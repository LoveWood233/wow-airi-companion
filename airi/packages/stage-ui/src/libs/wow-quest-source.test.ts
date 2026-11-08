import type { WowQuestContext, WowQuestQuery } from '@proj-airi/stage-shared/wow-knowledge'

import type { McpCallToolResult, McpToolRuntime } from '../tools/mcp'

import { describe, expect, it, vi } from 'vitest'

import detail from '../../../stage-shared/src/wow-knowledge/fixtures/quest-detail-horde.json'
import listed from '../../../stage-shared/src/wow-knowledge/fixtures/quest-list-horde.json'

import { WowQuestSource } from './wow-quest-source'

const query: WowQuestQuery = { operation: 'search', game: 'forever', level: 15, faction: 'Horde', zone: ' 贫瘠之地 ', limit: 4 }
function transport(): McpToolRuntime {
  return {
    trustedWowEvidence: true,
    listTools: vi.fn(async () => [{ name: 'wuxianwow::quests', serverName: 'wuxianwow', toolName: 'quests', inputSchema: {} }]),
    callTool: vi.fn(async payload => ({ structuredContent: payload.arguments?.id ? detail : listed })),
  }
}
function context(): WowQuestContext {
  return { game: 'retail', guid: 'Player-1', session: 'session-1', snapshot: { guid: 'Player-1', session: 'session-1', observedAt: '2026-11-01T09:00:00.000Z', log: { complete: true, truncated: false, total: 0, entries: [] }, completion: { source: 'unknown', scope: 'unknown', complete: false, truncated: false, total: null, ids: [], turnIns: [] } } }
}

describe('explicit quest reference runtime', () => {
  it('does not fetch on construction and makes one bounded explicit list request', async () => {
    const rpc = transport()
    const source = new WowQuestSource(rpc)
    expect(rpc.listTools).not.toHaveBeenCalled()
    expect(rpc.callTool).not.toHaveBeenCalled()
    const result = await source.query(query)
    expect(result.outcome).toBe('ok')
    expect(result.entries).toHaveLength(4)
    expect(rpc.callTool).toHaveBeenCalledExactlyOnceWith({ name: 'wuxianwow::quests', arguments: { view: 'confirmed', sort: 'level', level_min: 12, level_max: 18, req_max: 15, side: '部落', zone: '贫瘠之地', limit: 4, offset: 0 } })
  })

  it('fetches one selected task without recursively querying its chain or NPCs', async () => {
    const rpc = transport()
    const result = await new WowQuestSource(rpc).query({ operation: 'detail', game: 'forever', questId: 844 })
    expect(result.entries[0]?.chain).toHaveLength(12)
    expect(rpc.callTool).toHaveBeenCalledExactlyOnceWith({ name: 'wuxianwow::quests', arguments: { id: 844 } })
  })

  it('retains native cache times without an extra frontend metadata query', async () => {
    const rpc = transport()
    const receivedAt = '2026-11-01T08:00:00.000Z'
    const cache = { status: 'hit' as const, sourceReceivedAt: receivedAt, storedAt: receivedAt, servedAt: '2026-11-01T09:00:00.000Z', expiresAt: '2026-11-02T08:00:00.000Z' }
    vi.mocked(rpc.callTool).mockResolvedValue({ structuredContent: listed, wowReference: { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', receivedAt, build: '1.60.1.70707', buildCreatedAt: '2026-10-30T22:25:37+11:00' }, cache })
    const result = await new WowQuestSource(rpc).query(query)
    expect(result.sources[0]).toMatchObject({ receivedAt, cache, build: '1.60.1.70707' })
    expect(rpc.callTool).toHaveBeenCalledTimes(1)
  })

  it('keeps Retail queries entirely local even when the MCP source is connected', async () => {
    const rpc = transport()
    const source = new WowQuestSource(rpc)
    expect(await source.query({ ...query, game: 'retail' }, context())).toMatchObject({ outcome: 'empty', sources: [{ kind: 'quest-log' }] })
    expect(await source.query({ ...query, game: 'retail' }, { ...context(), game: 'forever' })).toMatchObject({ outcome: 'unavailable', errorCode: 'telemetry-game-mismatch' })
    expect(rpc.listTools).not.toHaveBeenCalled()
    expect(rpc.callTool).not.toHaveBeenCalled()
  })

  it('does not pretend that an unknown or neutral faction is Horde or Alliance', async () => {
    const rpc = transport()
    const source = new WowQuestSource(rpc)
    for (const faction of ['Neutral', 'Unknown'] as const) {
      const result = await source.query({ ...query, faction })
      expect(result.notices).toContain('faction-filter-unavailable')
      expect(vi.mocked(rpc.callTool).mock.lastCall?.[0].arguments).not.toHaveProperty('side')
    }
  })

  it('does not call unadvertised tools or retry source failures', async () => {
    const rpc = transport()
    vi.mocked(rpc.listTools).mockResolvedValueOnce([{ name: 'other::quests', serverName: 'other', toolName: 'quests', inputSchema: {} }])
    const source = new WowQuestSource(rpc)
    expect(await source.query(query)).toMatchObject({ outcome: 'unavailable', errorCode: 'source-unavailable' })
    expect(rpc.callTool).not.toHaveBeenCalled()
    vi.mocked(rpc.callTool).mockRejectedValueOnce(new Error('private implementation detail'))
    expect(await source.query(query)).toMatchObject({ outcome: 'unavailable', errorCode: 'source-unavailable' })
    expect(rpc.callTool).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid page before discovery and bounds the 255-level request', async () => {
    const rpc = transport()
    const source = new WowQuestSource(rpc)
    await expect(source.query({ ...query, limit: 21 })).rejects.toThrow('invalid-query')
    expect(rpc.listTools).not.toHaveBeenCalled()
    await source.query({ ...query, level: 255, faction: 'Alliance', offset: 10000 })
    expect(vi.mocked(rpc.callTool).mock.lastCall?.[0].arguments).toMatchObject({ level_min: 252, level_max: 255, req_max: 255, side: '联盟', offset: 10000 })
  })

  it('separates transport errors from invalid records without returning raw failure text', async () => {
    const rpc = transport()
    const source = new WowQuestSource(rpc)
    const responses: McpCallToolResult[] = [{ isError: true, content: [{ type: 'text', text: 'private failure' }] }, { structuredContent: { outcome: 'ok', id: 'quest:844', game: 'retail', title: 'wrong version' } }]
    for (const response of responses)
      vi.mocked(rpc.callTool).mockResolvedValueOnce(response)
    expect(await source.query(query)).toMatchObject({ outcome: 'unavailable', errorCode: 'source-unavailable' })
    expect(await source.query(query)).toMatchObject({ outcome: 'error', errorCode: 'source-invalid' })
  })
})
