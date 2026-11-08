import type { WowQuestActor, WowQuestCondition, WowQuestContext, WowQuestEntry, WowQuestFaction, WowQuestLocation, WowQuestQuery, WowQuestReference, WowQuestRequirement, WowQuestResult } from './quest-assistant'

import { readWowCraftingPayload } from './crafting-source'
import { enrichWowQuestEntries, wowQuestFailure } from './quest-assistant'
import { readWowReferenceAnswer, safeWowReferenceUrl } from './structured-answers'

type Row = Record<string, unknown>

function object(value: unknown): Row | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined
}

function text(value: unknown, maximum = 400): string | undefined {
  if (typeof value !== 'string')
    return undefined
  const result = value.replace(/[\p{Cc}\p{Cf}]/gu, character => character === '\n' ? character : '').trim()
  return result ? result.slice(0, maximum) : undefined
}

function integer(value: unknown, minimum = 0, maximum = 2_147_483_647): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : undefined
}

function rows(value: unknown, maximum: number): Row[] {
  return Array.isArray(value) ? value.slice(0, maximum).map(object).filter((row): row is Row => row !== undefined) : []
}

function id(value: unknown): number | undefined {
  if (typeof value === 'string' && /^quest:[1-9]\d{0,9}$/.test(value))
    return integer(Number(value.slice(6)), 1)
  return undefined
}

function link(value: unknown, path: 'quest' | 'atlas', target: number): string | undefined {
  const url = safeWowReferenceUrl(value)
  return url && new URL(url).pathname === `/${path}/${target}` ? url : undefined
}

function side(value: unknown): WowQuestFaction | undefined {
  if (value === '联盟' || value === 'Alliance')
    return 'Alliance'
  if (value === '部落' || value === 'Horde')
    return 'Horde'
  if (value === '中立' || value === 'Neutral' || value === '双方')
    return 'Neutral'
  return undefined
}

function reference(row: Row, temporary = false): WowQuestReference | undefined {
  const questId = integer(row.quest_id, 1) ?? id(row.id)
  if (!questId)
    return undefined
  return { questId, title: text(row.name ?? row.title), url: link(row.url, 'quest', questId), temporary: temporary || row.temporary_link === true, ...(typeof row.current === 'boolean' ? { current: row.current } : {}) }
}

function actors(value: unknown, temporary: boolean): WowQuestActor[] {
  return rows(value, 12).flatMap((row) => {
    const name = text(row.name)
    if (!name)
      return []
    return [{ name, id: integer(row.id, 1), kind: (['npc', 'object', 'item'].includes(String(row.kind)) ? row.kind : 'unknown') as WowQuestActor['kind'], temporary }]
  })
}

function locations(value: unknown): WowQuestLocation[] {
  return rows(value, 8).flatMap((group) => {
    const map = object(group.map)
    const mapId = integer(map?.ui_map)
    return rows(group.marks, 8).map((mark): WowQuestLocation => {
      const validCoordinates = typeof mark.x === 'number' && typeof mark.y === 'number' && Number.isFinite(mark.x) && Number.isFinite(mark.y) && mark.x >= 0 && mark.x <= 1 && mark.y >= 0 && mark.y <= 1
      const source = text(mark.source)
      return {
        mapId,
        mapName: text(map?.name),
        mapUrl: mapId === undefined ? undefined : link(map?.url, 'atlas', mapId),
        kind: mark.kind === 'obj' ? 'objective' : ['start', 'end', 'both'].includes(String(mark.kind)) ? mark.kind as 'start' | 'end' | 'both' : 'unknown',
        who: text(mark.who),
        place: text(mark.place),
        text: text(mark.text, 1000),
        source,
        ...(validCoordinates ? { x: mark.x as number, y: mark.y as number } : {}),
        temporary: /临时|QuestieDB|RestedXP/i.test(source ?? '') || mark.temporary === true,
      }
    })
  })
}

function scalar(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)
  if (typeof value === 'boolean')
    return String(value)
  return text(value)
}

function conditions(value: unknown): WowQuestCondition[] {
  const source = object(value)
  if (!source)
    return []
  const accepted = ['prerequisites_all', 'prerequisites_one_of', 'exclusive_with', 'taken_under', 'races', 'classes', 'skill', 'reputation_min', 'reputation_max', 'carry_items', 'repeatable']
  return accepted.flatMap((key) => {
    const value = source[key]
    const list = Array.isArray(value) ? value.slice(0, 20).map(item => scalar(item) ?? scalar(object(item)?.name) ?? scalar(object(item)?.quest_id) ?? scalar(object(item)?.id)).filter((item): item is string => item !== undefined) : []
    const rendered = Array.isArray(value) ? list.join(', ') : scalar(value)
    return rendered ? [{ key, value: rendered.slice(0, 1000), temporary: true }] : []
  })
}

function requirements(value: unknown, temporary: boolean): WowQuestRequirement[] {
  return rows(value, 20).map(row => ({ objectiveId: integer(row.objective_id, 1), itemId: integer(row.item_id, 1), type: text(row.type, 80), name: text(row.name), count: integer(row.count), text: text(row.text ?? row.description, 1000), optional: typeof row.optional === 'boolean' ? row.optional : undefined, temporary }))
}

function entry(row: Row, detail: boolean): WowQuestEntry | undefined {
  const questId = id(row.id) ?? integer(row.quest_id, 1)
  if (!questId || (row.quest_id !== undefined && integer(row.quest_id, 1) !== questId) || (row.id !== undefined && id(row.id) !== questId))
    return undefined
  const temporary = object(row.temporary)
  const level = integer(row.level, 1, 255) ?? integer(row.temporary_level ?? temporary?.level, 1, 255)
  const minLevel = integer(row.min_level, 1, 255) ?? integer(row.temporary_min_level ?? temporary?.min_level, 1, 255)
  const faction = side(row.side) ?? side(row.temporary_side ?? temporary?.side)
  const zone = text(row.zone) ?? text(row.temporary_zone ?? temporary?.zone)
  const marks = locations(row.map_marks)
  const previous = rows(row.previous_quests, 20).flatMap(row => reference(row) ?? [])
  if (previous.length === 0)
    previous.push(...rows(temporary?.previous_quests, 20).flatMap(row => reference(row, true) ?? []))
  const nextRow = object(row.next_quest) ?? object(temporary?.next_quest)
  const chain = rows(row.quest_chain, 40).flatMap(row => reference(row) ?? [])
  const notices = ['availability-unverified', 'prerequisites-unverified']
  if (faction === undefined)
    notices.push('faction-unverified')
  if (level === undefined)
    notices.push('level-unavailable')
  if (marks.every(mark => mark.x === undefined || mark.y === undefined))
    notices.push('coordinates-unavailable')
  if (!detail)
    notices.push('detail-not-loaded')
  if ([row.quest_chain, row.requirements, row.previous_quests].some(value => Array.isArray(value) && value.length > (value === row.quest_chain ? 40 : 20)) || rows(row.map_marks, 9).length > 8 || rows(row.map_marks, 8).some(group => Array.isArray(group.marks) && group.marks.length > 8))
    notices.push('result-truncated')
  const starts = actors(temporary?.starts ?? row.temporary_givers, true)
  const ends = actors(temporary?.ends, true)
  if (starts.length > 0 || ends.length > 0 || marks.some(mark => mark.temporary) || (side(row.side) === undefined && faction !== undefined) || chain.some(step => step.temporary))
    notices.push('temporary-data')
  return {
    id: `quest:${questId}`,
    questId,
    title: text(row.title ?? row.display_name ?? row.temporary_name),
    url: link(row.url, 'quest', questId),
    level,
    minLevel,
    faction,
    zone,
    levelTemporary: level !== undefined && integer(row.level, 1, 255) === undefined,
    minLevelTemporary: minLevel !== undefined && integer(row.min_level, 1, 255) === undefined,
    factionTemporary: faction !== undefined && side(row.side) === undefined,
    zoneTemporary: zone !== undefined && text(row.zone) === undefined,
    type: text(row.type, 120),
    confirmed: typeof row.confirmed === 'boolean' ? row.confirmed : undefined,
    reward: text(row.reward_brief, 1000),
    timeLimitSeconds: integer(row.time_limit_s, 1),
    requirements: requirements(Array.isArray(row.requirements) && row.requirements.length > 0 ? row.requirements : temporary?.objectives, !Array.isArray(row.requirements) || !(row.requirements.length > 0)),
    starts,
    ends,
    locations: marks,
    previous,
    next: nextRow ? reference(nextRow, row.next_quest === null || row.next_quest === undefined) : undefined,
    chain,
    conditions: conditions(temporary?.conditions),
    detail,
    risks: [],
    progress: { status: 'unknown' },
    notices,
  }
}

/**
 * Reads actual quests and fetch envelopes. No prose is interpreted as coordinates, prerequisites, or player progress.
 * @example readWowQuestSource({ outcome: 'empty', results: [] }, request)?.outcome // => 'empty'
 */
export function readWowQuestSource(raw: unknown, query: WowQuestQuery, context?: WowQuestContext): WowQuestResult | undefined {
  if (query.game !== 'forever')
    return undefined
  const payload = readWowCraftingPayload(raw)
  const report = readWowReferenceAnswer(raw, JSON.stringify({ name: 'wuxianwow::quests', arguments: {} }))
  if (!payload || !report || (payload.outcome !== undefined && !['ok', 'empty', 'not_found'].includes(String(payload.outcome))) || report.status === 'invalid' || report.status === 'error' || report.status === 'loading')
    return undefined
  const source = { kind: 'wuxianwow' as const, game: 'forever' as const, name: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', build: report.build, buildCreatedAt: report.buildCreatedAt, receivedAt: report.receivedAt, cache: report.cache }
  const offset = query.operation === 'search' ? query.offset ?? 0 : 0
  const limit = query.operation === 'search' ? query.limit ?? 20 : 1
  if (query.operation === 'detail' && payload.id !== undefined && id(payload.id) !== query.questId)
    return undefined
  if (query.operation === 'search' && ((payload.offset !== undefined && payload.offset !== offset) || (payload.limit !== undefined && payload.limit !== limit) || (payload.page_size !== undefined && payload.page_size !== limit)))
    return undefined
  if (report.status === 'empty')
    return { operation: query.operation, game: 'forever', outcome: 'empty', entries: [], offset, limit, hasMore: false, total: integer(payload.total), sources: [source], notices: [] }
  const metadata = object(payload.metadata)
  const detail = !Array.isArray(payload.results)
  if ((query.operation === 'detail') !== detail)
    return undefined
  const sourceRows = detail ? [{ ...metadata, ...payload }] : rows(payload.results, limit)
  const entries = sourceRows.flatMap(row => entry(row, detail) ?? [])
  if (query.operation === 'detail' && (entries.length !== 1 || entries[0]?.questId !== query.questId))
    return undefined
  const notices = ['availability-unverified', 'prerequisites-unverified']
  if (query.operation === 'search')
    notices.push('level-window-three')
  if (entries.length !== sourceRows.length || (Array.isArray(payload.results) && sourceRows.length !== payload.results.length) || report.notices.includes('incomplete'))
    notices.push('source-partial')
  if (entries.length === 0)
    return undefined
  if (query.operation === 'search' && sourceRows.length > limit)
    return wowQuestFailure(query, 'source-invalid')
  const enriched = enrichWowQuestEntries(entries, query, context)
  const sources = [source] as WowQuestResult['sources']
  if (enriched.some(entry => entry.progress.observedAt))
    sources.push({ kind: 'quest-log', game: query.game, name: '角色任务遥测', observedAt: context?.snapshot?.observedAt })
  return { operation: query.operation, game: 'forever', outcome: 'ok', entries: enriched, total: integer(payload.total), offset, limit, hasMore: payload.has_more === true, sources, notices }
}
