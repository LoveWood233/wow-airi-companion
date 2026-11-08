import type { RetailDatabaseError, RetailDatabaseQuery, RetailDatabaseResult, RetailDatabaseSource, WowDataCacheKey, WowDataCachePort } from '@proj-airi/stage-shared/wow-knowledge'

import type { WowRetailDatabaseStatus } from '../../../shared/wow-retail-database'
import type { RetailRuntimePaths } from './wow-retail-database-runtime'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, sep } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { readWowRetailAnswer, retailDatabaseQuerySchema, retailDatabaseResultSchema, WOW_STATIC_CACHE_TTL_MS } from '@proj-airi/stage-shared/wow-knowledge'
import { maxLength, nullable, parse, pipe, safeParse, strictObject, string } from 'valibot'

import { WowRetailDatabaseRuntime } from './wow-retail-database-runtime'

const configSchema = strictObject({ path: nullable(pipe(string(), maxLength(4096))) })

function failure(operation: RetailDatabaseQuery['operation'], errorCode: RetailDatabaseError): RetailDatabaseResult {
  return { operation, outcome: 'error', source: null, entries: [], offset: 0, limit: 0, hasMore: false, notices: [], errorCode, receivedAt: new Date().toISOString() }
}

/** Owns one selected snapshot and rejects late results after a selection changes. */
export class WowRetailDatabaseService {
  private path: string | null = null
  private revision = 0
  private loading: Promise<void> | undefined
  private changing: Promise<WowRetailDatabaseStatus> | undefined
  private runtime: WowRetailDatabaseRuntime | undefined
  private candidate: WowRetailDatabaseRuntime | undefined
  private errorCode: string | undefined
  private closing = false
  private source: RetailDatabaseSource | null = null

  constructor(private readonly configFile: string, private readonly paths: RetailRuntimePaths, private readonly cache?: WowDataCachePort) {}

  currentSource() { return this.source }

  /** Selection commits wait for filesystem cleanup. Cleanup cannot remove a directory containing the selected database. */
  withUnselectedSnapshot(directory: string, operation: () => Promise<void>): Promise<boolean> {
    if (!isAbsolute(directory))
      return Promise.reject(new Error('database-invalid'))
    const previous = this.changing
    let cleaned = false
    const transition = (async () => {
      await previous?.catch(() => {})
      await this.load()
      const parent = (await realpath(directory)).toLowerCase()
      const selected = this.path ? await realpath(this.path).then(value => value.toLowerCase(), () => undefined) : undefined
      if (this.path && !selected)
        return this.state()
      if (!this.closing && (!selected || (selected !== parent && !selected.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`)))) {
        await operation()
        cleaned = true
      }
      return this.state()
    })()
    this.changing = transition
    void transition.finally(() => {
      if (this.changing === transition)
        this.changing = undefined
    }).catch(() => {})
    return transition.then(() => cleaned)
  }

  private load() {
    this.loading ??= (async () => {
      try {
        const info = await stat(this.configFile)
        if (!info.isFile() || info.size > 16_384)
          throw new Error('configuration-invalid')
        this.path = parse(configSchema, JSON.parse(await readFile(this.configFile, 'utf8'))).path
        if (this.path !== null && !isAbsolute(this.path))
          throw new Error('configuration-invalid')
      }
      catch (error) {
        this.path = null
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
          this.errorCode = 'configuration-invalid'
      }
    })()
    return this.loading
  }

  private state(): WowRetailDatabaseStatus {
    return { configured: this.path !== null, ...(this.path ? { path: this.path } : {}), revision: this.revision, ...(this.errorCode ? { errorCode: this.errorCode } : {}) }
  }

  async status() {
    await this.load()
    return this.state()
  }

  private async save(path: string | null) {
    const temporary = `${this.configFile}.${randomUUID()}.tmp`
    try {
      await mkdir(dirname(this.configFile), { recursive: true })
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ path }), 'utf8')
        await handle.sync()
      }
      finally { await handle.close() }
      await rename(temporary, this.configFile)
    }
    finally { await unlink(temporary).catch(() => {}) }
  }

  /** Only a native file-picker result reaches this method. Validation precedes activation and durable configuration. */
  select(path: string | null) {
    const revision = ++this.revision
    this.cache?.invalidate()
    const previous = this.changing
    const operation = (async () => {
      await previous?.catch(() => {})
      await this.load()
      if (this.closing || revision !== this.revision)
        return this.state()
      this.errorCode = undefined
      this.source = null
      await this.runtime?.dispose()
      this.runtime = undefined
      let candidate: WowRetailDatabaseRuntime | undefined
      let candidateSource: RetailDatabaseSource | null = null
      try {
        let selected: string | null = null
        if (path !== null) {
          if (!isAbsolute(path) || path.length > 4096)
            throw new Error('database-invalid')
          selected = await realpath(path)
          const info = await stat(selected)
          if (!info.isFile())
            throw new Error('database-invalid')
          candidate = new WowRetailDatabaseRuntime(this.paths, selected)
          this.candidate = candidate
          const result = await candidate.query({ operation: 'stats' })
          if (result.outcome !== 'ok' || !result.source)
            throw new Error(result.errorCode ?? 'database-invalid')
          candidateSource = result.source
        }
        if (revision !== this.revision || this.closing)
          return this.state()
        await this.save(selected)
        // Later selections wait for this commit. Disk and memory retain the same last validated selection.
        this.path = selected
        this.source = candidateSource
        this.runtime = candidate
        candidate = undefined
      }
      catch (error) {
        if (revision === this.revision) {
          const message = errorMessageFrom(error) ?? ''
          this.errorCode = error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
            ? 'database-missing'
            : ['database-invalid', 'database-missing', 'database-unreadable', 'bridge-unavailable'].includes(message) ? message : 'configuration-save-failed'
        }
      }
      finally {
        await candidate?.dispose()
        this.candidate = undefined
      }
      return this.state()
    })()
    this.changing = operation
    void operation.finally(() => {
      if (this.changing === operation)
        this.changing = undefined
    }).catch(() => {})
    return operation
  }

  async query(input: unknown): Promise<RetailDatabaseResult> {
    const parsed = safeParse(retailDatabaseQuerySchema, input)
    if (!parsed.success)
      return failure('stats', 'query-invalid')
    const query = parsed.output
    const revision = this.revision
    await this.load()
    await this.changing?.catch(() => {})
    if (this.closing || revision !== this.revision)
      return failure(query.operation, 'database-changed')
    if (!this.path)
      return failure(query.operation, 'database-unconfigured')
    const selectedPath = this.path
    const runtime = this.runtime ??= new WowRetailDatabaseRuntime(this.paths, selectedPath)
    const cacheGeneration = this.cache?.generation
    let cacheKey: WowDataCacheKey | undefined
    try {
      if (this.cache && query.operation !== 'stats') {
        const summary = await runtime.query({ operation: 'stats' })
        if (revision !== this.revision || this.closing)
          return failure(query.operation, 'database-changed')
        if (summary.outcome !== 'ok' || !summary.source)
          return failure(query.operation, summary.errorCode ?? 'query-failed')
        this.source = summary.source
        cacheKey = {
          game: 'retail',
          source: 'retail-db2',
          build: summary.source.build,
          locale: summary.source.locale,
          snapshot: summary.source.datasetId,
          connection: createHash('sha256').update(selectedPath).digest('hex'),
          tool: `retail::${query.operation}`,
          args: query,
        }
        try {
          const cached = await this.cache.get(cacheKey)
          if (revision !== this.revision || this.closing)
            return failure(query.operation, 'database-changed')
          const value = cached && safeParse(retailDatabaseResultSchema, cached.data)
          if (cacheGeneration === this.cache.generation && cached && value && value.success
            && value.output.source?.datasetId === summary.source.datasetId && value.output.outcome !== 'error'
            && cached.cache.sourceReceivedAt === value.output.receivedAt
            && readWowRetailAnswer(value.output, JSON.stringify({ request: JSON.stringify(query) })).status !== 'invalid') {
            return { ...value.output, cache: cached.cache }
          }
        }
        catch { /* A disposable cache failure cannot prevent a fresh source query. */ }
      }
      const result = await runtime.query(query)
      if (revision !== this.revision || this.closing)
        return failure(query.operation, 'database-changed')
      if (readWowRetailAnswer(result, JSON.stringify({ request: JSON.stringify(query) })).status === 'invalid') {
        return failure(query.operation, 'query-failed')
      }
      if (result.source)
        this.source = result.source
      if (cacheKey && this.cache && cacheGeneration !== undefined && result.outcome !== 'error' && result.source?.datasetId === cacheKey.snapshot) {
        try {
          const evidence = await this.cache.put(cacheKey, result, { ttlMs: WOW_STATIC_CACHE_TTL_MS, sourceReceivedAt: result.receivedAt, generation: cacheGeneration })
          if (revision !== this.revision || this.closing)
            return failure(query.operation, 'database-changed')
          if (evidence)
            return { ...result, cache: evidence }
        }
        catch { /* The validated source response remains available when persistence fails. */ }
      }
      return result
    }
    catch {
      if (this.runtime === runtime)
        this.runtime = undefined
      await runtime.dispose()
      return failure(query.operation, revision === this.revision && !this.closing ? 'bridge-unavailable' : 'database-changed')
    }
  }

  async dispose() {
    this.closing = true
    this.revision++
    await this.candidate?.dispose()
    await this.runtime?.dispose()
    await this.changing?.catch(() => {})
  }
}
