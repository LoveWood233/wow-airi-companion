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
      inventory: null,
      inventoryReceivedAt: null,
      inventoryError: null,
      quests: null,
      questsReceivedAt: null,
      questsError: null,
      talents: null,
      talentsReceivedAt: null,
      talentsError: null,
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
    review: vi.fn(comparison => `Acquired ${comparison.candidate.name}. Compare it manually before changing equipment.`),
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

function reviewState(): CompanionState {
  const profile = state()
  const bridge = profile.bridge!
  bridge.equipmentOffer = null
  const comparison = bridge.equipmentComparisons[0]
  comparison.observedAt = now / 1000
  comparison.specMatch = null
  comparison.assessment = { verdict: 'review', reason: 'unknown_spec' }
  comparison.slot = 12
  Object.assign(comparison.current!, { itemID: 232349, name: 'Old ring', itemLevel: 10, equipLoc: 'INVTYPE_FINGER', complex: true, stats: [{ key: 'ITEM_MOD_CRIT_RATING_SHORT', value: 5 }, { key: 'ITEM_MOD_STAMINA_SHORT', value: 2 }, { key: 'ITEM_MOD_VERSATILITY', value: 2 }] })
  Object.assign(comparison.candidate, { itemID: 143902, name: 'New ring', itemLevel: 19, equipLoc: 'INVTYPE_FINGER', complex: true, stats: [{ key: 'ITEM_MOD_HASTE_RATING_SHORT', value: 11 }, { key: 'ITEM_MOD_STAMINA_SHORT', value: 5 }, { key: 'ITEM_MOD_VERSATILITY', value: 6 }] })
  bridge.equipment = [{ v: 1, id: comparison.id, session: comparison.session, guid: comparison.guid, itemID: comparison.candidate.itemID, itemGUID: 'Item-1', link: 'item:143902', name: comparison.candidate.name, type: 'Armor', subtype: 'Miscellaneous', equipLoc: 'INVTYPE_FINGER', quality: 3, itemLevel: 19, requiredLevel: 11, stats: comparison.candidate.stats, tooltip: ['Unique-Equipped'], quantity: 1, observedAt: comparison.observedAt, source: 'bag_added', infoComplete: true, statsComplete: true, tooltipComplete: true, truncated: false }]
  return profile
}

describe('equipmentPromptController', () => {
  // ROOT CAUSE:
  // A captured ring with unknown spec fit had no game offer. The desktop silently discarded its review result.
  it('shows a review notice for an acquired higher-level ring without offering an unproven equipment change', () => {
    const h = harness()
    h.muted(true)
    h.controller.observe('retail', reviewState())

    expect(h.view()?.phase).toBe('review')
    expect(h.view()?.text).toContain('New ring')
    expect(h.host.message).not.toHaveBeenCalled()
    expect(h.view()?.phase).toBe('review')
  })

  it('speaks a review once and never changes it into an equipment choice', async () => {
    const h = harness()
    const profile = reviewState()
    h.controller.observe('retail', profile)
    expect(h.host.speak).toHaveBeenCalledTimes(1)
    expect(h.view()?.phase).toBe('speaking')
    h.calls[0].done.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.view()?.phase).toBe('review')
    h.controller.unavailable('retail')
    h.controller.observe('retail', profile)
    expect(h.view()).toBeNull()
    expect(h.host.speak).toHaveBeenCalledTimes(1)
  })

  it('does not let a newer review suppress an earlier game offer that arrives later', () => {
    const h = harness()
    h.muted(true)
    const profile = reviewState()
    profile.bridge!.equipmentComparisons[0].id = 2
    profile.bridge!.equipment![0].id = 2
    h.controller.observe('retail', profile)
    expect(h.view()?.phase).toBe('review')

    h.controller.observe('retail', state())
    expect(h.view()?.phase).toBe('notice')
    expect(h.host.message).toHaveBeenCalledTimes(1)
  })

  it('gives a delayed game offer priority while its newer review remains in live history', async () => {
    const h = harness()
    const profile = reviewState()
    profile.bridge!.equipmentComparisons[0].id = 2
    profile.bridge!.equipment![0].id = 2
    h.controller.observe('retail', profile)
    const offered = state()
    profile.bridge!.equipmentOffer = offered.bridge!.equipmentOffer
    profile.bridge!.equipmentComparisons.unshift(offered.bridge!.equipmentComparisons[0])
    h.controller.observe('retail', profile)

    await vi.advanceTimersByTimeAsync(0)
    expect(h.calls[0].stop).toHaveBeenCalledTimes(1)
    expect(h.host.message).not.toHaveBeenCalled()
    h.calls[0].silence.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.host.message).toHaveBeenCalledTimes(1)
    expect(h.host.speak).toHaveBeenCalledTimes(2)
  })

  it.each(['missing-acquisition', 'wrong-acquisition', 'old-session', 'wrong-player', 'wrong-spec', 'unusable', 'lower-level', 'expired', 'future', 'stale', 'paused', 'comparison-error'] as const)('does not announce an invalid or irrelevant review: %s', (condition) => {
    const h = harness()
    const profile = reviewState()
    const bridge = profile.bridge!
    const comparison = bridge.equipmentComparisons[0]
    if (condition === 'missing-acquisition')
      bridge.equipment = []
    if (condition === 'wrong-acquisition')
      bridge.equipment![0].itemID++
    if (condition === 'old-session')
      comparison.session = 'earlier-login'
    if (condition === 'wrong-player')
      vi.mocked(h.host.currentPlayer).mockReturnValue(false)
    if (condition === 'wrong-spec')
      comparison.assessment = { verdict: 'not_upgrade', reason: 'wrong_spec' }
    if (condition === 'unusable')
      comparison.assessment = { verdict: 'not_upgrade', reason: 'unusable' }
    if (condition === 'lower-level')
      comparison.candidate.itemLevel = 9
    if (condition === 'expired')
      comparison.observedAt -= 181
    if (condition === 'future')
      comparison.observedAt += 6
    if (condition === 'stale')
      bridge.status = 'stale'
    if (condition === 'paused')
      bridge.config.paused = true
    if (condition === 'comparison-error')
      bridge.equipmentComparisonError = 'Invalid comparison'
    h.controller.observe('retail', profile)
    expect(h.view()).toBeNull()
    expect(h.host.speak).not.toHaveBeenCalled()
  })

  it('waits through combat and existing chat before speaking a review', () => {
    const h = harness()
    const profile = reviewState()
    profile.bridge!.snapshot!.combat = true
    h.controller.observe('retail', profile)
    expect(h.view()).toBeNull()
    profile.bridge!.snapshot!.combat = false
    h.busy(true)
    h.controller.observe('retail', profile)
    expect(h.controller.hasPending).toBe(true)
    expect(h.host.speak).not.toHaveBeenCalled()
    h.busy(false)
    h.controller.observe('retail', profile)
    expect(h.host.speak).toHaveBeenCalledTimes(1)
  })

  it('cancels a review when its character stops being current', async () => {
    const h = harness()
    h.controller.observe('retail', reviewState())
    vi.mocked(h.host.currentPlayer).mockReturnValue(false)
    h.controller.unavailable('forever')
    expect(h.view()).toBeNull()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.calls[0].stop).toHaveBeenCalledTimes(1)
    h.calls[0].silence.resolve()
  })
  it('rejects an older player and cancels its prompt before another profile can update', () => {
    const h = harness()
    h.muted(true)
    vi.mocked(h.host.currentPlayer).mockReturnValue(false)
    h.controller.observe('retail', state())
    expect(h.view()).toBeNull()
    expect(h.host.speak).not.toHaveBeenCalled()

    vi.mocked(h.host.currentPlayer).mockReturnValue(true)
    h.controller.observe('retail', state())
    expect(h.view()?.phase).toBe('notice')

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
      comparison.assessment = { verdict: 'not_upgrade', reason: 'wrong_spec' }
    if (condition === 'tradeoff')
      comparison.assessment = { verdict: 'review', reason: 'stat_tradeoff' }
    if (condition === 'complex')
      comparison.assessment = { verdict: 'review', reason: 'complex_item' }
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
    expect(h.view()?.phase).toBe('notice')
    profile.bridge!.snapshot!.spec = 63
    h.controller.observe('retail', profile)
    expect(h.view()).toBeNull()
  })

  it('asks about a supported secondary trade-off without relabeling it as a clear upgrade', () => {
    const h = harness()
    h.muted(true)
    const profile = state()
    const comparison = profile.bridge!.equipmentComparisons[0]
    comparison.assessment = { verdict: 'review', reason: 'primary_upgrade_tradeoff' }
    comparison.current!.stats.push({ key: 'ITEM_MOD_MASTERY_RATING_SHORT', value: 37 })
    comparison.candidate.stats.push({ key: 'ITEM_MOD_MASTERY_RATING_SHORT', value: 30 })
    h.controller.observe('retail', profile)
    expect(h.view()?.phase).toBe('notice')
    expect(h.host.message).toHaveBeenCalledWith(profile.bridge!.equipmentOffer, comparison)
  })
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })
  afterEach(() => vi.useRealTimers())

  it('waits for owned speech completion before starting the three-second subtitle interval', async () => {
    const h = harness()
    h.controller.observe('retail', state())
    expect(h.view()?.phase).toBe('speaking')
    expect(h.view()?.deadline).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.view()?.phase).toBe('speaking')
    h.calls[0].done.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.view()?.phase).toBe('notice')
    expect(h.view()?.deadline).toBe(now + 5000)
    await vi.advanceTimersByTimeAsync(2999)
    expect(h.view()?.phase).toBe('notice')
    await vi.advanceTimersByTimeAsync(1)
    expect(h.view()).toBeNull()
  })

  it('shows no desktop choice and does not replay the notice after its subtitle expires', async () => {
    const h = harness()
    h.muted(true)
    h.controller.observe('retail', state())
    expect(h.view()?.phase).toBe('notice')
    expect(h.view()?.deadline).toBe(now + 3000)
    expect(h.host.speak).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.view()).toBeNull()
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
    expect(h.view()?.phase).toBe('notice')
    expect(h.view()?.text).toContain('New robe')
    expect(h.host.speak).not.toHaveBeenCalled()
  })

  it('falls back to text when speech setup is unavailable', () => {
    const h = harness()
    h.host.speak = vi.fn(() => {
      throw new Error('No speech provider')
    })
    h.controller.observe('retail', state())
    expect(h.view()?.phase).toBe('notice')
    expect(h.view()?.deadline).toBe(now + 3000)
  })

  it('shows a text suggestion without a configured chat session', () => {
    const h = harness()
    h.session(undefined)
    h.controller.observe('retail', state())
    expect(h.view()?.phase).toBe('notice')
    expect(h.view()?.deadline).toBe(now + 3000)
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
    expect(h.view()?.phase).toBe('notice')
    expect(h.view()?.deadline).toBe(now + 4000)
  })

  it('bounds synthesis wait to two minutes and cancels only its owned audio', async () => {
    const h = harness()
    const profile = state('retail', { until: now / 1000 + 180 })
    h.controller.observe('retail', profile)
    const heartbeat = setInterval(() => {
      profile.bridge!.lastSeen = new Date(Date.now()).toISOString()
      h.controller.observe('retail', profile)
    }, 1000)
    await vi.advanceTimersByTimeAsync(119_999)
    expect(h.calls[0].stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.calls[0].stop).toHaveBeenCalledTimes(1)
    expect(h.view()?.phase).toBe('speaking')
    h.calls[0].silence.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.view()?.phase).toBe('notice')
    await vi.advanceTimersByTimeAsync(2000)
    h.calls[0].done.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.view()?.deadline).toBe(now + 123_000)
    clearInterval(heartbeat)
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
    const profile = state()
    h.controller.observe('retail', profile)
    await vi.advanceTimersByTimeAsync(8000)
    expect(h.host.speak).not.toHaveBeenCalled()
    h.busy(false)
    profile.bridge!.lastSeen = new Date(Date.now()).toISOString()
    h.controller.observe('retail', profile)
    await vi.advanceTimersByTimeAsync(100)
    expect(h.host.speak).toHaveBeenCalledTimes(1)
    expect(h.view()?.phase).toBe('speaking')
  })

  it('cancels a live-labelled offer when its heartbeat stops during speech', async () => {
    const h = harness()
    h.controller.observe('retail', state())
    await vi.advanceTimersByTimeAsync(5100)
    expect(h.view()).toBeNull()
    expect(h.calls[0].stop).toHaveBeenCalledTimes(1)
    h.calls[0].silence.resolve()
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
    expect(h.view()?.phase).toBe('notice')
  })

  it('keeps game profiles separate while presenting one suggestion at a time', async () => {
    const h = harness()
    h.muted(true)
    h.controller.observe('retail', state())
    const firstId = h.view()!.id
    h.controller.observe('forever', state('forever'))
    expect(h.view()?.id).toBe(firstId)
    await vi.advanceTimersByTimeAsync(3100)
    expect(h.view()?.id).not.toBe(firstId)
    expect(h.view()?.id).toContain('forever')
  })
})
