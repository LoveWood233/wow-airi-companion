import type { WowQuestContext, WowQuestEntry, WowQuestQuery } from './quest-assistant'

import { describe, expect, it } from 'vitest'

import classQuest from './fixtures/quest-detail-class.json'
import fetched from './fixtures/quest-detail-fetch.json'
import detail from './fixtures/quest-detail-horde.json'
import elite from './fixtures/quest-list-elite.json'
import listed from './fixtures/quest-list-horde.json'

import { assessWowQuestRisks, queryWowQuestLog, readWowQuestProgress, readWowQuestQuery, readWowQuestToolRequest } from './quest-assistant'
import { readWowQuestSource } from './quest-source'

const search: WowQuestQuery = { operation: 'search', game: 'forever', level: 15, faction: 'Horde', zone: '贫瘠之地', limit: 4 }
const selected: WowQuestQuery = { operation: 'detail', game: 'forever', questId: 844 }

function context(): WowQuestContext {
  return {
    game: 'retail',
    guid: 'Player-1',
    session: 'session-1',
    snapshot: {
      guid: 'Player-1',
      session: 'session-1',
      observedAt: '2026-11-01T09:00:00.000Z',
      log: { complete: true, truncated: false, total: 1, entries: [{ questID: 844, title: '实际日志任务', level: 18, header: '任务日志分类', readyForTurnIn: false, failed: false, objectivesComplete: true, objectives: [{ index: 1, text: '实际目标', type: 'item', fulfilled: 2, required: 7, finished: false }] }] },
      completion: { source: 'completed-api', scope: 'unknown', complete: true, truncated: false, total: 1, ids: [11], turnIns: [{ questID: 12, observedAt: '2026-11-01T08:59:00.000Z' }] },
    },
  }
}

function blankEntry(): WowQuestEntry {
  return { id: 'quest:1', questId: 1, requirements: [], starts: [], ends: [], locations: [], previous: [], chain: [], conditions: [], detail: true, risks: [], progress: { status: 'unknown' }, notices: [] }
}

describe('quest assistant requests', () => {
  it('accepts explicit versions, unknown factions, level255 and empty optional filters', () => {
    expect(readWowQuestQuery({ ...search, level: 255, faction: 'Unknown', zone: undefined })).toMatchObject({ level: 255, faction: 'Unknown' })
    expect(readWowQuestQuery({ ...search, faction: 'Neutral' })?.operation).toBe('search')
    expect(readWowQuestQuery({ operation: 'detail', game: 'retail', questId: 2_147_483_647 })).toBeDefined()
  })

  it('rejects extra tool parameters, unsupported games, controls and oversized pages', () => {
    for (const patch of [{ game: 'classic' }, { level: 0 }, { level: 256 }, { level: 1.5 }, { faction: '部落' }, { limit: 21 }, { offset: 10001 }, { zone: '  ' }, { query: 'x\u0000y' }, { path: 'file' }, { sql: 'select 1' }])
      expect(readWowQuestQuery({ ...search, ...patch })).toBeUndefined()
    expect(readWowQuestQuery({ ...selected, questId: 0 })).toBeUndefined()
  })

  it('requires the exact JSON-string tool wrapper', () => {
    expect(readWowQuestToolRequest({ request: JSON.stringify(selected) })).toEqual(selected)
    for (const input of [selected, { request: selected }, { request: '{' }, { request: JSON.stringify(selected), path: 'file' }, { request: JSON.stringify({ ...selected, sql: 'select 1' }) }])
      expect(readWowQuestToolRequest(input)).toBeUndefined()
  })
})

describe('actual Forever quest records', () => {
  it('reads the real bounded Horde list and preserves temporary faction and pagination', () => {
    const result = readWowQuestSource({ content: [{ type: 'text', text: JSON.stringify(listed) }] }, search)
    expect(result).toMatchObject({ game: 'forever', outcome: 'ok', total: 48, offset: 0, limit: 4, hasMore: true })
    expect(result?.entries).toHaveLength(4)
    expect(result?.entries[0]).toMatchObject({ questId: 844, title: '平原陆行鸟的威胁', level: 12, minLevel: 10, zone: '贫瘠之地', faction: 'Horde', factionTemporary: true, confirmed: true, detail: false, progress: { status: 'unknown' } })
    expect(result?.entries[0]?.notices).toContain('detail-not-loaded')
    expect(result?.entries[0]?.notices).toContain('prerequisites-unverified')
  })

  it('reads actual chains, NPCs, map ratios and distinct item/objective ids', () => {
    const entry = readWowQuestSource(detail, selected)?.entries[0]
    expect(entry?.starts).toEqual([{ id: 3338, kind: 'npc', name: '瑟格拉·黑棘', temporary: true }])
    expect(entry?.ends).toEqual(entry?.starts)
    expect(entry?.chain).toHaveLength(12)
    expect(entry?.chain[1]).toMatchObject({ questId: 844, current: true, temporary: false })
    expect(entry?.previous[0]).toMatchObject({ questId: 860 })
    expect(entry?.next).toMatchObject({ questId: 845 })
    expect(entry?.locations[0]).toMatchObject({ kind: 'both', mapId: 1413, mapName: '贫瘠之地', x: 0.5223, y: 0.3101, temporary: true })
    expect(entry?.requirements[0]).toMatchObject({ itemId: 5087, objectiveId: 380805, count: 7, temporary: false })
    expect(entry?.notices).toContain('temporary-data')
  })

  it('reads the real fetch metadata shape without flattening prose into facts', () => {
    const result = readWowQuestSource({ structuredContent: fetched }, selected)
    expect(result?.entries[0]?.starts[0]?.name).toBe('瑟格拉·黑棘')
    expect(result?.entries[0]?.chain).toHaveLength(12)
    const withoutStructuredPositions = { ...detail, map_marks: [], guide_text: '接：瑟格拉·黑棘（十字路口 52.2, 31.0）', text: '任务已完成' }
    const entry = readWowQuestSource(withoutStructuredPositions, selected)?.entries[0]
    expect(entry?.locations).toEqual([])
    expect(entry?.progress.status).toBe('unknown')
    expect(entry?.notices).toContain('coordinates-unavailable')
  })

  it('keeps real class and mutually exclusive conditions temporary without claiming eligibility', () => {
    const entry = readWowQuestSource(classQuest, { ...selected, questId: 1638, level: 15, faction: 'Horde' })?.entries[0]
    expect(entry?.conditions).toContainEqual({ key: 'classes', value: '战士', temporary: true })
    expect(entry?.conditions).toContainEqual({ key: 'exclusive_with', value: '穆伦·雷矛, 艾兰娜瑞', temporary: true })
    expect(entry?.risks).toContainEqual({ code: 'faction-mismatch' })
    expect(entry?.notices).toContain('availability-unverified')
  })

  it('retains original source and cache receipt times', () => {
    const receivedAt = '2026-11-01T08:00:00.000Z'
    const cache = { status: 'hit', sourceReceivedAt: receivedAt, storedAt: receivedAt, servedAt: '2026-11-01T09:00:00.000Z', expiresAt: '2026-11-02T08:00:00.000Z' }
    const result = readWowQuestSource({ structuredContent: detail, wowReference: { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', build: '1.60.1.70707', buildCreatedAt: '2026-10-30T22:25:37+11:00', receivedAt }, cache }, selected)
    expect(result?.sources[0]).toMatchObject({ receivedAt, cache, build: '1.60.1.70707' })
  })

  it('drops invalid coordinates and foreign or mismatched links', () => {
    const result = readWowQuestSource({ ...detail, url: 'https://wuxianwow.com/quest/999', map_marks: [{ map: { ui_map: 1413, name: '贫瘠之地', url: 'https://example.com/map' }, marks: [{ kind: 'both', x: 52.2, y: 31, source: '临时' }] }] }, selected)
    expect(result?.entries[0]?.url).toBeUndefined()
    expect(result?.entries[0]?.locations[0]).toMatchObject({ mapId: 1413, kind: 'both', temporary: true })
    expect(result?.entries[0]?.locations[0]?.mapUrl).toBeUndefined()
    expect(result?.entries[0]?.locations[0]?.x).toBeUndefined()
  })

  it('rejects cross-version records, wrong selected IDs and unsupported outcomes', () => {
    expect(readWowQuestSource({ ...detail, game: 'retail' }, selected)).toBeUndefined()
    expect(readWowQuestSource(detail, { ...selected, game: 'retail' })).toBeUndefined()
    expect(readWowQuestSource(detail, { ...selected, questId: 845 })).toBeUndefined()
    expect(readWowQuestSource({ ...detail, quest_id: 845 }, selected)).toBeUndefined()
    expect(readWowQuestSource({ ...detail, outcome: 'no_data' }, selected)).toBeUndefined()
    expect(readWowQuestSource({ ...detail, outcome: 'error' }, selected)).toBeUndefined()
  })

  it('preserves a confirmed empty result without claiming unavailable data is absent', () => {
    expect(readWowQuestSource({ outcome: 'empty', results: [], total: 0 }, search)).toMatchObject({ outcome: 'empty', entries: [], total: 0 })
    expect(readWowQuestSource({ outcome: 'not_found', id: 'quest:844' }, selected)).toMatchObject({ outcome: 'empty' })
  })

  it('rejects source pagination that does not match the explicit requested page', () => {
    expect(readWowQuestSource({ ...listed, offset: 4 }, search)).toBeUndefined()
    expect(readWowQuestSource({ ...listed, limit: 20 }, search)).toBeUndefined()
    expect(readWowQuestSource({ outcome: 'empty', results: [], offset: 4 }, search)).toBeUndefined()
  })

  it('marks elite and level risks from recorded fields and leaves unknown facts unknown', () => {
    const entry = readWowQuestSource(elite, { ...search, level: 8, limit: 2 })?.entries[0]
    expect(entry?.risks.map(risk => risk.code)).toEqual(['higher-level', 'elite'])
    expect(assessWowQuestRisks({ ...blankEntry(), level: 20, minLevel: 18, faction: 'Alliance', type: '精英 / 地下城 / 团队 / PvP', timeLimitSeconds: 60 }, search).map(risk => risk.code)).toEqual(['minimum-level', 'higher-level', 'faction-mismatch', 'elite', 'dungeon', 'raid', 'pvp', 'timed'])
    expect(assessWowQuestRisks({ ...blankEntry(), faction: 'Alliance' }, { ...search, faction: 'Unknown' })).toEqual([])
  })
})

describe('actual character quest evidence', () => {
  it('does not treat objective-list coverage as target completion', () => {
    const observed = context()
    expect(readWowQuestProgress(844, observed, 'retail').status).toBe('active')
    observed.snapshot!.log.entries[0]!.objectives[0]!.finished = true
    expect(readWowQuestProgress(844, observed, 'retail').status).toBe('objectives-complete')
    observed.snapshot!.log.entries[0]!.objectives = []
    expect(readWowQuestProgress(844, observed, 'retail').status).toBe('active')
  })

  it('distinguishes ready, failed, client flags and a recorded turn-in', () => {
    const observed = context()
    expect(readWowQuestProgress(11, observed, 'retail')).toMatchObject({ status: 'completed-flag', clientCompleted: true, completionScope: 'unknown' })
    expect(readWowQuestProgress(12, observed, 'retail')).toMatchObject({ status: 'turned-in', lastTurnInAt: '2026-11-01T08:59:00.000Z' })
    observed.snapshot!.log.entries[0]!.readyForTurnIn = true
    expect(readWowQuestProgress(844, observed, 'retail').status).toBe('ready-to-turn-in')
    observed.snapshot!.log.entries[0]!.failed = true
    expect(readWowQuestProgress(844, observed, 'retail').status).toBe('failed')
  })

  it('keeps a repeatable task current state separate from its previous turn-in', () => {
    const observed = context()
    observed.snapshot!.completion.turnIns.push({ questID: 844, observedAt: '2026-11-01T08:58:00.000Z' })
    expect(readWowQuestProgress(844, observed, 'retail')).toMatchObject({ status: 'active', inLog: true, lastTurnInAt: '2026-11-01T08:58:00.000Z' })
  })

  it('never infers completion from absence, truncated logs or a different identity', () => {
    const observed = context()
    expect(readWowQuestProgress(999, observed, 'retail')).toMatchObject({ status: 'unknown', inLog: false })
    observed.snapshot!.log.truncated = true
    expect(readWowQuestProgress(999, observed, 'retail').inLog).toBeUndefined()
    expect(readWowQuestProgress(844, { ...observed, guid: 'Player-2' }, 'retail')).toEqual({ status: 'unknown' })
    expect(readWowQuestProgress(844, { ...observed, session: 'session-2' }, 'retail')).toEqual({ status: 'unknown' })
    expect(readWowQuestProgress(844, observed, 'forever')).toEqual({ status: 'unknown' })
  })

  it('filters only Retail log evidence and labels its header as a category', () => {
    const result = queryWowQuestLog({ ...search, game: 'retail', zone: '分类' }, context())
    expect(result).toMatchObject({ outcome: 'ok', total: 1, sources: [{ kind: 'quest-log', game: 'retail' }] })
    expect(result.entries[0]).toMatchObject({ title: '实际日志任务', logCategory: '任务日志分类', level: 18, progress: { status: 'active' } })
    expect(result.entries[0]?.zone).toBeUndefined()
    expect(result.entries[0]?.url).toBeUndefined()
    expect(result.notices).toContain('local-quest-log-only')
  })

  it('returns completion-only detail with an unknown title instead of fabricating a database record', () => {
    const result = queryWowQuestLog({ operation: 'detail', game: 'retail', questId: 11 }, context())
    expect(result.entries[0]).toMatchObject({ questId: 11, progress: { status: 'completed-flag' } })
    expect(result.entries[0]?.title).toBeUndefined()
    expect(result.entries[0]?.notices).toContain('title-unavailable')
  })

  it('fails closed for unavailable or wrong-version telemetry', () => {
    expect(queryWowQuestLog({ ...search, game: 'retail' })).toMatchObject({ outcome: 'unavailable', errorCode: 'telemetry-game-mismatch' })
    expect(queryWowQuestLog({ ...search, game: 'retail' }, { game: 'retail' })).toMatchObject({ outcome: 'unavailable', errorCode: 'telemetry-unavailable' })
  })

  it('filters known log levels within three and retains unknown levels without guessing a recommendation', () => {
    const observed = context()
    const row = observed.snapshot!.log.entries[0]!
    observed.snapshot!.log.entries.push({ ...row, questID: 845, level: 60 }, { ...row, questID: 846, level: 0 })
    observed.snapshot!.log.total = 3
    const result = queryWowQuestLog({ ...search, game: 'retail', zone: undefined }, observed)
    expect(result.entries.map(entry => entry.questId)).toEqual([844, 846])
    expect(result.entries[1]?.level).toBeUndefined()
    expect(result.entries[1]?.notices).toContain('level-unavailable')
    expect(result.notices).toContain('faction-filter-unavailable')
  })
})
