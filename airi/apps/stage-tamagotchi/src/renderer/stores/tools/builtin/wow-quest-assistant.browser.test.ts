import type { Tool } from '@xsai/shared-chat'

import { readWowQuestAnswer } from '@proj-airi/stage-shared/wow-knowledge'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import quest from '../../../../../../../packages/stage-shared/src/wow-knowledge/fixtures/quest-detail-horde.json'

import { loadoutStateFixture } from '../../../../shared/wow-companion-loadout.test-helper'
import { useWowChatterSettingsStore } from '../../wow-chatter-settings'
import { useWowCompanionStore } from '../../wow-companion'
import { wowQuestAssistantTools } from './wow-quest-assistant'

const ipc = vi.hoisted(() => ({ list: vi.fn(), call: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async original => ({
  ...await original<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    if (event.receiveEvent?.id === 'eventa:invoke:electron:mcp:list-tools-receive')
      return ipc.list
    if (event.receiveEvent?.id === 'eventa:invoke:electron:mcp:call-tool-receive')
      return ipc.call
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

describe('quest model executor', () => {
  it('reads actual Retail progress through real stores without remote queries or enabling reminders', async () => {
    const state = loadoutStateFixture()
    const bridge = state.bridge!
    const snapshot = bridge.snapshot!
    const now = Date.now()
    bridge.lastSeen = new Date(now).toISOString()
    bridge.ageSeconds = 0
    bridge.quests = {
      v: 1,
      id: 1,
      session: snapshot.session,
      guid: snapshot.guid,
      observedAt: Math.floor(now / 1000),
      source: 'quest-log',
      log: { complete: true, truncated: false, total: 1, entries: [{ questID: 42, title: 'Observed task', level: 15, header: 'Observed category', readyForTurnIn: true, failed: false, objectivesComplete: true, objectives: [] }] },
      completion: { source: 'unknown', scope: 'unknown', complete: false, truncated: false, total: null, ids: [], turnIns: [] },
    }
    const companion = useWowCompanionStore()
    companion.profiles.retail.state = state
    const [tool] = await wowQuestAssistantTools()
    const raw = await tool!.execute({ request: '{"operation":"detail","game":"retail","questId":42}' }, {} as Parameters<Tool['execute']>[1])
    const result = readWowQuestAnswer(raw, JSON.stringify({ request: '{"operation":"detail","game":"retail","questId":42}' }))!
    expect(result.entries[0]?.questId).toBe(42)
    expect(result.entries[0]?.progress.status).toBe('ready-to-turn-in')
    expect(result.sources[0]?.kind).toBe('quest-log')
    expect(ipc.list).not.toHaveBeenCalled()
    expect(ipc.call).not.toHaveBeenCalled()
    expect(useWowChatterSettingsStore().questEnabled).toBe(false)
  })

  it('uses the Forever source and keeps absent player telemetry unknown', async () => {
    ipc.list.mockResolvedValue([{ name: 'wuxianwow::quests', serverName: 'wuxianwow', toolName: 'quests', inputSchema: {} }])
    ipc.call.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(quest) }] })
    const [tool] = await wowQuestAssistantTools()
    const raw = await tool!.execute({ request: '{"operation":"detail","game":"forever","questId":844}' }, {} as Parameters<Tool['execute']>[1])
    const result = readWowQuestAnswer(raw, JSON.stringify({ request: '{"operation":"detail","game":"forever","questId":844}' }))!
    expect(result.entries[0]?.questId).toBe(844)
    expect(result.entries[0]?.url).toBe('https://wuxianwow.com/quest/844')
    expect(result.entries[0]?.progress.status).toBe('unknown')
    expect(result.sources[0]?.name).toBe('无限图鉴 wuxianwow.com')
    expect(ipc.call).toHaveBeenCalledWith(expect.objectContaining({ name: 'wuxianwow::quests', arguments: { id: 844 } }))
  })
})
