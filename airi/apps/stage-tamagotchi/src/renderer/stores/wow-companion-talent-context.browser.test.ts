import type { CompanionState, GameVersion } from '../../shared/wow-companion'

import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatContextStore } from '@proj-airi/stage-ui/stores/chat/context-store'
import { useVoiceStore } from '@proj-airi/stage-ui/stores/voice'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { defineComponent, h, nextTick } from 'vue'

import { i18n } from '../modules/i18n'
import { buildStateFixture } from '../utils/wow-build.test-helper'
import { useWowChatterSettingsStore } from './wow-chatter-settings'
import { useWowCompanionStore } from './wow-companion'

const ipc = vi.hoisted(() => ({ get: vi.fn(), unexpected: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', async original => ({
  ...await original<typeof import('@proj-airi/electron-vueuse')>(),
  useElectronEventaInvoke: (event: { receiveEvent?: { id?: string } }) => {
    if (event.receiveEvent?.id === 'eventa:invoke:wow-companion:get-receive')
      return ipc.get
    return async () => {
      ipc.unexpected(event.receiveEvent?.id)
      throw new Error(`Unexpected IPC ${event.receiveEvent?.id}`)
    }
  },
}))

const clock = Date.parse('2026-11-01T08:00:00.000Z')
let pinia: ReturnType<typeof createPinia>
let companion: ReturnType<typeof useWowCompanionStore>
let context: ReturnType<typeof useChatContextStore>
let state: CompanionState
let pending: ReturnType<typeof Promise.withResolvers<CompanionState>>
let screen: ReturnType<typeof render>

function talentText() {
  return context.getContextsSnapshot()['wow-companion-talents']?.at(-1)?.text
}

async function advance(milliseconds: number) {
  await vi.advanceTimersByTimeAsync(milliseconds)
  await nextTick()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(clock)
  vi.resetAllMocks()
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
  const preferences = useWowChatterSettingsStore()
  preferences.regularEnabled = false
  preferences.sceneryEnabled = false
  preferences.locationEnabled = false
  preferences.questEnabled = false
  state = buildStateFixture('forever')
  state.settings.muted = true
  state.bridge!.snapshot!.combat = true
  const retail = buildStateFixture('retail')
  retail.settings.enabled = false
  retail.bridge!.snapshot!.online = false
  pending = Promise.withResolvers<CompanionState>()
  let reads = 0
  ipc.get.mockImplementation((request: { game: GameVersion }) => {
    if (request.game === 'retail')
      return Promise.resolve(structuredClone(retail))
    reads++
    return reads === 1 ? Promise.resolve(structuredClone(state)) : pending.promise
  })
  companion = useWowCompanionStore(pinia)
  context = useChatContextStore(pinia)
  // The real chat store uses useI18n during setup, just as it does in the app's main stage.
  const host = defineComponent({ setup: () => {
    useChatStore(pinia)
    useVoiceStore(pinia)
    return () => h('div')
  } })
  screen = render(host, { global: { plugins: [pinia, i18n] } })
})

afterEach(async () => {
  companion.stop()
  screen.unmount()
  disposePinia(pinia)
  pending.resolve(structuredClone(state))
  await Promise.resolve()
  vi.useRealTimers()
  localStorage.clear()
})

describe('talent chat context owner lifetime with real Pinia', () => {
  it('expires previously published active ranks while the next bridge request remains pending', async () => {
    companion.start(true)
    await advance(0)
    expect(companion.profiles.forever.loaded).toBe(true)
    expect(companion.profiles.forever.error).toBe('')
    expect(talentText()).toContain('"status":"active"')
    expect(talentText()).toContain('"nodeID":105958')
    expect(talentText()).toContain('"activeRank":1')

    await advance(250)
    expect(ipc.get.mock.calls.filter(([request]) => request.game === 'forever')).toHaveLength(2)
    expect(talentText()).toContain('"status":"active"')
    await advance(6000)
    expect(talentText()).toBeUndefined()
    expect(context.getContextsSnapshot()['wow-companion-talents']).toBeUndefined()
    expect(ipc.get.mock.calls.filter(([request]) => request.game === 'forever')).toHaveLength(2)
    expect(useChatStore(pinia).sending).toBe(false)
    expect(useChatStore(pinia).activeTurns).toEqual([])
    expect(ipc.unexpected).not.toHaveBeenCalled()
  })

  it('clears the independent expiry timer on stop and cannot republish a late bridge result', async () => {
    companion.start(true)
    await advance(250)
    expect(companion.profiles.forever.error).toBe('')
    expect(talentText()).toContain('"status":"active"')
    const timersWhilePending = vi.getTimerCount()
    companion.stop()
    expect(talentText()).toBeUndefined()
    expect(vi.getTimerCount()).toBe(timersWhilePending - 1)
    const historyAfterStop = context.contextHistory.length
    pending.resolve(structuredClone(state))
    await advance(10_000)
    expect(talentText()).toBeUndefined()
    expect(context.contextHistory).toHaveLength(historyAfterStop)
    expect(useChatStore(pinia).sending).toBe(false)
    expect(ipc.unexpected).not.toHaveBeenCalled()
  })

  it('keeps non-owner polling read-only and never creates a talent context writer', async () => {
    companion.start()
    await advance(250)
    expect(companion.profiles.forever.loaded).toBe(true)
    expect(talentText()).toBeUndefined()
    const historyBeforeExpiry = context.contextHistory.length
    await advance(10_000)
    expect(talentText()).toBeUndefined()
    expect(context.contextHistory).toHaveLength(historyBeforeExpiry)
    expect(ipc.get.mock.calls.filter(([request]) => request.game === 'forever')).toHaveLength(2)
    expect(ipc.unexpected).not.toHaveBeenCalled()
  })
})
