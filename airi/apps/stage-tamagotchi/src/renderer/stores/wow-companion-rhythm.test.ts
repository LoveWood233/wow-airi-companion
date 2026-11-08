import { describe, expect, it } from 'vitest'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { interactionScene, isQuietTime, normalizeClock } from './wow-companion-rhythm'

describe('companion rhythm rules', () => {
  const time = (hour: number, minute = 0) => new Date(2026, 9, 31, hour, minute).getTime()

  it('uses the local clock with exact overnight boundaries', () => {
    expect(isQuietTime(time(21, 59), '22:00', '08:00')).toBe(false)
    expect(isQuietTime(time(22), '22:00', '08:00')).toBe(true)
    expect(isQuietTime(time(0), '22:00', '08:00')).toBe(true)
    expect(isQuietTime(time(7, 59), '22:00', '08:00')).toBe(true)
    expect(isQuietTime(time(8), '22:00', '08:00')).toBe(false)
  })

  it('supports daytime and whole-day quiet hours', () => {
    expect(isQuietTime(time(13), '12:00', '14:00')).toBe(true)
    expect(isQuietTime(time(14), '12:00', '14:00')).toBe(false)
    expect(isQuietTime(time(0), '08:00', '08:00')).toBe(true)
    expect(isQuietTime(time(18), '08:00', '08:00')).toBe(true)
  })

  it('keeps invalid clock values outside configuration', () => {
    expect(normalizeClock('24:00', '22:00')).toBe('22:00')
    expect(normalizeClock('', '22:00')).toBe('22:00')
    expect(normalizeClock('05:30', '22:00')).toBe('05:30')
  })

  it('uses observed metadata instead of guessing from the map name', () => {
    const snapshot = loadoutStateFixture().bridge!.snapshot!
    expect(interactionScene({ ...snapshot, instanceType: 'none' })).toBe('outdoor')
    expect(interactionScene({ ...snapshot, instanceType: 'raid' })).toBe('instance')
    expect(interactionScene({ ...snapshot, instanceType: 'party' })).toBe('instance')
    expect(interactionScene({ ...snapshot, instanceType: 'unknown' })).toBe('unknown')
    expect(interactionScene({ ...snapshot, instanceType: 'pvp' })).toBe('unknown')
  })
})
