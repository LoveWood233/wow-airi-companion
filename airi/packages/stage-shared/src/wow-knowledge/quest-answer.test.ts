import type { WowQuestQuery, WowQuestResult } from './quest-assistant'

import { describe, expect, it } from 'vitest'

import detail from './fixtures/quest-detail-horde.json'
import listed from './fixtures/quest-list-horde.json'

import { readWowQuestAnswer } from './quest-answer'
import { queryWowQuestLog } from './quest-assistant'
import { readWowQuestSource } from './quest-source'

const selected: WowQuestQuery = { operation: 'detail', game: 'forever', questId: 844, level: 15, faction: 'Horde' }
const search: WowQuestQuery = { operation: 'search', game: 'forever', level: 15, faction: 'Horde', limit: 4 }
function args(query: WowQuestQuery) {
  return JSON.stringify({ request: JSON.stringify(query) })
}
function result(): WowQuestResult {
  return readWowQuestSource(detail, selected)!
}

describe('recorded quest answer boundary', () => {
  it('accepts only normalized bounded domain results for the recorded request', () => {
    expect(readWowQuestAnswer(result(), args(selected))?.entries[0]?.questId).toBe(844)
    expect(readWowQuestAnswer(JSON.stringify(result()), args(selected))?.entries[0]?.chain).toHaveLength(12)
    expect(readWowQuestAnswer(detail, args(selected))).toBeUndefined()
    expect(readWowQuestAnswer({ content: [{ type: 'text', text: JSON.stringify(result()) }] }, args(selected))).toBeUndefined()
  })

  it('reads the standard persisted chat text parts without accepting ambiguous multiple results', () => {
    const parts = [{ type: 'text', text: JSON.stringify(result()) }]
    expect(readWowQuestAnswer(parts, args(selected))?.entries[0]?.questId).toBe(844)
    expect(readWowQuestAnswer(JSON.stringify(parts), args(selected))?.entries[0]?.questId).toBe(844)
    expect(readWowQuestAnswer([...parts, ...parts], args(selected))).toBeUndefined()
    expect(readWowQuestAnswer([{ type: 'text', text: '任务已经完成' }], args(selected))).toBeUndefined()
  })

  it('checks the exact game, operation, selected ID and pagination', () => {
    expect(readWowQuestAnswer(result(), args({ ...selected, game: 'retail' }))).toBeUndefined()
    expect(readWowQuestAnswer(result(), args({ ...selected, questId: 845 }))).toBeUndefined()
    expect(readWowQuestAnswer(result(), args(search))).toBeUndefined()
    const page = readWowQuestSource(listed, search)!
    expect(readWowQuestAnswer(page, args(search))).toBeDefined()
    expect(readWowQuestAnswer(page, args({ ...search, offset: 4 }))).toBeUndefined()
    expect(readWowQuestAnswer(page, args({ ...search, limit: 5 }))).toBeUndefined()
  })

  it('rejects unsupported wrapper keys and arbitrary metadata', () => {
    expect(readWowQuestAnswer(result(), JSON.stringify(selected))).toBeUndefined()
    expect(readWowQuestAnswer(result(), JSON.stringify({ request: JSON.stringify(selected), sql: 'select 1' }))).toBeUndefined()
    expect(readWowQuestAnswer({ ...result(), path: 'private' }, args(selected))).toBeUndefined()
    expect(readWowQuestAnswer({ ...result(), errorCode: 'source-invalid' }, args(selected))).toBeUndefined()
  })

  it('rejects forged progress without matching quest-log provenance', () => {
    const original = result()
    const entry = original.entries[0]!
    expect(readWowQuestAnswer({ ...original, entries: [{ ...entry, progress: { status: 'turned-in', observedAt: '2026-11-01T09:00:00Z', lastTurnInAt: '2026-11-01T08:00:00Z' } }] }, args(selected))).toBeUndefined()
    expect(readWowQuestAnswer({ ...original, entries: [{ ...entry, progress: { status: 'objectives-complete', observedAt: '2026-11-01T09:00:00Z', objectivesCovered: true, objectives: [] } }] }, args(selected))).toBeUndefined()
  })

  it('rejects damaged recorded progress that contradicts its log or completion evidence', () => {
    const original = result()
    const observedAt = '2026-11-01T09:00:00Z'
    const withLog = { ...original, sources: [...original.sources, { kind: 'quest-log', game: 'forever', name: '角色任务遥测', observedAt }] }
    const entry = original.entries[0]!
    for (const status of ['active', 'ready-to-turn-in', 'failed'])
      expect(readWowQuestAnswer({ ...withLog, entries: [{ ...entry, progress: { status, inLog: false, observedAt } }] }, args(selected))).toBeUndefined()
    expect(readWowQuestAnswer({ ...withLog, entries: [{ ...entry, progress: { status: 'turned-in', inLog: true, observedAt, lastTurnInAt: observedAt } }] }, args(selected))).toBeUndefined()
    expect(readWowQuestAnswer({ ...withLog, entries: [{ ...entry, progress: { status: 'completed-flag', inLog: true, observedAt, clientCompleted: true, completionScope: 'unknown' } }] }, args(selected))).toBeUndefined()
    expect(readWowQuestAnswer({ ...withLog, entries: [{ ...entry, progress: { status: 'active', inLog: true, observedAt, clientCompleted: true } }] }, args(selected))).toBeUndefined()
    expect(readWowQuestAnswer({ ...withLog, entries: [{ ...entry, progress: { status: 'active', inLog: true, observedAt } }] }, args(selected))).toBeDefined()
  })

  it('keeps client completion flags distinct from a real turn-in', () => {
    const request: WowQuestQuery = { operation: 'detail', game: 'retail', questId: 11 }
    const observed = { game: 'retail' as const, guid: 'Player-1', session: 's1', snapshot: { guid: 'Player-1', session: 's1', observedAt: '2026-11-01T09:00:00Z', log: { complete: true, truncated: false, total: 0, entries: [] }, completion: { source: 'completed-api' as const, scope: 'unknown' as const, complete: true, truncated: false, total: 1, ids: [11], turnIns: [] } } }
    const output = queryWowQuestLog(request, observed)
    expect(readWowQuestAnswer(output, args(request))?.entries[0]?.progress.status).toBe('completed-flag')
    const forged = { ...output, entries: [{ ...output.entries[0]!, progress: { ...output.entries[0]!.progress, status: 'turned-in' } }] }
    expect(readWowQuestAnswer(forged, args(request))).toBeUndefined()
  })

  it('rejects Forever sources or external task references in a Retail result', () => {
    const original = result()
    const retail = { ...original, game: 'retail' }
    expect(readWowQuestAnswer(retail, args({ ...selected, game: 'retail' }))).toBeUndefined()
    expect(readWowQuestAnswer({ ...retail, sources: [{ kind: 'quest-log', game: 'retail', name: '角色任务遥测', observedAt: '2026-11-01T09:00:00Z' }] }, args({ ...selected, game: 'retail' }))).toBeUndefined()
  })

  it('requires an actual source for a confirmed empty answer', () => {
    const empty = { operation: 'search', game: 'forever', outcome: 'empty', entries: [], offset: 0, limit: 4, hasMore: false, sources: [], notices: [] }
    expect(readWowQuestAnswer(empty, args(search))).toBeUndefined()
  })

  it('rejects inconsistent cache clocks and invalid coordinate ranges', () => {
    const original = result()
    expect(readWowQuestAnswer({ ...original, sources: [{ ...original.sources[0], cache: { status: 'hit', sourceReceivedAt: '2026-11-01T08:00:00Z', storedAt: '2026-11-01T08:00:00Z', servedAt: '2026-11-01T09:00:00Z', expiresAt: '2026-11-02T08:00:00Z' } }] }, args(selected))).toBeUndefined()
    const entry = original.entries[0]!
    expect(readWowQuestAnswer({ ...original, entries: [{ ...entry, locations: [{ ...entry.locations[0], x: 52.2 }] }] }, args(selected))).toBeUndefined()
  })

  it('bounds sparse arrays, long strings and cyclic input before schema traversal', () => {
    expect(readWowQuestAnswer({ ...result(), entries: new Array<unknown>(1_000_000) }, args(selected))).toBeUndefined()
    expect(readWowQuestAnswer({ ...result(), entries: new Array<unknown>(1) }, args(selected))).toBeUndefined()
    expect(readWowQuestAnswer({ ...result(), notices: ['x'.repeat(5000)] }, args(selected))).toBeUndefined()
    const cyclic: Record<string, unknown> = { ...result() }
    cyclic.self = cyclic
    expect(readWowQuestAnswer(cyclic, args(selected))).toBeUndefined()
  })
})
