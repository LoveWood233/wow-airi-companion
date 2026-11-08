import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { snapshotSchema } from './wow-companion'
import { loadoutStateFixture } from './wow-companion-loadout.test-helper'

const snapshot = loadoutStateFixture().bridge!.snapshot!

describe('login progress in additive v3 observations', () => {
  it('leaves older senders unknown', () => {
    const value = parse(snapshotSchema, snapshot)
    expect(value.loginId).toBeUndefined()
    expect(value.combatEnds).toBeUndefined()
  })

  it.each([0, 7, 2147483647])('keeps the login identity with the observed count %i', (combatEnds) => {
    const value = parse(snapshotSchema, { ...snapshot, loginId: 'login_1', combatEnds })
    expect(value.loginId).toBe('login_1')
    expect(value.combatEnds).toBe(combatEnds)
  })

  it.each([{ loginId: 'login' }, { combatEnds: 0 }, { loginId: undefined, combatEnds: 0 }])('rejects partial pair %j', (pair) => {
    expect(safeParse(snapshotSchema, { ...snapshot, ...pair }).success).toBe(false)
  })

  it.each(['', 'x'.repeat(41), 'bad id', '登录', true, 1, null])('rejects invalid login identity %j', (loginId) => {
    expect(safeParse(snapshotSchema, { ...snapshot, loginId, combatEnds: 0 }).success).toBe(false)
  })

  it.each([-1, 1.5, 2147483648, true, '5', null, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid combat count %j', (combatEnds) => {
    expect(safeParse(snapshotSchema, { ...snapshot, loginId: 'login', combatEnds }).success).toBe(false)
  })

  it('removes the pair when the snapshot is offline', () => {
    const value = parse(snapshotSchema, { ...snapshot, loginId: 'login', combatEnds: 7, online: false })
    expect(Object.hasOwn(value, 'loginId')).toBe(false)
    expect(Object.hasOwn(value, 'combatEnds')).toBe(false)
  })
})
