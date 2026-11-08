import type { TtsRequest } from '@proj-airi/pipelines-audio'
import type { GenerationProvider } from '@proj-airi/provider-inference'

import type { GameVersion } from '../../shared/wow-companion'
import type { CompanionMemoryEntry, CompanionMemoryState } from '../../shared/wow-companion-memory'

import localforage from 'localforage'

import { Playback } from '@proj-airi/pipelines-audio'
import { useLLM } from '@proj-airi/stage-ui/stores/ai/chat-llm/llm'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useContextBridgeStore } from '@proj-airi/stage-ui/stores/mods/api/context-bridge'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { useSpeechOutputControlStore } from '@proj-airi/stage-ui/stores/speech-output-control'
import { useVoiceStore } from '@proj-airi/stage-ui/stores/voice'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick } from 'vue'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { i18n } from '../modules/i18n'
import { useWowChatterSettingsStore } from './wow-chatter-settings'
import { useWowCompanionStore } from './wow-companion'

const ipc = vi.hoisted(() => ({ state: vi.fn(), memory: vi.fn(), capacity: vi.fn(), claim: vi.fn(), setLimit: vi.fn(), activate: vi.fn(), remember: vi.fn(), unexpected: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async (original) => {
  const { createContext } = await import('@moeru/eventa')
  const context = createContext()
  return {
    ...await original<typeof import('@proj-airi/electron-vueuse')>(),
    getElectronEventaContext: () => context,
    useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
      switch (event.receiveEvent?.id) {
        case 'eventa:invoke:wow-companion:get-receive': return ipc.state
        case 'eventa:invoke:wow-memory:get-receive': return ipc.memory
        case 'eventa:invoke:wow-memory:get-capacity-receive': return ipc.capacity
        case 'eventa:invoke:wow-memory:claim-notice-receive': return ipc.claim
        case 'eventa:invoke:wow-memory:set-limit-receive': return ipc.setLimit
        case 'eventa:invoke:wow-memory:activate-receive': return ipc.activate
        case 'eventa:invoke:wow-memory:remember-receive': return ipc.remember
        default: return async () => {
          ipc.unexpected(event.receiveEvent?.id)
          throw new Error(`Unexpected IPC ${event.receiveEvent?.id}`)
        }
      }
    },
  }
})

const startedAt = Date.parse('2026-11-02T10:00:00Z')
const combatKey = 'settings/wow-chatter/combat-progress-v1'

async function settle() {
  for (let count = 0; count < 8; count++)
    await Promise.resolve()
  await nextTick()
}

beforeEach(async () => {
  vi.resetAllMocks()
  localStorage.clear()
  await localforage.clear()
})

async function companionFixture(options: { chat?: boolean, speech?: boolean, combats?: number, consumed?: number, emptyMemory?: boolean, capacityFull?: boolean, combat?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(startedAt)
  const pinia = createPinia()
  setActivePinia(pinia)
  const state = loadoutStateFixture()
  state.settings = { ...state.settings, muted: false, zone: false, levelUp: false, death: false, revive: false }
  state.bridge!.snapshot = { ...state.bridge!.snapshot!, loginId: 'real-game-login', combatEnds: options.combats ?? 5, combat: options.combat ?? false }
  state.bridge!.equipmentOffer = null
  state.bridge!.equipmentComparisons = []
  state.bridge!.events = []
  state.bridge!.eventCursor = 0
  const snapshot = state.bridge!.snapshot!
  const forever = loadoutStateFixture()
  forever.game = 'forever'
  forever.settings.enabled = false
  forever.bridge!.snapshot!.online = false
  if (options.consumed !== undefined) {
    localStorage.setItem(combatKey, JSON.stringify([{ game: 'retail', account: snapshot.account, guid: snapshot.guid, loginId: snapshot.loginId, consumed: options.consumed, lastInteractionAt: startedAt }]))
  }
  const modules = {
    consciousness: options.chat === false ? { provider: '', model: '' } : { provider: 'chatter-test-chat', model: 'test-chat' },
    vision: { provider: '', model: '' },
    speech: options.speech === false
      ? { provider: 'speech-noop', model: '', voice_id: '' }
      : { provider: 'chatter-test-speech', model: 'test-speech', voice_id: 'test-voice' },
  }
  localStorage.setItem('airi-card-module-defaults', JSON.stringify(modules))
  localStorage.setItem('airi-cards', JSON.stringify([['default', {
    name: 'Companion',
    version: '1.0',
    systemPrompt: 'You are a calm Warcraft companion.',
    extensions: { airi: { agents: {}, avatarModels: [], modules } },
  }]]))
  const goal: CompanionMemoryEntry = {
    id: 'current-plan',
    personaId: 'default',
    character: { game: 'retail', account: snapshot.account, guid: snapshot.guid },
    characterName: snapshot.name,
    kind: 'session-goal',
    source: 'user',
    sourceId: null,
    text: 'Explore the current region.',
    fact: null,
    occurredAt: startedAt,
    updatedAt: startedAt,
    collected: false,
    suppressed: false,
    gameSessionId: snapshot.loginId!,
    chatSessionId: null,
    expiresAt: null,
    expired: false,
  }
  let entries: CompanionMemoryEntry[] = options.emptyMemory ? [] : [goal]
  const capacity = { limit: 1000, used: options.capacityFull ? 1000 : 0, full: options.capacityFull ?? false }
  const memoryState = (): CompanionMemoryState => ({ entries: structuredClone(entries), relationship: { personaId: 'default', points: 0, stage: 0, visitedLocations: [], updatedAt: startedAt }, storageError: null, capacity: { ...capacity } })
  ipc.memory.mockImplementation(async () => memoryState())
  ipc.capacity.mockImplementation(async () => ({ ...capacity }))
  ipc.claim.mockResolvedValue(true)
  ipc.setLimit.mockImplementation(async () => {
    throw new Error('Unexpected memory limit edit during chatter')
  })
  ipc.activate.mockResolvedValue(undefined)
  ipc.remember.mockImplementation(async () => memoryState())
  ipc.state.mockImplementation(async ({ game }: { game: GameVersion }) => {
    const current = structuredClone(game === 'retail' ? state : forever)
    current.updatedAt = Date.now()
    current.bridge!.lastSeen = new Date().toISOString()
    current.bridge!.ageSeconds = 0
    current.bridge!.snapshot!.tick = Math.floor((Date.now() - startedAt) / 1000) + 1
    return current
  })
  // The actual stores and IndexedDB remain active. Only network, native IPC and audio provider IO are substituted.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ data: [], models: [], voices: [] })))
  let companion: ReturnType<typeof useWowCompanionStore>
  const host = defineComponent({ setup() {
    useChatStore(pinia)
    useContextBridgeStore(pinia)
    useVoiceStore(pinia)
    companion = useWowCompanionStore(pinia)
    return () => h('div')
  } })
  const screen = await render(host, { global: { plugins: [pinia, i18n] } })
  const preferences = useWowChatterSettingsStore(pinia)
  preferences.regularEnabled = true
  preferences.regularIntervalMinutes = 5
  preferences.combatsRequired = 5
  preferences.sceneryEnabled = false
  preferences.locationEnabled = false
  preferences.questEnabled = false
  const configs = useProviderConfigStore(pinia)
  configs.ensureProvider('chatter-test-chat', 'ollama', { model: 'test-chat' })
  configs.ensureProvider('chatter-test-speech', 'mimo-audio-speech', { model: 'test-speech', voice: 'test-voice' })
  const provider: GenerationProvider = { generation: model => ({ protocol: 'chat-completions', config: { model, baseURL: 'https://example.invalid/' } }) }
  vi.spyOn(useProviderStore(pinia), 'getChatProviderInstance').mockResolvedValue(provider)
  const pendingModels: ReturnType<typeof Promise.withResolvers<string>>[] = []
  let deferred = false
  let reply = 'Warrior, how is your exploration going?'
  const stream = vi.spyOn(useLLM(pinia), 'stream').mockImplementation(async (_model, _provider, _conversation, request) => {
    const pending = Promise.withResolvers<string>()
    pendingModels.push(pending)
    if (!deferred)
      pending.resolve(reply)
    const text = await pending.promise
    await request?.onStreamEvent?.({ type: 'text-delta', text })
    await request?.onStreamEvent?.({ type: 'finish' })
  })
  const sessions = useChatSessionStore(pinia)
  const sessionId = await sessions.createSession('default', { title: 'Companion chatter integration' })
  const voice = useVoiceStore(pinia)
  const synthesize = vi.fn(async (_request: TtsRequest, _signal: AbortSignal) => null)
  const playback = new Playback({ nowMs: () => 0, play: () => ({ done: Promise.resolve({ throughMs: 1 }), stop: async () => ({ throughMs: 0 }) }) })
  const output = vi.fn(() => ({ playback, synthesize }))
  const disconnect = voice.connectOutput(output)
  const controls = useSpeechOutputControlStore(pinia)
  controls.setSpeechMuted(false)
  controls.setSpeechVolume(1)
  const observedUserInput = vi.fn()
  const unregisterInput = useChatStore(pinia).registerUserInputObserver('test:chatter-owner-input', observedUserInput)
  onTestFinished(async () => {
    companion!.stop()
    for (const pending of pendingModels)
      pending.resolve('Late result after test cleanup.')
    await settle()
    unregisterInput()
    disconnect()
    screen.unmount()
    disposePinia(pinia)
    vi.restoreAllMocks()
    vi.useRealTimers()
    localStorage.clear()
    await localforage.clear()
  })
  companion!.start(true)
  await settle()
  await expect.poll(() => companion!.profiles.retail.loaded).toBe(true)

  async function refreshAt(time: number) {
    vi.setSystemTime(time)
    await companion!.refresh('retail')
    await settle()
  }

  async function observeUntil(time: number) {
    while (Date.now() < time)
      await refreshAt(Math.min(Date.now() + 10_000, time))
  }

  return { companion: companion!, state, snapshot, sessions, sessionId, stream, synthesize, output, preferences, observedUserInput, refreshAt, observeUntil, goal, sendMessage: (text: string) => useChatStore(pinia).send({ sessionId, text, messageId: 'owner-input-memory-limit' }), cancelMessage: () => useChatStore(pinia).cancelTurn({ sessionId, turnId: 'owner-input-memory-limit' }), setMemories: (value: CompanionMemoryEntry[]) => entries = value, removeMemories: () => entries = [], deferModel: () => deferred = true, resolveModel: (text: string) => pendingModels.at(-1)?.resolve(text), setReply: (text: string) => reply = text, progress: () => JSON.parse(localStorage.getItem(combatKey) ?? '[]') as { consumed: number }[] }
}

describe('fixed game notices with the shared voice owner', () => {
  it('speaks a level event without a chat model or a model request', async () => {
    const result = await companionFixture({ chat: false })
    result.state.settings.levelUp = true
    result.snapshot.level++
    result.state.bridge!.events = [{ id: 1, type: 'level_up', timestamp: new Date(startedAt + 1000).toISOString(), title: 'Level up', detail: '', snapshot: structuredClone(result.snapshot), demo: false }]
    result.state.bridge!.eventCursor = 1
    await result.refreshAt(startedAt + 1000)
    await expect.poll(() => result.synthesize.mock.calls.map(([request]) => request.text).join(' ')).toContain(String(result.snapshot.level))
    expect(result.synthesize.mock.calls.map(([request]) => request.text).join(' ')).toContain(result.snapshot.name)
    expect(result.stream).not.toHaveBeenCalled()
  })

  it('shows a death notice without speech and clears it after eight seconds', async () => {
    const result = await companionFixture({ chat: false, speech: false })
    result.state.settings.death = true
    result.snapshot.dead = true
    result.state.bridge!.events = [{ id: 1, type: 'death', timestamp: new Date(startedAt + 1000).toISOString(), title: 'Death', detail: '', snapshot: structuredClone(result.snapshot), demo: false }]
    result.state.bridge!.eventCursor = 1
    await result.refreshAt(startedAt + 1000)
    expect(result.companion.chatterCaption).toBe(i18n.global.t('wow-companion.fixed-notices.death', { player: result.snapshot.name }))
    await result.refreshAt(startedAt + 9001)
    expect(result.companion.chatterCaption).toBe('')
    expect(result.synthesize).not.toHaveBeenCalled()
    expect(result.stream).not.toHaveBeenCalled()
  })

  it('clears a fixed text notice when another character becomes current', async () => {
    const result = await companionFixture({ speech: false })
    result.state.settings.levelUp = true
    result.snapshot.level++
    result.state.bridge!.events = [{ id: 1, type: 'level_up', timestamp: new Date(startedAt + 1000).toISOString(), title: 'Level up', detail: '', snapshot: structuredClone(result.snapshot), demo: false }]
    result.state.bridge!.eventCursor = 1
    await result.refreshAt(startedAt + 1000)
    expect(result.companion.chatterCaption).toContain(result.snapshot.name)
    result.snapshot.guid = 'Player-next'
    result.snapshot.session = 'new-session'
    result.snapshot.name = 'Next character'
    await result.refreshAt(startedAt + 2000)
    expect(result.companion.chatterCaption).toBe('')
    expect(result.stream).not.toHaveBeenCalled()
  })

  it('reads a calendar reset as a lockout reset without a chat request or replay', async () => {
    const result = await companionFixture({ chat: false })
    result.state.bridge!.calendar = { day: '2026-11-02', items: [{ title: 'Test raid', action: 'reset', when: '2026-11-02 10:00' }] }
    await result.refreshAt(startedAt + 1000)
    await expect.poll(() => result.synthesize.mock.calls.map(([request]) => request.text).join(' ')).toContain('Test raid')
    await settle()
    const text = result.synthesize.mock.calls.map(([request]) => request.text).join(' ')
    expect(text.replaceAll(/\s+/g, '')).toContain(i18n.global.t('wow-companion.fixed-notices.reset', { title: 'Test raid', when: '2026-11-02 10:00' }).replaceAll(/\s+/g, ''))
    const requests = result.synthesize.mock.calls.length
    await result.refreshAt(startedAt + 3000)
    expect(result.synthesize).toHaveBeenCalledTimes(requests)
    expect(result.stream).not.toHaveBeenCalled()
  })

  it('does not speak or display muted fixed events', async () => {
    const result = await companionFixture({ speech: false })
    result.state.settings.levelUp = true
    result.state.settings.muted = true
    result.snapshot.level++
    result.state.bridge!.events = [{ id: 1, type: 'level_up', timestamp: new Date(startedAt + 1000).toISOString(), title: 'Level up', detail: '', snapshot: structuredClone(result.snapshot), demo: false }]
    result.state.bridge!.eventCursor = 1
    await result.refreshAt(startedAt + 1000)
    expect(result.companion.chatterCaption).toBe('')
    expect(result.synthesize).not.toHaveBeenCalled()
    expect(result.stream).not.toHaveBeenCalled()
  })

  it('keeps a failed speech notice as text without repeating the event', async () => {
    const result = await companionFixture({ chat: false })
    result.synthesize.mockRejectedValue(new Error('Synthetic speech service failure'))
    result.state.settings.levelUp = true
    result.snapshot.level++
    result.state.bridge!.events = [{ id: 1, type: 'level_up', timestamp: new Date(startedAt + 1000).toISOString(), title: 'Level up', detail: '', snapshot: structuredClone(result.snapshot), demo: false }]
    result.state.bridge!.eventCursor = 1
    await result.refreshAt(startedAt + 1000)
    await expect.poll(() => result.companion.chatterCaption).toBe(i18n.global.t('wow-companion.fixed-notices.level_up', { player: result.snapshot.name, level: result.snapshot.level }))
    const attempts = result.synthesize.mock.calls.length
    await result.refreshAt(startedAt + 3000)
    expect(result.synthesize).toHaveBeenCalledTimes(attempts)
    await result.refreshAt(startedAt + 10_000)
    expect(result.companion.chatterCaption).toBe('')
    expect(result.stream).not.toHaveBeenCalled()
  })
})

describe('ordinary companion chatter with real store ownership', () => {
  it('requires five minutes and five addon-observed combat ends before requesting the model', async () => {
    const result = await companionFixture({ combats: 5 })
    await result.observeUntil(startedAt + 299_000)
    expect(result.stream).not.toHaveBeenCalled()
    expect(result.output).not.toHaveBeenCalled()
    await result.refreshAt(startedAt + 300_000)
    await expect.poll(() => result.stream.mock.calls.length).toBe(1)
    await expect.poll(() => result.sessions.messages.filter(message => message.role === 'assistant' && message.proactive?.source === 'wow-companion-chatter').length).toBe(1)
    await expect.poll(() => result.synthesize.mock.calls.length).toBe(1)
    expect(result.stream.mock.calls[0][3]?.supportsTools).toBe(false)
    expect(result.stream.mock.calls[0][3]?.taskTools).toEqual([])
    expect(result.progress()[0]?.consumed).toBe(5)
  })

  it('does not request the model or spend combat progress below five actual combat ends', async () => {
    const result = await companionFixture({ combats: 4 })
    await result.observeUntil(startedAt + 600_000)
    expect(result.stream).not.toHaveBeenCalled()
    expect(result.output).not.toHaveBeenCalled()
    expect(result.progress()).toEqual([])
  })

  it('counts real elapsed time during combat and waits ten fresh seconds after combat ends', async () => {
    const result = await companionFixture({ combats: 4 })
    await result.observeUntil(startedAt + 240_000)
    result.snapshot.combat = true
    await result.observeUntil(startedAt + 300_000)
    expect(result.stream).not.toHaveBeenCalled()
    result.snapshot.combat = false
    result.snapshot.combatEnds = 5
    await result.refreshAt(startedAt + 301_000)
    await result.refreshAt(startedAt + 310_999)
    expect(result.stream).not.toHaveBeenCalled()
    await result.refreshAt(startedAt + 311_000)
    await expect.poll(() => result.stream.mock.calls.length).toBe(1)
    expect(result.progress()[0]?.consumed).toBe(5)
  })

  it('waits ten seconds after a missed short combat without restarting the elapsed five minutes', async () => {
    const result = await companionFixture({ combats: 4 })
    await result.observeUntil(startedAt + 300_000)
    expect(result.stream).not.toHaveBeenCalled()
    // The addon observed a short combat between two renderer polls.
    result.snapshot.combatEnds = 5
    await result.refreshAt(startedAt + 301_000)
    await result.refreshAt(startedAt + 310_999)
    expect(result.stream).not.toHaveBeenCalled()
    await result.refreshAt(startedAt + 311_000)
    await expect.poll(() => result.stream.mock.calls.length).toBe(1)
    expect(result.progress()[0]?.consumed).toBe(5)
  })

  it('does not request an empty topic or spend previously unconsumed progress', async () => {
    const result = await companionFixture({ combats: 10, consumed: 5, emptyMemory: true })
    await result.observeUntil(startedAt + 600_000)
    expect(result.stream).not.toHaveBeenCalled()
    expect(result.progress()[0]?.consumed).toBe(5)
    expect(result.output).not.toHaveBeenCalled()
  })

  it.each(['stop', 'disable', 'character', 'memory', 'short combat'] as const)('discards a late model result after %s', async (change) => {
    const result = await companionFixture()
    result.deferModel()
    await result.observeUntil(startedAt + 300_000)
    await expect.poll(() => result.stream.mock.calls.length).toBe(1)
    if (change === 'stop')
      result.companion.stop()
    if (change === 'disable')
      result.preferences.regularEnabled = false
    if (change === 'character') {
      result.snapshot.guid = 'Player-other'
      result.snapshot.session = 'other-ui'
      result.snapshot.loginId = 'other-login'
      await result.refreshAt(startedAt + 301_000)
    }
    if (change === 'memory')
      result.removeMemories()
    if (change === 'short combat') {
      result.snapshot.combatEnds = 6
      await result.refreshAt(startedAt + 301_000)
    }
    result.resolveModel('This old reply must never be spoken.')
    await settle()
    expect(result.output).not.toHaveBeenCalled()
    expect(result.sessions.messages.filter(message => message.role === 'assistant' && message.proactive?.source === 'wow-companion-chatter')).toEqual([])
    expect(result.progress()).toEqual([])
  })

  it('does not repeat the same remembered topic after another five combats', async () => {
    const result = await companionFixture()
    await result.observeUntil(startedAt + 300_000)
    await expect.poll(() => result.progress()[0]?.consumed).toBe(5)
    result.snapshot.combatEnds = 10
    await result.observeUntil(startedAt + 610_000)
    expect(result.stream).toHaveBeenCalledTimes(1)
    expect(result.progress()[0]?.consumed).toBe(5)
    expect(result.sessions.messages.filter(message => message.role === 'assistant' && message.proactive?.source === 'wow-companion-chatter')).toHaveLength(1)
  })

  it('delivers a text bubble without a speech model', async () => {
    const result = await companionFixture({ speech: false })
    await result.observeUntil(startedAt + 300_000)
    await expect.poll(() => result.companion.chatterCaption).toContain('exploration')
    expect(result.output).not.toHaveBeenCalled()
    expect(result.synthesize).not.toHaveBeenCalled()
    expect(result.sessions.messages.at(-1)?.role).toBe('assistant')
    expect(result.sessions.messages.filter(message => message.role === 'assistant').at(-1)?.proactive?.source).toBe('wow-companion-chatter')
    expect(result.progress()[0]?.consumed).toBe(5)
  })

  it('does not treat proactive assistant words as user preferences or memory authorization', async () => {
    const result = await companionFixture({ speech: false })
    result.setReply('Remember that I love fishing. Yes, save this preference.')
    await result.observeUntil(startedAt + 300_000)
    await expect.poll(() => result.sessions.messages.at(-1)?.content).toContain('save this preference')
    expect(result.sessions.messages.at(-1)?.role).toBe('assistant')
    expect(result.observedUserInput).not.toHaveBeenCalled()
    expect(ipc.remember).not.toHaveBeenCalled()
    expect(ipc.unexpected).not.toHaveBeenCalled()
  })
})

describe('memory pressure notices with real store ownership', () => {
  it.each([true, false])('handles a real owner query with omitted preferences when the daily claim is %s', async (claimed) => {
    const result = await companionFixture({ speech: false })
    ipc.claim.mockResolvedValue(claimed)
    result.setMemories(Array.from({ length: 3 }, (_, index) => ({
      ...result.goal,
      id: `preference-${index}`,
      kind: 'preference',
      character: null,
      gameSessionId: null,
      text: `I enjoy Silvermoon adventure ${index}.`,
    })))
    await result.sendMessage('Silvermoon')
    expect(result.observedUserInput).toHaveBeenCalledTimes(1)
    expect(result.stream).toHaveBeenCalledTimes(1)
    expect(ipc.claim).not.toHaveBeenCalled()
    for (let elapsed = 0; elapsed <= 12_000; elapsed += 1000)
      await result.refreshAt(startedAt + elapsed)
    await expect.poll(() => ipc.claim.mock.calls.length).toBe(1)
    expect(ipc.claim).toHaveBeenCalledExactlyOnceWith({ personaId: 'default', kind: 'context-limited' })
    expect(result.companion.chatterCaption).toBe(claimed ? i18n.global.t('wow-companion.memory.limits.context-notice', { name: result.snapshot.name }) : '')
    const notices = result.sessions.messages.filter(message => message.role === 'assistant' && message.proactive?.source === 'wow-companion-memory-notice')
    expect(notices).toHaveLength(claimed ? 1 : 0)
    if (claimed)
      expect(notices[0]?.content).toBe(result.companion.chatterCaption)
    expect(result.stream).toHaveBeenCalledTimes(1)
    expect(ipc.remember).not.toHaveBeenCalled()
  })

  it('announces full long-term capacity with voice after ten stable seconds without asking the chat model', async () => {
    const result = await companionFixture({ capacityFull: true })
    for (let elapsed = 0; elapsed < 10_000; elapsed += 1000)
      await result.refreshAt(startedAt + elapsed)
    expect(ipc.claim).not.toHaveBeenCalled()
    for (let elapsed = 10_000; elapsed <= 12_000; elapsed += 1000)
      await result.refreshAt(startedAt + elapsed)
    await expect.poll(() => result.synthesize.mock.calls.length).toBeGreaterThan(0)
    expect(ipc.claim).toHaveBeenCalledExactlyOnceWith({ personaId: 'default', kind: 'capacity-full' })
    expect(result.stream).not.toHaveBeenCalled()
    const notices = result.sessions.messages.filter(message => message.role === 'assistant' && message.proactive?.source === 'wow-companion-memory-notice')
    expect(notices).toHaveLength(1)
    expect(notices[0]?.role).toBe('assistant')
    expect(notices[0]?.content).toBe(i18n.global.t('wow-companion.memory.limits.capacity-notice', { name: result.snapshot.name }))
    await expect.poll(() => result.synthesize.mock.calls.map(([request]) => request.text).join('')).toContain(result.snapshot.name)
    expect(result.observedUserInput).not.toHaveBeenCalled()
    expect(ipc.remember).not.toHaveBeenCalled()
  })

  it('shows a text bubble without requesting speech when no speech model is configured', async () => {
    const result = await companionFixture({ capacityFull: true, speech: false })
    for (let elapsed = 0; elapsed <= 12_000; elapsed += 1000)
      await result.refreshAt(startedAt + elapsed)
    await expect.poll(() => result.companion.chatterCaption).toBe(i18n.global.t('wow-companion.memory.limits.capacity-notice', { name: result.snapshot.name }))
    expect(result.output).not.toHaveBeenCalled()
    expect(result.synthesize).not.toHaveBeenCalled()
    expect(result.stream).not.toHaveBeenCalled()
    expect(ipc.claim).toHaveBeenCalledTimes(1)
    for (let elapsed = 13_000; elapsed <= 30_000; elapsed += 1000)
      await result.refreshAt(startedAt + elapsed)
    expect(ipc.claim).toHaveBeenCalledTimes(1)
  })

  it('defers a full-capacity notice through combat and waits ten seconds after combat ends', async () => {
    const result = await companionFixture({ capacityFull: true, combat: true })
    for (let elapsed = 0; elapsed <= 15_000; elapsed += 1000)
      await result.refreshAt(startedAt + elapsed)
    expect(ipc.claim).not.toHaveBeenCalled()
    expect(result.output).not.toHaveBeenCalled()
    result.snapshot.combat = false
    result.snapshot.combatEnds = 6
    for (let elapsed = 16_000; elapsed < 26_000; elapsed += 1000)
      await result.refreshAt(startedAt + elapsed)
    expect(ipc.claim).not.toHaveBeenCalled()
    await result.refreshAt(startedAt + 26_000)
    await expect.poll(() => result.synthesize.mock.calls.length).toBeGreaterThan(0)
    expect(ipc.claim).toHaveBeenCalledTimes(1)
    expect(result.stream).not.toHaveBeenCalled()
  })

  it.each(['character switch', 'real owner input'] as const)('does not show a late claim after %s', async (change) => {
    const result = await companionFixture({ capacityFull: true, speech: false })
    const claim = Promise.withResolvers<boolean>()
    ipc.claim.mockReturnValue(claim.promise)
    for (let elapsed = 0; elapsed <= 12_000; elapsed += 1000)
      await result.refreshAt(startedAt + elapsed)
    await expect.poll(() => ipc.claim.mock.calls.length).toBe(1)
    if (change === 'character switch') {
      result.snapshot.guid = 'Player-other'
      result.snapshot.loginId = 'another-game-login'
      await result.refreshAt(startedAt + 13_000)
    }
    else {
      const sending = result.sendMessage('Let us talk about something else.').catch(() => {})
      await expect.poll(() => result.observedUserInput.mock.calls.length).toBe(1)
      await result.cancelMessage()
      await sending
    }
    claim.resolve(true)
    await settle()
    expect(result.companion.chatterCaption).toBe('')
    expect(result.sessions.messages.filter(message => message.role === 'assistant' && message.proactive?.source === 'wow-companion-memory-notice')).toEqual([])
    expect(result.synthesize).not.toHaveBeenCalled()
  })
})
