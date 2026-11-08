import type { RetailDatabaseResult } from '@proj-airi/stage-shared/wow-knowledge'
import type { McpCallToolResult, McpToolRuntime } from '@proj-airi/stage-ui/tools/mcp'

import { describe, expect, it, vi } from 'vitest'

import item from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/build-item-base.json'
import catalog from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/build-talents-warrior.json'

import { projectWowBuildContext, WowBuildClient } from './wow-build-client'
import { buildStateFixture } from './wow-build.test-helper'

function transport(): McpToolRuntime {
  return {
    listTools: vi.fn(async () => [{ name: 'wuxianwow::talents', toolName: 'talents', serverName: 'wuxianwow', inputSchema: {} }]),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(catalog) }] })),
  }
}

describe('build client observation and transport boundary', () => {
  it('copies actual talent and equipment instance evidence without treating missing nodes as zero', () => {
    const state = buildStateFixture()
    const context = projectWowBuildContext(state)
    expect(context.classId).toBe(1)
    expect(context.talents?.knownZeroNodes).toEqual([{ treeID: 161, nodeID: 105957 }])
    expect(context.talents?.nodes).toHaveLength(1)
    expect(context.loadout?.slots[15].item?.link).toContain('1234:5678')
    context.talents!.nodes[0].entries[0].spellID = 99
    context.loadout!.slots[15].item!.stats[0].value = 999
    expect(state.bridge!.talents!.nodes[0].entries[0].spellID).toBe(12282)
    expect(state.bridge!.equipmentLoadout!.slots[15].item!.stats[0].value).toBe(2)
  })

  it('retains old equipment capture clocks while rejecting stale talents and mismatched sessions', () => {
    const state = buildStateFixture()
    state.bridge!.talents!.observedAt -= 181
    const context = projectWowBuildContext(state)
    expect(context.talents).toBeUndefined()
    expect(context.loadout?.observedAt).toBe(new Date(state.bridge!.equipmentLoadout!.observedAt * 1000).toISOString())
    state.bridge!.equipmentLoadout!.session = 'previous-login'
    expect(projectWowBuildContext(state).loadout).toBeUndefined()
  })

  it('rejects disabled, demo, failed, or mismatched observations without falling back to stored history', () => {
    const state = buildStateFixture()
    state.settings.enabled = false
    expect(projectWowBuildContext(state)).toEqual({ game: 'unknown' })
    state.settings.enabled = true
    state.bridge!.source = 'demo'
    expect(projectWowBuildContext(state)).toEqual({ game: 'unknown' })
    state.bridge!.source = 'screen'
    state.bridge!.talentsError = 'incomplete new capture'
    state.bridge!.equipmentLoadoutError = 'incomplete new capture'
    expect(projectWowBuildContext(state).talents).toBeUndefined()
    expect(projectWowBuildContext(state).loadout).toBeUndefined()
  })

  it('does not infer class IDs from a token or require speech eligibility for an explicit read', () => {
    const state = buildStateFixture()
    state.bridge!.talents!.classID = null
    state.bridge!.snapshot!.combat = true
    state.bridge!.snapshot!.dead = true
    state.settings.muted = true
    const context = projectWowBuildContext(state)
    expect(context.game).toBe('forever')
    expect(context.classId).toBeUndefined()
    expect(context.loadout).toBeDefined()
  })

  it('keeps Retail talent comparisons local and never discovers MCP tools on construction', async () => {
    const state = buildStateFixture('retail')
    const rpc = transport()
    const database = { query: vi.fn<(request: unknown) => Promise<RetailDatabaseResult>>() }
    const client = new WowBuildClient(rpc, () => state, database)
    expect(rpc.listTools).not.toHaveBeenCalled()
    const result = await client.query({ operation: 'compare-talents', game: 'retail', classId: 1, level: 15, build: '[{"nodeId":105958,"rank":3},{"nodeId":105957,"rank":0},{"nodeId":105956,"rank":1}]' })
    expect(result.nodes.find(node => node.nodeId === 105958)).toMatchObject({ currentRank: 1, plannedRank: 3, delta: 2 })
    expect(result.nodes.find(node => node.nodeId === 105957)?.currentRank).toBe(0)
    expect(result.nodes.find(node => node.nodeId === 105956)?.currentRank).toBeUndefined()
    expect(rpc.listTools).not.toHaveBeenCalled()
    expect(database.query).not.toHaveBeenCalled()
  })

  it('uses only the local DB2 port for Retail spell facts and does not send a filesystem path', async () => {
    const rpc = transport()
    const database = { query: vi.fn(async () => ({ operation: 'fetch', outcome: 'empty', source: null, receivedAt: new Date().toISOString(), entries: [], offset: 0, limit: 1, hasMore: false, notices: [] } satisfies RetailDatabaseResult)) }
    const state = buildStateFixture('retail')
    const result = await new WowBuildClient(rpc, () => state, database).query({ operation: 'spell', game: 'retail', spellId: 12282 })
    expect(database.query).toHaveBeenCalledExactlyOnceWith({ operation: 'fetch', id: 'spell:12282' })
    expect(result.errorCode).toBe('database-unavailable')
    expect(rpc.listTools).not.toHaveBeenCalled()
    expect(rpc.callTool).not.toHaveBeenCalled()
  })

  it('drops an in-flight result after the current capture revision changes', async () => {
    const state = buildStateFixture()
    const rpc = transport()
    const pending = Promise.withResolvers<McpCallToolResult>()
    vi.mocked(rpc.callTool).mockReturnValueOnce(pending.promise)
    const request = new WowBuildClient(rpc, () => state).query({ operation: 'talents', game: 'forever', classId: 1, level: 15, nodeId: 105958 })
    await vi.waitFor(() => expect(rpc.callTool).toHaveBeenCalledTimes(1))
    state.bridge!.talents!.id++
    pending.resolve({ content: [{ type: 'text', text: JSON.stringify(catalog) }] })
    expect((await request).errorCode).toBe('telemetry-unavailable')
  })

  it('does not invalidate an equipment explanation because an unrelated talent capture refreshed', async () => {
    const state = buildStateFixture()
    const rpc = transport()
    vi.mocked(rpc.listTools).mockResolvedValue([{ name: 'wuxianwow::item_usage', serverName: 'wuxianwow', toolName: 'item_usage', inputSchema: {} }])
    const pending = Promise.withResolvers<McpCallToolResult>()
    vi.mocked(rpc.callTool).mockReturnValueOnce(pending.promise)
    const request = new WowBuildClient(rpc, () => state).query({ operation: 'compare-item', game: 'forever', slot: 16, itemId: 277979 })
    await vi.waitFor(() => expect(rpc.callTool).toHaveBeenCalledTimes(1))
    state.bridge!.talents!.id++
    pending.resolve({ content: [{ type: 'text', text: JSON.stringify(item) }] })
    expect((await request).item?.baseline?.name).toBe('Observed weapon')
  })
})
