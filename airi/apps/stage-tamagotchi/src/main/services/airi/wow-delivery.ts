import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { CompanionRelease, DeliveryCheck, DeliveryReport } from '../../../shared/wow-delivery'

import process from 'node:process'

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'
import { literal, looseObject, maxLength, parse, picklist, pipe, string } from 'valibot'

import { wowDeliveryInspect } from '../../../shared/eventa/wow-delivery'
import { gameProfiles, gameVersionSchema } from '../../../shared/wow-companion'
import { companionBridgeFiles, companionReleaseSchema } from '../../../shared/wow-delivery'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { CompanionBridgeRuntime } from './wow-companion-runtime'

const execFileAsync = promisify(execFile)
const healthSchema = looseObject({ ok: literal(true), service: literal('wow-companion-bridge'), game: gameVersionSchema, protocol: picklist(['WCP1', 'WCF1']), version: pipe(string(), maxLength(80)) })

interface DeliveryPaths {
  appPath: string
  resourcesPath: string
  userDataPath: string
  platform: NodeJS.Platform
  appVersion: string
}

function compare(actual: string | undefined, expected: string): DeliveryCheck {
  return { status: actual === expected ? 'passed' : 'failed', code: actual === expected ? 'version-match' : 'version-mismatch', actual, expected }
}

/** Owns bounded local resource reads and prerequisite probes. It never launches a bridge or installs a dependency. */
export class CompanionDelivery {
  private active: Promise<DeliveryReport> | undefined
  private closing = false
  private readonly runtime: CompanionBridgeRuntime

  constructor(private readonly paths: DeliveryPaths) {
    this.runtime = new CompanionBridgeRuntime(paths)
  }

  /** Concurrent refreshes share one probe. Each completed refresh returns newly observed evidence. */
  inspect() {
    if (this.closing)
      return Promise.reject(new Error('delivery-closed'))
    if (this.active)
      return this.active
    const operation = this.collect()
    this.active = operation
    void operation.finally(() => {
      if (this.active === operation)
        this.active = undefined
    }).catch(() => {})
    return operation
  }

  /** Stops accepting refreshes and waits for bounded interpreter probes before application shutdown. */
  async dispose() {
    this.closing = true
    await this.active?.catch(() => {})
    await this.runtime.dispose()
  }

  private async resource(path: string, maximum: number) {
    const parts = path.split('/')
    let current = this.paths.resourcesPath
    for (const [index, part] of parts.entries()) {
      current = join(current, part)
      const stat = await lstat(current)
      if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.size > maximum))
        throw new Error('delivery-resource-invalid')
    }
    return readFile(current)
  }

  private async collect(): Promise<DeliveryReport> {
    const unknown: DeliveryCheck = { status: 'unavailable', code: 'manifest-missing' }
    const result: DeliveryReport = {
      checkedAt: Date.now(),
      release: null,
      app: { status: 'unavailable', code: 'manifest-missing', actual: this.paths.appVersion },
      resources: { ...unknown, checked: 0, total: 0 },
      bundledBridge: { ...unknown },
      addons: { retail: { ...unknown }, forever: { ...unknown } },
      python: { status: 'unavailable', code: 'python-missing', expected: '3.10+' },
      runningBridges: { retail: { status: 'unavailable', code: 'bridge-not-running' }, forever: { status: 'unavailable', code: 'bridge-not-running' } },
    }
    let release: CompanionRelease | undefined
    try {
      const raw = await this.resource('wow-companion-release.json', 1024 * 1024)
      release = parse(companionReleaseSchema, JSON.parse(raw.toString('utf8')))
      result.release = release.releaseVersion
      result.app = compare(this.paths.appVersion, release.appVersion)
      await this.checkResources(release, result)
    }
    catch (error) {
      const missing = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
      result.resources = { ...result.resources, status: 'failed', code: missing && !release ? 'manifest-missing' : 'resources-invalid' }
    }
    const environment = await this.runtime.inspectEnvironment()
    result.python = { status: environment.python.status === 'passed' ? 'passed' : 'failed', code: environment.python.status === 'passed' ? 'python-ready' : this.paths.platform === 'win32' ? 'python-missing' : 'windows-required', expected: '3.10+', executable: environment.pythonPath }
    if (environment.pythonPath) {
      try {
        const probe = await execFileAsync(environment.pythonPath, ['-B', '-X', 'utf8', '-c', 'import ctypes,json,struct,threading,http.server,dataclasses,sys; print(sys.version.split()[0])'], { windowsHide: true, timeout: 3500, maxBuffer: 8192, encoding: 'utf8' })
        const version = probe.stdout.trim()
        if (!/^3\.\d+\.\d+$/.test(version) || Number(version.split('.')[1]) < 10)
          throw new Error('delivery-python-invalid')
        result.python.actual = version
      }
      catch {
        result.python.status = 'failed'
        result.python.code = 'python-broken'
      }
    }
    if (release) {
      const running = await Promise.all(['retail', 'forever'].map(game => this.runningBridge(game as 'retail' | 'forever', release.bridgeVersion)))
      result.runningBridges = { retail: running[0]!, forever: running[1]! }
    }
    return result
  }

  private async checkResources(release: CompanionRelease, result: DeliveryReport) {
    result.resources.total = release.files.length
    const catalog = new Set(release.files.map(file => file.path))
    const required = [
      ...companionBridgeFiles.map(file => `wow-companion-bridge/${file}`),
      'wow-companion-addons/WoWMapCompanion/WoWMapCompanion.toc',
      'wow-companion-addons/WoWForeverCompanion/WoWForeverCompanion.toc',
      'wow-companion-addons/WoWForeverCompanion/WoWForeverCompanion_Camelot.toc',
    ]
    if (required.some(path => !catalog.has(path)))
      throw new Error('delivery-resource-missing')
    const texts = new Map<string, string>()
    for (const file of release.files) {
      const data = await this.resource(file.path, 64 * 1024 * 1024)
      if (data.byteLength !== file.bytes || createHash('sha256').update(data).digest('hex') !== file.sha256)
        throw new Error('delivery-resource-damaged')
      if (file.path.endsWith('.toc') || file.path === 'wow-companion-bridge/server.py')
        texts.set(file.path, data.toString('utf8'))
      result.resources.checked++
    }
    for (const game of ['retail', 'forever'] as const) {
      const name = game === 'retail' ? 'WoWMapCompanion' : 'WoWForeverCompanion'
      const directory = `wow-companion-addons/${name}`
      const toc = texts.get(`${directory}/${name}.toc`)!
      const modules = toc.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
      if (!modules.length || modules.some(file => !/^[\w-]+\.lua$/.test(file) || !catalog.has(`${directory}/${file}`)))
        throw new Error('delivery-resource-missing')
      if (game === 'forever' && texts.get(`${directory}/${name}_Camelot.toc`) !== toc)
        throw new Error('delivery-resource-damaged')
      result.addons[game] = compare(toc.match(/^## Version:([^\r\n]+)$/m)?.[1]?.trim(), release.addons[game])
    }
    result.bundledBridge = compare(texts.get('wow-companion-bridge/server.py')?.match(/^VERSION = "([^"\r\n]+)"$/m)?.[1], release.bridgeVersion)
    result.resources.status = 'passed'
    result.resources.code = 'resources-ready'
  }

  private async runningBridge(game: 'retail' | 'forever', expected: string): Promise<DeliveryCheck> {
    try {
      // Only the fixed health endpoint is read. No status request can start or alter a bridge or game session.
      const response = await fetch(`http://127.0.0.1:${gameProfiles[game].port}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(1500) })
      if (!response.ok)
        throw new Error('delivery-bridge-unavailable')
      const raw = await response.text()
      if (raw.length > 16_384)
        throw new Error('delivery-bridge-invalid')
      const health = parse(healthSchema, JSON.parse(raw))
      if (health.game !== game || health.protocol !== (game === 'retail' ? 'WCP1' : 'WCF1'))
        return { status: 'failed', code: 'bridge-wrong-game', expected }
      return compare(health.version, expected)
    }
    catch {
      return { status: 'unavailable', code: 'bridge-not-running', expected }
    }
  }
}

/** The renderer can request only a read-only check of host-owned paths and loopback health endpoints. */
export function setupWowDelivery(context: ReturnType<typeof createContext>['context']) {
  const diagnostics = new CompanionDelivery({ appPath: app.getAppPath(), resourcesPath: process.resourcesPath, userDataPath: app.getPath('userData'), platform: process.platform, appVersion: app.getVersion() })
  const dispose = defineInvokeHandler(context, wowDeliveryInspect, () => diagnostics.inspect())
  onAppBeforeQuit(async () => {
    dispose()
    await diagnostics.dispose()
  })
}
