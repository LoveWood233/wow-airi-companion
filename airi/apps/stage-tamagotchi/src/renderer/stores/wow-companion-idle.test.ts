import type { CompanionState } from '../../shared/wow-companion'
import type { IdleEligibility } from './wow-companion-idle'

import { describe, expect, it } from 'vitest'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { CompanionIdlePolicy } from './wow-companion-idle'

const startedAt = Date.parse('2026-10-26T10:00:00Z')
const ready: IdleEligibility = { eligible: true, busy: false }

function observe(policy: CompanionIdlePolicy, state: CompanionState, elapsed: number, eligibility = ready) {
  state.bridge!.lastSeen = new Date(startedAt + elapsed).toISOString()
  state.bridge!.ageSeconds = 0
  return policy.observe(state, startedAt + elapsed, eligibility)
}

function continueUntil(policy: CompanionIdlePolicy, state: CompanionState, from: number, until: number, eligibility = ready) {
  const interactions = []
  for (let elapsed = from; elapsed <= until; elapsed += 1000) {
    const snapshot = observe(policy, state, elapsed, eligibility)
    if (snapshot)
      interactions.push(snapshot)
  }
  return interactions
}

describe('noncombat companion interaction schedule', () => {
  it('waits one continuous minute and emits one interaction per interval', () => {
    const policy = new CompanionIdlePolicy()
    const state = loadoutStateFixture()
    expect(continueUntil(policy, state, 0, 59_000)).toEqual([])
    expect(observe(policy, state, 59_999)).toBeUndefined()
    expect(observe(policy, state, 60_000)).toBe(state.bridge!.snapshot)
    expect(observe(policy, state, 60_000)).toBeUndefined()
    expect(continueUntil(policy, state, 61_000, 119_000)).toEqual([])
    expect(observe(policy, state, 120_000)).toBe(state.bridge!.snapshot)
  })

  it('defers one due opportunity through chat or equipment speech without creating a backlog', () => {
    const policy = new CompanionIdlePolicy()
    const state = loadoutStateFixture()
    expect(continueUntil(policy, state, 0, 180_000, { eligible: true, busy: true })).toEqual([])
    expect(observe(policy, state, 181_000)).toBe(state.bridge!.snapshot)
    expect(continueUntil(policy, state, 182_000, 240_000)).toEqual([])
    expect(observe(policy, state, 241_000)).toBe(state.bridge!.snapshot)
  })

  it('starts a new interval after combat even when event combat quiet mode is disabled', () => {
    const policy = new CompanionIdlePolicy()
    const state = loadoutStateFixture()
    state.settings.quietInCombat = false
    continueUntil(policy, state, 0, 59_000)
    state.bridge!.snapshot!.combat = true
    expect(observe(policy, state, 59_500)).toBeUndefined()
    state.bridge!.snapshot!.combat = false
    expect(continueUntil(policy, state, 60_000, 119_000)).toEqual([])
    expect(observe(policy, state, 120_000)).toBe(state.bridge!.snapshot)
  })

  it.each([
    ['disabled', (state: CompanionState) => { state.settings.enabled = false }],
    ['muted', (state: CompanionState) => { state.settings.muted = true }],
    ['offline', (state: CompanionState) => { state.bridge!.snapshot!.online = false }],
    ['dead', (state: CompanionState) => { state.bridge!.snapshot!.dead = true }],
    ['stale', (state: CompanionState) => { state.bridge!.status = 'stale' }],
    ['paused', (state: CompanionState) => { state.bridge!.config.paused = true }],
    ['demo', (state: CompanionState) => { state.bridge!.source = 'demo' }],
    ['profile error', (state: CompanionState) => { state.error = 'Bridge unavailable' }],
    ['capture error', (state: CompanionState) => { state.bridge!.error = 'Capture unavailable' }],
    ['missing snapshot', (state: CompanionState) => { state.bridge!.snapshot = null }],
    ['missing bridge', (state: CompanionState) => { state.bridge = null }],
  ] as const)('resets a pending interval when the observation becomes %s', (_condition, invalidate) => {
    const policy = new CompanionIdlePolicy()
    const state = loadoutStateFixture()
    continueUntil(policy, state, 0, 59_000)
    invalidate(state)
    expect(policy.observe(state, startedAt + 59_500, ready)).toBeUndefined()
    const restored = loadoutStateFixture()
    expect(continueUntil(policy, restored, 60_000, 119_000)).toEqual([])
    expect(observe(policy, restored, 120_000)).toBe(restored.bridge!.snapshot)
  })

  it('resets on host ineligibility instead of speaking immediately after unmute or character restoration', () => {
    const policy = new CompanionIdlePolicy()
    const state = loadoutStateFixture()
    continueUntil(policy, state, 0, 59_000)
    expect(observe(policy, state, 59_500, { eligible: false, busy: false })).toBeUndefined()
    expect(continueUntil(policy, state, 60_000, 119_000)).toEqual([])
    expect(observe(policy, state, 120_000)).toBe(state.bridge!.snapshot)
  })

  it.each([
    ['game version', (state: CompanionState) => { state.game = 'forever' }],
    ['bridge instance', (state: CompanionState) => { state.bridge!.instanceId = 'another-bridge' }],
    ['account', (state: CompanionState) => { state.bridge!.snapshot!.account = 'another-account' }],
    ['character', (state: CompanionState) => { state.bridge!.snapshot!.guid = 'Player-other' }],
    ['login session', (state: CompanionState) => { state.bridge!.snapshot!.session = 'another-login' }],
  ] as const)('isolates the interval after a change of %s', (_condition, changeIdentity) => {
    const policy = new CompanionIdlePolicy()
    const state = loadoutStateFixture()
    continueUntil(policy, state, 0, 59_000)
    changeIdentity(state)
    expect(continueUntil(policy, state, 60_000, 119_000)).toEqual([])
    expect(observe(policy, state, 120_000)).toBe(state.bridge!.snapshot)
  })

  it('discards overdue intervals after a suspended polling loop', () => {
    const policy = new CompanionIdlePolicy()
    const state = loadoutStateFixture()
    continueUntil(policy, state, 0, 59_000)
    expect(continueUntil(policy, state, 3_600_000, 3_659_000)).toEqual([])
    expect(observe(policy, state, 3_660_000)).toBe(state.bridge!.snapshot)
  })

  it('starts a new interval after a backward clock change', () => {
    const policy = new CompanionIdlePolicy()
    const state = loadoutStateFixture()
    continueUntil(policy, state, 0, 59_000)
    expect(continueUntil(policy, state, 50_000, 109_000)).toEqual([])
    expect(observe(policy, state, 110_000)).toBe(state.bridge!.snapshot)
  })

  it.each([
    ['old heartbeat', (state: CompanionState) => { state.bridge!.lastSeen = new Date(startedAt - 5001).toISOString() }],
    ['future heartbeat', (state: CompanionState) => { state.bridge!.lastSeen = new Date(startedAt + 5001).toISOString() }],
    ['missing heartbeat', (state: CompanionState) => { state.bridge!.lastSeen = null }],
    ['invalid heartbeat', (state: CompanionState) => { state.bridge!.lastSeen = 'invalid' }],
    ['old capture', (state: CompanionState) => { state.bridge!.ageSeconds = 5.001 }],
    ['negative capture age', (state: CompanionState) => { state.bridge!.ageSeconds = -1 }],
    ['missing capture age', (state: CompanionState) => { state.bridge!.ageSeconds = null }],
  ] as const)('does not trust a live label with %s', (_condition, invalidate) => {
    const policy = new CompanionIdlePolicy()
    const state = loadoutStateFixture()
    invalidate(state)
    expect(policy.observe(state, startedAt, ready)).toBeUndefined()
    expect(continueUntil(policy, state, 1000, 60_000)).toEqual([])
    expect(observe(policy, state, 61_000)).toBe(state.bridge!.snapshot)
  })

  it('releases its interval when the desktop owner stops', () => {
    const policy = new CompanionIdlePolicy()
    const state = loadoutStateFixture()
    continueUntil(policy, state, 0, 59_000)
    policy.reset()
    expect(continueUntil(policy, state, 60_000, 119_000)).toEqual([])
    expect(observe(policy, state, 120_000)).toBe(state.bridge!.snapshot)
  })
})
