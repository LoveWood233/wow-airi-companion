import type { InferOutput } from 'valibot'

import type { WowDataUpdateCheck, WowDataUpdateConfig, WowDataUpdateError, WowDataUpdateJob, WowDataUpdateSnapshot, WowDataUpdateStatus } from '../../../shared/wow-data-update'
import type { RetailRuntimePaths } from './wow-retail-database-runtime'
import type { WowRetailDatabaseService } from './wow-retail-database-service'

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { retailDatabaseSourceSchema } from '@proj-airi/stage-shared/wow-knowledge'
import { literal, nullable, parse, strictObject, string } from 'valibot'

import { DataUpdateFailure, fingerprintRetailSource, fingerprintUpdateTools, hashUpdateFile, readActiveRetailBuild, WowDataUpdateRuntime } from './wow-data-update-runtime'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const storedConfigSchema = strictObject({ version: literal(1), gameRoot: nullable(string()), toolsRoot: nullable(string()), lastBuild: nullable(string()) })
const markerSchema = strictObject({
  format: literal('wow-companion-managed-db2'),
  version: literal(1),
  id: string(),
  gameRoot: string(),
  createdAt: string(),
  state: string(),
  source: nullable(retailDatabaseSourceSchema),
  databaseSha256: nullable(string()),
  fingerprint: nullable(string()),
})
const checks = (): WowDataUpdateCheck[] => ['python', 'dotnet', 'exporter', 'definitions', 'offline-guard'].map(id => ({ id: id as WowDataUpdateCheck['id'], status: 'unknown' }))
const running = new Set(['checking', 'exporting', 'building-sqlite', 'verifying'])

async function jsonFile(path: string, maximum = 64 * 1024 * 1024): Promise<unknown> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum)
    throw new DataUpdateFailure('verification-failed')
  return JSON.parse(await readFile(path, 'utf8'))
}

function samePath(left: string, right: string) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

function inside(parent: string, target: string) {
  const child = relative(resolve(parent), resolve(target))
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

/** Owns offline update jobs and immutable managed snapshots. Queries continue using the explicitly selected source. */
export class WowDataUpdateService {
  private config: WowDataUpdateConfig = { gameRoot: null, toolsRoot: null }
  private lastBuild: string | null = null
  private discovery: WowDataUpdateStatus['discovery'] = { build: null, previousBuild: null, changed: false, checkedAt: null }
  private checks = checks()
  private job: WowDataUpdateJob | null = null
  private errorCode: WowDataUpdateError | undefined
  private loading: Promise<void> | undefined
  private buildCheck: Promise<void> | undefined
  private configurationRevision = 0
  private active: Promise<void> | undefined
  private controller: AbortController | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private mutating = false
  private closed = false
  private readonly folder: string
  private readonly snapshotsRoot: string
  private readonly configFile: string
  private readonly runtime: WowDataUpdateRuntime
  private readonly userDataRoot: string
  private anchor: string | undefined

  constructor(paths: RetailRuntimePaths, private readonly database: WowRetailDatabaseService, runtime?: WowDataUpdateRuntime) {
    this.folder = join(paths.userDataPath, 'wow-data-updates')
    this.userDataRoot = paths.userDataPath
    this.snapshotsRoot = join(this.folder, 'snapshots')
    this.configFile = join(this.folder, 'settings-v1.json')
    this.runtime = runtime ?? new WowDataUpdateRuntime(paths)
  }

  private load() {
    this.loading ??= (async () => {
      try {
        if (!await this.managedRoot())
          return
        const saved = parse(storedConfigSchema, await jsonFile(this.configFile, 16_384))
        if ([saved.gameRoot, saved.toolsRoot].some(path => path !== null && (!isAbsolute(path) || path.length > 4096)))
          throw new Error('invalid')
        this.config = { gameRoot: saved.gameRoot, toolsRoot: saved.toolsRoot }
        this.lastBuild = saved.lastBuild
      }
      catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
          this.errorCode = 'configuration-invalid'
      }
    })()
    return this.loading
  }

  private async save() {
    await this.managedRoot(true)
    const temporary = `${this.configFile}.${randomUUID()}.tmp`
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ version: 1, ...this.config, lastBuild: this.lastBuild }), 'utf8')
        await handle.sync()
      }
      finally { await handle.close() }
      await rename(temporary, this.configFile)
    }
    finally { await unlink(temporary).catch(() => {}) }
  }

  /** The fixed appData anchor may resolve platform aliases; runner-owned descendants may never be links. */
  private async managedRoot(create = false, snapshots = false) {
    if (create)
      await mkdir(this.userDataRoot, { recursive: true })
    const exists = await lstat(this.userDataRoot).then(() => true, (error) => {
      if (error.code === 'ENOENT')
        return false
      throw error
    })
    if (!exists)
      return null
    let current = await realpath(this.userDataRoot)
    if (this.anchor && !samePath(this.anchor, current))
      throw new DataUpdateFailure('snapshot-invalid')
    this.anchor ??= current
    for (const component of ['wow-data-updates', ...(snapshots ? ['snapshots'] : [])]) {
      current = join(current, component)
      if (create) {
        await mkdir(current).catch((error) => {
          if (error.code !== 'EEXIST')
            throw error
        })
      }
      const info = await lstat(current).catch((error) => {
        if (error.code === 'ENOENT')
          return null
        throw error
      })
      if (!info)
        return null
      if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(current), current))
        throw new DataUpdateFailure('snapshot-invalid')
    }
    if (this.config.gameRoot && inside(this.config.gameRoot, current))
      throw new DataUpdateFailure('game-root-invalid')
    return current
  }

  async configure(key: 'gameRoot' | 'toolsRoot', selected: string) {
    await this.load()
    if (this.active || this.mutating || this.closed) {
      this.errorCode = 'busy'
      return this.status()
    }
    this.mutating = true
    // A running check may still be flushing its old configuration. Finish that commit before changing roots.
    await this.buildCheck?.catch(() => {})
    const previous = { ...this.config }
    const previousBuild = this.lastBuild
    try {
      if (this.closed)
        throw new DataUpdateFailure('busy')
      if (!isAbsolute(selected))
        throw new DataUpdateFailure(key === 'gameRoot' ? 'game-root-invalid' : 'tools-root-invalid')
      const path = await realpath(selected)
      if (!(await stat(path)).isDirectory() || path.length > 4096)
        throw new DataUpdateFailure(key === 'gameRoot' ? 'game-root-invalid' : 'tools-root-invalid')
      if (key === 'gameRoot') {
        const canonicalData = await realpath(this.userDataRoot).catch(() => null)
        if (inside(path, canonicalData ? join(canonicalData, 'wow-data-updates') : this.folder))
          throw new DataUpdateFailure('game-root-invalid')
        await readActiveRetailBuild(path)
        this.lastBuild = null
      }
      this.configurationRevision++
      this.config = { ...this.config, [key]: path }
      await this.save()
      this.errorCode = undefined
      this.checks = checks()
      if (key === 'gameRoot')
        await this.checkBuild(true)
    }
    catch (error) {
      this.config = previous
      this.lastBuild = previousBuild
      this.configurationRevision++
      this.errorCode = error instanceof DataUpdateFailure ? error.code : 'configuration-save-failed'
    }
    finally { this.mutating = false }
    return this.status()
  }

  /** Startup and five-minute checks read only build metadata. They never start export or model requests. */
  startMonitoring() {
    if (this.timer || this.closed)
      return
    void this.checkBuild()
    this.timer = setInterval(() => void this.checkBuild(), 300_000)
    this.timer.unref()
  }

  checkBuild(allowMutation = false) {
    const previous = this.buildCheck
    const operation = (async () => {
      await previous?.catch(() => {})
      await this.inspectBuild(allowMutation)
    })()
    this.buildCheck = operation
    void operation.finally(() => {
      if (this.buildCheck === operation)
        this.buildCheck = undefined
    }).catch(() => {})
    return operation
  }

  private async inspectBuild(allowMutation: boolean) {
    await this.load()
    if (!this.config.gameRoot || this.closed || (this.mutating && !allowMutation))
      return
    const root = this.config.gameRoot
    const revision = this.configurationRevision
    try {
      const found = await readActiveRetailBuild(root)
      if (this.closed || revision !== this.configurationRevision || root !== this.config.gameRoot)
        return
      if (this.lastBuild === null) {
        this.lastBuild = found.build
        await this.save()
      }
      const previousBuild = (await this.status()).activeSource?.build ?? this.lastBuild
      if (!this.closed && revision === this.configurationRevision && root === this.config.gameRoot)
        this.discovery = { build: found.build, previousBuild, changed: found.build !== previousBuild, checkedAt: new Date().toISOString() }
    }
    catch (error) {
      if (!this.closed && revision === this.configurationRevision && root === this.config.gameRoot)
        this.discovery = { build: null, previousBuild: this.lastBuild, changed: false, checkedAt: new Date().toISOString(), errorCode: error instanceof DataUpdateFailure ? error.code : 'build-info-invalid' }
    }
  }

  private async snapshots() {
    if (!await this.managedRoot(false, true).catch(() => null))
      return []
    const entries = await readdir(this.snapshotsRoot, { withFileTypes: true }).catch(() => [])
    const result: Array<{ path: string, marker: InferOutput<typeof markerSchema> }> = []
    for (const entry of entries) {
      const id = entry.name.slice('snapshot-'.length)
      if (!entry.name.startsWith('snapshot-') || !uuid.test(id) || !entry.isDirectory() || entry.isSymbolicLink())
        continue
      try {
        const path = join(this.snapshotsRoot, entry.name)
        const marker = await this.owned(path, 'snapshot', id)
        if (marker.state === 'ready' && marker.source && marker.databaseSha256 && marker.fingerprint)
          result.push({ path, marker })
      }
      catch { /* Unrecognized folders are neither listed nor removed. */ }
    }
    return result.sort((a, b) => b.marker.createdAt.localeCompare(a.marker.createdAt))
  }

  async status(): Promise<WowDataUpdateStatus> {
    await this.load()
    const selected = await this.database.status()
    const snapshots = await this.snapshots()
    const active = snapshots.find(entry => selected.path && samePath(join(entry.path, 'retail.sqlite3'), selected.path))
    const activeSource = active?.marker.source ?? this.database.currentSource()
    const previousBuild = activeSource?.build ?? this.lastBuild
    return structuredClone({
      config: this.config,
      discovery: { ...this.discovery, previousBuild, changed: Boolean(this.discovery.build && previousBuild && this.discovery.build !== previousBuild) },
      checks: this.checks,
      job: this.job,
      snapshots: snapshots.map(({ marker, path }): WowDataUpdateSnapshot => ({ id: marker.id, build: marker.source!.build, createdAt: marker.createdAt, source: marker.source!, selected: Boolean(selected.path && samePath(join(path, 'retail.sqlite3'), selected.path)) })),
      activeSnapshotId: active?.marker.id ?? null,
      activeSelection: selected.configured ? active ? 'managed' : 'external' : 'none',
      activeSource,
      ...(this.errorCode ? { errorCode: this.errorCode } : {}),
    })
  }

  async check() {
    await this.load()
    if (this.active || this.mutating || this.closed) {
      this.errorCode = 'busy'
      return this.status()
    }
    this.mutating = true
    try {
      await this.checkBuild(true)
      if (!this.config.toolsRoot)
        throw new DataUpdateFailure('tools-root-invalid')
      await this.runtime.inspect(this.config.toolsRoot, new AbortController().signal, value => this.updateCheck(value))
      this.errorCode = undefined
    }
    catch (error) { this.errorCode = error instanceof DataUpdateFailure ? error.code : 'filesystem-failed' }
    finally { this.mutating = false }
    return this.status()
  }

  private updateCheck(value: WowDataUpdateCheck) {
    this.checks = this.checks.map(check => check.id === value.id ? value : check)
  }

  async start() {
    await this.load()
    if (this.active || this.mutating || this.closed) {
      this.errorCode = 'busy'
      return this.status()
    }
    const startedAt = new Date().toISOString()
    this.job = { id: randomUUID(), phase: 'checking', build: null, startedAt, updatedAt: startedAt, completed: 0, total: null }
    this.errorCode = undefined
    this.controller = new AbortController()
    const operation = this.work(this.controller)
    this.active = operation
    void operation.finally(() => {
      if (this.active === operation) {
        this.active = undefined
        this.controller = undefined
      }
    }).catch(() => {})
    return this.status()
  }

  private phase(phase: WowDataUpdateJob['phase']) {
    this.job = { ...this.job!, phase, completed: 0, total: null, updatedAt: new Date().toISOString() }
  }

  private async work(controller: AbortController) {
    const id = this.job!.id
    const signal = controller.signal
    let candidate: { path: string, kind: 'staging' | 'snapshot' } | undefined
    try {
      const { gameRoot, toolsRoot } = this.config
      if (!gameRoot || !toolsRoot)
        throw new DataUpdateFailure(!gameRoot ? 'game-root-invalid' : 'tools-root-invalid')
      const before = await readActiveRetailBuild(gameRoot)
      const sourceFingerprint = await fingerprintRetailSource(gameRoot, signal)
      this.job = { ...this.job!, build: before.build }
      const environment = await this.runtime.inspect(toolsRoot, signal, value => this.updateCheck(value))
      signal.throwIfAborted()
      await this.managedRoot(true, true)
      const staging = join(this.snapshotsRoot, `staging-${id}`)
      await mkdir(staging)
      candidate = { path: staging, kind: 'staging' }
      const marker = { format: 'wow-companion-managed-db2', version: 1, id, gameRoot, createdAt: this.job!.startedAt, state: 'staging', source: null, databaseSha256: null, fingerprint: null }
      await this.writeMarker(staging, marker)
      this.phase('exporting')
      try {
        await this.runtime.processRunner.run(environment.dotnet, [join(toolsRoot, 'DB2Export', 'bin', 'Release', 'net8.0', 'DB2Export.dll'), gameRoot, join(toolsRoot, 'WoWDBDefs'), staging], toolsRoot, signal, (line) => {
          const match = /^(\d+)\/(\d+) [\w-]+:/.exec(line)
          if (match && Number(match[1]) <= Number(match[2]) && Number(match[2]) <= 20_000)
            this.job = { ...this.job!, completed: Number(match[1]), total: Number(match[2]), updatedAt: new Date().toISOString() }
        })
      }
      catch {
        signal.throwIfAborted()
        throw new DataUpdateFailure('export-failed')
      }
      this.phase('building-sqlite')
      try {
        await this.runtime.processRunner.run(environment.python, ['-B', join(toolsRoot, 'DB2Export', 'build_sqlite.py'), staging], toolsRoot, signal)
      }
      catch {
        signal.throwIfAborted()
        throw new DataUpdateFailure('sqlite-failed')
      }
      this.phase('verifying')
      let source
      try {
        await this.runtime.processRunner.run(environment.python, ['-B', join(toolsRoot, 'DB2Export', 'verify_export.py'), staging], toolsRoot, signal)
        await this.validateOutput(staging, before.build)
        source = await this.runtime.source(environment, join(staging, 'retail.sqlite3'), signal)
      }
      catch {
        signal.throwIfAborted()
        throw new DataUpdateFailure('verification-failed')
      }
      if (source.build !== before.build || source.locale !== 'zhCN' || source.hotfixesApplied)
        throw new DataUpdateFailure('verification-failed')
      const after = await readActiveRetailBuild(gameRoot)
      if (after.hash !== before.hash || after.build !== before.build || await fingerprintRetailSource(gameRoot, signal) !== sourceFingerprint
        || await fingerprintUpdateTools(toolsRoot, signal) !== environment.fingerprint) {
        throw new DataUpdateFailure('source-changed')
      }
      const databaseSha256 = await hashUpdateFile(join(staging, 'retail.sqlite3'), signal, 32 * 1024 * 1024 * 1024)
      await this.writeMarker(staging, { ...marker, state: 'ready', source, databaseSha256, fingerprint: environment.fingerprint })
      const destination = join(this.snapshotsRoot, `snapshot-${id}`)
      const promoted = await this.database.withUnselectedSnapshot(await realpath(staging), async () => {
        await this.owned(staging, 'staging', id, true)
        await this.destination(destination, id)
        signal.throwIfAborted()
        await rename(staging, destination)
        candidate = { path: destination, kind: 'snapshot' }
      })
      if (!promoted)
        throw new DataUpdateFailure('busy')
      signal.throwIfAborted()
      this.job = { ...this.job!, phase: 'ready', snapshotId: id, completed: 0, total: null, updatedAt: new Date().toISOString() }
      candidate = undefined
      this.lastBuild = before.build
      await this.save()
      await this.checkBuild()
      await this.prune()
    }
    catch (error) {
      const code = signal.aborted ? 'cancelled' : error instanceof DataUpdateFailure ? error.code : 'filesystem-failed'
      this.job = { ...this.job!, phase: signal.aborted ? 'cancelled' : 'failed', errorCode: code, updatedAt: new Date().toISOString() }
      if (candidate) {
        const rejected = candidate
        await realpath(rejected.path).then(path => this.database.withUnselectedSnapshot(path, () => this.remove(rejected.path, rejected.kind, id))).catch(() => {})
      }
    }
  }

  private async validateOutput(folder: string, build: string) {
    const manifest = await jsonFile(join(folder, 'export-manifest.json'))
    const summary = await jsonFile(join(folder, 'summary.json'))
    const verification = await jsonFile(join(folder, 'verification.json'))
    if (!manifest || typeof manifest !== 'object')
      throw new DataUpdateFailure('verification-failed')
    const metadata = parse(strictObject({ build: string(), locale: string(), product: string(), localOnly: literal(true), hotfixesApplied: literal(false) }), Object.fromEntries(Object.entries(manifest).filter(([key]) => ['build', 'locale', 'product', 'localOnly', 'hotfixesApplied'].includes(key))))
    if (metadata.build !== build || metadata.locale !== 'zhCN' || metadata.product !== 'wow' || !manifest || typeof manifest !== 'object' || !('tables' in manifest) || !Array.isArray(manifest.tables))
      throw new DataUpdateFailure('verification-failed')
    let hashes = 0
    let rows = 0
    for (const value of manifest.tables) {
      if (!value || typeof value !== 'object' || !('Status' in value) || typeof value.Status !== 'string' || !('Rows' in value) || typeof value.Rows !== 'number' || !Number.isSafeInteger(value.Rows) || value.Rows < 0)
        throw new DataUpdateFailure('verification-failed')
      if ('Sha256' in value && value.Sha256)
        hashes++
      if (value.Status.startsWith('decoded'))
        rows += Number(value.Rows)
    }
    if (!summary || typeof summary !== 'object' || !('build' in summary) || summary.build !== build || !('rows' in summary) || summary.rows !== rows
      || !('sqlite_integrity' in summary) || summary.sqlite_integrity !== 'ok'
      || !verification || typeof verification !== 'object' || !('sqlite_integrity' in verification) || verification.sqlite_integrity !== 'ok'
      || !('rows_verified' in verification) || verification.rows_verified !== rows || !('raw_hashes_verified' in verification) || verification.raw_hashes_verified !== hashes || hashes === 0) {
      throw new DataUpdateFailure('verification-failed')
    }
  }

  private async writeMarker(directory: string, marker: object) {
    const temporary = join(directory, `.owner-${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(marker), 'utf8')
        await handle.sync()
      }
      finally { await handle.close() }
      await rename(temporary, join(directory, '.owner.json'))
    }
    finally { await unlink(temporary).catch(() => {}) }
  }

  private async owned(path: string, kind: 'staging' | 'snapshot', id: string, tree = false) {
    if (!uuid.test(id) || basename(path) !== `${kind}-${id}`)
      throw new DataUpdateFailure('snapshot-invalid')
    if (!await this.managedRoot(false, true))
      throw new DataUpdateFailure('snapshot-invalid')
    const rootInfo = await lstat(this.snapshotsRoot)
    const info = await lstat(path)
    const root = await realpath(this.snapshotsRoot)
    const target = await realpath(path)
    if (rootInfo.isSymbolicLink() || !info.isDirectory() || info.isSymbolicLink() || !samePath(dirname(target), root))
      throw new DataUpdateFailure('snapshot-invalid')
    const marker = parse(markerSchema, await jsonFile(join(path, '.owner.json'), 32_768))
    if (marker.id !== id || !isAbsolute(marker.gameRoot) || inside(marker.gameRoot, target) || (this.config.gameRoot && inside(this.config.gameRoot, target)))
      throw new DataUpdateFailure('snapshot-invalid')
    if (tree) {
      let visited = 0
      const scan = async (directory: string, depth = 0) => {
        if (depth > 8)
          throw new DataUpdateFailure('snapshot-invalid')
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (++visited > 20_000 || entry.isSymbolicLink())
            throw new DataUpdateFailure('snapshot-invalid')
          if (entry.isDirectory())
            await scan(join(directory, entry.name), depth + 1)
        }
      }
      await scan(target)
    }
    return marker
  }

  private async destination(path: string, id: string) {
    if (!uuid.test(id) || basename(path) !== `snapshot-${id}` || !samePath(await realpath(dirname(path)), await realpath(this.snapshotsRoot))
      || (this.config.gameRoot && inside(this.config.gameRoot, path))) {
      throw new DataUpdateFailure('snapshot-invalid')
    }
    if (await lstat(path).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)))
      throw new DataUpdateFailure('snapshot-invalid')
  }

  private async remove(path: string, kind: 'staging' | 'snapshot', id: string) {
    await this.owned(path, kind, id, true)
    await rm(path, { recursive: true, force: false })
  }

  private async prune() {
    // Recompute under the selection lease. Repeated user selections may postpone cleanup, never delete the selected source.
    for (let pass = 0; pass < 3; pass++) {
      const snapshots = await this.snapshots()
      if (snapshots.length <= 2)
        return
      for (const entry of snapshots) {
        await this.database.withUnselectedSnapshot(await realpath(entry.path), async () => {
          const selected = await this.database.status()
          const active = snapshots.find(candidate => selected.path && samePath(selected.path, join(candidate.path, 'retail.sqlite3')))
          const keep = active
            ? [active.marker.id, snapshots.find(candidate => candidate.marker.id !== active.marker.id)?.marker.id]
            : snapshots.slice(0, 2).map(candidate => candidate.marker.id)
          if (!keep.includes(entry.marker.id))
            await this.remove(entry.path, 'snapshot', entry.marker.id)
        })
      }
    }
  }

  async cancel() {
    if (this.active) {
      if (this.job && running.has(this.job.phase))
        this.controller?.abort()
      await this.active
    }
    return this.status()
  }

  async activate(id: string) {
    await this.load()
    if (this.active || this.mutating || this.closed) {
      this.errorCode = 'busy'
      return this.status()
    }
    this.mutating = true
    try {
      const path = join(this.snapshotsRoot, `snapshot-${id}`)
      const marker = await this.owned(path, 'snapshot', id, true)
      if (marker.state !== 'ready' || !marker.source || !marker.databaseSha256
        || await hashUpdateFile(join(path, 'retail.sqlite3'), undefined, 32 * 1024 * 1024 * 1024) !== marker.databaseSha256) {
        throw new DataUpdateFailure('snapshot-invalid')
      }
      const result = await this.database.select(join(path, 'retail.sqlite3'))
      if (result.errorCode || !result.path || !samePath(result.path, join(path, 'retail.sqlite3')))
        throw new DataUpdateFailure('activation-failed')
      this.errorCode = undefined
      await this.prune()
      await this.checkBuild(true)
    }
    catch (error) { this.errorCode = error instanceof DataUpdateFailure ? error.code : 'snapshot-invalid' }
    finally { this.mutating = false }
    return this.status()
  }

  async dispose() {
    this.closed = true
    clearInterval(this.timer)
    this.timer = undefined
    this.controller?.abort()
    await this.active
    await this.buildCheck
  }
}
