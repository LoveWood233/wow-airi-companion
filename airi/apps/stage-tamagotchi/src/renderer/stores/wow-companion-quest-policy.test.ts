import { parse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { questSnapshotSchema } from '../../shared/wow-companion-quests'
import { questReminderCurrent, QuestReminderPolicy, readQuestReminderReceipts } from './wow-companion-quest-policy'

const now = Date.parse('2026-11-01T08:00:00Z')
const allowed = { enabled: true, eligible: true, busy: false }

function ready(at = now) {
  const state = loadoutStateFixture()
  const bridge = state.bridge!
  const snapshot = bridge.snapshot!
  snapshot.level = 15
  bridge.lastSeen = new Date(at).toISOString()
  bridge.ageSeconds = 0
  bridge.quests = parse(questSnapshotSchema, {
    v: 1,
    id: 1,
    session: snapshot.session,
    guid: snapshot.guid,
    observedAt: Math.floor(at / 1000),
    source: 'quest-log',
    advice: { v: 1, playerLevel: 15, candidates: [{ kind: 'ready', questID: 101, eventAt: null }] },
    log: { complete: true, truncated: false, total: 1, entries: [{ questID: 101, title: 'Observed task', level: 16, header: 'Observed header', readyForTurnIn: true, failed: false, objectivesComplete: true, objectives: [{ index: 1, text: 'Observed objective', type: 'monster', fulfilled: 1, required: 1, finished: true }] }] },
    completion: { source: 'completed-api', scope: 'unknown', complete: false, truncated: true, total: 513, ids: [101], turnIns: [] },
  })
  bridge.questsError = null
  bridge.questsReceivedAt = new Date(at).toISOString()
  return state
}

describe('quest reminder policy', () => {
  it('deduplicates readiness by task and session, without calling it handed in', () => {
    const state = ready()
    const policy = new QuestReminderPolicy()
    const first = policy.observe(state, now, allowed, [])!
    expect(first.kind).toBe('ready')
    const receipts = [{ key: first.key, attemptedAt: now - 180_000 }]
    expect(policy.observe(state, now, allowed, receipts)).toBeUndefined()
    state.bridge!.snapshot!.session = 'another-session'
    state.bridge!.quests!.session = 'another-session'
    expect(policy.observe(state, now, allowed, receipts)?.kind).toBe('ready')
    expect(questReminderCurrent(state, first, now)).toBe(false)
  })

  it('uses a global three-minute cooldown across games, characters and policy restarts', () => {
    const receipts = [{ key: 'other-game-other-character', attemptedAt: now }]
    const state = ready(now + 179_999)
    expect(new QuestReminderPolicy().observe(state, now + 179_999, allowed, receipts)).toBeUndefined()
    expect(new QuestReminderPolicy().observe(state, now + 180_000, allowed, receipts)?.kind).toBe('ready')
    expect(new QuestReminderPolicy().observe(ready(), now - 1000, allowed, receipts)).toBeUndefined()
  })

  it.each(['disabled', 'ineligible', 'busy', 'combat', 'dead', 'stale', 'muted', 'paused', 'demo', 'missing', 'old', 'future', 'wrong-guid', 'wrong-session', 'error'])(
    'does not remind for %s observations',
    (reason) => {
      const state = ready()
      const bridge = state.bridge!
      const flags = { ...allowed }
      if (reason === 'disabled')
        flags.enabled = false
      if (reason === 'ineligible')
        flags.eligible = false
      if (reason === 'busy')
        flags.busy = true
      if (reason === 'combat')
        bridge.snapshot!.combat = true
      if (reason === 'dead')
        bridge.snapshot!.dead = true
      if (reason === 'stale')
        bridge.status = 'stale'
      if (reason === 'muted')
        state.settings.muted = true
      if (reason === 'paused')
        bridge.config.paused = true
      if (reason === 'demo')
        bridge.source = 'demo'
      if (reason === 'missing')
        bridge.quests = null
      if (reason === 'old')
        bridge.quests!.observedAt -= 181
      if (reason === 'future')
        bridge.quests!.observedAt += 6
      if (reason === 'wrong-guid')
        bridge.quests!.guid = 'another-guid'
      if (reason === 'wrong-session')
        bridge.quests!.session = 'another-session'
      if (reason === 'error')
        bridge.questsError = 'Decode failed'
      expect(new QuestReminderPolicy().observe(state, now, flags, [])).toBeUndefined()
    },
  )

  it('does not infer reminder candidates from flags, coverage or removed tasks', () => {
    const state = ready()
    state.bridge!.quests!.advice = undefined
    state.bridge!.quests!.log.entries[0]!.readyForTurnIn = null
    const policy = new QuestReminderPolicy()
    expect(policy.observe(state, now, allowed, [])).toBeUndefined()
    state.bridge!.quests!.log.entries = []
    state.bridge!.quests!.log.total = 0
    expect(policy.observe(state, now, allowed, [])).toBeUndefined()
  })

  it('only reports a newly observed recent turn-in and never replays startup history', () => {
    const state = ready()
    const quests = state.bridge!.quests!
    quests.log.entries = []
    quests.log.total = 0
    quests.completion.turnIns = [{ questID: 101, observedAt: now / 1000 - 5 }]
    quests.advice!.candidates = [{ kind: 'turned-in', questID: 101, eventAt: now / 1000 - 5 }]
    const policy = new QuestReminderPolicy()
    expect(policy.observe(state, now, allowed, [])).toBeUndefined()
    quests.completion.turnIns.push({ questID: 102, observedAt: now / 1000 })
    quests.advice!.candidates.push({ kind: 'turned-in', questID: 102, eventAt: now / 1000 })
    const result = policy.observe(state, now, allowed, [])!
    expect(result.kind).toBe('turned-in')
    expect(result.quest.questID).toBe(102)
    expect(result.quest.title).toBeNull()
    expect(questReminderCurrent(state, result, now)).toBe(true)
    quests.completion.turnIns = []
    quests.advice!.candidates = []
    expect(questReminderCurrent(state, result, now)).toBe(false)
  })

  it('retains a new turn-in through short busy work but drops expired evidence', () => {
    const state = ready()
    const policy = new QuestReminderPolicy()
    state.bridge!.quests!.log.entries[0]!.readyForTurnIn = false
    state.bridge!.quests!.advice!.candidates = []
    policy.observe(state, now, allowed, [])
    state.bridge!.quests!.completion.turnIns = [{ questID: 102, observedAt: now / 1000 }]
    state.bridge!.quests!.advice!.candidates = [{ kind: 'turned-in', questID: 102, eventAt: now / 1000 }]
    expect(policy.observe(state, now, { ...allowed, busy: true }, [])).toBeUndefined()
    expect(policy.observe(state, now + 1000, allowed, [])?.kind).toBe('turned-in')
  })

  it('describes a level gap as risk and invalidates it when the observed facts change', () => {
    const state = ready()
    const quest = state.bridge!.quests!.log.entries[0]!
    quest.readyForTurnIn = false
    quest.level = 20
    state.bridge!.quests!.advice!.candidates = [{ kind: 'level-risk', questID: 101, eventAt: null }]
    const result = new QuestReminderPolicy().observe(state, now, allowed, [])!
    expect(result.kind).toBe('level-risk')
    expect(questReminderCurrent(state, result, now)).toBe(true)
    state.bridge!.snapshot!.level = 16
    expect(questReminderCurrent(state, result, now)).toBe(false)
    quest.level = null
    state.bridge!.quests!.advice!.candidates = []
    expect(new QuestReminderPolicy().observe(state, now, allowed, [])).toBeUndefined()
  })

  it('offers a known logged task after an observed level gain, with no initial or failed-task recommendation', () => {
    const state = ready()
    state.bridge!.quests!.log.entries[0]!.readyForTurnIn = false
    state.bridge!.quests!.advice!.candidates = []
    const policy = new QuestReminderPolicy()
    expect(policy.observe(state, now, allowed, [])).toBeUndefined()
    state.bridge!.snapshot!.level = 16
    state.bridge!.quests!.advice = { v: 1, playerLevel: 16, candidates: [{ kind: 'leveling', questID: 101, eventAt: now / 1000 }] }
    const result = policy.observe(state, now, allowed, [])!
    expect(result.kind).toBe('leveling')
    state.bridge!.quests!.log.entries[0]!.failed = true
    state.bridge!.quests!.advice!.candidates = []
    expect(questReminderCurrent(state, result, now)).toBe(false)
    expect(policy.observe(state, now, allowed, [])).toBeUndefined()
  })

  it('reads bounded receipts and rejects malformed timestamps', () => {
    expect(readQuestReminderReceipts([{ key: 'task', attemptedAt: now }])).toHaveLength(1)
    expect(readQuestReminderReceipts([{ key: 'task', attemptedAt: -1 }])).toEqual([])
    expect(readQuestReminderReceipts('invalid')).toEqual([])
  })

  it('retains a level gain through combat and replacement quest transfers without speaking in combat', () => {
    const state = ready()
    const quests = state.bridge!.quests!
    quests.log.entries[0]!.readyForTurnIn = false
    quests.advice!.candidates = []
    const policy = new QuestReminderPolicy()
    expect(policy.observe(state, now, allowed, [])).toBeUndefined()
    state.bridge!.snapshot!.combat = true
    state.bridge!.snapshot!.level = 16
    state.bridge!.quests = null
    expect(policy.observe(state, now + 1000, allowed, [])).toBeUndefined()
    state.bridge!.snapshot!.combat = false
    state.bridge!.quests = quests
    quests.advice = { v: 1, playerLevel: 16, candidates: [{ kind: 'leveling', questID: 101, eventAt: now / 1000 }] }
    expect(policy.observe(state, now + 2000, allowed, [])?.kind).toBe('leveling')
  })

  it('uses the addon decision instead of maintaining another level-gap algorithm', () => {
    const state = ready()
    state.bridge!.quests!.advice!.candidates = [{ kind: 'level-risk', questID: 101, eventAt: null }]
    expect(new QuestReminderPolicy().observe(state, now, allowed, [])?.kind).toBe('level-risk')
    state.bridge!.quests!.advice!.candidates = []
    state.bridge!.quests!.log.entries[0]!.level = 99
    expect(new QuestReminderPolicy().observe(state, now, allowed, [])).toBeUndefined()
  })
})
