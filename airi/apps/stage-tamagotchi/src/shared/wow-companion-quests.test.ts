import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'

import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { bridgeSchema } from './wow-companion'
import { questSnapshotSchema } from './wow-companion-quests'

function snapshot() {
  return { v: 1, id: 1, session: 'session-1', guid: 'Player-1', observedAt: 1700000000, source: 'quest-log', log: { complete: true, truncated: false, total: 1, entries: [{ questID: 42, title: '任务', level: 15, header: null, readyForTurnIn: false, failed: null, objectivesComplete: true, objectives: [{ index: 1, text: '目标2/3', type: 'item', fulfilled: 2, required: 3, finished: false }] }] }, completion: { source: 'completed-api', scope: 'unknown', complete: true, truncated: false, total: 2, ids: [4, 9], turnIns: [] as Array<{ questID: number, observedAt: number }> } }
}

describe('live task telemetry contract', () => {
  it.skipIf(!env.WOW_COMPANION_BRIDGE_DIR).each(['retail', 'forever'] as const)('accepts the real %s Lua fixture', async (game) => {
    const addon = game === 'retail' ? 'WoWMapCompanion' : 'WoWForeverCompanion'
    const value: unknown = JSON.parse(await readFile(join(env.WOW_COMPANION_BRIDGE_DIR!, '..', addon, 'tests', 'fixtures', `lua-${game}-quests.json`), 'utf8'))
    expect(safeParse(questSnapshotSchema, value).success).toBe(true)
    const bridge: unknown = JSON.parse(await readFile(join(env.WOW_COMPANION_BRIDGE_DIR!, '..', addon, 'tests', 'fixtures', `lua-${game}-quests-bridge.json`), 'utf8'))
    expect(parse(bridgeSchema, bridge).quests).toEqual(value)
  })

  it('preserves goal coverage separately from success, completion flags and turn-in evidence', () => {
    const value = snapshot()
    expect(safeParse(questSnapshotSchema, value).success).toBe(true)
    expect(value.log.entries[0].objectivesComplete).toBe(true)
    expect(value.log.entries[0].objectives[0].finished).toBe(false)
    expect(value.completion.turnIns).toEqual([])
    const partial = { ...value, log: { complete: false, truncated: false, total: null, entries: [] }, completion: { source: 'unknown', scope: 'unknown', complete: false, truncated: false, total: null, ids: [], turnIns: [] } }
    expect(safeParse(questSnapshotSchema, partial).success).toBe(true)
  })

  it.each([
    { observedAt: 0 },
    { guid: '' },
    { source: 'questie' },
    { log: { ...snapshot().log, total: 0 } },
    { log: { ...snapshot().log, truncated: true } },
    { completion: { ...snapshot().completion, scope: 'character' } },
    { completion: { ...snapshot().completion, source: 'unknown' } },
    { completion: { ...snapshot().completion, ids: [9, 4] } },
    { completion: { ...snapshot().completion, ids: [4, 4] } },
    { completion: { ...snapshot().completion, truncated: true } },
    { completion: { ...snapshot().completion, turnIns: [{ questID: 42, observedAt: 1700000001 }] } },
    { completion: { ...snapshot().completion, turnIns: [{ questID: 42, observedAt: 1700000000 }, { questID: 42, observedAt: 1700000000 }] } },
  ])('rejects ambiguous or forged evidence %j', (change) => {
    expect(safeParse(questSnapshotSchema, { ...snapshot(), ...change }).success).toBe(false)
  })

  it('rejects secret substitutes, duplicate objectives, and byte overflow', () => {
    const value = snapshot()
    const entry = value.log.entries[0]
    expect(safeParse(questSnapshotSchema, { ...value, log: { ...value.log, entries: [{ ...entry, readyForTurnIn: 0 }] } }).success).toBe(false)
    expect(safeParse(questSnapshotSchema, { ...value, log: { ...value.log, entries: [{ ...entry, objectives: [...entry.objectives, entry.objectives[0]] }] } }).success).toBe(false)
    const many = Array.from({ length: 50 }, (_, index) => ({ ...entry, questID: index + 1, objectives: Array.from({ length: 8 }, (_, objective) => ({ ...entry.objectives[0], index: objective + 1, text: '中'.repeat(256) })) }))
    expect(safeParse(questSnapshotSchema, { ...value, log: { complete: true, truncated: false, total: 50, entries: many } }).success).toBe(false)
  })

  it('accepts optional addon advice without applying a second game-rule algorithm', () => {
    const value = { ...snapshot(), advice: { v: 1, playerLevel: 15, candidates: [{ kind: 'level-risk', questID: 42, eventAt: null }] } }
    expect(parse(questSnapshotSchema, value).advice).toEqual(value.advice)
    expect(parse(questSnapshotSchema, snapshot()).advice).toBeUndefined()
  })

  it.each([
    { v: 2, playerLevel: 15, candidates: [] },
    { v: 1, playerLevel: null, candidates: [{ kind: 'ready', questID: 42, eventAt: null }] },
    { v: 1, playerLevel: 15, candidates: [{ kind: 'ready', questID: 43, eventAt: null }] },
    { v: 1, playerLevel: 15, candidates: [{ kind: 'ready', questID: 42, eventAt: 1700000000 }] },
    { v: 1, playerLevel: 15, candidates: [{ kind: 'leveling', questID: 42, eventAt: null }] },
    { v: 1, playerLevel: 15, candidates: [{ kind: 'turned-in', questID: 42, eventAt: 1700000000 }] },
    { v: 1, playerLevel: 15, candidates: [{ kind: 'leveling', questID: 42, eventAt: 1700000001 }] },
    { v: 1, playerLevel: 15, candidates: [{ kind: 'ready', questID: 42, eventAt: null }, { kind: 'ready', questID: 42, eventAt: null }] },
  ])('rejects uncorrelated, duplicate or malformed advice %j', (advice) => {
    expect(safeParse(questSnapshotSchema, { ...snapshot(), advice }).success).toBe(false)
  })
})
