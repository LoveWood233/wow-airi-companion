import type { McpCallToolResult, McpToolRuntime } from '@proj-airi/stage-ui/tools/mcp'

import { describe, expect, it, vi } from 'vitest'

import price from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/crafting-price-item.json'
import route from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/crafting-route-engineering.json'
import recipe from '../../../../../packages/stage-shared/src/wow-knowledge/fixtures/reference-recipe.json'

import { WowProfessionSource } from './wow-profession-source'

function response(value: unknown): McpCallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function transport(): McpToolRuntime {
  return {
    listTools: vi.fn(async () => ['search', 'fetch', 'leveling_route', 'auction_house'].map(toolName => ({ name: `wuxianwow::${toolName}`, serverName: 'wuxianwow', toolName, inputSchema: {} }))),
    callTool: vi.fn(async payload => payload.name === 'wuxianwow::fetch' ? response(recipe) : response({ outcome: 'empty', results: [], total: 0 })),
  }
}

describe('explicit profession database requests', () => {
  it('does not request anything until an explicit action and uses the advertised exact server', async () => {
    const rpc = transport()
    const source = new WowProfessionSource(rpc)
    expect(rpc.listTools).not.toHaveBeenCalled()
    expect(rpc.callTool).not.toHaveBeenCalled()
    vi.mocked(rpc.listTools).mockResolvedValue([{ name: 'other::search', serverName: 'other', toolName: 'search', inputSchema: {} }])
    await expect(source.search('瑟银')).rejects.toThrow('source-unavailable')
    expect(rpc.callTool).not.toHaveBeenCalled()
  })

  it('uses typed recipe search and reads the selected full record', async () => {
    const rpc = transport()
    vi.mocked(rpc.callTool).mockImplementation(async payload => payload.name === 'wuxianwow::search'
      ? response({ outcome: 'ok', results: [{ id: recipe.id, title: recipe.title, url: recipe.url }] })
      : response(recipe))
    const source = new WowProfessionSource(rpc)
    expect(await source.search('瑟银')).toEqual([{ id: 'recipe:8796', title: recipe.title, url: recipe.url }])
    expect(rpc.callTool).toHaveBeenCalledWith({ name: 'wuxianwow::search', arguments: { query: '瑟银', kind: 'recipe', limit: 20 } })
    expect((await source.recipe('recipe:8796')).reagents).toEqual([{ itemId: 10620, name: '瑟银矿石', count: 1 }])
    await expect(source.recipe('spell:16153')).rejects.toThrow('recipe-unavailable')
    expect(vi.mocked(rpc.callTool).mock.calls.filter(([payload]) => payload.name === 'wuxianwow::stats')).toHaveLength(0)
  })

  it('validates ranges before discovery and hydrates only the selected route interval', async () => {
    const rpc = transport()
    vi.mocked(rpc.callTool).mockImplementation(async payload => payload.name === 'wuxianwow::leveling_route' ? response(route) : response({ ...recipe, id: payload.arguments?.id, metadata: { ...recipe.metadata, id: payload.arguments?.id, recipe_id: Number(String(payload.arguments?.id).split(':')[1]) } }))
    const source = new WowProfessionSource(rpc)
    await expect(source.route('工程学', 225, 150, 'free')).rejects.toThrow('invalid-range')
    expect(rpc.listTools).not.toHaveBeenCalled()
    const result = await source.route('工程学', 150, 175, 'free')
    expect(result.route.steps).toHaveLength(1)
    expect(result.route.steps[0]?.endSkill).toBe(175)
    expect(vi.mocked(rpc.callTool).mock.calls.filter(([payload]) => payload.name === 'wuxianwow::fetch').map(([payload]) => payload.arguments?.id)).toEqual(['recipe:6858'])
    expect(result.recipes).toHaveLength(1)
  })

  it('never substitutes another recipe when the requested identity differs', async () => {
    const source = new WowProfessionSource(transport())
    await source.discover()
    await expect(source.recipe('recipe:6858')).rejects.toThrow('recipe-unavailable')
  })

  it('excludes prices for another item or a different market snapshot', async () => {
    const rpc = transport()
    vi.mocked(rpc.callTool).mockImplementation(async payload => response(payload.arguments?.item_id === 4499 ? price : { ...price, snapshot: { ...price.snapshot, realm: 'Other realm' }, item_id: 4500, today: { ...price.today, item_id: 4500 } }))
    const source = new WowProfessionSource(rpc)
    const result = await source.prices([4499, 4500, 4499])
    expect(result?.quotes).toEqual([{ itemId: 4499, unitCopper: 500000 }])
    expect(result?.collectedAt).toBe('北京时间 2026-10-26 16:49')
    expect(result?.complete).toBe(false)
    expect(result?.notices).toContain('conflicting-price-snapshots')
    expect(rpc.callTool).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed recipe query separate from an empty successful result', async () => {
    const rpc = transport()
    const source = new WowProfessionSource(rpc)
    expect(await source.search('未命中')).toEqual([])
    vi.mocked(rpc.callTool).mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'Offline' }] })
    await expect(source.search('未命中')).rejects.toThrow('source-unavailable')
  })
})
