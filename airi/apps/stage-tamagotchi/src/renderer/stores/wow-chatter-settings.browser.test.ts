import type { Pinia } from 'pinia'

import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { useWowChatterSettingsStore } from './wow-chatter-settings'

const owners: Pinia[] = []
const frames: HTMLIFrameElement[] = []

function settings() {
  const owner = createPinia()
  owners.push(owner)
  setActivePinia(owner)
  return useWowChatterSettingsStore()
}

beforeEach(() => localStorage.clear())

afterEach(() => {
  for (const frame of frames.splice(0))
    frame.remove()
  for (const owner of owners.splice(0))
    disposePinia(owner)
  localStorage.clear()
})

describe('independent chatter preferences', () => {
  it('starts rhythm limits disabled and inherits base frequencies', () => {
    const store = settings()
    expect(store.quietEnabled).toBe(false)
    expect(store.sceneEnabled).toBe(false)
    expect(store.budgetEnabled).toBe(false)
    expect(store.questEnabled).toBe(false)
    expect(store.quietStart).toBe('22:00')
    expect(store.quietEnd).toBe('08:00')
    expect(store.interval('regular', null)).toBe(5)
    expect(store.interval('scenery', null)).toBe(10)
  })

  it('applies scene overrides only to observed matching scenes', () => {
    const store = settings()
    const snapshot = loadoutStateFixture().bridge!.snapshot!
    store.regularIntervalMinutes = 4
    store.sceneEnabled = true
    store.outdoorRegular = 2
    store.instanceRegular = 20
    expect(store.interval('regular', { ...snapshot, instanceType: 'none' })).toBe(2)
    expect(store.interval('regular', { ...snapshot, instanceType: 'raid' })).toBe(20)
    expect(store.interval('regular', { ...snapshot, instanceType: 'unknown' })).toBe(4)
    store.outdoorRegular = 0
    expect(store.interval('regular', { ...snapshot, instanceType: 'none' })).toBe(4)
    store.regularIntervalMinutes = 6
    expect(store.interval('regular', { ...snapshot, instanceType: 'none' })).toBe(6)
  })

  it('keeps failed reservations and usage through toggles and fresh owners', () => {
    const first = settings()
    first.budgetEnabled = true
    first.hourlyLimit = 2
    expect(first.consume(1000)).toBe(true)
    expect(first.usage(1000).used).toBe(1)
    expect(first.canGenerate(2, 1000)).toBe(false)
    expect(first.consume(2000)).toBe(true)
    expect(first.usage(2000).used).toBe(2)
    expect(first.consume(3000)).toBe(false)
    first.budgetEnabled = false
    expect(first.consume(3000)).toBe(true)
    expect(first.usage(3000).used).toBe(3)
    expect(localStorage.getItem('settings/wow-chatter/model-requests-v1')).toBe('[1000,2000,3000]')
    first.budgetEnabled = true
    const second = settings()
    expect(second.usage(3000).used).toBe(3)
    expect(second.consume(3000)).toBe(false)
    expect(second.usage(500).used).toBe(3)
    expect(second.usage(3_601_000).used).toBe(2)
    expect(second.consume(3_602_000)).toBe(true)
    expect(JSON.parse(localStorage.getItem('settings/wow-chatter/model-requests-v1') ?? '[]')).toEqual([3000, 3_602_000])
  })

  it('persists quiet hours and bounds new frequency and budget fields', () => {
    const first = settings()
    first.quietEnabled = true
    first.quietStart = '23:30'
    first.quietEnd = '06:30'
    first.instanceScenery = 99
    first.outdoorRegular = -2
    first.hourlyLimit = 0
    expect(first.instanceScenery).toBe(60)
    expect(first.outdoorRegular).toBe(5)
    expect(first.hourlyLimit).toBe(1)
    const second = settings()
    expect(second.quietEnabled).toBe(true)
    expect(second.quietStart).toBe('23:30')
    expect(second.quiet(new Date(2026, 9, 31, 0, 0).getTime())).toBe(true)
    expect(second.quiet(new Date(2026, 9, 31, 6, 30).getTime())).toBe(false)
  })
  it('keeps ordinary chatter enabled and screenshots disabled until explicitly selected', () => {
    const store = settings()
    expect(store.regularEnabled).toBe(true)
    expect(store.regularIntervalMinutes).toBe(5)
    expect(store.combatsRequired).toBe(5)
    expect(store.sceneryEnabled).toBe(false)
    expect(store.sceneryIntervalMinutes).toBe(10)
    expect(store.locationEnabled).toBe(true)
  })

  it('persists independent switches and intervals across a fresh store owner', async () => {
    const first = settings()
    first.regularEnabled = false
    first.regularIntervalMinutes = 3
    first.combatsRequired = 12
    first.sceneryEnabled = true
    first.sceneryIntervalMinutes = 60
    first.locationEnabled = false
    first.questEnabled = true
    expect(localStorage.getItem('settings/wow-chatter/regular-enabled')).toBe('false')
    expect(localStorage.getItem('settings/wow-chatter/scenery-enabled')).toBe('true')
    expect(localStorage.getItem('settings/wow-chatter/regular-interval-minutes')).toBe('3')
    expect(localStorage.getItem('settings/wow-chatter/combats-required')).toBe('12')
    expect(localStorage.getItem('settings/wow-chatter/scenery-interval-minutes')).toBe('60')
    expect(localStorage.getItem('settings/wow-chatter/location-enabled')).toBe('false')
    const second = settings()
    expect(second.regularEnabled).toBe(false)
    expect(second.regularIntervalMinutes).toBe(3)
    expect(second.combatsRequired).toBe(12)
    expect(second.sceneryEnabled).toBe(true)
    expect(second.sceneryIntervalMinutes).toBe(60)
    expect(second.locationEnabled).toBe(false)
    expect(second.questEnabled).toBe(true)
  })

  it.each(['"true"', '1', 'null', '{}', '[]', 'invalid'])('keeps quest reminders disabled for corrupt opt-in %s', (stored) => {
    localStorage.setItem('settings/wow-chatter/quest-enabled', stored)
    expect(settings().questEnabled).toBe(false)
  })

  it.each(['"true"', '1', 'null', '{}', '[]', 'invalid'])('does not treat corrupt opt-in %s as screenshot permission', (stored) => {
    localStorage.setItem('settings/wow-chatter/scenery-enabled', stored)
    expect(settings().sceneryEnabled).toBe(false)
  })

  it.each([
    ['2', 2],
    ['30', 30],
    ['4.8', 5],
    ['1', 5],
    ['0', 5],
    ['31', 5],
    ['60', 5],
    ['"10"', 5],
    ['null', 5],
    ['1e999', 5],
    ['invalid', 5],
  ])('restores a valid ordinary interval for stored value %s', (stored, expected) => {
    localStorage.setItem('settings/wow-chatter/regular-interval-minutes', stored)
    expect(settings().regularIntervalMinutes).toBe(expected)
  })

  it.each([
    ['5', 5],
    ['30', 30],
    ['7.8', 8],
    ['4', 5],
    ['31', 5],
    ['"12"', 5],
    ['null', 5],
    ['1e999', 5],
    ['invalid', 5],
  ])('restores a valid combat requirement for stored value %s', (stored, expected) => {
    localStorage.setItem('settings/wow-chatter/combats-required', stored)
    expect(settings().combatsRequired).toBe(expected)
  })

  it.each([
    ['0', 0],
    ['2', 2],
    ['30', 30],
    ['1', 5],
    ['31', 5],
    ['60', 5],
    ['null', 5],
  ])('normalizes stored ordinary scene override %s independently from screenshots', (stored, expected) => {
    localStorage.setItem('settings/wow-chatter/outdoor-regular', stored)
    localStorage.setItem('settings/wow-chatter/instance-regular', stored)
    const store = settings()
    expect(store.outdoorRegular).toBe(expected)
    expect(store.instanceRegular).toBe(expected)
    expect(store.outdoorScenery).toBe(0)
    expect(store.instanceScenery).toBe(0)
  })

  it.each([
    ['0', 1],
    ['-2', 1],
    ['61', 60],
    ['4.8', 5],
    ['"8"', 10],
    ['true', 10],
    ['null', 10],
    ['1e999', 10],
    ['invalid', 10],
  ])('normalizes stored screenshot interval %s to %s', (stored, expected) => {
    localStorage.setItem('settings/wow-chatter/scenery-interval-minutes', stored)
    expect(settings().sceneryIntervalMinutes).toBe(expected)
  })

  it('bounds writes before a runtime owner sees them', () => {
    const store = settings()
    store.sceneryIntervalMinutes = 0
    expect(store.sceneryIntervalMinutes).toBe(1)
    store.regularIntervalMinutes = 62
    expect(store.regularIntervalMinutes).toBe(5)
    store.regularIntervalMinutes = Number.NaN
    expect(store.regularIntervalMinutes).toBe(5)
    store.outdoorRegular = 0
    expect(store.outdoorRegular).toBe(0)
    store.instanceRegular = 31
    expect(store.instanceRegular).toBe(5)
    store.combatsRequired = 30
    expect(store.combatsRequired).toBe(30)
    store.combatsRequired = 0
    expect(store.combatsRequired).toBe(5)
    store.combatsRequired = Number.NaN
    expect(store.combatsRequired).toBe(5)
    store.sceneryIntervalMinutes = 2.8
    expect(store.sceneryIntervalMinutes).toBe(3)
  })

  it('receives native storage changes from another same-origin window', async () => {
    const store = settings()
    const frame = document.createElement('iframe')
    frame.src = 'about:blank'
    document.body.append(frame)
    frames.push(frame)
    const otherWindow = frame.contentWindow
    if (!otherWindow)
      throw new Error('Expected a second same-origin window')
    await new Promise<void>((resolve) => {
      if (frame.contentDocument?.readyState === 'complete')
        resolve()
      else
        frame.addEventListener('load', () => resolve(), { once: true })
    })
    otherWindow.localStorage.setItem('settings/wow-chatter/scenery-enabled', 'true')
    otherWindow.localStorage.setItem('settings/wow-chatter/scenery-interval-minutes', '7')
    otherWindow.localStorage.setItem('settings/wow-chatter/location-enabled', 'false')
    otherWindow.localStorage.setItem('settings/wow-chatter/combats-required', '20')
    await vi.waitFor(() => expect(store.sceneryEnabled).toBe(true))
    await vi.waitFor(() => expect(store.sceneryIntervalMinutes).toBe(7))
    await vi.waitFor(() => expect(store.locationEnabled).toBe(false))
    await vi.waitFor(() => expect(store.combatsRequired).toBe(20))
    otherWindow.localStorage.setItem('settings/wow-chatter/scenery-enabled', '"true"')
    otherWindow.localStorage.setItem('settings/wow-chatter/scenery-interval-minutes', '0')
    await vi.waitFor(() => expect(store.sceneryEnabled).toBe(false))
    await vi.waitFor(() => expect(store.sceneryIntervalMinutes).toBe(1))
    expect(store.regularEnabled).toBe(true)
    expect(store.regularIntervalMinutes).toBe(5)
  })
})
