import type { WowBuildContext, WowBuildQuery, WowBuildResult } from '@proj-airi/stage-shared/wow-knowledge'

import type { McpCallToolPayload, McpCallToolResult, McpToolRuntime } from '../tools/mcp'

import { readWowBuildAnswer, retailDatabaseResultSchema } from '@proj-airi/stage-shared/wow-knowledge'
import { parse } from 'valibot'
import { describe, expect, it, vi } from 'vitest'

import item from '../../../stage-shared/src/wow-knowledge/fixtures/build-item-base.json'
import spell from '../../../stage-shared/src/wow-knowledge/fixtures/build-spell-warrior.json'
import allocation from '../../../stage-shared/src/wow-knowledge/fixtures/build-talents-plan.json'
import talents from '../../../stage-shared/src/wow-knowledge/fixtures/build-talents-warrior.json'
import nativeItem from '../../../stage-shared/src/wow-knowledge/fixtures/retail-database-item.json'
import nativeSpell from '../../../stage-shared/src/wow-knowledge/fixtures/retail-database-spell.json'

import { WowBuildSource } from './wow-build-source'

const query: WowBuildQuery = { operation: 'talents', game: 'forever', classId: 1, level: 15 }
const args = (request: WowBuildQuery) => JSON.stringify({ request: JSON.stringify(request) })
function transport(): McpToolRuntime {
  return { trustedWowEvidence: true, listTools: vi.fn(async () => ['talents', 'spellbook', 'item_usage'].map(toolName => ({ name: `wuxianwow::${toolName}`, serverName: 'wuxianwow', toolName, inputSchema: {} }))), callTool: vi.fn(async (payload: McpCallToolPayload): Promise<McpCallToolResult> => ({ structuredContent: payload.name === 'wuxianwow::spellbook' ? spell : payload.name === 'wuxianwow::item_usage' ? item : payload.arguments?.build ? allocation : talents, wowReference: { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', build: '1.60.1.70707', receivedAt: '2026-11-01T09:00:00Z' } })) }
}
function context(): WowBuildContext {
  return { game: 'retail', guid: 'P1', session: 's1', classId: 1, talents: { guid: 'P1', session: 's1', observedAt: '2026-11-01T09:00:00Z', classID: 1, clientBuild: '12.1.5.70575', locale: 'zhCN', status: 'active', hasStagedChanges: false, scope: 'selected-nodes', complete: true, truncated: false, knownZeroNodes: [{ treeID: 10, nodeID: 21 }], nodes: [] } }
}
function readable(result: WowBuildResult, request: WowBuildQuery) {
  return readWowBuildAnswer(result, args(request))
}

describe('explicit build reference runtime', () => {
  it('does not query on construction and performs one read-only catalog call', async () => {
    const rpc = transport()
    const source = new WowBuildSource(rpc)
    expect(rpc.listTools).not.toHaveBeenCalled()
    const result = await source.query(query)
    expect(result.outcome).toBe('ok')
    expect(readable(result, query)?.nodes[0]?.nodeId).toBe(105958)
    expect(rpc.callTool).toHaveBeenCalledExactlyOnceWith({ name: 'wuxianwow::talents', arguments: { class: '1', level: 15, compact: false } })
  })

  it('lets the source decode calculator strings and returns explicit node IDs', async () => {
    const request: WowBuildQuery = { ...query, operation: 'compare-talents', build: 'https://wuxianwow.com/talents/1?t=3--' }
    const rpc = transport()
    const result = await new WowBuildSource(rpc).query(request)
    expect(readable(result, request)?.nodes[0]).toMatchObject({ nodeId: 105958, plannedRank: 3 })
    expect(result.plan).toMatchObject({ kind: 'source', validation: 'source-validated', normalized: '3' })
    expect(rpc.callTool).toHaveBeenCalledTimes(1)
  })

  it('rejects a different calculator class before invoking the remote tool', async () => {
    const rpc = transport()
    const request: WowBuildQuery = { ...query, operation: 'compare-talents', build: 'https://wuxianwow.com/talents/2?t=3' }
    expect(await new WowBuildSource(rpc).query(request)).toMatchObject({ outcome: 'error', errorCode: 'invalid-plan' })
    expect(rpc.callTool).not.toHaveBeenCalled()
  })

  it('keeps Retail explicit-node comparisons local and does not interpret game import codes', async () => {
    const rpc = transport()
    const source = new WowBuildSource(rpc)
    const request: WowBuildQuery = { ...query, game: 'retail', operation: 'compare-talents', build: '[{"nodeId":21,"rank":1}]' }
    expect(readable(await source.query(request, context()), request)?.nodes[0]).toMatchObject({ nodeId: 21, currentRank: 0, purchasedRank: 0, plannedRank: 1, delta: 1 })
    expect(await source.query({ ...request, build: 'https://wuxianwow.com/talents/1?t=3' }, context())).toMatchObject({ outcome: 'unsupported', errorCode: 'unsupported-plan' })
    expect(await source.query({ ...request, build: 'C4DAAAGameCode' }, context())).toMatchObject({ outcome: 'error', errorCode: 'invalid-plan' })
    expect(rpc.listTools).not.toHaveBeenCalled()
    expect(rpc.callTool).not.toHaveBeenCalled()
  })

  it('uses only local base fields for a Retail candidate without inventing scaled attributes', async () => {
    const rpc = transport()
    const local = { query: vi.fn(async () => parse(retailDatabaseResultSchema, nativeItem)) }
    const request: WowBuildQuery = { operation: 'compare-item', game: 'retail', slot: 16, itemId: nativeItem.entries[0]!.numericId }
    const result = await new WowBuildSource(rpc, local).query(request)
    expect(result.item?.candidate.stats).toEqual([])
    expect(result.item?.candidate.fields).toEqual(nativeItem.entries[0]!.fields)
    expect(result.item?.differences).toEqual([])
    expect(result.item?.basis).toBe('unresolved')
    expect(readable(result, request)).toBeDefined()
    expect(rpc.callTool).not.toHaveBeenCalled()
  })

  it('returns local spell templates as raw fields and requests exactly the chosen typed ID', async () => {
    const rpc = transport()
    const local = { query: vi.fn(async () => parse(retailDatabaseResultSchema, nativeSpell)) }
    const request: WowBuildQuery = { operation: 'spell', game: 'retail', spellId: nativeSpell.entries[0]!.numericId }
    const result = await new WowBuildSource(rpc, local).query(request)
    expect(result.spell?.notices).toContain('raw-spell-template')
    expect(result.spell?.description).toBeUndefined()
    expect(readable(result, request)).toBeDefined()
    expect(local.query).toHaveBeenCalledExactlyOnceWith({ operation: 'fetch', id: `spell:${request.spellId}` })
    expect(rpc.callTool).not.toHaveBeenCalled()
  })

  it('preserves unavailable and malformed source outcomes without exposing raw failures', async () => {
    const rpc = transport()
    const source = new WowBuildSource(rpc)
    vi.mocked(rpc.callTool).mockRejectedValueOnce(new Error('private remote failure'))
    expect(await source.query(query)).toMatchObject({ outcome: 'unavailable', errorCode: 'source-unavailable' })
    const wrong: McpCallToolResult = { structuredContent: { ...talents, class_id: 2 } }
    vi.mocked(rpc.callTool).mockResolvedValueOnce(wrong)
    expect(await source.query(query)).toMatchObject({ outcome: 'error', errorCode: 'source-invalid' })
  })
})

describe('recorded build answer boundary', () => {
  it('reads recorded text parts and rejects wrong versions, IDs, slots and extra fields', async () => {
    const source = new WowBuildSource(transport())
    const request: WowBuildQuery = { operation: 'compare-item', game: 'forever', slot: 16, itemId: 277979 }
    const result = await source.query(request)
    expect(readWowBuildAnswer([{ type: 'text', text: JSON.stringify(result) }], args(request))).toBeDefined()
    expect(readWowBuildAnswer(result, args({ ...request, game: 'retail' }))).toBeUndefined()
    expect(readWowBuildAnswer(result, args({ ...request, slot: 17 }))).toBeUndefined()
    expect(readWowBuildAnswer(result, args({ ...request, itemId: 25 }))).toBeUndefined()
    expect(readWowBuildAnswer({ ...result, path: 'private' }, args(request))).toBeUndefined()
  })

  it('rejects fabricated rank, unsafe URL, source clocks and sparse payloads', async () => {
    const result = await new WowBuildSource(transport()).query(query)
    const node = result.nodes[0]!
    expect(readable({ ...result, nodes: [{ ...node, mapping: 'same-build', currentRank: 3 }] }, query)).toBeUndefined()
    expect(readWowBuildAnswer({ ...result, nodes: new Array<unknown>(1_000_000) }, args(query))).toBeUndefined()
    const request: WowBuildQuery = { operation: 'compare-item', game: 'forever', slot: 16, itemId: 277979 }
    const gear = await new WowBuildSource(transport()).query(request)
    expect(readWowBuildAnswer({ ...gear, item: { ...gear.item, candidate: { ...gear.item?.candidate, url: 'javascript:alert(1)' } } }, args(request))).toBeUndefined()
    expect(readWowBuildAnswer({ ...gear, item: { ...gear.item, differences: [{ key: 'ITEM_MOD_STAMINA_SHORT', current: 0, candidate: 999, delta: 999 }] } }, args(request))).toBeUndefined()
    expect(readWowBuildAnswer({ ...result, sources: [{ ...result.sources[0], receivedAt: '2026-02-30T01:00:00Z' }] }, args(query))).toBeUndefined()
  })
})
