import type { WowDataCacheEvidence, WowDataCacheKey, WowDataCachePort, WowDataCacheRecord } from '@proj-airi/stage-shared/wow-knowledge'

import type { McpCallToolResult, McpToolRuntime } from '../tools/mcp'

import { serializeWowDataCacheKey } from '@proj-airi/stage-shared/wow-knowledge'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WowMcpCacheRuntime } from './wow-mcp-cache-runtime'

const record: McpCallToolResult = { content: [{ type: 'text', text: '{"outcome":"ok","results":[{"id":"item:12359","title":"瑟银锭"}]}' }] }
function stats(build = '1.60.1.70707', built_at = '2026-10-30T22:25:37+11:00'): McpCallToolResult {
  return { structuredContent: { outcome: 'ok', product: 'wowf', build, built_at, app: 'https://wuxianwow.com', auction_house: { collected_at: '北京时间 2026-10-26 16:49', realm: 'Realm', side: '联盟拍卖行' } } }
}

function port() {
  let generation = 0
  const entries = new Map<string, WowDataCacheRecord>()
  const cache: WowDataCachePort = {
    get generation() { return generation },
    get: vi.fn(async (key: WowDataCacheKey) => {
      const entry = entries.get(serializeWowDataCacheKey(key)!)
      return entry ? { data: entry.data, cache: { ...entry.cache, status: 'hit' as const, servedAt: new Date().toISOString() } } : undefined
    }),
    put: vi.fn(async (key, data, options) => {
      if (options.generation !== generation)
        return undefined
      const now = Date.now()
      const evidence: WowDataCacheEvidence = { status: 'miss', sourceReceivedAt: options.sourceReceivedAt, storedAt: new Date(now).toISOString(), servedAt: new Date(now).toISOString(), expiresAt: new Date(now + options.ttlMs).toISOString() }
      entries.set(serializeWowDataCacheKey(key)!, { data, cache: evidence })
      return evidence
    }),
    invalidate: vi.fn(() => { generation++ }),
    clear: vi.fn(async () => {
      generation++
      entries.clear()
    }),
  }
  return { cache, entries }
}

function transport(advertiseStats = true): McpToolRuntime {
  const names = ['search', 'fetch', 'leveling_route', 'auction_house', 'report_issue', 'stage']
  if (advertiseStats)
    names.push('stats')
  return {
    listTools: vi.fn(async () => names.map(toolName => ({ name: `wuxianwow::${toolName}`, toolName, serverName: 'wuxianwow', inputSchema: {} }))),
    callTool: vi.fn(async payload => payload.name === 'wuxianwow::stats' ? stats() : record),
  }
}

const query = { name: 'wuxianwow::search', arguments: { query: '瑟银', kind: 'item' } }
afterEach(() => vi.useRealTimers())

describe('main-process MCP cache adapter', () => {
  it('reuses a source result with its original receipt and current cache delivery time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    const rpc = transport()
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    const first = await runtime.callTool(query)
    vi.advanceTimersByTime(1000)
    const second = await runtime.callTool({ ...query, arguments: { kind: 'item', query: '瑟银' } })
    expect(first.cache?.status).toBe('miss')
    expect(second.cache?.status).toBe('hit')
    expect(second.wowReference?.receivedAt).toBe(first.wowReference?.receivedAt)
    expect(second.cache?.servedAt).toBe('2026-11-01T10:00:01.000Z')
    expect(second.wowReference?.buildCreatedAt).toBe('2026-10-30T22:25:37+11:00')
    expect(rpc.callTool).toHaveBeenCalledTimes(4)
    expect(cache.put).toHaveBeenCalledWith(expect.objectContaining({ locale: 'zhCN', snapshot: '2026-10-30T22:25:37+11:00', connection: 'source-a' }), expect.anything(), expect.objectContaining({ ttlMs: 86400000, generation: 0 }))
  })

  it('bypasses all cache and metadata work for acceptance, creative tools, and another server', async () => {
    const rpc = transport()
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    for (const payload of [{ ...query, cachePolicy: 'bypass' as const }, { name: 'wuxianwow::report_issue', arguments: {} }, { name: 'wuxianwow::stage', arguments: {} }, { name: 'memory::search', arguments: {} }, { name: 'wuxianwow::fetch', arguments: { id: 'scene:1' } }])
      expect(await runtime.callTool(payload)).toBe(record)
    expect(rpc.callTool).toHaveBeenCalledTimes(5)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('never probes stats through a restricted catalog or unknown connection', async () => {
    const rpc = transport(false)
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    expect(await runtime.callTool(query)).toBe(record)
    const unknown = new WowMcpCacheRuntime(transport(), cache, () => undefined)
    await unknown.listTools()
    expect(await unknown.callTool(query)).toBe(record)
    expect(rpc.callTool).toHaveBeenCalledTimes(1)
    expect(cache.get).not.toHaveBeenCalled()
  })

  it.each([
    { outcome: 'ok', product: 'wowf', build: '1.60.1.70707', app: 'https://wuxianwow.com' },
    { outcome: 'ok', product: 'wow', build: '12.1.5.70575', built_at: '2026-10-30T00:00:00Z', app: 'https://wuxianwow.com' },
    { outcome: 'ok', product: 'wowf', build: '1.60.1.70707', built_at: '2026-10-30T00:00:00Z', app: 'https://another.example' },
  ])('does not cache an unknown or unverified source snapshot', async (metadata) => {
    const rpc = transport()
    vi.mocked(rpc.callTool).mockImplementation(async payload => payload.name === 'wuxianwow::stats' ? { structuredContent: metadata } : record)
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    expect((await runtime.callTool(query)).content).toBe(record.content)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('revalidates the source scope on every explicit request and separates a new published snapshot', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    const rpc = transport()
    let metadata = stats()
    vi.mocked(rpc.callTool).mockImplementation(async payload => payload.name === 'wuxianwow::stats' ? metadata : record)
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    await runtime.callTool(query)
    metadata = stats('1.60.1.70707', '2026-11-01T09:00:00Z')
    const second = await runtime.callTool(query)
    expect(second.cache?.status).toBe('miss')
    expect(second.wowReference?.build).toBe('1.60.1.70707')
    expect(vi.mocked(cache.get).mock.calls.map(([key]) => key.snapshot)).toEqual(['2026-10-30T22:25:37+11:00', '2026-11-01T09:00:00Z'])
  })

  it('coalesces concurrent source reads and metadata probes', async () => {
    const rpc = transport()
    const response = Promise.withResolvers<McpCallToolResult>()
    vi.mocked(rpc.callTool).mockImplementation(payload => payload.name === 'wuxianwow::stats' ? Promise.resolve(stats()) : response.promise)
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    const first = runtime.callTool(query)
    const second = runtime.callTool(query)
    await vi.waitFor(() => expect(rpc.callTool).toHaveBeenCalledTimes(2))
    response.resolve(record)
    const results = await Promise.all([first, second])
    expect(results[0]?.content).toBe(record.content)
    expect(results[1]?.content).toBe(record.content)
    expect(cache.put).toHaveBeenCalledTimes(1)
  })

  it('bounds a failing metadata probe and never hides the successful database result', async () => {
    vi.useFakeTimers()
    const rpc = transport()
    vi.mocked(rpc.callTool).mockImplementation(payload => payload.name === 'wuxianwow::stats' ? new Promise(() => {}) : Promise.resolve(record))
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    const request = runtime.callTool(query)
    await vi.advanceTimersByTimeAsync(2000)
    expect((await request).content).toBe(record.content)
    expect((await runtime.callTool(query)).content).toBe(record.content)
    expect(vi.mocked(rpc.callTool).mock.calls.filter(([payload]) => payload.name === 'wuxianwow::stats')).toHaveLength(1)
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('keeps a synchronous metadata transport failure from blocking the source read', async () => {
    const rpc = transport()
    vi.mocked(rpc.callTool).mockImplementation((payload) => {
      if (payload.name === 'wuxianwow::stats')
        throw new Error('metadata unavailable')
      return Promise.resolve(record)
    })
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    expect((await runtime.callTool(query)).content).toBe(record.content)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('discards a pending source identity when stats is removed from discovery', async () => {
    const rpc = transport()
    const metadata = Promise.withResolvers<McpCallToolResult>()
    vi.mocked(rpc.callTool).mockImplementation(payload => payload.name === 'wuxianwow::stats' ? metadata.promise : Promise.resolve(record))
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    const pending = runtime.callTool(query)
    await vi.waitFor(() => expect(rpc.callTool).toHaveBeenCalledTimes(1))
    vi.mocked(rpc.listTools).mockResolvedValueOnce([])
    await runtime.listTools()
    metadata.resolve(stats())
    expect((await pending).cache).toBeUndefined()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('cannot refill disk from a request that began before a clear or configuration change', async () => {
    const rpc = transport()
    const response = Promise.withResolvers<McpCallToolResult>()
    vi.mocked(rpc.callTool).mockImplementation(payload => payload.name === 'wuxianwow::stats' ? Promise.resolve(stats()) : response.promise)
    const { cache, entries } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    const pending = runtime.callTool(query)
    await vi.waitFor(() => expect(rpc.callTool).toHaveBeenCalledTimes(2))
    await cache.clear()
    response.resolve(record)
    expect((await pending).cache).toBeUndefined()
    expect(entries.size).toBe(0)
    expect(cache.put).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ generation: 0 }))
    runtime.invalidate()
    expect(cache.invalidate).toHaveBeenCalledTimes(1)
  })

  it('keeps cache failures and failed source responses out of the success path', async () => {
    const rpc = transport()
    const { cache } = port()
    vi.mocked(cache.get).mockRejectedValue(new Error('disk read failed'))
    vi.mocked(cache.put).mockRejectedValue(new Error('disk write failed'))
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    expect((await runtime.callTool(query)).content).toBe(record.content)
    vi.mocked(cache.put).mockClear()
    vi.mocked(rpc.callTool).mockImplementation(async payload => payload.name === 'wuxianwow::stats' ? stats() : { isError: true, content: [{ type: 'text', text: 'unavailable' }] })
    expect((await runtime.callTool(query)).isError).toBe(true)
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('expires auction requests after fifteen minutes while retaining the source collection label', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    const rpc = transport()
    const auction: McpCallToolResult = { structuredContent: { outcome: 'ok', snapshot: { collected_at: '北京时间 2026-10-26 16:49', realm: 'Realm', side: '联盟拍卖行' }, view: 'item', item_id: 12359, today: null } }
    vi.mocked(rpc.callTool).mockImplementation(async payload => payload.name === 'wuxianwow::stats' ? stats() : auction)
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    const payload = { name: 'wuxianwow::auction_house', arguments: { view: 'item', item_id: 12359 } }
    await runtime.callTool(payload)
    expect((await runtime.callTool(payload)).cache?.status).toBe('hit')
    vi.advanceTimersByTime(900001)
    const result = await runtime.callTool(payload)
    expect(result.cache?.status).toBe('miss')
    expect(result.structuredContent).toBe(auction.structuredContent)
    expect(cache.put).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ ttlMs: 900000 }))
  })

  it('does not assign or cache a plaintext record when the source changes during its query', async () => {
    const rpc = transport()
    let metadata = stats()
    vi.mocked(rpc.callTool).mockImplementation(async (payload) => {
      if (payload.name === 'wuxianwow::stats')
        return metadata
      metadata = stats('1.60.1.70708', '2026-11-01T09:00:00Z')
      return record
    })
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    const result = await runtime.callTool(query)
    expect(result.content).toBe(record.content)
    expect(result.wowReference?.build).toBeUndefined()
    expect(result.cache).toBeUndefined()
    expect(cache.put).not.toHaveBeenCalled()
    expect(vi.mocked(rpc.callTool).mock.calls.filter(([payload]) => payload.name === 'wuxianwow::stats')).toHaveLength(2)
  })

  it('separates auction snapshots within the same client build before the price TTL expires', async () => {
    const rpc = transport()
    let snapshot = { collected_at: '北京时间 2026-10-26 16:49', realm: 'Realm', side: '联盟拍卖行' }
    vi.mocked(rpc.callTool).mockImplementation(async payload => payload.name === 'wuxianwow::stats'
      ? { structuredContent: { ...stats().structuredContent, auction_house: snapshot } }
      : { structuredContent: { outcome: 'ok', snapshot, view: 'item', item_id: 12359, today: null } })
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    const payload = { name: 'wuxianwow::auction_house', arguments: { view: 'item', item_id: 12359 } }
    expect((await runtime.callTool(payload)).cache?.status).toBe('miss')
    snapshot = { ...snapshot, collected_at: '北京时间 2026-10-27 16:49' }
    expect((await runtime.callTool(payload)).cache?.status).toBe('miss')
    const scopes = vi.mocked(cache.get).mock.calls.map(([key]) => key.snapshot)
    expect(scopes[0]).not.toBe(scopes[1])
  })

  it.each(['wuxianwow::fetch', 'wuxianwow::item_usage'])('isolates embedded item prices under the fifteen-minute market scope for %s', async (name) => {
    const rpc = transport()
    vi.mocked(rpc.listTools).mockResolvedValue(['stats', 'fetch', 'item_usage'].map(toolName => ({ name: `wuxianwow::${toolName}`, toolName, serverName: 'wuxianwow', inputSchema: {} })))
    let snapshot = { collected_at: '北京时间 2026-10-26 16:49', realm: 'Realm', side: '联盟拍卖行' }
    vi.mocked(rpc.callTool).mockImplementation(async (payload) => {
      if (payload.name === 'wuxianwow::stats')
        return { structuredContent: { ...stats().structuredContent, auction_house: snapshot } }
      const auction = { collected_at: snapshot.collected_at, guidance: 500000 }
      return { structuredContent: name === 'wuxianwow::fetch'
        ? { outcome: 'ok', id: 'item:4499', title: '棕色大袋', metadata: { auction } }
        : { outcome: 'ok', id: 'item:4499', title: '棕色大袋', auction } }
    })
    const { cache } = port()
    const runtime = new WowMcpCacheRuntime(rpc, cache, () => 'source-a')
    await runtime.listTools()
    const payload = { name, arguments: name === 'wuxianwow::fetch' ? { id: 'item:4499' } : { item_id: 4499 } }
    expect((await runtime.callTool(payload)).cache?.status).toBe('miss')
    expect((await runtime.callTool(payload)).cache?.status).toBe('hit')
    snapshot = { ...snapshot, collected_at: '北京时间 2026-10-27 16:49' }
    expect((await runtime.callTool(payload)).cache?.status).toBe('miss')
    expect(vi.mocked(cache.get).mock.calls[0]?.[0].snapshot).not.toBe(vi.mocked(cache.get).mock.calls.at(-1)?.[0].snapshot)
    expect(cache.put).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ ttlMs: 900000 }))
  })
})
