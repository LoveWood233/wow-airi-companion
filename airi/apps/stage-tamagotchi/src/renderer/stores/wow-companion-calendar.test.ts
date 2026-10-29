import { describe, expect, it } from 'vitest'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { calendarReminder } from './wow-companion-calendar'

function ready() {
  const state = loadoutStateFixture()
  state.bridge!.lastSeen = new Date(100000).toISOString()
  state.bridge!.ageSeconds = 0
  state.bridge!.calendar = { day: '2026-12-31', items: [{ title: 'Holiday', action: 'end', when: '2027-01-01 06:00' }] }
  return state
}

describe('first-login calendar digest', () => {
  it('retains character-specific resets while suppressing repeated public events', () => {
    const state = ready()
    state.bridge!.calendar!.items.push({ title: 'Raid', action: 'reset_soon', when: '2027-01-01 06:00' })
    const first = calendarReminder(state, [], 100000)!
    expect(first.keys).toHaveLength(2)
    expect(calendarReminder(state, first.keys, 100000)).toBeUndefined()
    state.bridge!.snapshot!.guid = 'another-character'
    const second = calendarReminder(state, first.keys, 100000)!
    expect(second.calendar.items.map(item => item.title)).toEqual(['Raid'])
    const legacyReceipt = JSON.stringify([state.game, state.bridge!.snapshot!.account, state.bridge!.snapshot!.realm, '2026-12-31'])
    expect(calendarReminder(state, [legacyReceipt], 100000)!.calendar.items.map(item => item.title)).toEqual(['Raid'])
  })

  it('deduplicates relogs and character switches but keeps accounts and dates separate', () => {
    const state = ready()
    const first = calendarReminder(state, [], 100000)!
    expect(first.calendar.items).toHaveLength(1)
    state.bridge!.snapshot!.session = 'relogin'
    state.bridge!.snapshot!.guid = 'another-character'
    expect(calendarReminder(state, first.keys, 100000)).toBeUndefined()
    state.bridge!.snapshot!.account = 'another-account'
    expect(calendarReminder(state, first.keys, 100000)).toBeDefined()
    state.bridge!.calendar!.day = '2027-01-01'
    expect(calendarReminder(state, first.keys, 100000)).toBeDefined()
  })

  it('defers combat and mute and ignores stale or incomplete observations', () => {
    const state = ready()
    state.bridge!.snapshot!.combat = true
    expect(calendarReminder(state, [], 100000)).toBeUndefined()
    state.bridge!.snapshot!.combat = false
    state.settings.muted = true
    expect(calendarReminder(state, [], 100000)).toBeUndefined()
    state.settings.muted = false
    state.bridge!.status = 'stale'
    expect(calendarReminder(state, [], 100000)).toBeUndefined()
    state.bridge!.status = 'live'
    state.bridge!.calendar = null
    expect(calendarReminder(state, [], 100000)).toBeUndefined()
  })
})
