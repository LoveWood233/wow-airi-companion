import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { WowDataCacheEvidence, WowDataCacheKey, WowDataCachePort, WowDataCacheRecord } from '@proj-airi/stage-shared/wow-knowledge'

import type { WowDataCacheStatus } from '../../../shared/wow-data-cache'

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath, rename, unlink, utimes } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { serializeWowDataCacheKey, WOW_AUCTION_CACHE_TTL_MS, WOW_STATIC_CACHE_TTL_MS, wowDataCacheEvidenceSchema } from '@proj-airi/stage-shared/wow-knowledge'
import { literal, parse, strictObject, string, unknown } from 'valibot'

import { wowDataCacheClear, wowDataCacheStatus } from '../../../shared/eventa/wow-data-cache'

const MAX_BYTES = 256 * 1024 * 1024
const MAX_RECORD_BYTES = 2 * 1024 * 1024
const MAX_ENTRIES = 4096
const recordSchema = strictObject({ version: literal(1), keyHash: string(), data: unknown(), sourceReceivedAt: string(), storedAt: string(), expiresAt: string() })
interface StoredFile { path: string, bytes: number, usedAt: number, expiresAt: number }

/** One main-process owner bounds disposable query records. Source databases and user histories never enter this directory. */
export class WowDataCache implements WowDataCachePort {
  private epoch = 0
  private closed = false
  private pending: Promise<void> = Promise.resolve()
  private directory: Promise<string> | undefined
  private files: Map<string, StoredFile> | undefined

  constructor(private readonly root: string, private readonly maximumBytes = MAX_BYTES) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_BYTES)
      throw new Error('cache-unavailable')
  }

  get generation() { return this.epoch }

  invalidate() { this.epoch++ }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.then(() => {}, () => {})
    return result
  }

  private async folder() {
    this.directory ??= (async () => {
      await mkdir(this.root, { recursive: true })
      const info = await lstat(this.root)
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error('cache-unavailable')
      return realpath(this.root)
    })()
    const root = await this.directory
    const info = await lstat(root)
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root)
      throw new Error('cache-unavailable')
    return root
  }

  private async remove(path: string) {
    const root = await this.folder()
    if (dirname(resolve(path)) !== root)
      throw new Error('cache-unavailable')
    try {
      await unlink(path)
    }
    catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
        throw error
    }
    this.files?.delete(path)
  }

  private hash(key: WowDataCacheKey) {
    const normalized = serializeWowDataCacheKey(key)
    return normalized ? createHash('sha256').update(normalized).digest('hex') : undefined
  }

  private async read(path: string, keyHash: string) {
    const info = await lstat(path)
    const root = await this.folder()
    if (dirname(resolve(path)) !== root || !info.isFile() || info.isSymbolicLink() || info.size > MAX_RECORD_BYTES)
      throw new Error('cache-unavailable')
    const handle = await open(path, 'r')
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.size > MAX_RECORD_BYTES || await realpath(path) !== path)
        throw new Error('cache-unavailable')
      const value = parse(recordSchema, JSON.parse(await handle.readFile('utf8')))
      if (value.keyHash !== keyHash)
        throw new Error('cache-unavailable')
      const evidence = parse(wowDataCacheEvidenceSchema, { status: 'hit', sourceReceivedAt: value.sourceReceivedAt, servedAt: new Date().toISOString(), storedAt: value.storedAt, expiresAt: value.expiresAt })
      const storedAt = Date.parse(evidence.storedAt)
      const expiresAt = Date.parse(evidence.expiresAt)
      if (storedAt > Date.now() + 30_000 || expiresAt < storedAt || expiresAt - storedAt > WOW_STATIC_CACHE_TTL_MS)
        throw new Error('cache-unavailable')
      return { record: { data: value.data, cache: evidence }, file: { path, bytes: opened.size, usedAt: info.mtimeMs, expiresAt } }
    }
    finally { await handle.close() }
  }

  private async scan() {
    const root = await this.folder()
    const files: StoredFile[] = []
    if (this.files) {
      for (const file of this.files.values()) {
        if (file.expiresAt <= Date.now()) {
          await this.remove(file.path)
          continue
        }
        try {
          const info = await lstat(file.path)
          if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_RECORD_BYTES)
            throw new Error('cache-unavailable')
          files.push({ ...file, bytes: info.size, usedAt: info.mtimeMs })
        }
        catch { await this.remove(file.path) }
      }
      this.files = new Map(files.map(file => [file.path, file]))
      return files
    }
    for (const name of await readdir(root)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name))
        continue
      const path = join(root, name)
      try {
        const result = await this.read(path, name.slice(0, -5))
        if (result.file.expiresAt > Date.now())
          files.push(result.file)
        else
          await this.remove(path)
      }
      catch {
        // Only an owned hash-named entry is removed. Unlinking a symbolic link never follows its target.
        await this.remove(path)
      }
    }
    this.files = new Map(files.map(file => [file.path, file]))
    return files
  }

  async get(key: WowDataCacheKey): Promise<WowDataCacheRecord | undefined> {
    const generation = this.epoch
    return this.run(async () => {
      if (this.closed || generation !== this.epoch)
        return undefined
      const hash = this.hash(key)
      if (!hash)
        return undefined
      try {
        const path = join(await this.folder(), `${hash}.json`)
        const result = await this.read(path, hash)
        if (result.file.expiresAt <= Date.now()) {
          await this.remove(path)
          return undefined
        }
        if (generation !== this.epoch || this.closed)
          return undefined
        const now = new Date()
        await utimes(path, now, now)
        if (generation !== this.epoch || this.closed)
          return undefined
        this.files?.set(path, { ...result.file, usedAt: now.getTime() })
        return result.record
      }
      catch { return undefined }
    })
  }

  async put(key: WowDataCacheKey, data: unknown, options: { ttlMs: number, sourceReceivedAt: string, generation: number }): Promise<WowDataCacheEvidence | undefined> {
    return this.run(async () => {
      if (this.closed || data === undefined || options.generation !== this.epoch || ![WOW_STATIC_CACHE_TTL_MS, WOW_AUCTION_CACHE_TTL_MS].includes(options.ttlMs))
        return undefined
      const keyHash = this.hash(key)
      if (!keyHash)
        return undefined
      let temporary: string | undefined
      try {
        const now = Date.now()
        const storedAt = new Date(now).toISOString()
        const expiresAt = new Date(now + options.ttlMs).toISOString()
        const evidence = parse(wowDataCacheEvidenceSchema, { status: 'miss', sourceReceivedAt: options.sourceReceivedAt, servedAt: storedAt, storedAt, expiresAt })
        const raw = JSON.stringify({ version: 1, keyHash, data, sourceReceivedAt: options.sourceReceivedAt, storedAt, expiresAt })
        const bytes = Buffer.byteLength(raw)
        if (bytes > MAX_RECORD_BYTES || bytes > this.maximumBytes)
          return undefined
        const files = await this.scan()
        let used = files.filter(file => !file.path.endsWith(`${keyHash}.json`)).reduce((total, file) => total + file.bytes, 0)
        let count = files.filter(file => !file.path.endsWith(`${keyHash}.json`)).length
        for (const file of files.sort((left, right) => left.usedAt - right.usedAt)) {
          if (used + bytes <= this.maximumBytes && count < MAX_ENTRIES)
            break
          if (file.path.endsWith(`${keyHash}.json`))
            continue
          await this.remove(file.path)
          used -= file.bytes
          count--
        }
        if (options.generation !== this.epoch || this.closed)
          return undefined
        const root = await this.folder()
        temporary = join(root, `.wow-cache-${randomUUID()}.tmp`)
        const handle = await open(temporary, 'wx', 0o600)
        try {
          await handle.writeFile(raw, 'utf8')
          await handle.sync()
        }
        finally { await handle.close() }
        if (options.generation !== this.epoch || this.closed)
          return undefined
        if (await this.folder() !== root)
          return undefined
        const path = join(root, `${keyHash}.json`)
        await rename(temporary, path)
        this.files?.set(path, { path, bytes, usedAt: Date.now(), expiresAt: Date.parse(expiresAt) })
        if (options.generation !== this.epoch || this.closed) {
          await this.remove(path)
          return undefined
        }
        return evidence
      }
      catch { return undefined }
      finally {
        if (temporary)
          await this.remove(temporary).catch(() => {})
      }
    })
  }

  async clear() {
    this.invalidate()
    return this.run(async () => {
      const root = await this.folder()
      for (const name of await readdir(root)) {
        if (/^[a-f0-9]{64}\.json$/.test(name) || /^\.wow-cache-[a-f0-9-]+\.tmp$/.test(name))
          await this.remove(join(root, name))
      }
      this.files = new Map()
    })
  }

  async status(): Promise<WowDataCacheStatus> {
    return this.run(async () => {
      const policy = { maxBytes: this.maximumBytes, staticTtlMs: WOW_STATIC_CACHE_TTL_MS, priceTtlMs: WOW_AUCTION_CACHE_TTL_MS }
      try {
        const files = await this.scan()
        return { ...policy, entries: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }
      }
      catch { return { ...policy, entries: 0, bytes: 0, errorCode: 'cache-unavailable' } }
    })
  }

  async dispose() {
    this.closed = true
    this.invalidate()
    await this.pending
  }
}

export function setupWowDataCache(context: ReturnType<typeof createContext>['context'], cache: WowDataCache) {
  const disposers = [
    defineInvokeHandler(context, wowDataCacheStatus, () => cache.status()),
    defineInvokeHandler(context, wowDataCacheClear, async () => {
      await cache.clear()
      return cache.status()
    }),
  ]
  return () => disposers.forEach(dispose => dispose())
}
