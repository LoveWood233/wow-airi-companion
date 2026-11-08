import type { CompanionRelease } from '../../src/shared/wow-delivery'

import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { companionReleaseVersion, generateReleaseManifest, writeUpdateManifest } from './files'

describe('companion release resources and executable inventory', () => {
  let root: string
  let project: string
  let source: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wow-release-'))
    project = join(root, 'app')
    source = join(root, 'source')
    await mkdir(project)
    await writeFile(join(project, 'package.json'), '{"version":"0.12.0-beta.5"}')
    const bridge = join(source, 'WoWCompanionBridge')
    await mkdir(bridge, { recursive: true })
    for (const file of ['server.py', 'capture.py', 'geometry.py', 'connection.py', 'window.py', 'protocol.py', 'state.py', 'item_storage.py', 'macro_import.py', 'macro_native.py', 'retail_query.py', 'index.html'])
      await writeFile(join(bridge, file), file === 'server.py' ? 'VERSION = "2.15.0"\n' : file)
    const python = join(project, 'resources', 'wow-companion-python')
    await mkdir(python, { recursive: true })
    for (const file of ['python.exe', 'python3.dll', 'python314.dll', 'python314.zip', 'python314._pth', 'LICENSE.txt'])
      await writeFile(join(python, file), file)
    for (const [name, version] of [['WoWMapCompanion', '2.15.0'], ['WoWForeverCompanion', '1.13.0']] as const) {
      const folder = join(source, name)
      await mkdir(folder)
      const toc = `## Version: ${version}\nMain.lua\n`
      await writeFile(join(folder, `${name}.toc`), toc)
      await writeFile(join(folder, 'Main.lua'), '-- UTF-8: 陪伴精灵\n')
      if (name === 'WoWForeverCompanion')
        await writeFile(join(folder, `${name}_Camelot.toc`), toc)
    }
  })

  afterEach(async () => {
    const absolute = resolve(root)
    expect(dirname(absolute)).toBe(resolve(tmpdir()))
    expect(basename(absolute).startsWith('wow-release-')).toBe(true)
    await rm(absolute, { recursive: true, force: true })
  })

  async function packed() {
    const release = await generateReleaseManifest(project, source)
    const out = join(root, 'win-unpacked')
    await mkdir(join(out, 'resources'), { recursive: true })
    await cp(join(project, 'resources', 'wow-companion-release.json'), join(out, 'resources', 'wow-companion-release.json'))
    await writeFile(join(out, 'wow-companion.exe'), 'Final executable bytes after resource editing')
    await writeFile(join(out, 'resources', 'app.asar'), 'Application archive')
    await writeFile(join(out, 'resources', 'wow-local-update.ps1'), 'Update helper')
    for (const file of release.files) {
      const resource = file.path.replace('wow-companion-bridge/', 'WoWCompanionBridge/').replace('wow-companion-addons/', '')
      await mkdir(dirname(join(out, 'resources', file.path)), { recursive: true })
      const input = file.path.startsWith('wow-companion-python/') ? join(project, 'resources', file.path) : join(source, resource)
      await cp(input, join(out, 'resources', file.path))
    }
    return { out, release }
  }

  it('derives independent product, app, bridge, and addon versions from the release sources', async () => {
    await writeFile(join(source, 'WoWCompanionBridge', 'bridge-config.json'), '{"private":"not packaged"}')
    const release = await generateReleaseManifest(project, source)
    expect(release.releaseVersion).toBe(companionReleaseVersion)
    expect(release.appVersion).toBe('0.12.0-beta.5')
    expect(release.bridgeVersion).toBe('2.15.0')
    expect(release.addons).toEqual({ retail: '2.15.0', forever: '1.13.0' })
    expect(release.python).toEqual({ minimum: '3.10', modules: [] })
    expect(release.files).toHaveLength(23)
    expect(release.files.some(file => file.path === 'wow-companion-python/python.exe')).toBe(true)
    expect(release.files.some(file => file.path === 'wow-companion-bridge/item_storage.py')).toBe(true)
    expect(JSON.stringify(release)).not.toContain('bridge-config.json')
    const saved: CompanionRelease = JSON.parse(await readFile(join(project, 'resources', 'wow-companion-release.json'), 'utf8'))
    expect(saved).toEqual(release)
    const raw = await readFile(join(source, 'WoWMapCompanion', 'Main.lua'))
    expect(release.files.find(file => file.path.endsWith('WoWMapCompanion/Main.lua'))?.sha256).toBe(createHash('sha256').update(raw).digest('hex'))
  })

  it('rejects missing declared modules and mismatched Infinite manifests', async () => {
    const toc = join(source, 'WoWMapCompanion', 'WoWMapCompanion.toc')
    await writeFile(toc, '## Version: 2.15.0\nMissing.lua\n')
    await expect(generateReleaseManifest(project, source)).rejects.toThrow()
    await writeFile(toc, '## Version: 2.15.0\nMain.lua\n')
    await writeFile(join(source, 'WoWForeverCompanion', 'WoWForeverCompanion_Camelot.toc'), '## Version: 1.12.0\nMain.lua\n')
    await expect(generateReleaseManifest(project, source)).rejects.toThrow('Infinite addon TOC files differ')
  })

  it('refuses an incomplete embedded runtime and tracks its final bytes in the executable inventory', async () => {
    const runtime = join(project, 'resources', 'wow-companion-python')
    await unlink(join(runtime, 'python314.zip'))
    await expect(generateReleaseManifest(project, source)).rejects.toThrow('Release Python runtime is incomplete')
    await writeFile(join(runtime, 'python314.zip'), 'stdlib')
    const { out } = await packed()
    const manifest = await writeUpdateManifest(out)
    expect(manifest.files.some(file => file.path === 'resources/wow-companion-python/python314.zip')).toBe(true)
    await writeFile(join(out, 'resources', 'wow-companion-python', 'python.exe'), 'damaged')
    await expect(writeUpdateManifest(out)).rejects.toThrow('Bundled resource differs')
  })

  it('hashes every packaged file after editing and signing and excludes only its own root manifest', async () => {
    const { out, release } = await packed()
    const manifest = await writeUpdateManifest(out)
    expect(manifest.entry).toBe('wow-companion.exe')
    expect(manifest.files).toHaveLength(release.files.length + 4)
    expect(manifest.files.some(file => file.path === 'resources/wow-local-update.ps1')).toBe(true)
    expect(manifest.files.some(file => file.path === 'wow-companion-update.json')).toBe(false)
    const expected = createHash('sha256').update(await readFile(join(out, 'wow-companion.exe'))).digest('hex')
    expect(manifest.files.find(file => file.path === 'wow-companion.exe')?.sha256).toBe(expected)
    expect(await writeUpdateManifest(out)).toEqual(manifest)
    expect(JSON.parse(await readFile(join(out, 'wow-companion-update.json'), 'utf8'))).toEqual(manifest)
  })

  it('refuses a package whose bundled bytes disagree with its resource manifest', async () => {
    const { out } = await packed()
    await writeFile(join(out, 'resources', 'wow-companion-bridge', 'capture.py'), 'damaged')
    await expect(writeUpdateManifest(out)).rejects.toThrow('Bundled resource differs')
  })

  it('refuses links in an executable payload instead of following them into other files', async () => {
    const { out } = await packed()
    const target = join(root, 'outside')
    await mkdir(target)
    await writeFile(join(target, 'private.txt'), 'outside')
    await symlink(target, join(out, 'linked'), 'junction')
    await expect(writeUpdateManifest(out)).rejects.toThrow('Release payload contains a link')
  })
})
