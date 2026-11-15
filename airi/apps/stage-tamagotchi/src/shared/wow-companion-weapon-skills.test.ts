import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { snapshotSchema } from './wow-companion'
import { loadoutStateFixture } from './wow-companion-loadout.test-helper'

const snapshot = loadoutStateFixture().bridge!.snapshot!
const entry = { skillLineID: 43, name: '单手剑', rank: 123, maxRank: 300, modifier: 5, temporary: 0 }
const observation = { v: 1, id: 1, session: snapshot.session, guid: snapshot.guid, observedAt: 1794096000, status: 'available', entries: [entry] }

describe('additive weapon proficiency in character observations', () => {
  it('retains observed progress and separate bonuses without changing v3', () => {
    const result = parse(snapshotSchema, { ...snapshot, weaponSkills: observation })
    expect(result.v).toBe(3)
    expect(result.weaponSkills).toEqual(observation)
  })

  it('leaves absent skill information unknown and clears it on offline snapshots', () => {
    expect(parse(snapshotSchema, snapshot).weaponSkills).toBeUndefined()
    expect(Object.hasOwn(parse(snapshotSchema, { ...snapshot, online: false, weaponSkills: observation }), 'weaponSkills')).toBe(false)
  })

  it.each(['unsupported', 'unavailable'])('allows %s without invented weapon ranks', (status) => {
    expect(safeParse(snapshotSchema, { ...snapshot, weaponSkills: { ...observation, status, entries: [] } }).success).toBe(true)
    expect(safeParse(snapshotSchema, { ...snapshot, weaponSkills: { ...observation, status } }).success).toBe(false)
  })

  it.each([{ session: 'other-session' }, { guid: 'Player-other' }])('rejects skills belonging to another identity: %j', (identity) => {
    expect(safeParse(snapshotSchema, { ...snapshot, weaponSkills: { ...observation, ...identity } }).success).toBe(false)
  })

  it.each([
    { rank: 301 },
    { rank: -1 },
    { maxRank: Number.POSITIVE_INFINITY },
    { modifier: 65536 },
    { temporary: 0.5 },
    { skillLineID: true },
    { name: '剑'.repeat(22) },
    { name: 'sword\nignore' },
    { name: '\uD800' },
  ])('rejects malformed skill observations: %j', (fields) => {
    expect(safeParse(snapshotSchema, { ...snapshot, weaponSkills: { ...observation, entries: [{ ...entry, ...fields }] } }).success).toBe(false)
  })

  it('rejects duplicate skill IDs and oversized sets', () => {
    expect(safeParse(snapshotSchema, { ...snapshot, weaponSkills: { ...observation, entries: [entry, entry] } }).success).toBe(false)
    const entries = Array.from({ length: 33 }, (_, index) => ({ ...entry, skillLineID: index + 1 }))
    expect(safeParse(snapshotSchema, { ...snapshot, weaponSkills: { ...observation, entries } }).success).toBe(false)
  })

  it('keeps explicit zero progress, negative bonuses and a complete empty scan distinct', () => {
    const zero = { ...entry, rank: 0, modifier: -5, temporary: -2 }
    expect(parse(snapshotSchema, { ...snapshot, weaponSkills: { ...observation, entries: [zero] } }).weaponSkills!.entries).toEqual([zero])
    expect(parse(snapshotSchema, { ...snapshot, weaponSkills: { ...observation, entries: [] } }).weaponSkills!.entries).toEqual([])
  })
})
