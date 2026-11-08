import type { CompanionState } from '../../shared/wow-companion'
import type { IdleEligibility } from './wow-companion-idle'

import { describe, expect, it } from 'vitest'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { isSameLocation, LocationPolicy } from './wow-companion-location-policy'

const startedAt = Date.parse('2026-10-29T10:00:00Z')
const ready: IdleEligibility = { eligible: true, busy: false }

function observe(policy: LocationPolicy, state: CompanionState, elapsed: number, eligibility = ready) {
  state.bridge!.lastSeen = new Date(startedAt + elapsed).toISOString()
  state.bridge!.ageSeconds = 0
  return policy.observe(state, startedAt + elapsed, eligibility)
}

function continueUntil(policy: LocationPolicy, state: CompanionState, from: number, until: number, eligibility = ready) {
  const results = []
  for (let elapsed = from; elapsed <= until; elapsed += 1000) {
    const result = observe(policy, state, elapsed, eligibility)
    if (result)
      results.push(result)
  }
  return results
}

describe('location arrival policy', () => {
  it('starts with a baseline and consumes one arrival only after three stable seconds', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    expect(observe(policy, state, 0)).toBeUndefined()
    expect(policy.hasPending).toBe(false)
    state.bridge!.snapshot!.map = 37
    expect(observe(policy, state, 1000)).toBeUndefined()
    expect(policy.hasPending).toBe(true)
    expect(observe(policy, state, 3999)).toBeUndefined()
    expect(observe(policy, state, 4000)).toBe(state.bridge!.snapshot)
    expect(policy.hasPending).toBe(false)
    expect(continueUntil(policy, state, 5000, 120_000)).toEqual([])
  })

  it('keeps only the final destination when several maps arrive before the delay', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    state.bridge!.snapshot!.map = 37
    observe(policy, state, 1000)
    state.bridge!.snapshot!.map = 52
    observe(policy, state, 2500)
    expect(observe(policy, state, 4000)).toBeUndefined()
    expect(observe(policy, state, 5500)?.map).toBe(52)
    expect(policy.hasPending).toBe(false)
  })

  it('ignores subzone names and changing coordinates on one map', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    Object.assign(state.bridge!.snapshot!, { zone: 'Trade District', px: 1250, py: 1500 })
    expect(continueUntil(policy, state, 1000, 60_000)).toEqual([])
    expect(policy.hasPending).toBe(false)
  })

  it('does not treat unknown maps as arrivals and resumes stability after loading', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    state.bridge!.snapshot!.map = 0
    observe(policy, state, 1000)
    state.bridge!.snapshot!.map = 84
    expect(observe(policy, state, 2000)).toBeUndefined()
    expect(policy.hasPending).toBe(false)
    state.bridge!.snapshot!.map = 37
    observe(policy, state, 3000)
    state.bridge!.snapshot!.map = 0
    observe(policy, state, 4000)
    state.bridge!.snapshot!.map = 37
    expect(observe(policy, state, 8000)).toBeUndefined()
    expect(observe(policy, state, 10_999)).toBeUndefined()
    expect(observe(policy, state, 11_000)?.map).toBe(37)
  })

  it.each(['party', 'raid', 'pvp', 'arena', 'scenario'] as const)('treats %s instance entry as one arrival across its floors', (instanceType) => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    Object.assign(state.bridge!.snapshot!, { instanceType: 'none', instanceID: null })
    observe(policy, state, 0)
    Object.assign(state.bridge!.snapshot!, { map: 90, instanceType, instanceID: 123 })
    observe(policy, state, 1000)
    Object.assign(state.bridge!.snapshot!, { map: 91, zone: 'Upper floor' })
    expect(observe(policy, state, 4000)).toBe(state.bridge!.snapshot)
    state.bridge!.snapshot!.map = 92
    expect(continueUntil(policy, state, 5000, 65_000)).toEqual([])
  })

  it('does not announce instance metadata discovery or loss on the same map', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    Object.assign(state.bridge!.snapshot!, { instanceType: 'party', instanceID: 123 })
    expect(continueUntil(policy, state, 1000, 5000)).toEqual([])
    Object.assign(state.bridge!.snapshot!, { instanceType: 'unknown', instanceID: null })
    expect(continueUntil(policy, state, 6000, 10_000)).toEqual([])
    Object.assign(state.bridge!.snapshot!, { instanceType: 'party', instanceID: 123 })
    expect(continueUntil(policy, state, 11_000, 15_000)).toEqual([])
    expect(policy.hasPending).toBe(false)
  })

  it('detects a known world-to-instance transition even when its map stays the same', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    Object.assign(state.bridge!.snapshot!, { instanceType: 'none', instanceID: null })
    observe(policy, state, 0)
    Object.assign(state.bridge!.snapshot!, { instanceType: 'pvp', instanceID: 489 })
    observe(policy, state, 1000)
    expect(observe(policy, state, 4000)?.instanceType).toBe('pvp')
  })

  it('retains the latest destination through combat regardless of combat quiet preference', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    state.settings.quietInCombat = false
    observe(policy, state, 0)
    Object.assign(state.bridge!.snapshot!, { map: 37, combat: true })
    expect(continueUntil(policy, state, 1000, 20_000)).toEqual([])
    state.bridge!.snapshot!.map = 52
    expect(continueUntil(policy, state, 21_000, 30_000)).toEqual([])
    state.bridge!.snapshot!.combat = false
    expect(observe(policy, state, 31_000)?.map).toBe(52)
    expect(policy.hasPending).toBe(false)
  })

  it('waits for revival without letting an arrival interrupt death handling', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    Object.assign(state.bridge!.snapshot!, { map: 37, dead: true })
    expect(continueUntil(policy, state, 1000, 10_000)).toEqual([])
    state.bridge!.snapshot!.dead = false
    expect(observe(policy, state, 11_000)?.map).toBe(37)
  })

  it('retains one arrival while the host is busy and expires it after two minutes', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    state.bridge!.snapshot!.map = 37
    expect(continueUntil(policy, state, 1000, 121_000, { eligible: true, busy: true })).toEqual([])
    expect(policy.hasPending).toBe(false)
    expect(observe(policy, state, 122_000)).toBeUndefined()
    state.bridge!.snapshot!.map = 52
    expect(continueUntil(policy, state, 123_000, 130_000, { eligible: true, busy: true })).toEqual([])
    expect(observe(policy, state, 131_000)?.map).toBe(52)
  })

  it('applies a one-minute cooldown and does not repeat a destination within ten minutes', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    state.bridge!.snapshot!.map = 37
    observe(policy, state, 1000)
    expect(observe(policy, state, 4000)?.map).toBe(37)
    state.bridge!.snapshot!.map = 52
    expect(continueUntil(policy, state, 5000, 63_000)).toEqual([])
    expect(observe(policy, state, 64_000)?.map).toBe(52)
    state.bridge!.snapshot!.map = 37
    expect(continueUntil(policy, state, 65_000, 605_000)).toEqual([])
    expect(policy.hasPending).toBe(false)
    state.bridge!.snapshot!.map = 84
    observe(policy, state, 606_000, { eligible: true, busy: true })
    state.bridge!.snapshot!.map = 37
    observe(policy, state, 607_000)
    expect(observe(policy, state, 610_000)?.map).toBe(37)
  })

  it.each([
    ['disabled', (state: CompanionState) => { state.settings.enabled = false }],
    ['muted', (state: CompanionState) => { state.settings.muted = true }],
    ['region notifications disabled', (state: CompanionState) => { state.settings.zone = false }],
    ['offline', (state: CompanionState) => { state.bridge!.snapshot!.online = false }],
    ['stale', (state: CompanionState) => { state.bridge!.status = 'stale' }],
    ['paused', (state: CompanionState) => { state.bridge!.config.paused = true }],
    ['demo', (state: CompanionState) => { state.bridge!.source = 'demo' }],
    ['state error', (state: CompanionState) => { state.error = 'Unavailable' }],
    ['bridge error', (state: CompanionState) => { state.bridge!.error = 'Unavailable' }],
    ['snapshot missing', (state: CompanionState) => { state.bridge!.snapshot = null }],
  ] as const)('clears pending work when %s', (_label, invalidate) => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    state.bridge!.snapshot!.map = 37
    observe(policy, state, 1000)
    invalidate(state)
    expect(observe(policy, state, 2000)).toBeUndefined()
    expect(policy.hasPending).toBe(false)
    expect(observe(policy, loadoutStateFixture(), 3000)).toBeUndefined()
  })

  it.each([
    ['game', (state: CompanionState) => { state.game = 'forever' }],
    ['bridge', (state: CompanionState) => { state.bridge!.instanceId = 'other-bridge' }],
    ['account', (state: CompanionState) => { state.bridge!.snapshot!.account = 'other-account' }],
    ['character', (state: CompanionState) => { state.bridge!.snapshot!.guid = 'Player-other' }],
    ['login', (state: CompanionState) => { state.bridge!.snapshot!.session = 'other-session' }],
  ] as const)('establishes a baseline after the %s identity changes', (_label, changeIdentity) => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    state.bridge!.snapshot!.map = 37
    observe(policy, state, 1000)
    changeIdentity(state)
    expect(observe(policy, state, 4000)).toBeUndefined()
    expect(policy.hasPending).toBe(false)
  })

  it('resets after host ineligibility, suspended polling, or backward clock changes', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    state.bridge!.snapshot!.map = 37
    observe(policy, state, 1000)
    expect(observe(policy, state, 2000, { eligible: false, busy: false })).toBeUndefined()
    expect(policy.hasPending).toBe(false)
    observe(policy, state, 3000)
    state.bridge!.snapshot!.map = 52
    observe(policy, state, 4000)
    expect(observe(policy, state, 125_000)).toBeUndefined()
    expect(policy.hasPending).toBe(false)
    state.bridge!.snapshot!.map = 37
    observe(policy, state, 126_000)
    expect(observe(policy, state, 124_000)).toBeUndefined()
    expect(policy.hasPending).toBe(false)
  })

  it.each(['offline', 'stale', 'waiting'] as const)('preserves a baseline across a short %s loading gap', (gap) => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    if (gap === 'offline')
      state.bridge!.snapshot!.online = false
    else
      state.bridge!.status = gap
    expect(observe(policy, state, 1000)).toBeUndefined()
    expect(policy.hasPending).toBe(false)
    state.bridge!.status = 'live'
    Object.assign(state.bridge!.snapshot!, { online: true, map: 37, instanceType: 'party', instanceID: 123 })
    expect(observe(policy, state, 45_000)).toBeUndefined()
    expect(policy.hasPending).toBe(true)
    expect(observe(policy, state, 48_000)?.instanceID).toBe(123)
  })

  it('discards a pending arrival across loading without reviving an old queued speech', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    state.bridge!.snapshot!.map = 37
    observe(policy, state, 1000)
    state.bridge!.snapshot!.online = false
    expect(observe(policy, state, 2000)).toBeUndefined()
    expect(policy.hasPending).toBe(false)
    state.bridge!.snapshot!.online = true
    expect(continueUntil(policy, state, 3000, 10_000)).toEqual([])
    state.bridge!.snapshot!.map = 52
    observe(policy, state, 11_000)
    expect(observe(policy, state, 14_000)?.map).toBe(52)
  })

  it('uses only a baseline after a long offline interval or a new login during loading', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    state.bridge!.snapshot!.online = false
    observe(policy, state, 1000)
    Object.assign(state.bridge!.snapshot!, { online: true, map: 37 })
    expect(observe(policy, state, 121_000)).toBeUndefined()
    expect(policy.hasPending).toBe(false)
    state.bridge!.snapshot!.online = false
    observe(policy, state, 122_000)
    Object.assign(state.bridge!.snapshot!, { online: true, map: 52, session: 'new-login' })
    expect(observe(policy, state, 123_000)).toBeUndefined()
    expect(policy.hasPending).toBe(false)
  })

  it('rejects stale wall-clock observations even when the bridge claims zero age', () => {
    const policy = new LocationPolicy()
    const state = loadoutStateFixture()
    observe(policy, state, 0)
    state.bridge!.snapshot!.map = 37
    observe(policy, state, 1000)
    expect(policy.observe(state, startedAt + 7000, ready)).toBeUndefined()
    expect(policy.hasPending).toBe(false)
  })

  it('compares canonical instance floors while treating unknown map observations as different', () => {
    const snapshot = loadoutStateFixture().bridge!.snapshot!
    const first = { ...snapshot, map: 90, instanceType: 'raid' as const, instanceID: 123 }
    const second = { ...first, map: 91 }
    expect(isSameLocation(first, second)).toBe(true)
    expect(isSameLocation(first, { ...second, instanceID: 456 })).toBe(false)
    expect(isSameLocation(snapshot, { ...snapshot, map: 0 })).toBe(false)
  })
})
