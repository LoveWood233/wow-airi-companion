import type { CompanionRelease } from '../../../shared/wow-delivery'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CompanionDelivery } from './wow-delivery'

const mocks = vi.hoisted(() => ({ run: vi.fn(), health: vi.fn() }))
vi.mock('electron', () => ({ app: {} }))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: mocks.run }),
}))

describe('companion release diagnostics', () => {
  let directory: string
  let resources: string
  let executable: string
  let manifest: CompanionRelease
  let delivery: CompanionDelivery

  async function saveManifest() {
    await writeFile(join(resources, 'wow-companion-release.json'), JSON.stringify(manifest))
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    directory = await mkdtemp(join(tmpdir(), 'wow-delivery-'))
    resources = join(directory, 'resources')
    await mkdir(resources)
    await mkdir(join(resources, 'wow-companion-python'))
    executable = join(resources, 'wow-companion-python', 'python.exe')
    await writeFile(executable, 'external process boundary')
    vi.stubEnv('PATH', directory)
    vi.stubGlobal('fetch', mocks.health)
    mocks.run.mockImplementation(async (_executable: string, args: string[]) => ({ stdout: args.at(-1)?.includes('sys.version_info.major')
      ? JSON.stringify({ executable, major: 3, minor: 13 })
      : '3.13.2\n', stderr: '' }))
    mocks.health.mockImplementation(async (address: string) => new Response(JSON.stringify({ ok: true, service: 'wow-companion-bridge', version: '2.15.0', game: address.includes(':18766/') ? 'forever' : 'retail', protocol: address.includes(':18766/') ? 'WCF1' : 'WCP1' })))
    const contents = new Map<string, string>()
    for (const file of ['server.py', 'capture.py', 'geometry.py', 'connection.py', 'window.py', 'protocol.py', 'state.py', 'item_storage.py', 'macro_import.py', 'macro_native.py', 'retail_query.py', 'index.html'])
      contents.set(`wow-companion-bridge/${file}`, file === 'server.py' ? 'VERSION = "2.15.0"\n' : 'resource')
    for (const [game, version] of [['WoWMapCompanion', '2.15.0'], ['WoWForeverCompanion', '1.13.0']]) {
      const toc = `## Version: ${version}\nCore.lua\n`
      contents.set(`wow-companion-addons/${game}/${game}.toc`, toc)
      contents.set(`wow-companion-addons/${game}/Core.lua`, '-- addon')
      if (game === 'WoWForeverCompanion')
        contents.set(`wow-companion-addons/${game}/${game}_Camelot.toc`, toc)
    }
    manifest = { format: 'wow-companion-release', version: 1, releaseVersion: '2.21.0', appVersion: '0.12.0-beta.5', bridgeVersion: '2.15.0', addons: { retail: '2.15.0', forever: '1.13.0' }, python: { minimum: '3.10', modules: [] }, files: [] }
    for (const [path, value] of contents) {
      await mkdir(dirname(join(resources, path)), { recursive: true })
      await writeFile(join(resources, path), value)
      manifest.files.push({ path, bytes: Buffer.byteLength(value), sha256: createHash('sha256').update(value).digest('hex') })
    }
    await saveManifest()
    delivery = new CompanionDelivery({ appPath: join(directory, 'app'), resourcesPath: resources, userDataPath: join(directory, 'user'), platform: 'win32', appVersion: '0.12.0-beta.5' })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir(), 'wow-delivery-')))
      throw new Error('Refusing to remove a directory outside the delivery test prefix')
    await rm(target, { recursive: true, force: true })
  })

  it('verifies resources and versions without installing or starting a bridge', async () => {
    const report = await delivery.inspect()
    expect(report.release).toBe('2.21.0')
    expect(report.app.status).toBe('passed')
    expect(report.resources).toEqual({ status: 'passed', code: 'resources-ready', checked: 17, total: 17 })
    expect(report.bundledBridge.status).toBe('passed')
    expect(report.addons.forever.status).toBe('passed')
    expect(report.python.status).toBe('passed')
    expect(report.python.actual).toBe('3.13.2')
    expect(mocks.health).toHaveBeenCalledTimes(2)
    expect(mocks.run.mock.calls.every(([, args]) => args.includes('-c') && !args.includes('server.py'))).toBe(true)
    expect(report.runningBridges.retail.status).toBe('passed')
    expect(report.runningBridges.forever.status).toBe('passed')
  })

  it('reports a damaged resource and keeps observed app and Python evidence', async () => {
    await writeFile(join(resources, 'wow-companion-bridge', 'capture.py'), 'damaged')
    const report = await delivery.inspect()
    expect(report.resources.status).toBe('failed')
    expect(report.resources.code).toBe('resources-invalid')
    expect(report.app.status).toBe('passed')
    expect(report.python.status).toBe('passed')
  })

  it('rejects missing inventory entries and arbitrary filesystem paths', async () => {
    manifest.files = manifest.files.filter(file => !file.path.endsWith('/window.py'))
    await saveManifest()
    expect((await delivery.inspect()).resources.status).toBe('failed')
    manifest.files[0]!.path = '../private.json'
    await saveManifest()
    const invalid = await delivery.inspect()
    expect(invalid.release).toBeNull()
    expect(invalid.resources.code).toBe('resources-invalid')
  })

  it('does not accept a missing manifest as a matched packaged build', async () => {
    await rm(join(resources, 'wow-companion-release.json'))
    const report = await delivery.inspect()
    expect(report.resources.code).toBe('manifest-missing')
    expect(report.app.status).toBe('unavailable')
    expect(report.release).toBeNull()
    expect(mocks.health).not.toHaveBeenCalled()
  })

  it('compares metadata with observed files and the running bridge independently', async () => {
    manifest.appVersion = '0.13.0'
    manifest.bridgeVersion = '2.16.0'
    manifest.addons.retail = '2.16.0'
    await saveManifest()
    const report = await delivery.inspect()
    expect(report.app.code).toBe('version-mismatch')
    expect(report.resources.status).toBe('passed')
    expect(report.bundledBridge.actual).toBe('2.15.0')
    expect(report.bundledBridge.code).toBe('version-mismatch')
    expect(report.addons.retail.code).toBe('version-mismatch')
    expect(report.runningBridges.retail.code).toBe('version-mismatch')
  })

  it('keeps a missing health response unavailable and rejects a wrong game', async () => {
    mocks.health.mockRejectedValueOnce(new Error('Connection refused'))
    mocks.health.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, service: 'wow-companion-bridge', game: 'retail', protocol: 'WCP1', version: '2.15.0' })))
    const report = await delivery.inspect()
    expect(report.runningBridges.retail.status).toBe('unavailable')
    expect(report.runningBridges.forever.code).toBe('bridge-wrong-game')
  })

  it('reports Python version or standard library failures without installing packages', async () => {
    mocks.run.mockImplementation(async (_path: string, args: string[]) => {
      if (!args.at(-1)?.includes('sys.version_info.major'))
        throw new Error('No ctypes')
      return { stdout: JSON.stringify({ executable, major: 3, minor: 13 }), stderr: '' }
    })
    expect((await delivery.inspect()).python.code).toBe('python-broken')
    mocks.run.mockResolvedValue({ stdout: JSON.stringify({ executable, major: 3, minor: 9 }), stderr: '' })
    expect((await delivery.inspect()).python.code).toBe('python-missing')
  })

  it('shares concurrent checks and waits for the active probe during shutdown', async () => {
    const probe = Promise.withResolvers<{ stdout: string, stderr: string }>()
    mocks.run.mockReturnValueOnce(probe.promise)
    const first = delivery.inspect()
    expect(delivery.inspect()).toBe(first)
    const shutdown = delivery.dispose()
    await expect(delivery.inspect()).rejects.toThrow('delivery-closed')
    probe.resolve({ stdout: JSON.stringify({ executable, major: 3, minor: 13 }), stderr: '' })
    await first
    await shutdown
    expect(mocks.health).toHaveBeenCalledTimes(2)
  })
})
