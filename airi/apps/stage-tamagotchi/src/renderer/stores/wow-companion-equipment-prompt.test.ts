import type { BridgeStatus, CompanionState, GameVersion } from '../../shared/wow-companion'
import type { EquipmentOffer } from '../../shared/wow-companion-equipment-offer'
import type { EquipmentPrompt, EquipmentPromptHost } from './wow-companion-equipment-prompt'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultSettings } from '../../shared/wow-companion'
import { comparisonFixture } from '../../shared/wow-companion-comparison.test-helper'
import { EquipmentPromptController } from './wow-companion-equipment-prompt'

const now = Date.parse('2026-10-24T14:00:00Z')

function state(game: GameVersion = 'retail', changes: Partial<EquipmentOffer> = {}): CompanionState {
  const profile: CompanionState = {
    game,
    settings: { ...defaultSettings },
    error: null,
    updatedAt: now,
    gold: { accounts: [], storageError: null },
    equipmentHistory: { entries: [], storageError: null },
    equipmentComparisons: { entries: [], storageError: null },
    equipmentLoadouts: { entries: [], latestCharacter: null, storageError: null },
    levelHistory: { characters: [], storageError: null },
    bridge: {
      instanceId: 'bridge',
      status: 'live',
      source: 'screen',
      ageSeconds: 0,
      lastSeen: new Date(now).toISOString(),
      eventCursor: 0,
      events: [],
      error: null,
      equipmentComparisons: [],
      equipmentComparisonError: null,
      equipmentLoadout: null,
      equipmentLoadoutError: null,
      config: { x: 8, y: 8, cellSize: 1, pollMs: 500, paused: false },
      snapshot: {
        v: 3,
        session: 'login',
        seq: 1,
        tick: 1,
        guid: 'Player-1',
        name: 'Player',
        realm: 'Realm',
        level: 80,
        class: 'MAGE',
        faction: 'Alliance',
        race: 'Human',
        spec: 64,
        map: 84,
        zone: 'City',
        combat: false,
        dead: false,
        online: true,
        account: 'account',
        moneyEpoch: 'epoch',
        copper: 100,
        earned: 0,
        spent: 0,
      },
      equipmentOffer: {
        v: 1,
        kind: 'offer',
        s: 'login',
        g: 'Player-1',
        id: 1,
        q: 1,
        st: 'ready',
        slot: 5,
        item: 100,
        n: 'New robe',
        il: 120,
        old: 99,
        ol: 100,
        until: now / 1000 + 120,
        ...changes,
      },
    },
  }
  const offer = profile.bridge!.equipmentOffer!
  const comparison = comparisonFixture({ id: offer.id, session: offer.s, guid: offer.g, slot: offer.slot })
  comparison.candidate.itemID = offer.item
  comparison.candidate.itemLevel = offer.il
  comparison.current!.itemID = offer.old
  comparison.current!.itemLevel = offer.ol
  if (offer.old === 0)
    comparison.current!.stats = []
  profile.bridge!.equipmentComparisons = [comparison]
  return profile
}

function harness() {
  let view: EquipmentPrompt | null = null
  let busy = false
  let muted = false
  let sessionId: string | undefined = 'chat'
  const calls: {
    done: ReturnType<typeof Promise.withResolvers<void>>
    silence: ReturnType<typeof Promise.withResolvers<void>>
    stop: ReturnType<typeof vi.fn>
  }[] = []
  const host: EquipmentPromptHost = {
    publish: vi.fn(value => view = value),
    currentPlayer: vi.fn(() => true),
    busy: () => busy,
    muted: () => muted,
    sessionId: () => sessionId,
    message: vi.fn((offer: EquipmentOffer) => `Change to ${offer.n}?`),
    accepted: () => 'Confirm the change in the game.',
    speak: vi.fn(() => {
      const done = Promise.withResolvers<void>()
      const silence = Promise.withResolvers<void>()
      const stop = vi.fn(() => silence.promise)
      calls.push({ done, silence, stop })
      return { turnId: `voice-${calls.length}`, done: done.promise, stop }
    }),
  }
  const controller = new EquipmentPromptController(host)
  return {
    host,
    controller,
    calls,
    view: () => view,
    busy: (value: boolean) => busy = value,
    muted: (value: boolean) => muted = value,
    session: (value: string | undefined) => sessionId = value,
  }
}

describe('equipmentPromptController', () => {
  it('rejects an older player and cancels its prompt before another profile can update', () => {
    const h = harness()
    h.muted(true)
    vi.mocked(h.host.currentPlayer).mockReturnValue(false)
    h.controller.observe('retail', state())
    expect(h.view()).toBeNull()
    expect(h.host.speak).not.toHaveBeenCalled()

    vi.mocked(h.host.currentPlayer).mockReturnValue(true)
    h.controller.observe('retail', state())
    expect(h.view()?.phase).toBe('choosing')

    vi.mocked(h.host.currentPlayer).mockReturnValue(false)
    h.controller.unavailable('forever')
    expect(h.view()).toBeNull()
    expect(h.host.speak).not.toHaveBeenCalled()
  })

  it.each(['missing', 'wrong-spec', 'tradeoff', 'complex', 'old-item', 'slot', 'candidate', 'changed-spec', 'comparison-error'] as const)('does not ask for an unproven upgrade: %s', (condition) => {
    const h = harness()
    const profile = state()
    const comparison = profile.bridge!.equipmentComparisons[0]
    if (condition === 'missing')
      profile.bridge!.equipmentComparisons = []
    if (condition === 'wrong-spec')
      comparison.specMatch = false
    if (condition === 'tradeoff')
      comparison.candidate.stats[0].value = 1
    if (condition === 'complex')
      comparison.candidate.complex = true
    if (condition === 'old-item')
      comparison.current!.itemID++
    if (condition === 'slot')
      comparison.slot++
    if (condition === 'candidate')
      comparison.candidate.itemID++
    if (condition === 'changed-spec')
      profile.bridge!.snapshot!.spec++
    if (condition === 'comparison-error')
      profile.bridge!.equipmentComparisonError = 'Invalid data'
    h.controller.observe('retail', profile)
    expect(h.view()).toBeNull()
    expect(h.host.speak).not.toHaveBeenCalled()
  })

  it('waits for comparison arrival and accepts proven equal-item-level improvements', () => {
    const h = harness()
    h.muted(true)
    const profile = state('retail', { il: 100 })
    const comparison = profile.bridge!.equipmentComparisons.pop()!
    h.controller.observe('retail', profile)
    expect(h.view()).toBeNull()
    profile.bridge!.equipmentComparisons.push(comparison)
    h.controller.observe('retail', profile)
    expect(h.view()?.phase).toBe('choosing')
    profile.bridge!.snapshot!.spec = 63
    h.controller.observe('retail', profile)
    expect(h.view()).toBeNull()
  })

  it('asks about a supported secondary trade-off without relabeling it as a clear upgrade', () => {
    const h = harness()
    h.muted(true)
    const profile = state()
    const comparison = profile.bridge!.equipmentComparisons[0]
    comparison.current!.stats.push({ key: 'ITEM_MOD_MASTERY_RATING_SHORT', value: 37 })
    comparison.candidate.stats.push({ key: 'ITEM_MOD_MASTERY_RATING_SHORT', value: 30 })
    h.controller.observe('retail', profile)
    expect(h.view()?.phase).toBe('choosing')
    expect(h.host.message).toHaveBeenCalledWith(profile.bridge!.equipmentOffer, comparison)
  })
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })
  afterEach(() => vi.useRealTimers())

  it('waits for owned speech completion before starting the ten-second choice window', async () => {
    const h = harness()
    h.controller.observe('retail', state())
    expect(h.view()?.phase).toBe('speaking')
    expect(h.view()?.deadline).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.view()?.phase).toBe('speaking')
    h.calls[0].done.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.view()?.phase).toBe('choosing')
    expect(h.view()?.deadline).toBe(now + 12_000)
    await vi.advanceTimersByTimeAsync(9999)
    expect(h.view()?.phase).toBe('choosing')
    await vi.advanceTimersByTimeAsync(1)
    expect(h.view()).toBeNull()
  })

  it('accepts only the current choice and displays the game confirmation instruction', async () => {
    const h = harness()
    h.muted(true)
    h.controller.observe('retail', state())
    const id = h.view()!.id
    h.controller.choose('old-id', 'accept')
    expect(h.view()?.phase).toBe('choosing')
    h.controller.choose(id, 'accept')
    expect(h.view()?.phase).toBe('accepted')
    expect(h.view()?.text).toBe('Confirm the change in the game.')
    expect(h.view()?.deadline).toBeNull()
    expect(h.host.speak).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.view()).toBeNull()
  })

  it('ignores a choice during speech and after its deadline', async () => {
    const h = harness()
    h.controller.observe('retail', state())
    const id = h.view()!.id
    h.controller.choose(id, 'accept')
    expect(h.view()?.phase).toBe('speaking')
    h.calls[0].done.resolve()
    await vi.advanceTimersByTimeAsync(10_000)
    h.controller.choose(id, 'accept')
    expect(h.view()).toBeNull()
  })

  it.each(['accept', 'decline', 'timeout'] as const)('does not replay a suggestion after %s', async (choice) => {
    const h = harness()
    h.muted(true)
    h.controller.observe('retail', state())
    const id = h.view()!.id
    if (choice !== 'timeout')
      h.controller.choose(id, choice)
    await vi.advanceTimersByTimeAsync(10_000)
    h.controller.observe('retail', state('retail', { q: 4 }))
    expect(h.view()).toBeNull()
  })

  it.each(['global', 'game'] as const)('keeps %s mute text-only', (kind) => {
    const h = harness()
    const profile = state()
    if (kind === 'global')
      h.muted(true)
    else
      profile.settings.muted = true
    h.controller.observe('retail', profile)
    expect(h.view()?.phase).toBe('choosing')
    expect(h.view()?.text).toContain('New robe')
    expect(h.host.speak).not.toHaveBeenCalled()
  })

  it('falls back to text when speech setup is unavailable', () => {
    const h = harness()
    h.host.speak = vi.fn(() => {
      throw new Error('No speech provider')
    })
    h.controller.observe('retail', state())
    expect(h.view()?.phase).toBe('choosing')
    expect(h.view()?.deadline).toBe(now + 10_000)
  })

  it('shows a text suggestion without a configured chat session', () => {
    const h = harness()
    h.session(undefined)
    h.controller.observe('retail', state())
    expect(h.view()?.phase).toBe('choosing')
    expect(h.view()?.deadline).toBe(now + 10_000)
    expect(h.host.speak).not.toHaveBeenCalled()
  })

  it('waits for silence after speech failure before showing choices', async () => {
    const h = harness()
    h.controller.observe('retail', state())
    h.calls[0].done.reject(new Error('Speech failed'))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.calls[0].stop).toHaveBeenCalledTimes(1)
    expect(h.view()?.phase).toBe('speaking')
    await vi.advanceTimersByTimeAsync(1000)
    h.calls[0].silence.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.view()?.phase).toBe('choosing')
    expect(h.view()?.deadline).toBe(now + 11_000)
  })

  it('bounds synthesis wait to two minutes and cancels only its owned audio', async () => {
    const h = harness()
    h.controller.observe('retail', state('retail', { until: now / 1000 + 180 }))
    await vi.advanceTimersByTimeAsync(119_999)
    expect(h.calls[0].stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.calls[0].stop).toHaveBeenCalledTimes(1)
    expect(h.view()?.phase).toBe('speaking')
    h.calls[0].silence.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.view()?.phase).toBe('choosing')
    await vi.advanceTimersByTimeAsync(5000)
    h.calls[0].done.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.view()?.deadline).toBe(now + 130_000)
  })

  it('closes an audio cancellation that never confirms silence', async () => {
    const h = harness()
    h.controller.observe('retail', state())
    await vi.advanceTimersByTimeAsync(115_000)
    expect(h.view()).toBeNull()
    expect(h.calls[0].stop).toHaveBeenCalledTimes(1)
  })

  it('closes the suggestion when audio cannot confirm silence', async () => {
    const h = harness()
    h.controller.observe('retail', state())
    h.calls[0].done.reject(new Error('Speech failed'))
    await vi.advanceTimersByTimeAsync(0)
    h.calls[0].silence.reject(new Error('Device failed'))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.view()).toBeNull()
  })

  it('waits through a long existing chat and starts only after it becomes idle', async () => {
    const h = harness()
    h.busy(true)
    h.controller.observe('retail', state())
    await vi.advanceTimersByTimeAsync(8000)
    expect(h.host.speak).not.toHaveBeenCalled()
    h.busy(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(h.host.speak).toHaveBeenCalledTimes(1)
    expect(h.view()?.phase).toBe('speaking')
  })

  it('drops expired waiting offers without speaking after the chat ends', async () => {
    const h = harness()
    h.busy(true)
    h.controller.observe('retail', state('retail', { until: now / 1000 + 12 }))
    await vi.advanceTimersByTimeAsync(13_000)
    h.busy(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(h.host.speak).not.toHaveBeenCalled()
    expect(h.view()).toBeNull()
  })

  it('does not start audio without at least ten seconds for a choice', () => {
    const h = harness()
    h.controller.observe('retail', state('retail', { until: now / 1000 + 9 }))
    expect(h.host.speak).not.toHaveBeenCalled()
    expect(h.view()).toBeNull()
  })

  it('keeps only the latest waiting offer', async () => {
    const h = harness()
    h.busy(true)
    h.controller.observe('retail', state())
    h.controller.observe('retail', state('retail', { id: 2, q: 2, n: 'Latest robe' }))
    h.busy(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(h.view()?.text).toContain('Latest robe')
    expect(h.host.speak).toHaveBeenCalledTimes(1)
  })

  it('allows a closed offer to reopen only when it was never presented', () => {
    const h = harness()
    h.controller.observe('retail', state('retail', { st: 'closed' }))
    expect(h.host.speak).not.toHaveBeenCalled()
    h.controller.observe('retail', state('retail', { q: 2 }))
    expect(h.host.speak).toHaveBeenCalledTimes(1)
  })

  it('does not repeat a presented offer when combat closes and reopens it', async () => {
    const h = harness()
    h.controller.observe('retail', state())
    const combat = state('retail', { q: 2, st: 'closed' })
    combat.bridge!.snapshot!.combat = true
    h.controller.observe('retail', combat)
    await vi.advanceTimersByTimeAsync(0)
    h.calls[0].silence.resolve()
    await vi.advanceTimersByTimeAsync(0)
    h.controller.observe('retail', state('retail', { q: 3 }))
    expect(h.host.speak).toHaveBeenCalledTimes(1)
    expect(h.view()).toBeNull()
  })

  it.each<Partial<BridgeStatus>>([
    { status: 'stale' },
    { status: 'demo' },
    { source: 'demo' },
    { status: 'paused' },
    { error: 'capture failed' },
    { equipmentOfferError: 'invalid offer' },
    { equipmentOffer: null },
  ])('rejects unavailable bridge state %j', (overrides) => {
    const h = harness()
    const profile = state()
    Object.assign(profile.bridge!, overrides)
    h.controller.observe('retail', profile)
    expect(h.view()).toBeNull()
    expect(h.host.speak).not.toHaveBeenCalled()
  })

  it.each(['combat', 'dead', 'offline', 'wrong-session', 'wrong-character', 'disabled', 'state-error'] as const)('rejects %s observations', (condition) => {
    const h = harness()
    const profile = state()
    const snapshot = profile.bridge!.snapshot!
    if (condition === 'combat')
      snapshot.combat = true
    if (condition === 'dead')
      snapshot.dead = true
    if (condition === 'offline')
      snapshot.online = false
    if (condition === 'wrong-session')
      snapshot.session = 'other'
    if (condition === 'wrong-character')
      snapshot.guid = 'Player-2'
    if (condition === 'disabled')
      profile.settings.enabled = false
    if (condition === 'state-error')
      profile.error = 'unavailable'
    h.controller.observe('retail', profile)
    expect(h.view()).toBeNull()
    expect(h.host.speak).not.toHaveBeenCalled()
  })

  it.each(['disconnect', 'stop', 'session', 'other-chat'] as const)('cancels owned audio on %s and ignores its late completion', async (reason) => {
    const h = harness()
    h.controller.observe('retail', state())
    if (reason === 'disconnect')
      h.controller.unavailable('retail')
    if (reason === 'stop')
      h.controller.stop()
    if (reason === 'session')
      h.session('another-chat')
    if (reason === 'other-chat')
      h.busy(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(h.view()).toBeNull()
    expect(h.calls[0].stop).toHaveBeenCalledTimes(1)
    h.calls[0].done.resolve()
    h.calls[0].silence.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.view()).toBeNull()
  })

  it('waits for old audio cancellation before starting a replacement offer', async () => {
    const h = harness()
    h.controller.observe('retail', state())
    h.controller.observe('retail', state('retail', { id: 2, q: 2, n: 'Another robe' }))
    await vi.advanceTimersByTimeAsync(100)
    expect(h.calls[0].stop).toHaveBeenCalledTimes(1)
    expect(h.host.speak).toHaveBeenCalledTimes(1)
    h.calls[0].silence.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.host.speak).toHaveBeenCalledTimes(2)
    expect(h.view()?.text).toContain('Another robe')
    h.calls[0].done.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.view()?.phase).toBe('speaking')
  })

  it('does not overlap another offer while cancelled speech still drains', async () => {
    const h = harness()
    h.controller.observe('retail', state())
    h.calls[0].done.reject(new Error('Speech failed'))
    await vi.advanceTimersByTimeAsync(0)
    h.controller.observe('retail', state('retail', { id: 2, q: 2 }))
    await vi.advanceTimersByTimeAsync(100)
    expect(h.host.speak).toHaveBeenCalledTimes(1)
    h.calls[0].silence.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.host.speak).toHaveBeenCalledTimes(2)
  })

  it('switches mid-speech mute to text only after the owned audio stops', async () => {
    const h = harness()
    h.controller.observe('retail', state())
    h.muted(true)
    await vi.advanceTimersByTimeAsync(100)
    expect(h.calls[0].stop).toHaveBeenCalledTimes(1)
    expect(h.view()?.phase).toBe('speaking')
    h.calls[0].silence.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.view()?.phase).toBe('choosing')
  })

  it('keeps game profiles separate while presenting one suggestion at a time', async () => {
    const h = harness()
    h.muted(true)
    h.controller.observe('retail', state())
    const firstId = h.view()!.id
    h.controller.observe('forever', state('forever'))
    expect(h.view()?.id).toBe(firstId)
    h.controller.choose(firstId, 'decline')
    await vi.advanceTimersByTimeAsync(100)
    expect(h.view()?.id).not.toBe(firstId)
    expect(h.view()?.id).toContain('forever')
  })
})
