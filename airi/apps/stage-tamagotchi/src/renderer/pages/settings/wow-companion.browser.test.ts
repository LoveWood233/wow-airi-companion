import type { TtsRequest } from '@proj-airi/pipelines-audio'

import type { CompanionState, GameVersion, Snapshot } from '../../../shared/wow-companion'
import type { EquipmentRecord } from '../../../shared/wow-companion-equipment'
import type { EquipmentHistoryEntry } from '../../../shared/wow-companion-equipment-history'
import type { EquipmentSwap } from '../../../shared/wow-companion-equipment-swaps'
import type { LevelHistoryCharacter } from '../../../shared/wow-companion-level-history'

import { Playback } from '@proj-airi/pipelines-audio'
import { useChatContextStore } from '@proj-airi/stage-ui/stores/chat/context-store'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useContextBridgeStore } from '@proj-airi/stage-ui/stores/mods/api/context-bridge'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useSpeechOutputControlStore } from '@proj-airi/stage-ui/stores/speech-output-control'
import { useVoiceStore } from '@proj-airi/stage-ui/stores/voice'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { parse } from 'yaml'

import enMessages from '../../../../../../packages/i18n/src/locales/en/wow-companion.yaml?raw'
import zhMessages from '../../../../../../packages/i18n/src/locales/zh-Hans/wow-companion.yaml?raw'
import WowCompanionForever from './wow-companion-forever.vue'
import WowCompanion from './wow-companion.vue'

import { defaultSettings } from '../../../shared/wow-companion'
import { comparisonFixture } from '../../../shared/wow-companion-comparison.test-helper'
import { loadoutFixture } from '../../../shared/wow-companion-loadout.test-helper'
import { i18n } from '../../modules/i18n'
import { useWowCompanionStore } from '../../stores/wow-companion'

import '@unocss/reset/tailwind.css'
import 'virtual:uno.css'

const invokeMocks = vi.hoisted(() => ({
  getState: vi.fn(),
  setAccountName: vi.fn(),
  setSettings: vi.fn(),
  setCapture: vi.fn(),
  demo: vi.fn(),
}))

vi.mock('@proj-airi/electron-vueuse', async importOriginal => ({
  ...await importOriginal<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    switch (event.receiveEvent?.id) {
      case 'eventa:invoke:wow-companion:get-receive': return invokeMocks.getState
      case 'eventa:invoke:wow-companion:account-name-receive': return invokeMocks.setAccountName
      case 'eventa:invoke:wow-companion:settings-receive': return invokeMocks.setSettings
      case 'eventa:invoke:wow-companion:capture-receive': return invokeMocks.setCapture
      case 'eventa:invoke:wow-companion:demo-receive': return invokeMocks.demo
      default: throw new Error(`Unexpected Eventa invoke: ${event.receiveEvent?.id}`)
    }
  },
}))

const now = Date.parse('2026-10-22T10:00:00Z')
const snapshot: Snapshot = {
  v: 3,
  session: 'session-1',
  seq: 1,
  tick: 1,
  guid: 'Player-1',
  name: 'Mage',
  realm: 'Azeroth',
  level: 30,
  class: 'MAGE',
  faction: 'Alliance',
  race: 'Human',
  spec: 64,
  map: 84,
  zone: 'Stormwind',
  combat: false,
  dead: false,
  online: true,
  account: 'account-1',
  moneyEpoch: 'money-1',
  copper: 12345678,
  earned: 50000,
  spent: 10000,
}

function liveState(game: GameVersion = 'retail'): CompanionState {
  return {
    game,
    settings: { ...defaultSettings },
    bridge: {
      instanceId: 'decoder-1',
      status: 'live',
      source: 'screen',
      snapshot: { ...snapshot },
      lastSeen: new Date(now).toISOString(),
      ageSeconds: 0,
      eventCursor: 0,
      events: [],
      equipmentComparisons: [],
      equipmentComparisonError: null,
      equipmentLoadout: null,
      equipmentLoadoutError: null,
      config: { x: 8, y: 32, cellSize: 1, pollMs: 500, paused: false },
      error: null,
    },
    error: null,
    updatedAt: now,
    equipmentHistory: { entries: [], storageError: null },
    equipmentComparisons: { entries: [], storageError: null },
    equipmentLoadouts: { entries: [], latestCharacter: null, storageError: null },
    levelHistory: { characters: [], storageError: null },
    gold: {
      storageError: null,
      accounts: [{
        account: 'account-1',
        name: 'Main account',
        earned: '50000',
        spent: '10000',
        net: '40000',
        balance: '12345678',
        characterCount: 1,
        firstSeen: now,
        lastSeen: now,
        characters: [{ guid: 'Player-1', name: 'Mage', realm: 'Azeroth', copper: 12345678, earned: '50000', spent: '10000', net: '40000', firstSeen: now, lastSeen: now }],
      }],
    },
  }
}

function disabledForever(): CompanionState {
  const state = liveState('forever')
  state.settings.enabled = false
  state.updatedAt = 0
  state.bridge = null
  state.gold.accounts = []
  return state
}

function newEquipment(name: string, id = 1): EquipmentRecord {
  return {
    v: 1,
    id,
    session: snapshot.session,
    guid: snapshot.guid,
    itemID: 19019,
    itemGUID: 'Item-1',
    link: '|Hitem:19019|h[Equipment]|h',
    name,
    type: 'Weapon',
    subtype: 'Sword',
    equipLoc: 'INVTYPE_WEAPON',
    quality: 5,
    itemLevel: 50,
    requiredLevel: 30,
    stats: [{ key: 'ITEM_MOD_STRENGTH_SHORT', value: 12 }, { key: 'UNKNOWN_STAT', value: 3 }],
    tooltip: ['+12 Strength', 'Set (2): Gain a bonus'],
    quantity: 1,
    observedAt: Math.floor(now / 1000),
    source: 'bag_added',
    infoComplete: true,
    statsComplete: true,
    tooltipComplete: true,
    truncated: false,
  }
}

function mockStates(retail: CompanionState, forever = disabledForever()) {
  invokeMocks.getState.mockImplementation(({ game }: { game: GameVersion }) => Promise.resolve(structuredClone(game === 'retail' ? retail : forever)))
}

function savedEquipment(record: EquipmentRecord, labels: Partial<EquipmentHistoryEntry> = {}): EquipmentHistoryEntry {
  return { account: snapshot.account, name: snapshot.name, realm: snapshot.realm, receivedAt: now, record, ...labels }
}

function newEquipmentSwap(id = 1): EquipmentSwap {
  return { v: 1, kind: 'swap', s: snapshot.session, g: snapshot.guid, id, e: 1, st: 'equipped', r: 'confirmed', at: Math.floor(now / 1000), slot: 16, item: 19019, old: 123 }
}

function levelCharacter(overrides: Partial<LevelHistoryCharacter> = {}): LevelHistoryCharacter {
  const day = 86_400_000
  return {
    account: snapshot.account,
    guid: snapshot.guid,
    name: snapshot.name,
    realm: snapshot.realm,
    currentLevel: 31,
    firstSeen: now - 7 * day,
    lastSeen: now,
    records: [
      { id: 1, fromLevel: null, level: 28, recordedAt: now - 7 * day, source: 'baseline', durationMs: null, durationBasis: 'unknown' },
      { id: 2, fromLevel: 28, level: 29, recordedAt: now - 6 * day, source: 'live', durationMs: day, durationBasis: 'partial' },
      { id: 3, fromLevel: 29, level: 30, recordedAt: now - 4 * day, source: 'live', durationMs: 2 * day, durationBasis: 'complete' },
      { id: 4, fromLevel: 30, level: 31, recordedAt: now, source: 'live', durationMs: 4 * day, durationBasis: 'complete' },
    ],
    ...overrides,
  }
}

async function renderPage(state = liveState(), locale = 'en', forever = disabledForever()) {
  mockStates(state, forever)
  const pinia = createPinia()
  setActivePinia(pinia)
  const companion = useWowCompanionStore(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/settings/wow-companion', component: WowCompanion },
      { path: '/settings/wow-companion-forever', component: WowCompanionForever },
    ],
  })
  await router.push('/settings/wow-companion')
  await router.isReady()
  const content = defineComponent({
    setup() {
      // Owner polling reads the stores that the main Stage initializes inside its component scope.
      useContextBridgeStore(pinia)
      useVoiceStore(pinia)
      useSpeechOutputControlStore(pinia)
      return () => h(RouterView)
    },
  })
  const screen = await render(content, {
    global: {
      plugins: [pinia, router, createI18n({
        legacy: false,
        locale,
        messages: { 'en': { 'wow-companion': parse(enMessages) }, 'zh-Hans': { 'wow-companion': parse(zhMessages) } },
        missingWarn: false,
        fallbackWarn: false,
      })],
    },
  })
  onTestFinished(() => {
    companion.stop()
    screen.unmount()
  })
  await expect.poll(() => companion.profiles.retail.state.updatedAt).toBe(now)
  return { companion, pinia, router }
}

async function speechCompanion(state = liveState(), forever = disabledForever()) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  const previousLocale = i18n.global.locale.value
  i18n.global.locale.value = 'zh-Hans'
  onTestFinished(() => {
    i18n.global.locale.value = previousLocale
    vi.useRealTimers()
  })
  const result = await renderPage(state, 'zh-Hans', forever)
  const cards = useAiriCardStore(result.pinia)
  cards.moduleDefaults = {
    consciousness: { provider: '', model: '' },
    vision: { provider: '', model: '' },
    speech: { provider: '', model: '', voice_id: '' },
  }
  const speech = { provider: 'wow-test-speech', model: 'test-speech', voice_id: 'test-voice' }
  cards.cards.set('wow-test-character', {
    name: '希瓦',
    version: '1.0.0',
    extensions: {
      airi: {
        avatarModels: [],
        modules: { ...cards.moduleDefaults, speech },
        agents: {},
      },
    },
  })
  useProviderConfigStore(result.pinia).ensureProvider('wow-test-speech', 'mimo-audio-speech', { model: 'test-speech', voice: 'test-voice' })
  const sessions = useChatSessionStore(result.pinia)
  const sessionId = await sessions.createSession('wow-test-character')
  const voice = useVoiceStore(result.pinia)
  // A null provider result exercises real speech turn ownership without a remote request or audio playback.
  const synthesize = vi.fn(async (_request: TtsRequest, _signal: AbortSignal) => null)
  const playback = new Playback({
    nowMs: () => 0,
    play: () => ({ done: Promise.resolve({ throughMs: 1 }), stop: async () => ({ throughMs: 0 }) }),
  })
  const output = vi.fn(() => ({ playback, synthesize }))
  const disconnect = voice.connectOutput(output)
  onTestFinished(disconnect)
  const controls = useSpeechOutputControlStore(result.pinia)
  controls.setSpeechMuted(false)
  controls.setSpeechVolume(1)
  result.companion.start(true)
  await result.companion.refresh('retail')

  async function refreshAt(time: number) {
    vi.setSystemTime(time)
    for (const profile of [state, forever]) {
      profile.updatedAt = time
      if (profile.bridge) {
        profile.bridge.lastSeen = new Date(time).toISOString()
        profile.bridge.ageSeconds = 0
        if (profile.bridge.snapshot)
          profile.bridge.snapshot.seq++
      }
    }
    mockStates(state, forever)
    await result.companion.refresh('retail')
    await result.companion.refresh('forever')
    await nextTick()
  }

  async function observeUntil(time: number) {
    while (Date.now() < time)
      await refreshAt(Math.min(Date.now() + 10_000, time))
  }

  return { ...result, cards, speech, sessions, sessionId, voice, controls, synthesize, output, refreshAt, observeUntil }
}

describe('woW companion proactive speech', () => {
  beforeEach(() => vi.resetAllMocks())

  it('speaks a named interaction every noncombat minute without a chat model or duplicate polls', async () => {
    const state = liveState()
    state.bridge!.snapshot!.name = '深烘拿铁'
    const { output, synthesize, observeUntil, refreshAt, companion } = await speechCompanion(state)
    await observeUntil(now + 59_000)
    expect(output).not.toHaveBeenCalled()
    await refreshAt(now + 60_000)
    await expect.poll(() => output.mock.calls.length).toBe(1)
    await expect.poll(() => synthesize.mock.calls.length).toBeGreaterThan(0)
    expect(JSON.stringify(synthesize.mock.calls)).toContain('深烘拿铁')
    expect(JSON.stringify(synthesize.mock.calls)).not.toContain('idle-interaction.messages')
    await expect.poll(() => companion.profiles.retail.responseState).toBe('submitted')
    await refreshAt(now + 60_000)
    expect(output).toHaveBeenCalledTimes(1)
    await observeUntil(now + 120_000)
    await expect.poll(() => output.mock.calls.length).toBe(2)
  })

  it.each(['companion-muted', 'speech-muted', 'zero-volume', 'no-provider', 'no-model', 'no-voice'] as const)('keeps proactive speech silent while %s', async (blocked) => {
    const state = liveState()
    const { output, speech, cards, controls, observeUntil } = await speechCompanion(state)
    if (blocked === 'companion-muted')
      state.settings.muted = true
    if (blocked === 'speech-muted')
      controls.setSpeechMuted(true)
    if (blocked === 'zero-volume')
      controls.setSpeechVolume(0)
    if (blocked === 'no-provider')
      speech.provider = 'speech-noop'
    if (blocked === 'no-model')
      speech.model = ''
    if (blocked === 'no-voice')
      speech.voice_id = ''
    if (blocked.startsWith('no-')) {
      cards.cards.get('wow-test-character')!.extensions.airi.modules.speech = { ...speech }
      await useProviderConfigStore().resetProviders()
    }
    await observeUntil(now + 70_000)
    expect(output).not.toHaveBeenCalled()
  })

  it('restarts the one-minute wait after combat and after a newer character logs in', async () => {
    const state = liveState()
    const { output, synthesize, observeUntil, refreshAt } = await speechCompanion(state)
    await observeUntil(now + 50_000)
    state.bridge!.snapshot!.combat = true
    await refreshAt(now + 51_000)
    state.bridge!.snapshot!.combat = false
    await refreshAt(now + 60_000)
    await observeUntil(now + 110_000)
    expect(output).not.toHaveBeenCalled()
    state.bridge!.snapshot = { ...state.bridge!.snapshot!, guid: 'Player-latest', session: 'latest-session', name: '新登录角色' }
    await refreshAt(now + 111_000)
    await observeUntil(now + 170_000)
    expect(output).not.toHaveBeenCalled()
    await refreshAt(now + 171_000)
    await expect.poll(() => output.mock.calls.length).toBe(1)
    await expect.poll(() => JSON.stringify(synthesize.mock.calls)).toContain('新登录角色')
    expect(JSON.stringify(synthesize.mock.calls)).not.toContain('Mage')
  })

  it('waits for another voice turn and then speaks only one due interaction', async () => {
    const state = liveState()
    const { output, voice, sessionId, observeUntil, refreshAt } = await speechCompanion(state)
    await observeUntil(now + 50_000)
    const foreground = { sessionId, turnId: 'foreground-chat' }
    voice.startResponse(foreground)
    expect(output).toHaveBeenCalledTimes(1)
    await observeUntil(now + 60_000)
    expect(output).toHaveBeenCalledTimes(1)
    await voice.finishResponse(foreground)
    await refreshAt(now + 61_000)
    await expect.poll(() => output.mock.calls.length).toBe(2)
    await refreshAt(now + 61_000)
    expect(output).toHaveBeenCalledTimes(2)
    await observeUntil(now + 120_000)
    expect(output).toHaveBeenCalledTimes(2)
    await refreshAt(now + 121_000)
    await expect.poll(() => output.mock.calls.length).toBe(3)
  })

  it('allows slow synthesis beyond thirty seconds but cancels it when combat starts', async () => {
    const state = liveState()
    const { companion, voice, output, synthesize, observeUntil, refreshAt } = await speechCompanion(state)
    const requests = new Set<AbortSignal>()
    synthesize.mockImplementation((_request, signal) => {
      requests.add(signal)
      return new Promise<null>((resolve) => {
        signal.addEventListener('abort', () => resolve(null), { once: true })
      })
    })
    await observeUntil(now + 60_000)
    await expect.poll(() => output.mock.calls.length).toBe(1)
    await expect.poll(() => requests.size).toBeGreaterThan(0)
    await observeUntil(now + 100_000)
    expect(voice.activeTurns).toHaveLength(1)
    expect([...requests].some(signal => signal.aborted)).toBe(false)
    state.bridge!.snapshot!.combat = true
    await refreshAt(now + 101_000)
    await expect.poll(() => [...requests].every(signal => signal.aborted)).toBe(true)
    await expect.poll(() => voice.activeTurns.length).toBe(0)
    expect(companion.profiles.retail.responseState).toBe('idle')
    expect(companion.profiles.retail.error).toBe('')
  })

  it('cancels pending idle speech before it announces a new equipment upgrade', async () => {
    const state = liveState()
    const { companion, voice, output, synthesize, observeUntil, refreshAt } = await speechCompanion(state)
    const idleRequests = new Set<AbortSignal>()
    const overlap: boolean[] = []
    synthesize.mockImplementation((request, signal) => {
      if (request.turnId?.startsWith('wow-idle:')) {
        idleRequests.add(signal)
        return new Promise<null>((resolve) => {
          signal.addEventListener('abort', () => resolve(null), { once: true })
        })
      }
      overlap.push([...idleRequests].some(signal => !signal.aborted)
        || voice.activeTurns.some(turn => turn.turnId.startsWith('wow-idle:')))
      return Promise.resolve(null)
    })
    await observeUntil(now + 60_000)
    await expect.poll(() => idleRequests.size).toBeGreaterThan(0)
    expect(output).toHaveBeenCalledTimes(1)
    const comparison = comparisonFixture({ session: snapshot.session, guid: snapshot.guid })
    state.bridge!.equipmentComparisons = [comparison]
    state.bridge!.equipmentOffer = {
      v: 1,
      kind: 'offer',
      s: comparison.session,
      g: comparison.guid,
      id: comparison.id,
      q: 1,
      st: 'ready',
      slot: comparison.slot,
      item: comparison.candidate.itemID,
      n: comparison.candidate.name,
      il: comparison.candidate.itemLevel,
      old: comparison.current!.itemID,
      ol: comparison.current!.itemLevel,
      until: Math.floor((now + 181_000) / 1000),
    }
    await refreshAt(now + 61_000)
    await expect.poll(() => [...idleRequests].every(signal => signal.aborted)).toBe(true)
    await expect.poll(() => output.mock.calls.length).toBe(2)
    await expect.poll(() => overlap.length).toBeGreaterThan(0)
    expect(overlap.some(Boolean)).toBe(false)
    await expect.poll(() => companion.equipmentPrompt?.phase).toBe('choosing')
    expect(companion.equipmentPrompt?.text).toContain('New robe')
    expect(companion.equipmentPrompt?.text).toContain('恭喜获得')
    expect(companion.profiles.retail.error).toBe('')
  })

  it('speaks a named equipment congratulations and retains the change confirmation', async () => {
    const state = liveState()
    state.bridge!.snapshot!.name = '深烘拿铁'
    const comparison = comparisonFixture({ session: snapshot.session, guid: snapshot.guid })
    state.bridge!.equipmentComparisons = [comparison]
    state.bridge!.equipmentOffer = {
      v: 1,
      kind: 'offer',
      s: comparison.session,
      g: comparison.guid,
      id: comparison.id,
      q: 1,
      st: 'ready',
      slot: comparison.slot,
      item: comparison.candidate.itemID,
      n: comparison.candidate.name,
      il: comparison.candidate.itemLevel,
      old: comparison.current!.itemID,
      ol: comparison.current!.itemLevel,
      until: Math.floor(now / 1000) + 120,
    }
    const { companion, output, synthesize } = await speechCompanion(state)
    await expect.poll(() => output.mock.calls.length).toBe(1)
    await expect.poll(() => synthesize.mock.calls.length).toBeGreaterThan(0)
    const spoken = JSON.stringify(synthesize.mock.calls)
    expect(spoken).toContain('深烘拿铁')
    expect(spoken).toContain('New robe')
    expect(spoken).toContain('恭喜获得')
    expect(spoken).toContain('又能变强了')
    await expect.poll(() => companion.equipmentPrompt?.phase).toBe('choosing')
    expect(companion.equipmentPrompt?.text).toContain('要换上这件装备吗')
    const prompt = companion.equipmentPrompt
    if (!prompt)
      throw new Error('Expected an equipment reminder')
    companion.chooseEquipmentPrompt(prompt.id, 'accept')
    expect(companion.equipmentPrompt?.text).toContain('请在游戏内点击“确认换装”')
  })
})

describe('woW companion faction and race', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows translated factions and localized race labels for each game, with explicit unknown values', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    if (!retail.bridge?.snapshot || !forever.bridge?.snapshot)
      throw new Error('Expected snapshots')
    retail.bridge.snapshot.faction = 'Horde'
    retail.bridge.snapshot.race = '血精灵'
    forever.bridge.snapshot.faction = 'Neutral'
    forever.bridge.snapshot.race = '熊猫人'
    const { companion } = await renderPage(retail, 'zh-Hans', forever)
    await expect.element(page.getByText('部落', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('血精灵', { exact: true })).toBeInTheDocument()
    await page.getByRole('button', { name: '魔兽世界：无限', exact: true }).click()
    await expect.element(page.getByText('中立', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('熊猫人', { exact: true })).toBeInTheDocument()
    forever.bridge.snapshot.seq++
    forever.bridge.snapshot.faction = null
    forever.bridge.snapshot.race = null
    mockStates(retail, forever)
    await companion.refresh('forever')
    await expect.poll(() => page.getByText('未知', { exact: true }).elements().length).toBe(2)
  })

  it('updates ordinary chat with observed identity and never treats an unknown Pandaren faction as known', async () => {
    const state = liveState()
    const { companion, pinia } = await renderPage(state)
    await expect.element(page.getByText('Alliance', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Human', { exact: true })).toBeInTheDocument()
    companion.start(true)
    await companion.refresh('retail')
    expect(companion.profiles.retail.error).toBe('')
    const contexts = useChatContextStore(pinia)
    let text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).toContain('Observed player identity')
    expect(text).toContain('Alliance')
    expect(text).toContain('Human')
    if (!state.bridge?.snapshot)
      throw new Error('Expected snapshot')
    state.bridge.snapshot.seq++
    state.bridge.snapshot.faction = null
    state.bridge.snapshot.race = '熊猫人'
    mockStates(state)
    await companion.refresh('retail')
    text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).toContain('Unknown')
    expect(text).toContain('熊猫人')
    expect(text).toContain('Never infer faction from race')
    expect(text).toContain('Never extend them to real-world groups')
    expect(companion.profiles.retail.responseState).toBe('idle')
  })

  it('sends the death identity and persona-aware banter rules to the reaction boundary', async () => {
    const state = liveState()
    if (!state.bridge?.snapshot)
      throw new Error('Expected snapshot')
    state.bridge.snapshot.faction = 'Horde'
    state.bridge.snapshot.race = '血精灵'
    state.bridge.snapshot.name = '深烘拿铁'
    const { companion, pinia } = await renderPage(state, 'en', disabledForever())
    const consciousness = useConsciousnessStore(pinia)
    const previousProvider = consciousness.activeProvider
    const previousModel = consciousness.activeModel
    consciousness.activeProvider = 'openai'
    await nextTick()
    consciousness.activeModel = 'test-model'
    const dispatch = vi.spyOn(useContextBridgeStore(pinia), 'dispatchSparkNotifyReaction').mockResolvedValue('A fictional reply')
    onTestFinished(async () => {
      dispatch.mockRestore()
      consciousness.activeProvider = previousProvider
      await nextTick()
      consciousness.activeModel = previousModel
    })
    companion.start(true)
    await companion.refresh('retail')
    state.bridge.snapshot.seq++
    state.bridge.snapshot.dead = true
    state.bridge.eventCursor = 1
    state.bridge.events = [{
      id: 1,
      type: 'death',
      timestamp: new Date().toISOString(),
      title: '角色阵亡',
      detail: '角色已死亡',
      snapshot: { ...state.bridge.snapshot },
      demo: false,
    }]
    mockStates(state)
    await companion.refresh('retail')
    await expect.poll(() => dispatch.mock.calls.length).toBe(1)
    const request = dispatch.mock.calls[0]![0]
    expect(request.payload).toMatchObject({ eventType: 'death', snapshot: { faction: 'Horde', race: '血精灵' } })
    const instructions = request.messageOverride?.appendSystemInstructions?.join(' ')
    expect(instructions).toContain('active character persona')
    expect(instructions).toContain('Horde')
    expect(instructions).toContain('血精灵')
    expect(instructions).toContain('部落都是废物')
    expect(instructions).toContain('not a fixed reply')
    expect(instructions).toContain('Address the user by this exact character name: "深烘拿铁".')
    expect(instructions).not.toContain('warm sentence')
    expect(instructions).not.toContain('gentle support')
  })
})

describe('woW companion current player address', () => {
  beforeEach(() => vi.resetAllMocks())

  it('replaces the address after a character switch and a same-sequence name update', async () => {
    const state = liveState()
    if (!state.bridge?.snapshot)
      throw new Error('Expected snapshot')
    state.bridge.snapshot.name = 'Previous character'
    const { companion, pinia } = await renderPage(state)
    companion.start(true)
    await companion.refresh('retail')
    const contexts = useChatContextStore(pinia)
    const address = () => contexts.getContextsSnapshot()['wow-companion-player-address']
    await expect.poll(() => JSON.stringify(address())).toContain('Previous character')

    state.bridge.snapshot.guid = 'Player-2'
    state.bridge.snapshot.session = 'session-2'
    state.bridge.snapshot.name = '新旅人'
    mockStates(state)
    await companion.refresh('retail')
    await expect.poll(() => JSON.stringify(address())).toContain('新旅人')
    expect(JSON.stringify(address())).not.toContain('Previous character')
    expect(address()).toHaveLength(1)
    expect(address()?.[0]).toMatchObject({ contextId: 'wow-current-player-address', lane: 'wow:player-address' })

    state.bridge.snapshot.name = '暮色行者'
    mockStates(state)
    await companion.refresh('retail')
    await expect.poll(() => JSON.stringify(address())).toContain('暮色行者')
    expect(JSON.stringify(address())).not.toContain('新旅人')
    expect(JSON.stringify(address())).toContain('precedence over older names')
    companion.stop()
    expect(contexts.getContextsSnapshot()).toEqual({})
  })

  it('uses the newest connected character across games without changing on older heartbeats', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    if (!retail.bridge?.snapshot || !forever.bridge?.snapshot)
      throw new Error('Expected snapshots')
    retail.bridge.snapshot.name = 'Retail veteran'
    forever.bridge.snapshot.name = 'Forever newcomer'
    forever.bridge.snapshot.guid = 'Player-forever'
    forever.bridge.snapshot.session = 'forever-session'
    retail.bridge.events = [{ id: 1, type: 'connected', timestamp: new Date(Date.now() - 20_000).toISOString(), title: 'Connected', detail: '', snapshot: { ...retail.bridge.snapshot }, demo: false }]
    forever.bridge.events = [{ id: 1, type: 'connected', timestamp: new Date(Date.now() - 10_000).toISOString(), title: 'Connected', detail: '', snapshot: { ...forever.bridge.snapshot }, demo: false }]
    const { companion, pinia } = await renderPage(retail, 'en', forever)
    companion.start(true)
    await companion.refresh('retail')
    await companion.refresh('forever')
    const contexts = useChatContextStore(pinia)
    const address = () => JSON.stringify(contexts.getContextsSnapshot()['wow-companion-player-address'])
    await expect.poll(address).toContain('Forever newcomer')
    expect(address()).not.toContain('Retail veteran')

    retail.bridge.snapshot.seq++
    retail.bridge.snapshot.tick++
    mockStates(retail, forever)
    await companion.refresh('retail')
    expect(address()).toContain('Forever newcomer')

    retail.bridge.snapshot.guid = 'Player-new-retail'
    retail.bridge.snapshot.session = 'new-retail-session'
    retail.bridge.snapshot.name = 'Newest retail character'
    retail.bridge.events = [{ id: 2, type: 'connected', timestamp: new Date().toISOString(), title: 'Connected', detail: '', snapshot: { ...retail.bridge.snapshot }, demo: false }]
    mockStates(retail, forever)
    await companion.refresh('retail')
    await expect.poll(address).toContain('Newest retail character')
    expect(address()).not.toContain('Forever newcomer')

    retail.bridge.status = 'stale'
    mockStates(retail, forever)
    await companion.refresh('retail')
    await companion.refresh('forever')
    await expect.poll(address).toContain('neutral second-person wording')
    expect(address()).not.toContain('Newest retail character')
    expect(address()).not.toContain('Forever newcomer')
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('wow:forever:player')
  })

  it.each(['offline', 'disabled', 'demo', 'blank', 'unavailable'] as const)('removes the name for an %s observation', async (condition) => {
    const state = liveState()
    if (!state.bridge?.snapshot)
      throw new Error('Expected snapshot')
    state.bridge.snapshot.name = 'Only current name'
    const { companion, pinia } = await renderPage(state)
    companion.start(true)
    await companion.refresh('retail')
    const contexts = useChatContextStore(pinia)
    const address = () => JSON.stringify(contexts.getContextsSnapshot()['wow-companion-player-address'])
    await expect.poll(address).toContain('Only current name')

    if (condition === 'offline')
      state.bridge.snapshot.online = false
    if (condition === 'disabled')
      state.settings.enabled = false
    if (condition === 'demo') {
      state.bridge.status = 'demo'
      state.bridge.source = 'demo'
      state.settings.allowDemo = true
    }
    if (condition === 'blank')
      state.bridge.snapshot.name = ''
    mockStates(state)
    if (condition === 'unavailable')
      invokeMocks.getState.mockRejectedValue(new Error('Bridge unavailable'))
    await companion.refresh('retail')
    await expect.poll(address).toContain('No current online Warcraft character name is available.')
    expect(address()).not.toContain('Only current name')
  })

  it.each((['en', 'zh-Hans'] as const).flatMap(locale => [{ locale, tradeoff: false }, { locale, tradeoff: true }]))('uses the current name and translated equipment choices in $locale with tradeoff=$tradeoff without a voice session', async ({ locale, tradeoff }) => {
    const previousLocale = i18n.global.locale.value
    i18n.global.locale.value = locale
    onTestFinished(() => {
      i18n.global.locale.value = previousLocale
    })
    const state = liveState()
    if (!state.bridge?.snapshot)
      throw new Error('Expected snapshot')
    state.bridge.snapshot.name = '深烘拿铁'
    const comparison = comparisonFixture({ session: state.bridge.snapshot.session, guid: state.bridge.snapshot.guid })
    if (tradeoff) {
      comparison.current!.stats.push({ key: 'ITEM_MOD_MASTERY_RATING_SHORT', value: 37 }, { key: 'ITEM_MOD_STRENGTH_SHORT', value: 100 })
      comparison.candidate.stats.push({ key: 'ITEM_MOD_MASTERY_RATING_SHORT', value: 30 }, { key: 'ITEM_MOD_STRENGTH_SHORT', value: 1 })
    }
    state.bridge.equipmentComparisons = [comparison]
    state.bridge.equipmentOffer = {
      v: 1,
      kind: 'offer',
      s: comparison.session,
      g: comparison.guid,
      id: comparison.id,
      q: 1,
      st: 'ready',
      slot: comparison.slot,
      item: comparison.candidate.itemID,
      n: comparison.candidate.name,
      il: comparison.candidate.itemLevel,
      old: comparison.current!.itemID,
      ol: comparison.current!.itemLevel,
      until: Math.floor(Date.now() / 1000) + 120,
    }
    const { companion } = await renderPage(state, locale, disabledForever())
    companion.start(true)
    await companion.refresh('retail')
    expect(companion.profiles.retail.error).toBe('')
    await expect.poll(() => companion.equipmentPrompt?.text).toContain('深烘拿铁')
    expect(companion.equipmentPrompt?.text).toContain('New robe')
    if (tradeoff) {
      expect(companion.equipmentPrompt?.text).toContain(locale === 'en' ? 'Mastery 37 → 30' : '精通 37 → 30')
      expect(companion.equipmentPrompt?.text).toContain(locale === 'en' ? 'Intellect 10 → 12' : '智力 10 → 12')
      expect(companion.equipmentPrompt?.text).toContain(locale === 'en' ? 'Overall benefit is not guaranteed' : '不保证综合收益更高')
      expect(companion.equipmentPrompt?.text).not.toContain(locale === 'en' ? 'Strength 100' : '力量 100')
      expect(companion.equipmentPrompt?.text).not.toContain(locale === 'en' ? 'clearly improve' : '明确提升')
    }
    else {
      expect(companion.equipmentPrompt?.text).toContain(locale === 'en' ? 'congratulations on' : '恭喜获得')
      expect(companion.equipmentPrompt?.text).toContain(locale === 'en' ? 'stronger' : '又能变强了')
    }
    expect(companion.equipmentPrompt?.text).toContain('100 → 120')
    expect(companion.equipmentPrompt?.text).not.toContain('equipment-prompt')
    expect(companion.equipmentPrompt?.text).not.toContain('ITEM_MOD_')
    expect(companion.equipmentPrompt?.phase).toBe('choosing')
    const prompt = companion.equipmentPrompt
    if (!prompt)
      throw new Error('Expected an equipment reminder')
    companion.chooseEquipmentPrompt(prompt.id, 'accept')
    expect(companion.equipmentPrompt?.phase).toBe('accepted')
    expect(companion.equipmentPrompt?.text).toContain(locale === 'en' ? 'Please click “Confirm change” in the game.' : '请在游戏内点击“确认换装”')
    expect(companion.equipmentPrompt?.text).not.toContain('equipment-prompt')

    state.bridge.snapshot.guid = 'Player-next'
    state.bridge.snapshot.session = 'next-login'
    state.bridge.snapshot.name = 'Next character'
    mockStates(state)
    await companion.refresh('retail')
    await expect.poll(() => companion.equipmentPrompt).toBeNull()
  })
})

describe('woW companion character level history', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows real dates and multi-day intervals, and averages only complete single levels', async () => {
    const state = liveState()
    state.levelHistory.characters = [levelCharacter()]
    if (state.bridge?.snapshot)
      state.bridge.snapshot.level = 31
    await renderPage(state, 'zh-Hans')
    const character = page.getByRole('article', { name: 'Mage · Azeroth · account-1', exact: true })
    await expect.element(character.getByText('3天 0小时 0分 0秒', { exact: true })).toBeInTheDocument()
    await expect.element(character.getByText('2', { exact: true })).toBeInTheDocument()
    await character.getByRole('button', { name: '查看等级历史', exact: true }).click()
    await expect.element(character.getByRole('row', { name: /29 → 30/ })).toHaveTextContent('2天 0小时 0分 0秒')
    await expect.element(character.getByRole('row', { name: /30 → 31/ })).toHaveTextContent('4天 0小时 0分 0秒')
    await expect.element(character.getByRole('row', { name: /28 → 29/ })).toHaveTextContent('并非该等级的完整用时')
    await expect.element(character.getByRole('row', { name: /首次发现该等级/ })).toHaveTextContent('未知')
    const date = character.element().querySelector(`time[datetime="${new Date(now).toISOString()}"]`)
    expect(date?.textContent).toContain('2026')
    await expect.element(page.getByText('两次升级之间的离线、游玩其他角色及关闭魔兽陪伴精灵的时间均计入。重启后保留记录。', { exact: true })).toBeInTheDocument()
  })

  it('keeps same-name characters separate and puts the current character first', async () => {
    const state = liveState()
    state.levelHistory.characters = [
      levelCharacter({ account: 'account-2', realm: 'Lordaeron', guid: 'Player-2', lastSeen: now + 5000 }),
      levelCharacter(),
    ]
    await renderPage(state)
    const main = page.getByRole('article', { name: 'Mage · Azeroth · account-1', exact: true })
    const alt = page.getByRole('article', { name: 'Mage · Lordaeron · account-2', exact: true })
    await expect.element(main.getByText('Current character', { exact: true })).toBeInTheDocument()
    await expect.element(alt.getByText('Current character', { exact: true })).not.toBeInTheDocument()
    const cards = page.getByRole('article').elements()
    expect(cards.indexOf(main.element())).toBeLessThan(cards.indexOf(alt.element()))
    await alt.getByRole('button', { name: 'Show level history', exact: true }).click()
    await expect.element(alt.getByRole('rowheader', { name: '30 → 31', exact: true })).toBeInTheDocument()
    await expect.element(main.getByRole('button', { name: 'Show level history', exact: true })).toHaveAttribute('aria-expanded', 'false')
  })

  it('marks missed changes and clock changes without inventing per-level durations', async () => {
    const state = liveState()
    const character = levelCharacter()
    character.records.push(
      { id: 5, fromLevel: 31, level: 34, recordedAt: now + 60_000, source: 'gap', durationMs: null, durationBasis: 'unknown' },
      { id: 6, fromLevel: 34, level: 35, recordedAt: now + 30_000, source: 'clock-change', durationMs: null, durationBasis: 'unknown' },
      { id: 7, fromLevel: 35, level: 20, recordedAt: now + 40_000, source: 'decrease', durationMs: null, durationBasis: 'unknown' },
    )
    character.currentLevel = 20
    character.lastSeen = now + 40_000
    state.levelHistory.characters = [character]
    if (state.bridge?.snapshot)
      state.bridge.snapshot.level = 20
    await renderPage(state)
    const card = page.getByRole('article', { name: 'Mage · Azeroth · account-1', exact: true })
    await expect.element(card.getByText('3d 0h 0m 0s', { exact: true })).toBeInTheDocument()
    await card.getByRole('button', { name: 'Show level history', exact: true }).click()
    const missed = card.getByRole('row', { name: /31 → 34/ })
    await expect.element(missed).toHaveTextContent('Unknown')
    await expect.element(missed).toHaveTextContent('Upgrade times are unknown.')
    await expect.element(card.getByRole('rowheader', { name: '31 → 32', exact: true })).not.toBeInTheDocument()
    await expect.element(card.getByRole('row', { name: /34 → 35/ })).toHaveTextContent('Computer clock changed.')
    await expect.element(card.getByRole('row', { name: /35 → 20/ })).toHaveTextContent('No upgrade interval applies.')
  })

  it('isolates saved level histories between the Retail and Forever pages', async () => {
    const retail = liveState()
    const forever = disabledForever()
    retail.levelHistory.characters = [levelCharacter({ name: 'Retail mage' })]
    forever.levelHistory.characters = [levelCharacter({ name: 'Forever warrior' })]
    await renderPage(retail, 'en', forever)
    await expect.element(page.getByRole('article', { name: 'Retail mage · Azeroth · account-1', exact: true })).toBeInTheDocument()
    await expect.element(page.getByRole('article', { name: 'Forever warrior · Azeroth · account-1', exact: true })).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(page.getByRole('article', { name: 'Forever warrior · Azeroth · account-1', exact: true })).toBeInTheDocument()
    await expect.element(page.getByRole('article', { name: 'Retail mage · Azeroth · account-1', exact: true })).not.toBeInTheDocument()
  })

  it('shows the empty state and storage errors without presenting an unknown average as zero', async () => {
    const state = liveState()
    state.levelHistory.storageError = 'Level history disk unavailable'
    const { companion } = await renderPage(state)
    await expect.element(page.getByText('No level history yet.', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Level history disk unavailable')
    const baseline = levelCharacter()
    baseline.records = baseline.records.slice(0, 1)
    baseline.currentLevel = 28
    state.levelHistory.characters = [baseline]
    state.bridge = null
    mockStates(state)
    await companion.refresh('retail')
    const card = page.getByRole('article', { name: 'Mage · Azeroth · account-1', exact: true })
    await expect.element(card.getByText('Unknown', { exact: true })).toBeInTheDocument()
    await expect.element(card.getByText('0s', { exact: true })).not.toBeInTheDocument()
    await expect.element(card.getByText('Current character', { exact: true })).not.toBeInTheDocument()
    await expect.element(page.getByText('No level history yet.', { exact: false })).not.toBeInTheDocument()
  })

  it.each([375, 1024])('keeps every level record in a scrollable table at %i pixels', async (width) => {
    await page.viewport(width, 900)
    const state = liveState()
    const character = levelCharacter()
    for (let id = 5; id <= 14; id++) {
      character.records.push({ id, fromLevel: id + 26, level: id + 27, recordedAt: now + (id - 4) * 1000, source: 'live', durationMs: 1000, durationBasis: 'complete' })
    }
    character.currentLevel = 41
    character.lastSeen = now + 10_000
    state.levelHistory.characters = [character]
    if (state.bridge?.snapshot)
      state.bridge.snapshot.level = 41
    await renderPage(state, 'zh-Hans')
    const card = page.getByRole('article', { name: 'Mage · Azeroth · account-1', exact: true })
    await card.getByRole('button', { name: '查看等级历史', exact: true }).click()
    await expect.poll(() => card.getByRole('row').elements().length).toBe(15)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    expect(card.element().getBoundingClientRect().right).toBeLessThanOrEqual(width)
    const scroller = card.element().querySelector('table')?.parentElement
    if (!scroller)
      throw new Error('Expected a level history table scroll area')
    expect(getComputedStyle(scroller).overflowX).toBe('auto')
    if (width === 375)
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth)
    await card.screenshot({ path: `__screenshots__/wow-companion-level-history-${width}.png` })
  })
})

describe('woW companion gold ledger', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows exact large totals, signed net changes, and each account separately', async () => {
    await page.viewport(1024, 900)
    const state = liveState()
    state.gold.accounts.push({
      account: 'account-2',
      name: 'Alt account',
      earned: '9007199254740994',
      spent: '9007199254753561',
      net: '-12567',
      balance: '20000',
      characterCount: 1,
      firstSeen: now,
      lastSeen: now,
      characters: [{ guid: 'Player-2', name: 'Warrior', realm: 'Lordaeron', copper: 20000, earned: '9007199254740994', spent: '9007199254753561', net: '-12567', firstSeen: now, lastSeen: now }],
    })
    await renderPage(state)

    await expect.element(page.getByRole('heading', { name: 'Gold ledger', exact: true })).toBeInTheDocument()
    const main = page.getByRole('article', { name: 'Main account' })
    const alt = page.getByRole('article', { name: 'Alt account' })
    await expect.element(main.getByRole('rowheader', { name: 'Mage' })).toBeInTheDocument()
    await expect.element(main.getByRole('cell', { name: '1,234g 56s 78c', exact: true })).toBeInTheDocument()
    await expect.element(alt.getByRole('rowheader', { name: 'Warrior' })).toBeInTheDocument()
    await expect.element(alt.getByRole('cell', { name: '900,719,925,474g 9s 94c', exact: true })).toBeInTheDocument()
    await expect.element(alt.getByText('−1g 25s 67c', { exact: true })).toBeInTheDocument()
  })

  it('keeps a draft label across polling and saves it through main', async () => {
    const { companion } = await renderPage()
    const label = page.getByRole('textbox', { name: 'Account label', exact: true })
    await label.fill('Raiding account')
    const refreshed = liveState()
    refreshed.gold.accounts[0]!.balance = '12345679'
    mockStates(refreshed)
    await companion.refresh('retail')
    await expect.element(label).toHaveValue('Raiding account')

    const saved = liveState()
    saved.gold.accounts[0]!.name = 'Raiding account'
    invokeMocks.setAccountName.mockResolvedValue(saved)
    mockStates(saved)
    await page.getByRole('button', { name: 'Save label', exact: true }).click()

    expect(invokeMocks.setAccountName).toHaveBeenCalledWith({ game: 'retail', request: { account: 'account-1', name: 'Raiding account' } })
    await expect.element(page.getByRole('article', { name: 'Raiding account' })).toBeInTheDocument()
    await expect.element(page.getByText('Saved.', { exact: true })).toHaveAttribute('role', 'status')
  })

  it('shows an empty ledger and no current balance for demo capture', async () => {
    const state = liveState()
    state.gold.accounts = []
    if (state.bridge) {
      state.bridge.status = 'demo'
      state.bridge.source = 'demo'
    }
    await renderPage(state)

    await expect.element(page.getByText('No real money observations yet.', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByText('Current money is unavailable.', { exact: false })).toBeInTheDocument()
    expect(page.getByRole('article').elements()).toHaveLength(0)
    await expect.element(page.getByText('1,234g 56s 78c', { exact: true })).not.toBeInTheDocument()
  })

  it('reports storage failures without confirming the label was saved', async () => {
    await renderPage()
    const failed = liveState()
    failed.gold.storageError = 'Disk full'
    invokeMocks.setAccountName.mockResolvedValue(failed)
    mockStates(failed)
    await page.getByRole('textbox', { name: 'Account label', exact: true }).fill('Main')
    await page.getByRole('button', { name: 'Save label', exact: true }).click()

    await expect.element(page.getByRole('alert')).toHaveTextContent('Disk full')
    expect(page.getByText('Saved.', { exact: true }).elements()).toHaveLength(0)
  })

  it('keeps recorded balances but hides current money after a capture error', async () => {
    const state = liveState()
    if (state.bridge)
      state.bridge.error = 'Checksum mismatch'
    await renderPage(state)

    await expect.element(page.getByText('Current money is unavailable.', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByRole('article', { name: 'Main account' }).getByRole('cell', { name: '1,234g 56s 78c', exact: true })).toBeInTheDocument()
  })

  it.each([375, 1024])('keeps the character table inside a %i pixel viewport', async (width) => {
    await page.viewport(width, 900)
    const state = liveState()
    state.gold.accounts[0]!.name = '主账号'
    state.gold.accounts[0]!.characters[0]!.name = '法师'
    state.gold.accounts[0]!.characters[0]!.realm = '艾泽拉斯'
    await renderPage(state, 'zh-Hans')
    const account = page.getByRole('article', { name: '主账号' })
    await expect.element(page.getByRole('heading', { name: '金币账本', exact: true })).toBeInTheDocument()
    const article = account.element()
    const table = article.querySelector('table')
    const scroller = table?.parentElement
    if (!scroller)
      throw new Error('Expected a character table scroll area')
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    expect(article.getBoundingClientRect().right).toBeLessThanOrEqual(width)
    expect(getComputedStyle(scroller).overflowX).toBe('auto')
    if (width === 375)
      expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth)
    await account.screenshot({ path: `__screenshots__/wow-companion-gold-${width}.png` })
  })

  it('updates chat money context silently and removes stale observations', async () => {
    const { companion, pinia } = await renderPage()
    companion.start(true)
    await companion.refresh('retail')
    const contexts = useChatContextStore(pinia)
    await expect.poll(() => JSON.stringify(contexts.getContextsSnapshot())).toContain('12345678')
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('100 copper = 1 silver')

    const changed = liveState()
    if (changed.bridge?.snapshot) {
      changed.bridge.snapshot.seq = 2
      changed.bridge.snapshot.copper = 12345679
      changed.bridge.snapshot.earned = 50001
    }
    mockStates(changed)
    await companion.refresh('retail')
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('12345679')
    expect(companion.profiles.retail.responseState).toBe('idle')

    if (changed.bridge)
      changed.bridge.error = 'Checksum mismatch'
    mockStates(changed)
    await companion.refresh('retail')
    expect(Object.keys(contexts.getContextsSnapshot())).toEqual(['wow-companion-player-address'])
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('neutral second-person wording')
    expect(JSON.stringify(contexts.getContextsSnapshot())).not.toContain('12345679')
    expect(JSON.stringify(contexts.getContextsSnapshot())).not.toContain('wow:retail:player')

    if (changed.bridge)
      changed.bridge.error = null
    await companion.refresh('retail')
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('12345679')

    if (changed.bridge)
      changed.bridge.status = 'stale'
    mockStates(changed)
    await companion.refresh('retail')
    expect(Object.keys(contexts.getContextsSnapshot())).toEqual(['wow-companion-player-address'])
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('neutral second-person wording')
    expect(JSON.stringify(contexts.getContextsSnapshot())).not.toContain('12345679')
    expect(JSON.stringify(contexts.getContextsSnapshot())).not.toContain('wow:retail:player')
  })
})

describe('woW version profiles', () => {
  beforeEach(() => vi.resetAllMocks())

  it('opens both version pages and discards unsaved settings when switching', async () => {
    const retail = liveState()
    const forever = disabledForever()
    forever.settings.cooldownSeconds = 7
    await renderPage(retail, 'en', forever)
    await page.getByRole('spinbutton', { name: 'Minimum seconds between reactions' }).fill('99')
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()

    await expect.element(page.getByRole('heading', { name: 'World of Warcraft: Forever', exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Companion disabled', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('This version is prepared before the client release.', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByRole('spinbutton', { name: 'Minimum seconds between reactions' })).toHaveValue(7)
    await expect.element(page.getByRole('button', { name: 'Start demo', exact: true })).toBeDisabled()
    await page.screenshot({ path: '__screenshots__/wow-companion-forever-page.png' })
    expect(page.getByRole('article').elements()).toHaveLength(0)

    await page.getByRole('button', { name: 'World of Warcraft Retail', exact: true }).click()
    await expect.element(page.getByRole('heading', { name: 'World of Warcraft Retail', exact: true })).toBeInTheDocument()
    await expect.element(page.getByRole('spinbutton', { name: 'Minimum seconds between reactions' })).toHaveValue(20)
    expect(invokeMocks.setSettings).not.toHaveBeenCalled()
    await page.screenshot({ path: '__screenshots__/wow-companion-retail-page.png' })
  })

  it('enables a profile whose bridge has never connected', async () => {
    const forever = disabledForever()
    const { companion } = await renderPage(liveState(), 'en', forever)
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    expect(companion.profiles.forever.state.updatedAt).toBe(0)
    await expect.element(page.getByRole('switch', { name: 'Enable companion', exact: false })).toBeEnabled()
    await page.getByRole('switch', { name: 'Enable companion', exact: false }).click()
    const enabled = structuredClone(forever)
    enabled.settings.enabled = true
    invokeMocks.setSettings.mockResolvedValue(enabled)
    mockStates(liveState(), enabled)
    await page.getByRole('button', { name: 'Save preferences' }).click()
    expect(invokeMocks.setSettings).toHaveBeenCalledWith({ game: 'forever', settings: enabled.settings })
    expect(companion.profiles.forever.state.settings.enabled).toBe(true)
  })

  it('saves calibration and demo commands only to the visible version', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    if (forever.bridge)
      forever.bridge.config.x = 128
    const { companion } = await renderPage(retail, 'en', forever)
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(page.getByRole('spinbutton', { name: 'Grid left (X)' })).toHaveValue(128)
    const saved = structuredClone(forever)
    if (!saved.bridge)
      throw new Error('Expected bridge')
    saved.bridge.config.x = 144
    invokeMocks.setCapture.mockResolvedValue(saved)
    await page.getByRole('spinbutton', { name: 'Grid left (X)' }).fill('144')
    await page.getByRole('button', { name: 'Apply calibration' }).click()
    expect(invokeMocks.setCapture).toHaveBeenCalledWith({ game: 'forever', capture: saved.bridge.config })
    expect(companion.profiles.retail.state.bridge?.config.x).toBe(8)
    const demo = structuredClone(saved)
    if (!demo.bridge)
      throw new Error('Expected bridge')
    demo.bridge.status = 'demo'
    demo.bridge.source = 'demo'
    invokeMocks.demo.mockResolvedValue(demo)
    await page.getByRole('button', { name: 'Start demo', exact: true }).click()
    expect(invokeMocks.demo).toHaveBeenCalledWith({ game: 'forever', request: { enabled: true, action: 'none' } })
    expect(companion.profiles.retail.state.bridge?.source).toBe('screen')
    await expect.element(page.getByText('Current money is unavailable.', { exact: false })).toBeInTheDocument()
  })

  it('keeps pending account saves and settings feedback on their original page', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    forever.gold.accounts[0]!.name = 'Forever account'
    forever.gold.accounts[0]!.balance = '500'
    forever.settings.cooldownSeconds = 7
    const { companion } = await renderPage(retail, 'en', forever)
    const labelSave = Promise.withResolvers<CompanionState>()
    const settingsSave = Promise.withResolvers<CompanionState>()
    invokeMocks.setAccountName.mockReturnValue(labelSave.promise)
    invokeMocks.setSettings.mockReturnValue(settingsSave.promise)
    await page.getByRole('textbox', { name: 'Account label', exact: true }).fill('Retail saved label')
    await page.getByRole('button', { name: 'Save label', exact: true }).click()
    await page.getByRole('spinbutton', { name: 'Minimum seconds between reactions' }).fill('55')
    await page.getByRole('button', { name: 'Save preferences' }).click()
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(page.getByRole('textbox', { name: 'Account label', exact: true })).toHaveValue('Forever account')
    await expect.element(page.getByRole('spinbutton', { name: 'Minimum seconds between reactions' })).toHaveValue(7)
    const saved = structuredClone(retail)
    saved.gold.accounts[0]!.name = 'Retail saved label'
    saved.settings.cooldownSeconds = 55
    mockStates(saved, forever)
    labelSave.resolve(saved)
    settingsSave.resolve(saved)
    await expect.poll(() => companion.profiles.retail.state.settings.cooldownSeconds).toBe(55)
    await expect.element(page.getByRole('textbox', { name: 'Account label', exact: true })).toHaveValue('Forever account')
    expect(page.getByText('Saved.', { exact: true }).elements()).toHaveLength(0)
    expect(companion.profiles.forever.state.gold.accounts[0]!.balance).toBe('500')
    expect(invokeMocks.setSettings).toHaveBeenCalledWith({ game: 'retail', settings: { ...retail.settings, cooldownSeconds: 55 } })
  })

  it('keeps equal character and account identifiers in separate model contexts', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    if (!forever.bridge?.snapshot)
      throw new Error('Expected snapshot')
    forever.bridge.snapshot.copper = 990011
    const { companion, pinia } = await renderPage(retail, 'en', forever)
    companion.start(true)
    await companion.refresh('retail')
    await companion.refresh('forever')
    const contexts = useChatContextStore(pinia)
    let text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).toContain('wow:retail:player')
    expect(text).toContain('wow:forever:player')
    expect(text).toContain('12345678')
    expect(text).toContain('990011')
    expect(text).toContain('Game version: forever')
    expect(companion.profiles.retail.responseState).toBe('idle')
    expect(companion.profiles.forever.responseState).toBe('idle')

    forever.bridge.source = 'demo'
    forever.bridge.status = 'demo'
    mockStates(retail, forever)
    await companion.refresh('forever')
    text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).toContain('wow:retail:player')
    expect(text).not.toContain('wow:forever:player')
    forever.settings.allowDemo = true
    await companion.refresh('forever')
    text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).toContain('wow:forever:player')
    expect(text).toContain('SIMULATION')
    forever.error = 'Forever bridge unavailable'
    await companion.refresh('forever')
    text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).not.toContain('wow:forever:player')
    expect(text).toContain('wow:retail:player')
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Forever bridge unavailable')
    await page.getByRole('button', { name: 'World of Warcraft Retail', exact: true }).click()
    expect(page.getByRole('alert').elements()).toHaveLength(0)
  })

  it('keeps event cursors separate and reacts only for the latest character session', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    const { companion } = await renderPage(retail, 'en', forever)
    companion.start(true)
    await companion.refresh('retail')
    await companion.refresh('forever')
    const changedForever = structuredClone(forever)
    const changedRetail = structuredClone(retail)
    for (const state of [changedForever, changedRetail]) {
      if (!state.bridge)
        throw new Error('Expected bridge')
      state.bridge.eventCursor = 1
      state.bridge.events = [{
        id: 1,
        type: 'level_up',
        timestamp: new Date().toISOString(),
        title: `${state.game} level up`,
        detail: `${state.game} event`,
        snapshot: { ...snapshot, level: 31, seq: 2 },
        demo: false,
      }]
    }
    mockStates(retail, changedForever)
    await companion.refresh('forever')
    expect(companion.profiles.forever.responseState).toBe('model-required')
    expect(companion.profiles.retail.responseState).toBe('idle')
    mockStates(changedRetail, changedForever)
    await companion.refresh('retail')
    expect(companion.profiles.retail.responseState).toBe('idle')
    await expect.element(page.getByText('retail level up', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('forever level up', { exact: true })).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(page.getByText('forever level up', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('retail level up', { exact: true })).not.toBeInTheDocument()
  })

  it('rejects cross-version responses and ignores a read that predates a save', async () => {
    const { companion } = await renderPage()
    companion.stop()
    const oldRead = Promise.withResolvers<CompanionState>()
    invokeMocks.getState.mockReturnValueOnce(oldRead.promise)
    const reading = companion.refresh('retail')
    const saved = liveState()
    saved.settings.muted = true
    invokeMocks.setSettings.mockResolvedValue(saved)
    await companion.setSettings('retail', saved.settings)
    oldRead.resolve(liveState())
    await reading
    expect(companion.profiles.retail.state.settings.muted).toBe(true)
    invokeMocks.getState.mockResolvedValue(liveState('forever'))
    await companion.refresh('retail')
    expect(companion.profiles.retail.state.game).toBe('retail')
    expect(companion.profiles.retail.error).toContain('another game profile')
    invokeMocks.demo.mockResolvedValue(liveState('forever'))
    await expect(companion.demo('retail', { enabled: true, action: 'none' })).rejects.toThrow('another game profile')
  })
})

describe('woW equipment view and chat context', () => {
  beforeEach(() => vi.resetAllMocks())

  it('explains how to update a supported bridge that only supplies character data', async () => {
    const { companion, pinia } = await renderPage()
    await expect.element(page.getByText('This bridge only provides character data.', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByText('Use a 100 ms capture interval for quick equipment questions.', { exact: false })).toBeInTheDocument()
    companion.start(true)
    await companion.refresh('retail')
    expect(JSON.stringify(useChatContextStore(pinia).getContextsSnapshot())).toContain('Stormwind')
  })

  it('shows isolated equipment details and preserves missing values and literal tooltip text', async () => {
    await page.viewport(1024, 900)
    const retail = liveState()
    const forever = liveState('forever')
    if (!retail.bridge || !forever.bridge)
      throw new Error('Expected bridges')
    const item = newEquipment('Retail sword')
    item.itemLevel = null
    item.quality = 0
    item.requiredLevel = 0
    item.infoComplete = false
    item.truncated = true
    item.tooltip.push('<script>window.invalidEquipment = true</script>')
    retail.bridge.equipment = [item]
    forever.bridge.equipment = [newEquipment('Forever sword')]
    retail.equipmentHistory.entries = [savedEquipment(item)]
    forever.equipmentHistory.entries = [savedEquipment(forever.bridge.equipment[0]!)]
    await renderPage(retail, 'en', forever)
    const article = page.getByRole('article', { name: 'Retail sword', exact: true })
    await expect.element(article).toBeInTheDocument()
    await expect.element(article.getByText('Item level Unavailable', { exact: false })).toBeInTheDocument()
    await expect.element(article.getByText('Item details: Incomplete', { exact: true })).toBeInTheDocument()
    await expect.element(article.getByText('Some text was shortened', { exact: true })).toBeInTheDocument()
    const toggle = article.getByRole('button', { name: 'Show equipment details' })
    await toggle.click()
    await expect.element(article.getByRole('button', { name: 'Hide equipment details' })).toHaveAttribute('aria-expanded', 'true')
    await expect.element(article.getByText('Strength', { exact: true })).toBeInTheDocument()
    await expect.element(article.getByText('UNKNOWN_STAT', { exact: true })).toBeInTheDocument()
    await expect.element(article.getByText('Poor', { exact: true })).toBeInTheDocument()
    await expect.element(article.getByText('0', { exact: true })).toBeInTheDocument()
    await expect.element(article.getByText('<script>window.invalidEquipment = true</script>', { exact: true })).toBeInTheDocument()
    expect(article.element().querySelector('script')).toBeNull()
    await expect.element(article.getByText('It does not prove that a set bonus or effect is currently active.', { exact: false })).toBeInTheDocument()
    await expect.element(page.getByRole('article', { name: 'Forever sword', exact: true })).not.toBeInTheDocument()
    await article.screenshot({ path: '__screenshots__/wow-companion-equipment-retail.png' })
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(page.getByRole('article', { name: 'Forever sword', exact: true })).toBeInTheDocument()
    await expect.element(page.getByRole('article', { name: 'Retail sword', exact: true })).not.toBeInTheDocument()
    const foreverArticle = page.getByRole('article', { name: 'Forever sword', exact: true })
    await foreverArticle.getByRole('button', { name: 'Show equipment details' }).click()
    await foreverArticle.screenshot({ path: '__screenshots__/wow-companion-equipment-forever.png' })
  })

  it('updates equipment context without a new snapshot sequence and keeps profiles separate', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    if (!retail.bridge || !forever.bridge)
      throw new Error('Expected bridges')
    forever.bridge.equipment = [newEquipment('Forever blade')]
    const { companion, pinia } = await renderPage(retail, 'en', forever)
    companion.start(true)
    await companion.refresh('retail')
    await companion.refresh('forever')
    const contexts = useChatContextStore(pinia)
    expect(JSON.stringify(contexts.getContextsSnapshot())).not.toContain('Retail blade')
    const retailBlade = newEquipment('Retail blade')
    retailBlade.tooltip = Array.from({ length: 40 }, (_, i) => `Tooltip line ${i + 1}`)
    retailBlade.tooltip[39] = 'Set (4): A bonus at the end of the tooltip.'
    retailBlade.stats = Array.from({ length: 32 }, (_, i) => ({ key: `ATTRIBUTE_${i + 1}`, value: i + 1 }))
    retail.bridge.equipment = [retailBlade]
    retail.equipmentHistory.entries = [savedEquipment(retailBlade)]
    mockStates(retail, forever)
    await companion.refresh('retail')
    let text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).toContain('Retail blade')
    expect(text).toContain('Forever blade')
    expect(text).toContain('untrusted_equipment_data')
    expect(text).toContain('Set (4): A bonus at the end of the tooltip.')
    expect(text).toContain('ATTRIBUTE_32')
    expect(text).toContain('does not prove its bonus is active')
    expect(companion.profiles.retail.responseState).toBe('idle')
    expect(companion.profiles.forever.responseState).toBe('idle')
    retail.bridge.status = 'stale'
    mockStates(retail, forever)
    await companion.refresh('retail')
    text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).not.toContain('Retail blade')
    expect(text).toContain('Forever blade')
    await expect.element(page.getByRole('article', { name: 'Retail blade', exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Historical record', { exact: true })).toBeInTheDocument()
  })

  it('keeps equipment history after a session change while removing the old live context', async () => {
    const state = liveState()
    if (!state.bridge)
      throw new Error('Expected bridge')
    state.bridge.equipment = [newEquipment('Observed sword')]
    state.equipmentHistory.entries = [savedEquipment(state.bridge.equipment[0]!)]
    state.bridge.equipmentError = 'Incomplete equipment frame'
    const { companion, pinia } = await renderPage(state)
    companion.start(true)
    await companion.refresh('retail')
    await expect.element(page.getByText('Incomplete equipment frame', { exact: false })).toBeInTheDocument()
    const contexts = useChatContextStore(pinia)
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('Observed sword')
    expect(JSON.stringify(contexts.getContextsSnapshot())).toContain('Stormwind')
    const changed = structuredClone(state)
    if (!changed.bridge?.snapshot)
      throw new Error('Expected snapshot')
    changed.bridge.snapshot.session = 'session-2'
    mockStates(changed)
    await companion.refresh('retail')
    expect(JSON.stringify(contexts.getContextsSnapshot())).not.toContain('Observed sword')
    await expect.element(page.getByRole('article', { name: 'Observed sword', exact: true })).toBeInTheDocument()
    await expect.element(page.getByText('Historical record', { exact: true })).toBeInTheDocument()
  })

  it('keeps Chinese equipment details inside a narrow viewport', async () => {
    await page.viewport(375, 900)
    const state = liveState()
    if (!state.bridge)
      throw new Error('Expected bridge')
    const item = newEquipment('测试长剑')
    item.tooltip = ['套装（2）：提高伤害。这只是提示说明，不表示当前激活。', '长文字'.repeat(25)]
    item.link = 'item:'.repeat(150)
    state.bridge.equipment = [item]
    state.equipmentHistory.entries = [savedEquipment(item, { name: '测试角色', realm: '银月服务器' })]
    await renderPage(state, 'zh-Hans')
    const article = page.getByRole('article', { name: '测试长剑', exact: true })
    await article.getByRole('button', { name: '查看装备详情' }).click()
    await expect.element(article.getByText('力量', { exact: true })).toBeInTheDocument()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375)
    expect(article.element().getBoundingClientRect().right).toBeLessThanOrEqual(375)
    await article.screenshot({ path: '__screenshots__/wow-companion-equipment-375.png' })
  })

  it.each(['disconnected', 'disabled', 'stale', 'paused', 'demo', 'offline'] as const)('keeps ten saved records visible when %s', async (status) => {
    const state = liveState()
    state.equipmentHistory.entries = Array.from({ length: 10 }, (_, index) => savedEquipment(newEquipment(`History item ${index + 1}`, index + 1), { receivedAt: now + index }))
    if (!state.bridge?.snapshot)
      throw new Error('Expected snapshot')
    if (status === 'disconnected') {
      state.bridge = null
    }
    else if (status === 'disabled') {
      state.settings.enabled = false
    }
    else if (status === 'offline') {
      state.bridge.snapshot.online = false
    }
    else {
      state.bridge.status = status
      if (status === 'demo')
        state.bridge.source = 'demo'
    }
    await renderPage(state)
    const history = page.getByRole('region', { name: 'Equipment acquisition history', exact: true })
    expect(history.getByRole('article').elements()).toHaveLength(10)
    expect(history.getByRole('heading', { level: 3 }).elements().map(element => element.textContent?.trim())).toEqual(Array.from({ length: 10 }, (_, index) => `History item ${10 - index}`))
    expect(history.getByText('Historical record', { exact: true }).elements()).toHaveLength(10)
  })

  it('replaces the oldest displayed record and retains complete details without adding history to chat', async () => {
    const state = liveState()
    state.equipmentHistory.entries = Array.from({ length: 10 }, (_, index) => savedEquipment(newEquipment(`Saved item ${index + 1}`, index + 1), { receivedAt: now + index }))
    const { companion, pinia } = await renderPage(state)
    companion.start(true)
    await companion.refresh('retail')
    const next = newEquipment('Newest saved item', 11)
    next.stats = Array.from({ length: 32 }, (_, index) => ({ key: `ATTRIBUTE_${index + 1}`, value: index + 1 }))
    next.tooltip = Array.from({ length: 40 }, (_, index) => `Tooltip line ${index + 1}`)
    next.tooltip[39] = 'Set (4): The final stored bonus.'
    next.observedAt = 0
    state.equipmentHistory.entries = [...state.equipmentHistory.entries.slice(1), savedEquipment(next, { receivedAt: now + 10 })]
    mockStates(state)
    await companion.refresh('retail')
    const history = page.getByRole('region', { name: 'Equipment acquisition history', exact: true })
    expect(history.getByRole('article').elements()).toHaveLength(10)
    await expect.element(history.getByRole('article', { name: 'Saved item 1', exact: true })).not.toBeInTheDocument()
    expect(history.getByRole('heading', { level: 3 }).elements()[0]?.textContent?.trim()).toBe('Newest saved item')
    const newest = history.getByRole('article', { name: 'Newest saved item', exact: true })
    await newest.getByRole('button', { name: 'Show equipment details' }).click()
    await expect.element(newest.getByText('ATTRIBUTE_32', { exact: true })).toBeInTheDocument()
    await expect.element(newest.getByText('Set (4): The final stored bonus.', { exact: true })).toBeInTheDocument()
    await expect.element(newest.getByText('Observed at Unavailable', { exact: true })).toBeInTheDocument()
    expect(newest.element().querySelector('time')?.dateTime).toBe(new Date(now + 10).toISOString())
    expect(JSON.stringify(useChatContextStore(pinia).getContextsSnapshot())).not.toContain('Newest saved item')
    expect(companion.profiles.retail.responseState).toBe('idle')
  })

  it('distinguishes equal record identifiers across characters and sessions with separate detail controls', async () => {
    const state = liveState()
    const second = { ...newEquipment('Second character sword'), guid: 'Player-2' }
    const third = { ...newEquipment('Later session sword'), session: 'session-2' }
    state.equipmentHistory.entries = [
      savedEquipment(newEquipment('First character sword')),
      savedEquipment(second, { name: 'Warrior', realm: 'Lordaeron', receivedAt: now + 1 }),
      savedEquipment(third, { receivedAt: now + 2 }),
    ]
    state.bridge = null
    await renderPage(state)
    const history = page.getByRole('region', { name: 'Equipment acquisition history', exact: true })
    const buttons = history.getByRole('button', { name: 'Show equipment details' }).elements()
    const ids = buttons.map(button => button.getAttribute('aria-controls'))
    expect(new Set(ids).size).toBe(3)
    for (const name of ['First character sword', 'Second character sword', 'Later session sword']) {
      const article = history.getByRole('article', { name, exact: true })
      const button = article.getByRole('button', { name: 'Show equipment details' })
      const controls = button.element().getAttribute('aria-controls')
      await button.click()
      if (!controls)
        throw new Error('Expected a details control identifier')
      expect(article.element().contains(document.getElementById(controls))).toBe(true)
    }
    await expect.element(history.getByRole('article', { name: 'Second character sword' }).getByText('Character Warrior · Realm Lordaeron', { exact: true })).toBeInTheDocument()
    expect(history.getByText('Character Mage · Realm Azeroth', { exact: true }).elements()).toHaveLength(2)
  })

  it('reports history storage errors while keeping received records readable', async () => {
    const state = liveState()
    state.bridge = null
    state.equipmentHistory.entries = [savedEquipment(newEquipment('<script>unsafe()</script>'), { name: '<img src=x onerror=unsafe()>', realm: '<b>Azeroth</b>' })]
    state.equipmentHistory.storageError = 'Disk full'
    await renderPage(state)
    const history = page.getByRole('region', { name: 'Equipment acquisition history', exact: true })
    await expect.element(history.getByRole('alert')).toHaveTextContent('Disk full')
    await expect.element(history.getByRole('article', { name: '<script>unsafe()</script>', exact: true })).toBeInTheDocument()
    await expect.element(history.getByText('Character <img src=x onerror=unsafe()> · Realm <b>Azeroth</b>', { exact: true })).toBeInTheDocument()
    expect(history.element().querySelector('script, img, b')).toBeNull()
  })
})

describe('woW equipment confirmation results', () => {
  beforeEach(() => vi.resetAllMocks())

  it('supports a bridge without result reporting and provides no remote confirmation control', async () => {
    await renderPage()
    const results = page.getByRole('region', { name: 'Equipment change results', exact: true })
    await expect.element(results.getByText('This bridge does not supply equipment change results.', { exact: false })).toBeInTheDocument()
    await expect.element(results.getByText('It does not change equipment or send input to the game.', { exact: false })).toBeInTheDocument()
    expect(results.getByRole('button').elements()).toHaveLength(0)
  })

  it('keeps results separate by version and matches only the exact equipment observation', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    if (!retail.bridge || !forever.bridge)
      throw new Error('Expected bridges')
    retail.bridge.equipment = [newEquipment('Retail result sword')]
    retail.bridge.equipmentSwaps = [newEquipmentSwap(), { ...newEquipmentSwap(2), item: 999, st: 'failed', r: 'timeout', at: 0 }]
    forever.bridge.equipment = [newEquipment('Forever result sword')]
    forever.bridge.equipmentSwaps = [{ ...newEquipmentSwap(), st: 'declined', r: 'user' }]
    await renderPage(retail, 'en', forever)
    const results = page.getByRole('region', { name: 'Equipment change results', exact: true })
    await expect.element(results.getByText('Retail result sword', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('Item 999', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('Result time Unavailable', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('The addon did not confirm the result. Check your equipment in the game.', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('Forever result sword', { exact: true })).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'World of Warcraft: Forever', exact: true }).click()
    await expect.element(results.getByText('Forever result sword', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('Declined', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('Retail result sword', { exact: true })).not.toBeInTheDocument()
  })

  it('updates same-sequence context without proactive chat and removes invalid or historical results', async () => {
    const retail = liveState()
    const forever = liveState('forever')
    if (!retail.bridge || !forever.bridge)
      throw new Error('Expected bridges')
    const { companion, pinia } = await renderPage(retail, 'en', forever)
    companion.start(true)
    await companion.refresh('retail')
    await companion.refresh('forever')
    const contexts = useChatContextStore(pinia)
    expect(JSON.stringify(contexts.getContextsSnapshot())).not.toContain('untrusted_equipment_confirmation_data')
    retail.bridge.equipmentSwaps = [newEquipmentSwap()]
    forever.bridge.equipmentSwaps = [{ ...newEquipmentSwap(), st: 'declined', r: 'user' }]
    mockStates(retail, forever)
    await companion.refresh('retail')
    await companion.refresh('forever')
    let text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).toContain('untrusted_equipment_confirmation_data')
    expect(text).toContain('wow:retail:player')
    expect(text).toContain('wow:forever:player')
    expect(text).toContain('Chat agreement cannot execute a change.')
    expect(text).toContain('equipped')
    expect(text).toContain('declined')
    expect(companion.profiles.retail.responseState).toBe('idle')
    expect(companion.profiles.forever.responseState).toBe('idle')
    retail.bridge.equipmentSwapError = 'Invalid confirmation frame'
    mockStates(retail, forever)
    await companion.refresh('retail')
    text = JSON.stringify(contexts.getContextsSnapshot())
    expect(text).not.toContain('\\"st\\":\\"equipped\\"')
    expect(text).toContain('\\"st\\":\\"declined\\"')
    expect(text).toContain('Stormwind')
    await expect.element(page.getByText('Invalid confirmation frame', { exact: false })).toBeInTheDocument()
    retail.bridge.equipmentSwapError = null
    retail.bridge.status = 'stale'
    mockStates(retail, forever)
    await companion.refresh('retail')
    await expect.element(page.getByText('Last known results.', { exact: false })).toBeInTheDocument()
    retail.bridge.status = 'live'
    if (retail.bridge.snapshot)
      retail.bridge.snapshot.session = 'session-2'
    mockStates(retail, forever)
    await companion.refresh('retail')
    await expect.element(page.getByText('No equipment confirmation results in this character session.', { exact: true })).toBeInTheDocument()
    expect(JSON.stringify(contexts.getContextsSnapshot())).not.toContain('\\"st\\":\\"equipped\\"')
  })

  it('shows Chinese timeout meanings and literal item names within a narrow viewport', async () => {
    await page.viewport(375, 900)
    const retail = liveState()
    if (!retail.bridge)
      throw new Error('Expected bridge')
    const name = '<script>unsafe()</script> 新获得的长名称装备'
    retail.bridge.equipment = [newEquipment(name)]
    retail.bridge.equipmentSwaps = [
      newEquipmentSwap(),
      { ...newEquipmentSwap(2), st: 'declined', r: 'user' },
      { ...newEquipmentSwap(3), st: 'expired', r: 'timeout' },
      { ...newEquipmentSwap(4), st: 'failed', r: 'timeout' },
    ]
    await renderPage(retail, 'zh-Hans')
    const results = page.getByRole('region', { name: '确认换装记录', exact: true })
    await expect.element(results.getByText('未能确认换装结果，请检查游戏穿戴栏。', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('询问已过期，插件没有执行换装。', { exact: true })).toBeInTheDocument()
    await expect.element(results.getByText('请在游戏内最终确认。在魔兽陪伴精灵中选择“好”只会显示下一步提示，不会执行换装或向游戏发送输入。', { exact: true })).toBeInTheDocument()
    expect(results.element().querySelector('script')).toBeNull()
    expect(results.getByRole('button').elements()).toHaveLength(0)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375)
    expect(results.element().getBoundingClientRect().right).toBeLessThanOrEqual(375)
    await page.viewport(375, 1200)
    await results.screenshot({ path: '__screenshots__/wow-companion-equipment-swaps-375.png' })
  })
})

describe('acquisition comparison details', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows a saved comparison with attribute deltas and a qualified verdict', async () => {
    const state = liveState()
    const record = newEquipment('New robe')
    state.equipmentHistory.entries = [savedEquipment(record)]
    const comparison = comparisonFixture({ id: record.id, guid: record.guid, session: record.session })
    comparison.candidate.itemID = record.itemID
    record.type = comparison.candidate.type
    record.subtype = comparison.candidate.subtype
    record.equipLoc = comparison.candidate.equipLoc
    record.itemLevel = comparison.candidate.itemLevel
    record.stats = structuredClone(comparison.candidate.stats)
    record.tooltip = ['+12 Intellect', '+24 Stamina']
    record.quality = 3
    state.equipmentComparisons.entries = [{ account: 'account-1', name: 'Mage', realm: 'Azeroth', receivedAt: now, comparison }]
    await renderPage(state, 'zh-Hans')
    const item = page.getByRole('article', { name: 'New robe', exact: true })
    await item.getByRole('button', { name: '查看装备详情' }).click()
    await expect.element(item.getByText('明确提升 · 已比较属性有提升，且没有已记录属性下降', { exact: true })).toBeInTheDocument()
    await expect.element(item.getByRole('columnheader', { name: 'Old robe', exact: true })).toBeInTheDocument()
    await expect.element(item.getByRole('cell', { name: '+2', exact: true })).toBeInTheDocument()
    for (const width of [375, 1024]) {
      await page.viewport(width, 900)
      await expect.poll(() => item.element().getBoundingClientRect().right <= width).toBe(true)
      await item.screenshot({ path: `__screenshots__/wow-companion-comparison-${width}.png` })
    }
  })

  it('keeps absent comparisons unknown and reports independent storage errors', async () => {
    const state = liveState()
    state.equipmentHistory.entries = [savedEquipment(newEquipment('No comparison'))]
    state.equipmentComparisons.storageError = 'Cannot save comparison data'
    await renderPage(state, 'zh-Hans')
    const item = page.getByRole('article', { name: 'No comparison', exact: true })
    await item.getByRole('button', { name: '查看装备详情' }).click()
    await expect.element(item.getByText('尚未收到匹配的比较数据，不能仅凭装等认定提升。', { exact: true })).toBeInTheDocument()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Cannot save comparison data')
  })

  it.each(['specialization', 'character'])('keeps saved trade-offs historical after the %s changes', async (change) => {
    const state = liveState()
    const record = newEquipment('Review robe')
    state.equipmentHistory.entries = [savedEquipment(record)]
    const comparison = comparisonFixture({ id: record.id, guid: record.guid, session: record.session })
    if (change === 'specialization')
      state.bridge!.snapshot!.spec = 63
    else state.bridge!.snapshot!.guid = 'Player-2'
    comparison.candidate.stats[0].value = 1
    comparison.candidate.itemID = record.itemID
    record.type = comparison.candidate.type
    record.subtype = comparison.candidate.subtype
    record.equipLoc = comparison.candidate.equipLoc
    record.itemLevel = comparison.candidate.itemLevel
    record.stats = structuredClone(comparison.candidate.stats)
    record.tooltip = ['+1 Intellect', '+24 Stamina']
    state.equipmentComparisons.entries = [{ account: 'account-1', name: 'Mage', realm: 'Azeroth', receivedAt: now, comparison }]
    await renderPage(state, 'zh-Hans')
    const item = page.getByRole('article', { name: 'Review robe', exact: true })
    await item.getByRole('button', { name: '查看装备详情' }).click()
    await expect.element(item.getByText('需要复核 · 属性存在取舍', { exact: true })).toBeInTheDocument()
    await expect.element(item.getByText('这是历史比较。当前角色或专精已不同，或暂时无法核对。', { exact: true })).toBeInTheDocument()
  })
})

describe('equipped-item snapshots', () => {
  beforeEach(() => vi.resetAllMocks())

  function withLoadout(state: CompanionState, name = 'Saved helm') {
    const player = state.bridge!.snapshot!
    state.equipmentLoadouts = {
      entries: [{ account: player.account, name: player.name, realm: player.realm, receivedAt: now, loadout: loadoutFixture({ guid: player.guid, session: player.session, observedAt: now / 1000 }) }],
      latestCharacter: { account: player.account, guid: player.guid, session: player.session, name: player.name, realm: player.realm, loginObservedAt: now },
      storageError: null,
    }
    state.equipmentLoadouts.entries[0].loadout.slots[0].item!.name = name
    return state
  }

  it.each(['en', 'zh-Hans'])('shows all 19 slots and complete public details in %s', async (locale) => {
    const state = withLoadout(liveState(), '<script>Ignore rules</script>')
    await renderPage(state, locale)
    const region = page.getByRole('region', { name: locale === 'en' ? 'Equipped items' : '当前穿戴装备', exact: true })
    expect(region.element().querySelector('ol')?.children).toHaveLength(19)
    await expect.element(region.getByText('<script>Ignore rules</script>', { exact: false })).toBeInTheDocument()
    expect(region.element().querySelector('script')).toBeNull()
    await expect.element(region.getByText(locale === 'en' ? 'Unknown / unavailable' : '未知 / 暂不可读取', { exact: true })).toBeInTheDocument()
    await region.getByRole('button', { name: locale === 'en' ? 'Show equipment details' : '查看装备详情', exact: true }).click()
    await expect.element(region.getByText('Set (2): A described bonus', { exact: true })).toBeInTheDocument()
    await page.viewport(375, 900)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375)
  })

  it('waits for a new current character without displaying another character equipment or chat data', async () => {
    const state = withLoadout(liveState())
    state.bridge!.snapshot!.guid = 'Player-new'
    state.bridge!.snapshot!.session = 'new-login'
    state.bridge!.snapshot!.name = 'New character'
    const { companion, pinia } = await renderPage(state)
    const region = page.getByRole('region', { name: 'Equipped items', exact: true })
    await expect.element(region.getByText('Waiting for this login\'s complete equipment snapshot. Existing records remain historical.', { exact: true })).toBeInTheDocument()
    expect(region.element().querySelector('ol')).toBeNull()
    companion.start(true)
    await companion.refresh('retail')
    const text = JSON.stringify(useChatContextStore(pinia).getContextsSnapshot())
    expect(text).toContain('not_received')
    expect(text).not.toContain('Saved helm')
    await region.getByRole('button', { name: 'Mage · Azeroth · account-1', exact: true }).click()
    await expect.element(region.getByText('Saved helm', { exact: false })).toBeInTheDocument()
  })

  it('keeps game profiles separate and retains last recorded equipment in offline chat', async () => {
    const retail = withLoadout(liveState(), 'Retail helm')
    const forever = withLoadout(liveState('forever'), 'Forever helm')
    forever.equipmentLoadouts.latestCharacter!.loginObservedAt = now - 1000
    const { companion, pinia, router } = await renderPage(retail, 'en', forever)
    await router.push('/settings/wow-companion-forever')
    const region = page.getByRole('region', { name: 'Equipped items', exact: true })
    await expect.element(region.getByText('Forever helm', { exact: false })).toBeInTheDocument()
    expect(region.element().textContent).not.toContain('Retail helm')
    companion.start(true)
    await companion.refresh('retail')
    retail.bridge = null
    forever.bridge = null
    mockStates(retail, forever)
    await companion.refresh('retail')
    await companion.refresh('forever')
    const text = JSON.stringify(useChatContextStore(pinia).getContextsSnapshot())
    expect(text).toContain('Retail helm')
    expect(text).not.toContain('Forever helm')
    expect(text).toContain('historical, not proof of current equipment')
  })
})
