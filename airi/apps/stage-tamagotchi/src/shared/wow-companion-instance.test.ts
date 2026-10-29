import type { Snapshot } from './wow-companion'

import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { snapshotSchema } from './wow-companion'

const snapshot: Snapshot = {
  v: 3,
  session: 'scene-test',
  seq: 1,
  tick: 1,
  guid: 'Player-scene',
  name: 'Traveler',
  realm: 'Realm',
  level: 30,
  class: 'MAGE',
  faction: 'Alliance',
  race: 'Human',
  spec: 64,
  map: 84,
  zone: 'Stormwind',
  combat: false,
  dead: false,
  online: true,
  account: 'account-scene',
  moneyEpoch: 'epoch-scene',
  copper: 0,
  earned: 0,
  spent: 0,
}

describe('scene observations in v3 snapshots', () => {
  it('keeps absent scene metadata unobserved', () => {
    const value = parse(snapshotSchema, snapshot)
    expect(value.instanceType).toBeUndefined()
    expect(value.instanceID).toBeUndefined()
  })

  it.each(['none', 'party', 'raid', 'pvp', 'arena', 'scenario', 'unknown'] as const)('accepts the observed %s type without inventing an ID', (instanceType) => {
    const value = parse(snapshotSchema, { ...snapshot, instanceType, instanceID: null })
    expect(value.instanceType).toBe(instanceType)
    expect(value.instanceID).toBeNull()
  })

  it.each(['party', 'raid', 'pvp', 'arena', 'scenario'] as const)('keeps a %s instance ID distinct from the UI map', (instanceType) => {
    const value = parse(snapshotSchema, { ...snapshot, instanceType, instanceID: 529 })
    expect(value.instanceType).toBe(instanceType)
    expect(value.instanceID).toBe(529)
    expect(value.map).toBe(84)
  })

  it.each([true, '', 'dungeon', null, 2, {}, []])('rejects invalid type %j', (instanceType) => {
    expect(safeParse(snapshotSchema, { ...snapshot, instanceType }).success).toBe(false)
  })

  it.each([true, 0, -1, 1.5, 2147483648, Number.POSITIVE_INFINITY, Number.NaN, '36'])('rejects invalid ID %j', (instanceID) => {
    expect(safeParse(snapshotSchema, { ...snapshot, instanceType: 'party', instanceID }).success).toBe(false)
  })

  it.each(['none', 'unknown', undefined])('rejects ID attached to %s', (instanceType) => {
    expect(safeParse(snapshotSchema, { ...snapshot, instanceType, instanceID: 36 }).success).toBe(false)
  })

  it('clears observed instance metadata when offline', () => {
    const value = parse(snapshotSchema, { ...snapshot, instanceType: 'raid', instanceID: 409, online: false })
    expect(value.instanceType).toBe('unknown')
    expect(value.instanceID).toBeNull()
  })

  it('keeps absent scene metadata absent when offline', () => {
    const value = parse(snapshotSchema, { ...snapshot, online: false })
    expect(value.instanceType).toBeUndefined()
    expect(value.instanceID).toBeUndefined()
  })
})
