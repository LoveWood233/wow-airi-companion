import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { groupBuffSchema } from '../../shared/wow-companion-group-buffs'
import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { groupBuffReminder } from './wow-companion-group-buffs'

function ready() {
  const state = loadoutStateFixture()
  const bridge = state.bridge!
  bridge.lastSeen = new Date(100000).toISOString()
  bridge.snapshot!.instanceType = 'party'
  bridge.snapshot!.instanceID = 33
  bridge.groupBuff = {
    v: 1,
    kind: 'buff',
    s: bridge.snapshot!.session,
    g: bridge.snapshot!.guid,
    e: 1,
    q: 1,
    st: 'ready',
    spell: 6673,
    name: 'Battle Shout',
    missing: 1,
    checked: 2,
    total: 5,
    instanceType: 'party',
    instanceID: 33,
  }
  return state
}

describe('group buff reminders', () => {
  it('reminds for partial missing coverage once per entry and retains independent game identities', () => {
    const state = ready()
    const first = groupBuffReminder(state, [], 100000)!
    expect(first.buff.missing).toBe(1)
    expect(groupBuffReminder(state, [first.key], 100000)).toBeUndefined()
    state.bridge!.groupBuff!.q++
    expect(groupBuffReminder(state, [first.key], 100000)).toBeUndefined()
    state.bridge!.groupBuff!.e++
    expect(groupBuffReminder(state, [first.key], 100000)).toBeDefined()
    state.bridge!.groupBuff!.e--
    state.game = 'forever'
    expect(groupBuffReminder(state, [first.key], 100000)).toBeDefined()
  })

  it.each(['combat', 'dead', 'muted', 'stale', 'demo', 'paused', 'filled', 'waiting', 'class', 'session', 'guid', 'scene', 'instance', 'missing-data'])(
    'ignores %s observations',
    (reason) => {
      const state = ready()
      const bridge = state.bridge!
      const snapshot = bridge.snapshot!
      const buff = bridge.groupBuff!
      if (reason === 'combat')
        snapshot.combat = true
      if (reason === 'dead')
        snapshot.dead = true
      if (reason === 'muted')
        state.settings.muted = true
      if (reason === 'stale')
        bridge.status = 'stale'
      if (reason === 'demo')
        bridge.source = 'demo'
      if (reason === 'paused')
        bridge.config.paused = true
      if (reason === 'filled')
        buff.missing = 0
      if (reason === 'waiting')
        buff.st = 'waiting'
      if (reason === 'class')
        snapshot.class = 'MAGE'
      if (reason === 'session')
        snapshot.session = 'other'
      if (reason === 'guid')
        snapshot.guid = 'other'
      if (reason === 'scene')
        snapshot.instanceType = 'none'
      if (reason === 'instance')
        snapshot.instanceID = 34
      if (reason === 'missing-data')
        bridge.groupBuff = null
      expect(groupBuffReminder(state, [], 100000)).toBeUndefined()
    },
  )

  it('rejects impossible transport counts and incomplete ready entries', () => {
    const buff = ready().bridge!.groupBuff!
    expect(safeParse(groupBuffSchema, buff).success).toBe(true)
    for (const changes of [{ missing: 3 }, { spell: 999 }, { name: '' }, { e: 0 }, { instanceType: 'none' }, { st: 'inactive' }])
      expect(safeParse(groupBuffSchema, { ...buff, ...changes }).success).toBe(false)
  })
})
