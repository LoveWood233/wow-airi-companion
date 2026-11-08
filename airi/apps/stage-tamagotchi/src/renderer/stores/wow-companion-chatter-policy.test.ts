import { describe, expect, it } from 'vitest'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { ChatterCombatGate, normalizeChatterCombats, RegularChatterClock } from './wow-companion-chatter-policy'

const now = Date.parse('2026-11-02T04:00:00Z')

function state(completed = 0, loginId = 'login-1') {
  const result = loadoutStateFixture()
  result.bridge!.lastSeen = new Date(now).toISOString()
  result.bridge!.ageSeconds = 0
  Object.assign(result.bridge!.snapshot!, { loginId, combatEnds: completed })
  return result
}

describe('ordinary chatter combat progress', () => {
  it.each([[5, 5], [30, 30], [7.8, 8], [4, 5], [31, 5], [Number.NaN, 5], ['10', 5]])('normalizes requirement %s', (input, expected) => {
    expect(normalizeChatterCombats(input)).toBe(expected)
  })

  it('waits for real addon combat completions instead of counting polling or bridge reconnects', () => {
    const gate = new ChatterCombatGate()
    const current = state(4)
    for (let index = 0; index < 20; index++) {
      current.bridge!.instanceId = `reconnect-${index}`
      current.bridge!.snapshot!.seq++
      expect(gate.status(current, now, 5).ready).toBe(false)
      expect(gate.status(current, now, 5).completed).toBe(4)
    }
    current.bridge!.snapshot!.combatEnds = 5
    expect(gate.status(current, now, 5).ready).toBe(true)
  })

  it('consumes progress on delivery and preserves the checkpoint through a desktop restart', () => {
    const current = state(8)
    const gate = new ChatterCombatGate()
    expect(gate.status(current, now, 5).ready).toBe(true)
    expect(gate.consume(current.game, current.bridge!.snapshot!)).toBe(true)
    const restored = new ChatterCombatGate(gate.read())
    expect(restored.status(current, now, 5).completed).toBe(0)
    current.bridge!.snapshot!.combatEnds = 12
    expect(restored.status(current, now, 5).ready).toBe(false)
    current.bridge!.snapshot!.combatEnds = 13
    expect(restored.status(current, now, 5).ready).toBe(true)
  })

  it('keeps earned progress until a topic actually reaches the player', () => {
    const current = state(5)
    const gate = new ChatterCombatGate()
    expect(gate.status(current, now, 5).ready).toBe(true)
    expect(gate.status(current, now, 5).ready).toBe(true)
    expect(gate.read()).toEqual([])
  })

  it('resets for a real game login and keeps character and game scopes separate', () => {
    const current = state(5)
    const gate = new ChatterCombatGate()
    gate.consume(current.game, current.bridge!.snapshot!)
    const nextLogin = state(0, 'login-2')
    expect(gate.status(nextLogin, now, 5).completed).toBe(0)
    nextLogin.bridge!.snapshot!.combatEnds = 5
    expect(gate.status(nextLogin, now, 5).ready).toBe(true)
    const otherCharacter = state(5)
    otherCharacter.bridge!.snapshot!.guid = 'Player-other'
    expect(gate.status(otherCharacter, now, 5).ready).toBe(true)
    const otherGame = state(5)
    otherGame.game = 'forever'
    expect(gate.status(otherGame, now, 5).ready).toBe(true)
    expect(gate.status(current, now, 5).ready).toBe(false)
  })

  it('does not refund consumed combats when an older frame arrives', () => {
    const current = state(10)
    const gate = new ChatterCombatGate()
    gate.consume(current.game, current.bridge!.snapshot!)
    current.bridge!.snapshot!.combatEnds = 3
    expect(gate.status(current, now, 5).ready).toBe(false)
    expect(gate.consume(current.game, current.bridge!.snapshot!)).toBe(false)
    current.bridge!.snapshot!.combatEnds = 14
    expect(gate.status(current, now, 5).ready).toBe(false)
    current.bridge!.snapshot!.combatEnds = 15
    expect(gate.status(current, now, 5).ready).toBe(true)
  })

  it('requires fresh noncombat observations and explicit counter capability', () => {
    const current = state(10)
    const gate = new ChatterCombatGate()
    current.bridge!.snapshot!.combat = true
    expect(gate.status(current, now, 5).ready).toBe(false)
    current.bridge!.snapshot!.combat = false
    expect(gate.status(current, now + 60_000, 5).ready).toBe(false)
    delete current.bridge!.snapshot!.loginId
    expect(gate.status(current, now, 5).supported).toBe(false)
    delete current.bridge!.snapshot!.combatEnds
    expect(gate.status(current, now, 5).ready).toBe(false)
  })
})

describe('real-time ordinary chatter clock', () => {
  function clockFixture() {
    const clock = new RegularChatterClock()
    const current = state(5)
    function observe(elapsed: number, options: { combat?: boolean, ready?: boolean, busy?: boolean, lastInteractionAt?: number } = {}) {
      current.bridge!.snapshot!.combat = options.combat ?? false
      current.bridge!.lastSeen = new Date(now + elapsed).toISOString()
      return clock.observe(current, now + elapsed, {
        eligible: true,
        busy: options.busy ?? false,
        combatsReady: options.ready ?? true,
        ...(options.lastInteractionAt !== undefined ? { lastInteractionAt: options.lastInteractionAt } : {}),
      }, 5)
    }
    return { clock, current, observe }
  }

  it('counts real minutes through combat and waits ten stable noncombat seconds', () => {
    const { current, observe } = clockFixture()
    for (let elapsed = 0; elapsed <= 299_000; elapsed += 1000)
      expect(observe(elapsed, { combat: elapsed >= 60_000 })).toBeUndefined()
    expect(observe(300_000)).toBeUndefined()
    expect(observe(309_000)).toBeUndefined()
    expect(observe(310_000)).toBe(current.bridge!.snapshot)
  })

  it('retains elapsed time when the final required combat becomes eligible', () => {
    const { current, observe } = clockFixture()
    for (let elapsed = 0; elapsed <= 300_000; elapsed += 1000)
      expect(observe(elapsed, { ready: false })).toBeUndefined()
    expect(observe(301_000)).toBe(current.bridge!.snapshot)
    expect(observe(302_000)).toBeUndefined()
  })

  it('waits a new checking interval after an empty opportunity without accumulating a backlog', () => {
    const { current, observe } = clockFixture()
    for (let elapsed = 0; elapsed < 300_000; elapsed += 1000)
      expect(observe(elapsed)).toBeUndefined()
    expect(observe(300_000)).toBe(current.bridge!.snapshot)
    for (let elapsed = 301_000; elapsed < 600_000; elapsed += 1000)
      expect(observe(elapsed)).toBeUndefined()
    expect(observe(600_000)).toBe(current.bridge!.snapshot)
  })

  it('restores elapsed time after a desktop restart using a real delivery checkpoint', () => {
    const { current, observe } = clockFixture()
    const previous = now - 240_000
    for (let elapsed = 0; elapsed < 60_000; elapsed += 1000)
      expect(observe(elapsed, { lastInteractionAt: previous })).toBeUndefined()
    expect(observe(60_000, { lastInteractionAt: previous })).toBe(current.bridge!.snapshot)
  })

  it('starts the next full interval at delivery rather than model-request start', () => {
    const { clock, current, observe } = clockFixture()
    for (let elapsed = 0; elapsed < 300_000; elapsed += 1000)
      observe(elapsed)
    expect(observe(300_000)).toBe(current.bridge!.snapshot)
    clock.delivered(now + 320_000, 5)
    for (let elapsed = 321_000; elapsed < 620_000; elapsed += 1000)
      expect(observe(elapsed)).toBeUndefined()
    expect(observe(620_000)).toBe(current.bridge!.snapshot)
  })

  it('keeps elapsed time through stale telemetry while requiring a new stable observation period', () => {
    const { clock, current, observe } = clockFixture()
    for (let elapsed = 0; elapsed < 300_000; elapsed += 1000)
      expect(observe(elapsed)).toBeUndefined()
    expect(clock.observe(current, now + 310_000, { eligible: true, busy: false, combatsReady: true }, 5)).toBeUndefined()
    expect(observe(311_000)).toBeUndefined()
    expect(observe(320_000)).toBeUndefined()
    expect(observe(321_000)).toBe(current.bridge!.snapshot)
  })
})
