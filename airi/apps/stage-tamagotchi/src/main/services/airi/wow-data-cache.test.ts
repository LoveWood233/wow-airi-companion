import type { WowDataCacheKey } from '@proj-airi/stage-shared/wow-knowledge'

import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { WOW_AUCTION_CACHE_TTL_MS, WOW_STATIC_CACHE_TTL_MS } from '@proj-airi/stage-shared/wow-knowledge'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WowDataCache } from './wow-data-cache'

function key(id = 1): WowDataCacheKey {
  return { game: 'forever', source: 'wuxianwow', build: '1.60.1.70707', locale: 'zhCN', snapshot: '2026-11-01T00:00:00Z', connection: 'connection-a', tool: 'wuxianwow::fetch', args: { id: `item:${id}` } }
}

describe('bounded persistent query cache', () => {
  let directory: string
  let cache: WowDataCache
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'wow-data-cache-'))
    cache = new WowDataCache(join(directory, 'cache'))
  })
  afterEach(async () => {
    await cache.dispose()
    vi.restoreAllMocks()
    vi.useRealTimers()
    const target = resolve(directory)
    expect(dirname(target)).toBe(resolve(tmpdir()))
    expect(basename(target).startsWith('wow-data-cache-')).toBe(true)
    expect(await realpath(target)).toBe(target)
    await rm(target, { recursive: true, force: true })
  })

  async function put(id: number, data: unknown = { item: id }) {
    return cache.put(key(id), data, { ttlMs: WOW_STATIC_CACHE_TTL_MS, sourceReceivedAt: new Date().toISOString(), generation: cache.generation })
  }

  it('persists records across owners and preserves original receipts independently from cache reads', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'))
    const stored = await put(1)
    expect(stored?.status).toBe('miss')
    await cache.dispose()
    cache = new WowDataCache(join(directory, 'cache'))
    vi.setSystemTime(new Date('2026-11-01T00:01:00Z'))
    const hit = await cache.get(key())
    expect(hit?.data).toEqual({ item: 1 })
    expect(hit?.cache).toEqual({ ...stored, status: 'hit', servedAt: '2026-11-01T00:01:00.000Z' })
    expect(hit?.cache.sourceReceivedAt).toBe('2026-11-01T00:00:00.000Z')
    expect((await cache.status()).maxBytes).toBe(256 * 1024 * 1024)
  })

  it('isolates builds, snapshots, locales, connection identities, and query arguments', async () => {
    await put(1)
    for (const changed of [
      { ...key(), build: '1.60.2.70708' },
      { ...key(), snapshot: 'another-snapshot' },
      { ...key(), locale: 'enUS' },
      { ...key(), connection: 'connection-b' },
      key(2),
    ])
      expect(await cache.get(changed)).toBeUndefined()
    expect((await cache.get(key()))?.data).toEqual({ item: 1 })
  })

  it('derives expiry and storage times from one clock reading across a millisecond boundary', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const epoch = Date.parse('2026-11-01T00:00:00Z')
    vi.setSystemTime(epoch)
    let tick = epoch
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => ++tick)
    const evidence = await put(1)
    expect(evidence).toBeDefined()
    expect(Date.parse(evidence!.expiresAt) - Date.parse(evidence!.storedAt)).toBe(WOW_STATIC_CACHE_TTL_MS)
    clock.mockRestore()
    vi.setSystemTime(epoch + 100)
    expect((await cache.get(key()))?.data).toEqual({ item: 1 })
  })

  it('expires auction request caches without changing source collection timestamps', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'))
    const data = { collectedAt: '北京时间 2026-10-26 16:49', realm: 'Example', faction: 'Alliance' }
    await cache.put(key(), data, { ttlMs: WOW_AUCTION_CACHE_TTL_MS, sourceReceivedAt: new Date().toISOString(), generation: cache.generation })
    vi.setSystemTime(new Date('2026-11-01T00:14:59Z'))
    expect((await cache.get(key()))?.data).toEqual(data)
    vi.setSystemTime(new Date('2026-11-01T00:15:00Z'))
    expect(await cache.get(key())).toBeUndefined()
    expect((await cache.status()).entries).toBe(0)
  })

  it('blocks an in-flight generation from refilling a cleared cache and leaves foreign files alone', async () => {
    await put(1)
    const generation = cache.generation
    await writeFile(join(directory, 'cache', 'notes.txt'), 'keep')
    await writeFile(join(directory, 'source.sqlite3'), 'source database')
    await cache.clear()
    expect(await cache.put(key(), { late: true }, { ttlMs: WOW_STATIC_CACHE_TTL_MS, sourceReceivedAt: new Date().toISOString(), generation })).toBeUndefined()
    expect((await cache.status()).entries).toBe(0)
    expect(await readFile(join(directory, 'cache', 'notes.txt'), 'utf8')).toBe('keep')
    expect(await readFile(join(directory, 'source.sqlite3'), 'utf8')).toBe('source database')
    expect(await put(2)).toBeDefined()
  })

  it('evicts least-recently-used records before exceeding its byte budget', async () => {
    await cache.dispose()
    cache = new WowDataCache(join(directory, 'cache'), 2400)
    for (const id of [1, 2, 3]) {
      expect(await put(id, { filler: '料'.repeat(150) })).toBeDefined()
      await delay(20)
    }
    expect(await cache.get(key(1))).toBeDefined()
    await delay(20)
    expect(await put(4, { filler: '料'.repeat(150) })).toBeDefined()
    expect(await cache.get(key(2))).toBeUndefined()
    expect(await cache.get(key(1))).toBeDefined()
    expect((await cache.status()).bytes).toBeLessThanOrEqual(2400)
  })

  it('fails open for malformed records, unsupported keys, oversized data, and non-JSON values', async () => {
    await put(1)
    const [file] = (await readdir(join(directory, 'cache'))).filter(name => name.endsWith('.json'))
    expect(file).toBeDefined()
    await writeFile(join(directory, 'cache', file!), '{broken')
    expect(await cache.get(key())).toBeUndefined()
    expect(await cache.put({ ...key(), build: 'unknown' }, {}, { ttlMs: WOW_STATIC_CACHE_TTL_MS, sourceReceivedAt: new Date().toISOString(), generation: cache.generation })).toBeUndefined()
    expect(await put(2, 'x'.repeat(2 * 1024 * 1024))).toBeUndefined()
    expect(await put(2, 1n)).toBeUndefined()
  })

  it('refuses a linked cache root and cannot delete files in its target', async () => {
    await cache.dispose()
    const target = join(directory, 'outside-cache')
    await mkdir(target)
    const protectedFile = join(target, `${'a'.repeat(64)}.json`)
    await writeFile(protectedFile, 'keep')
    const link = join(directory, 'linked-cache')
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    cache = new WowDataCache(link)
    expect((await cache.status()).errorCode).toBe('cache-unavailable')
    await expect(cache.clear()).rejects.toThrow('cache-unavailable')
    expect(await readFile(protectedFile, 'utf8')).toBe('keep')
  })
})
