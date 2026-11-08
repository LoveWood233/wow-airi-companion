import type { Tool } from '@xsai/shared-chat'

import { readWowBuildAnswer } from '@proj-airi/stage-shared/wow-knowledge'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { parse } from 'valibot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import talents from '../../../../../../../packages/stage-shared/src/wow-knowledge/fixtures/build-talents-warrior.json'
import nativeItem from '../../../../../../../packages/stage-shared/src/wow-knowledge/fixtures/retail-database-item.json'
import nativeSpell from '../../../../../../../packages/stage-shared/src/wow-knowledge/fixtures/retail-database-spell.json'

import { loadoutStateFixture } from '../../../../shared/wow-companion-loadout.test-helper'
import { talentSnapshotSchema } from '../../../../shared/wow-companion-talents'
import { useWowCompanionStore } from '../../wow-companion'
import { wowBuildAssistantTools } from './wow-build-assistant'

const ipc = vi.hoisted(() => ({ list: vi.fn(), call: vi.fn(), local: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async original => ({
  ...await original<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    if (event.receiveEvent?.id === 'eventa:invoke:electron:mcp:list-tools-receive')
      return ipc.list
    if (event.receiveEvent?.id === 'eventa:invoke:electron:mcp:call-tool-receive')
      return ipc.call
    if (event.receiveEvent?.id === 'eventa:invoke:wow-retail-database:query-receive')
      return ipc.local
    return vi.fn(async () => {
      throw new Error('Unexpected game IPC')
    })
  },
}))

let pinia: ReturnType<typeof createPinia>
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => {
  disposePinia(pinia)
  localStorage.clear()
})

describe('build model executor with actual Pinia and query client', () => {
  it('reads committed Forever effects separately from purchased and planned ranks', async () => {
    const state = loadoutStateFixture()
    state.game = 'forever'
    const bridge = state.bridge!
    const player = bridge.snapshot!
    player.level = 15
    const now = Date.now()
    bridge.lastSeen = new Date(now).toISOString()
    bridge.ageSeconds = 0
    bridge.talents = parse(talentSnapshotSchema, {
      v: 1,
      id: 1,
      guid: player.guid,
      session: player.session,
      observedAt: Math.floor(now / 1000),
      source: 'class-traits',
      clientBuild: '1.60.1.70707',
      locale: 'zhCN',
      class: 'WARRIOR',
      classID: 1,
      specID: 71,
      configID: 7,
      configName: 'Observed',
      configType: 1,
      status: 'active',
      hasStagedChanges: false,
      scope: 'selected-nodes',
      complete: true,
      truncated: false,
      treeIDs: [999],
      knownZeroNodes: [{ treeID: 999, nodeID: 105957 }],
      nodes: [{ treeID: 999, nodeID: 105958, ranksPurchased: 3, activeRank: 4, maxRanks: 3, isAvailable: true, isVisible: true, meetsEdgeRequirements: true, entriesComplete: true, entries: [{ entryID: 777, definitionID: 888, spellID: 12282, rank: 4, isActive: true }], conditionsComplete: true, conditions: [] }],
    })
    useWowCompanionStore().profiles.forever.state = state
    ipc.list.mockResolvedValue([{ name: 'wuxianwow::talents', serverName: 'wuxianwow', toolName: 'talents', inputSchema: {} }])
    ipc.call.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(talents) }], wowReference: { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', build: '1.60.1.70707', receivedAt: new Date(now).toISOString() } })
    const [tool] = await wowBuildAssistantTools()
    const facts = { request: '{"operation":"talents","game":"forever","classId":1,"level":15,"nodeId":105958}' }
    const raw = await tool!.execute(facts, {} as Parameters<Tool['execute']>[1])
    const report = readWowBuildAnswer(raw, JSON.stringify(facts))!
    expect(report.nodes[0]).toMatchObject({ nodeId: 105958, currentRank: 4, purchasedRank: 3, mapping: 'same-build' })
    expect(report.nodes[0]?.plannedRank).toBeUndefined()
    const request = { request: JSON.stringify({ operation: 'compare-talents', game: 'forever', classId: 1, level: 15, build: '[{"nodeId":105958,"rank":3}]' }) }
    const compared = readWowBuildAnswer(await tool!.execute(request, {} as Parameters<Tool['execute']>[1]), JSON.stringify(request))!
    expect(compared.nodes[0]).toMatchObject({ currentRank: 4, purchasedRank: 3, plannedRank: 3, delta: 0 })
    expect(ipc.call).toHaveBeenCalledTimes(2)
    expect(ipc.local).not.toHaveBeenCalled()
  })

  it('queries a Retail spell through local Eventa without any wuxianwow request', async () => {
    useWowCompanionStore().profiles.retail.state = loadoutStateFixture()
    ipc.local.mockResolvedValue(nativeSpell)
    const [tool] = await wowBuildAssistantTools()
    const request = { request: JSON.stringify({ operation: 'spell', game: 'retail', spellId: 16153 }) }
    const report = readWowBuildAnswer(await tool!.execute(request, {} as Parameters<Tool['execute']>[1]), JSON.stringify(request))!
    expect(report.spell?.spellId).toBe(16153)
    expect(report.spell?.description).toBeUndefined()
    expect(report.sources[0]?.kind).toBe('retail-db2')
    expect(ipc.local).toHaveBeenCalledExactlyOnceWith({ operation: 'fetch', id: 'spell:16153' })
    expect(ipc.list).not.toHaveBeenCalled()
    expect(ipc.call).not.toHaveBeenCalled()
  })

  it('compares an explicit Retail slot against base fields without inventing candidate stats', async () => {
    useWowCompanionStore().profiles.retail.state = loadoutStateFixture()
    ipc.local.mockResolvedValue(nativeItem)
    const [tool] = await wowBuildAssistantTools()
    const request = { request: JSON.stringify({ operation: 'compare-item', game: 'retail', slot: 1, itemId: 12359 }) }
    const report = readWowBuildAnswer(await tool!.execute(request, {} as Parameters<Tool['execute']>[1]), JSON.stringify(request))!
    expect(report.item?.slot).toBe(1)
    expect(report.item?.baseline?.itemID).toBe(123)
    expect(report.item?.candidate.stats).toEqual([])
    expect(report.item?.differences.every(row => row.candidate === undefined && row.delta === undefined)).toBe(true)
    expect(report.item?.basis).toBe('unresolved')
    expect(ipc.call).not.toHaveBeenCalled()
    expect(ipc.list).not.toHaveBeenCalled()
  })
})
