import type { McpCallToolResult, McpToolRuntime } from '../tools/mcp'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { WowReferenceRuntime } from './wow-reference-runtime'

const record = { content: [{ type: 'text', text: '{"outcome":"ok","results":[],"total":0}' }] }
function stats(build = '1.60.1.70707'): McpCallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ outcome: 'ok', product: 'wowf', build, built_at: '2026-10-30T22:25:37+11:00' }) }] }
}
function transport(advertiseStats = true): McpToolRuntime {
  return {
    listTools: vi.fn(async () => advertiseStats ? [{ name: 'wuxianwow::stats', serverName: 'wuxianwow', toolName: 'stats', inputSchema: {} }] : []),
    callTool: vi.fn(async payload => payload.name === 'wuxianwow::stats' ? stats() : record),
  }
}
afterEach(() => vi.useRealTimers())

describe('reference source evidence at the MCP boundary', () => {
  it('keeps other servers and non-reference tools unchanged without probing their metadata', async () => {
    const rpc = transport()
    const runtime = new WowReferenceRuntime(rpc)
    await runtime.listTools()
    expect(await runtime.callTool({ name: 'memory::search', arguments: {} })).toBe(record)
    expect(await runtime.callTool({ name: 'wuxianwow::report_issue', arguments: {} })).toBe(record)
    expect(await runtime.callTool({ name: 'wuxianwow::fetch', arguments: { id: 'spell:123' } })).toBe(record)
    expect(rpc.callTool).toHaveBeenCalledTimes(3)
  })

  it('does not call tools that were not advertised, including restricted acceptance transports', async () => {
    const rpc = transport(false)
    const runtime = new WowReferenceRuntime(rpc)
    await runtime.listTools()
    const result = await runtime.callTool({ name: 'wuxianwow::search', arguments: { query: '瑟银锭' } })
    expect(rpc.callTool).toHaveBeenCalledTimes(1)
    expect(result.content).toBe(record.content)
    expect(result.wowReference?.build).toBeUndefined()
    expect(result.wowReference?.game).toBe('forever')
    expect(result.wowReference?.receivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('adds verified build evidence once and keeps the returned entity bytes intact', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T00:00:00Z'))
    const rpc = transport()
    const runtime = new WowReferenceRuntime(rpc)
    await runtime.listTools()
    const first = await runtime.callTool({ name: 'wuxianwow::fetch', arguments: { id: 'item:12359' } })
    expect(first.content).toBe(record.content)
    expect(first.wowReference).toEqual({ game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', build: '1.60.1.70707', buildCreatedAt: '2026-10-30T22:25:37+11:00', receivedAt: '2026-11-01T00:00:00.000Z' })
    await runtime.callTool({ name: 'wuxianwow::quests', arguments: { id: 11 } })
    expect(vi.mocked(rpc.callTool).mock.calls.filter(([payload]) => payload.name === 'wuxianwow::stats')).toHaveLength(1)
    vi.advanceTimersByTime(300_001)
    await runtime.callTool({ name: 'wuxianwow::atlas', arguments: { id: 1424 } })
    expect(vi.mocked(rpc.callTool).mock.calls.filter(([payload]) => payload.name === 'wuxianwow::stats')).toHaveLength(2)
  })

  it('shares one metadata probe across concurrent reference calls', async () => {
    const rpc = transport()
    const pending = Promise.withResolvers<McpCallToolResult>()
    vi.mocked(rpc.callTool).mockImplementation(payload => payload.name === 'wuxianwow::stats' ? pending.promise : Promise.resolve(record))
    const runtime = new WowReferenceRuntime(rpc)
    await runtime.listTools()
    const first = runtime.callTool({ name: 'wuxianwow::search', arguments: { query: '瑟银锭' } })
    const second = runtime.callTool({ name: 'wuxianwow::search', arguments: { query: '瑟银护甲' } })
    await vi.waitFor(() => expect(rpc.callTool).toHaveBeenCalledTimes(3))
    pending.resolve(stats())
    const results = await Promise.all([first, second])
    expect(results.map(result => result.wowReference?.build)).toEqual(['1.60.1.70707', '1.60.1.70707'])
  })

  it('returns records after a metadata timeout and backs off instead of retrying every card', async () => {
    vi.useFakeTimers()
    const rpc = transport()
    vi.mocked(rpc.callTool).mockImplementation(payload => payload.name === 'wuxianwow::stats' ? new Promise(() => {}) : Promise.resolve(record))
    const runtime = new WowReferenceRuntime(rpc)
    await runtime.listTools()
    const request = runtime.callTool({ name: 'wuxianwow::search', arguments: {} })
    await vi.advanceTimersByTimeAsync(2000)
    const result = await request
    expect(result.content).toBe(record.content)
    expect(result.wowReference?.build).toBeUndefined()
    await runtime.callTool({ name: 'wuxianwow::fetch', arguments: { id: 'item:12359' } })
    expect(vi.mocked(rpc.callTool).mock.calls.filter(([payload]) => payload.name === 'wuxianwow::stats')).toHaveLength(1)
  })

  it('discards pending build evidence when the advertised stats tool is removed', async () => {
    const rpc = transport()
    const oldProbe = Promise.withResolvers<McpCallToolResult>()
    const newProbe = Promise.withResolvers<McpCallToolResult>()
    let probeCount = 0
    vi.mocked(rpc.callTool).mockImplementation((payload) => {
      if (payload.name !== 'wuxianwow::stats')
        return Promise.resolve(record)
      return ++probeCount === 1 ? oldProbe.promise : newProbe.promise
    })
    const advertised = await rpc.listTools()
    const runtime = new WowReferenceRuntime(rpc)
    await runtime.listTools()
    const first = runtime.callTool({ name: 'wuxianwow::search', arguments: {} })
    await vi.waitFor(() => expect(probeCount).toBe(1))
    vi.mocked(rpc.listTools).mockResolvedValueOnce([])
    await runtime.listTools()
    vi.mocked(rpc.listTools).mockResolvedValueOnce(advertised)
    await runtime.listTools()
    const second = runtime.callTool({ name: 'wuxianwow::search', arguments: {} })
    await vi.waitFor(() => expect(probeCount).toBe(2))
    oldProbe.resolve(stats('1.60.1.70707'))
    expect((await first).wowReference?.build).toBeUndefined()
    const third = runtime.callTool({ name: 'wuxianwow::search', arguments: {} })
    newProbe.resolve(stats('1.60.1.70708'))
    const current = await Promise.all([second, third])
    expect(current.map(result => result.wowReference?.build)).toEqual(['1.60.1.70708', '1.60.1.70708'])
    expect((await runtime.callTool({ name: 'wuxianwow::search', arguments: {} })).wowReference?.build).toBe('1.60.1.70708')
    expect(probeCount).toBe(2)
  })

  it('preserves query failures and rejects metadata from another game', async () => {
    const rpc = transport()
    const runtime = new WowReferenceRuntime(rpc)
    await runtime.listTools()
    const failed = { isError: true, content: [{ type: 'text', text: 'Unavailable' }] }
    vi.mocked(rpc.callTool).mockResolvedValueOnce(failed)
    expect(await runtime.callTool({ name: 'wuxianwow::search', arguments: {} })).toBe(failed)
    expect(rpc.callTool).toHaveBeenCalledTimes(1)
    vi.mocked(rpc.callTool).mockImplementation(async payload => payload.name === 'wuxianwow::stats'
      ? { structuredContent: { outcome: 'ok', product: 'wow', build: '12.1.5.70575' } }
      : record)
    const result = await runtime.callTool({ name: 'wuxianwow::fetch', arguments: { id: 'item:12359' } })
    expect(result.wowReference?.build).toBeUndefined()
  })

  it('preserves trusted main-process cache receipts without another metadata probe', async () => {
    const rpc = transport()
    rpc.trustedWowEvidence = true
    const cache = { status: 'hit' as const, sourceReceivedAt: '2026-11-01T00:00:00Z', storedAt: '2026-11-01T00:00:00Z', servedAt: '2026-11-01T01:00:00Z', expiresAt: '2026-11-02T00:00:00Z' }
    const wowReference = { game: 'forever' as const, source: '无限图鉴 wuxianwow.com' as const, sourceUrl: 'https://wuxianwow.com/' as const, build: '1.60.1.70707', buildCreatedAt: '2026-10-30T22:25:37+11:00', receivedAt: cache.sourceReceivedAt }
    vi.mocked(rpc.callTool).mockResolvedValue({ ...record, cache, wowReference })
    const runtime = new WowReferenceRuntime(rpc)
    await runtime.listTools()
    const result = await runtime.callTool({ name: 'wuxianwow::search', arguments: {} })
    expect(result.cache).toBe(cache)
    expect(result.wowReference).toBe(wowReference)
    expect(result.wowReference?.receivedAt).toBe('2026-11-01T00:00:00Z')
    expect(rpc.callTool).toHaveBeenCalledTimes(1)
  })

  it('ignores reserved metadata from an untrusted transport', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
    const rpc = transport(false)
    const cache = { status: 'hit' as const, sourceReceivedAt: '2001-01-01T00:00:00Z', storedAt: '2001-01-01T00:00:00Z', servedAt: '2001-01-01T01:00:00Z', expiresAt: '2001-01-02T00:00:00Z' }
    vi.mocked(rpc.callTool).mockResolvedValue({ ...record, cache, wowReference: { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', receivedAt: cache.sourceReceivedAt } })
    const runtime = new WowReferenceRuntime(rpc)
    await runtime.listTools()
    const result = await runtime.callTool({ name: 'wuxianwow::search', arguments: {} })
    expect(result.cache).toBeUndefined()
    expect(result.wowReference?.receivedAt).toBe('2026-11-01T10:00:00.000Z')
  })

  it('does not replace the main-process snapshot policy with a client-side version probe', async () => {
    const rpc = transport()
    rpc.trustedWowEvidence = true
    vi.mocked(rpc.callTool).mockResolvedValue(record)
    const runtime = new WowReferenceRuntime(rpc)
    await runtime.listTools()
    const result = await runtime.callTool({ name: 'wuxianwow::search', arguments: {} })
    expect(result.wowReference?.build).toBeUndefined()
    expect(rpc.callTool).toHaveBeenCalledTimes(1)
  })
})
