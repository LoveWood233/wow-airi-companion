import type { InferOutput } from 'valibot'

import type { WowDataCacheEvidence } from './wow-data-cache'

import { check, integer, literal, maxLength, maxValue, minLength, minValue, number, optional, picklist, pipe, safeParse, strictObject, string, variant } from 'valibot'

/** Both the page and model tool validate the same bounded, read-only request. */
export const WOW_QUEST_ASSISTANT_TOOL_NAME = 'builtIn_wowQuestAssistant'
export const WOW_QUEST_ASSISTANT_TOOL_DESCRIPTION = 'Read quest and leveling references for a specific game. The request is a JSON string: {"operation":"search","game":"forever","level":15,"faction":"Horde","zone":"贫瘠之地"} or {"operation":"detail","game":"forever","questId":844}. Search supports level 1..255, faction Alliance/Horde/Neutral/Unknown, optional zone/query, limit 1..20 and offset 0..10000. Forever uses the read-only 无限图鉴 wuxianwow.com database. Retail uses only the current character quest-log snapshot, never Forever data. Quest chains and NPC coordinates can be temporary third-party data. Missing prerequisites or coordinates remain unknown. Client completion flags do not prove turn-in. Only observed turn-in events prove a session turn-in. Do not claim a quest is available, safe, active, completed or turned in without the stated evidence.'

const textQuery = (maximum: number) => pipe(string(), minLength(1), maxLength(maximum), check(value => value.trim().length > 0 && !/[\p{Cc}\p{Cf}]/u.test(value)))
const questId = pipe(number(), integer(), minValue(1), maxValue(2_147_483_647))
const level = pipe(number(), integer(), minValue(1), maxValue(255))
const game = picklist(['retail', 'forever'])
const faction = picklist(['Alliance', 'Horde', 'Neutral', 'Unknown'])

export const wowQuestQuerySchema = variant('operation', [
  strictObject({
    operation: literal('search'),
    game,
    level,
    faction,
    zone: optional(textQuery(120)),
    query: optional(textQuery(160)),
    limit: optional(pipe(number(), integer(), minValue(1), maxValue(20))),
    offset: optional(pipe(number(), integer(), minValue(0), maxValue(10_000))),
  }),
  strictObject({ operation: literal('detail'), game, questId, level: optional(level), faction: optional(faction) }),
])
export type WowQuestQuery = InferOutput<typeof wowQuestQuerySchema>
export type WowQuestFaction = InferOutput<typeof faction>
export const wowQuestToolArgumentsSchema = strictObject({ request: pipe(string(), minLength(1), maxLength(4096)) })

export interface WowQuestReference { questId: number, title?: string, url?: string, temporary: boolean, current?: boolean }
export interface WowQuestActor { kind: 'npc' | 'object' | 'item' | 'unknown', id?: number, name: string, temporary: boolean }
export interface WowQuestLocation {
  mapId?: number
  mapName?: string
  mapUrl?: string
  kind: 'start' | 'end' | 'both' | 'objective' | 'unknown'
  who?: string
  place?: string
  x?: number
  y?: number
  text?: string
  source?: string
  temporary: boolean
}
export interface WowQuestRequirement { objectiveId?: number, itemId?: number, type?: string, name?: string, count?: number, text?: string, optional?: boolean, temporary: boolean }
export interface WowQuestCondition { key: string, value: string, temporary: boolean }
export type WowQuestRiskCode = 'minimum-level' | 'higher-level' | 'elite' | 'dungeon' | 'raid' | 'pvp' | 'timed' | 'faction-mismatch'
export interface WowQuestRisk { code: WowQuestRiskCode, questLevel?: number, minimumLevel?: number, playerLevel?: number, type?: string }
export interface WowQuestObservedObjective { index: number, text: string | null, type: string | null, fulfilled: number | null, required: number | null, finished: boolean | null }
export interface WowQuestLogEntry {
  questID: number
  title: string | null
  level: number | null
  header: string | null
  readyForTurnIn: boolean | null
  failed: boolean | null
  /** This describes coverage of the objective list, not completion of its objectives. */
  objectivesComplete: boolean
  objectives: WowQuestObservedObjective[]
}

/** Normalized character observations use ISO clocks. The desktop client projects validated addon epoch clocks and checks character identity. */
export interface WowQuestTelemetrySnapshot {
  guid: string
  session: string
  observedAt: string
  log: { complete: boolean, truncated: boolean, total: number | null, entries: WowQuestLogEntry[] }
  completion: { source: 'completed-api' | 'session-events' | 'unknown', scope: 'unknown', complete: boolean, truncated: boolean, total: number | null, ids: number[], turnIns: { questID: number, observedAt: string }[] }
}
export interface WowQuestContext { game: 'retail' | 'forever' | 'unknown', guid?: string, session?: string, snapshot?: WowQuestTelemetrySnapshot }
export interface WowQuestProgress {
  status: 'unknown' | 'active' | 'ready-to-turn-in' | 'objectives-complete' | 'failed' | 'completed-flag' | 'turned-in'
  inLog?: boolean
  observedAt?: string
  clientCompleted?: true
  completionScope?: 'unknown'
  lastTurnInAt?: string
  objectives?: WowQuestObservedObjective[]
  objectivesCovered?: boolean
}

export interface WowQuestEntry {
  id: string
  questId: number
  title?: string
  url?: string
  level?: number
  levelTemporary?: boolean
  minLevel?: number
  minLevelTemporary?: boolean
  zone?: string
  logCategory?: string
  zoneTemporary?: boolean
  faction?: WowQuestFaction
  factionTemporary?: boolean
  type?: string
  confirmed?: boolean
  reward?: string
  timeLimitSeconds?: number
  requirements: WowQuestRequirement[]
  starts: WowQuestActor[]
  ends: WowQuestActor[]
  locations: WowQuestLocation[]
  previous: WowQuestReference[]
  next?: WowQuestReference
  chain: WowQuestReference[]
  conditions: WowQuestCondition[]
  detail: boolean
  risks: WowQuestRisk[]
  progress: WowQuestProgress
  notices: string[]
}
export interface WowQuestSourceEvidence {
  kind: 'wuxianwow' | 'quest-log'
  game: 'retail' | 'forever'
  name: string
  sourceUrl?: string
  build?: string
  buildCreatedAt?: string
  receivedAt?: string
  observedAt?: string
  cache?: WowDataCacheEvidence
}
export type WowQuestError = 'invalid-query' | 'source-unavailable' | 'source-invalid' | 'telemetry-unavailable' | 'telemetry-game-mismatch'
export interface WowQuestResult {
  operation: WowQuestQuery['operation']
  game: 'retail' | 'forever'
  outcome: 'ok' | 'empty' | 'unavailable' | 'error'
  entries: WowQuestEntry[]
  total?: number
  offset: number
  limit: number
  hasMore: boolean
  sources: WowQuestSourceEvidence[]
  notices: string[]
  errorCode?: WowQuestError
}

/**
 * Rejects extra model parameters before any local or remote request.
 * @example readWowQuestQuery({ operation: 'detail', game: 'forever', questId: 844 })?.operation // => 'detail'
 */
export function readWowQuestQuery(value: unknown): WowQuestQuery | undefined {
  const result = safeParse(wowQuestQuerySchema, value)
  return result.success ? result.output : undefined
}

/**
 * Decodes the provider-friendly tool wrapper and validates its inner request.
 * @example readWowQuestToolRequest({ request: '{"operation":"detail","game":"forever","questId":844}' })?.questId // => 844
 */
export function readWowQuestToolRequest(value: unknown): WowQuestQuery | undefined {
  const result = safeParse(wowQuestToolArgumentsSchema, value)
  if (!result.success)
    return undefined
  try {
    return readWowQuestQuery(JSON.parse(result.output.request) as unknown)
  }
  catch { return undefined }
}

/**
 * Missing evidence remains unknown. An old turn-in event never replaces the state of a newly accepted repeatable quest.
 * @example readWowQuestProgress(844, undefined, 'forever').status // => 'unknown'
 */
export function readWowQuestProgress(id: number, context: WowQuestContext | undefined, requestedGame: 'forever' | 'retail'): WowQuestProgress {
  const snapshot = context?.snapshot
  if (!snapshot || context.game !== requestedGame || !context.guid || !context.session || context.guid !== snapshot.guid || context.session !== snapshot.session)
    return { status: 'unknown' }
  const row = snapshot.log.entries.find(entry => entry.questID === id)
  const turnIn = snapshot.completion.turnIns.filter(entry => entry.questID === id).toSorted((a, b) => b.observedAt.localeCompare(a.observedAt))[0]
  const completed = snapshot.completion.source === 'completed-api' && snapshot.completion.ids.includes(id)
  const progress: WowQuestProgress = {
    status: 'unknown',
    observedAt: snapshot.observedAt,
    ...(row ? { inLog: true, objectives: row.objectives, objectivesCovered: row.objectivesComplete } : snapshot.log.complete && !snapshot.log.truncated ? { inLog: false } : {}),
    ...(turnIn ? { lastTurnInAt: turnIn.observedAt } : {}),
    ...(completed ? { clientCompleted: true, completionScope: 'unknown' } : {}),
  }
  if (row) {
    if (row.failed === true)
      progress.status = 'failed'
    else if (row.readyForTurnIn === true)
      progress.status = 'ready-to-turn-in'
    else if (row.objectivesComplete && row.objectives.length > 0 && row.objectives.every(objective => objective.finished === true))
      progress.status = 'objectives-complete'
    else
      progress.status = 'active'
  }
  else if (turnIn) {
    progress.status = 'turned-in'
  }
  else if (completed) {
    progress.status = 'completed-flag'
  }
  return progress
}

/** Risks compare known task facts with the requested level. They never certify that an unflagged quest is safe or available. */
export function assessWowQuestRisks(entry: WowQuestEntry, query: WowQuestQuery): WowQuestRisk[] {
  const risks: WowQuestRisk[] = []
  if (query.level !== undefined) {
    if (entry.minLevel !== undefined && entry.minLevel > query.level)
      risks.push({ code: 'minimum-level', minimumLevel: entry.minLevel, playerLevel: query.level })
    if (entry.level !== undefined && entry.level > query.level)
      risks.push({ code: 'higher-level', questLevel: entry.level, playerLevel: query.level })
  }
  if (query.faction !== undefined) {
    if (query.faction !== 'Unknown' && entry.faction !== undefined && entry.faction !== 'Unknown' && entry.faction !== 'Neutral' && query.faction !== entry.faction)
      risks.push({ code: 'faction-mismatch' })
  }
  const type = entry.type
  if (type) {
    for (const [code, pattern] of [['elite', /精英|elite/i], ['dungeon', /地下城|副本|dungeon/i], ['raid', /团队|raid/i], ['pvp', /PvP|玩家对战/i]] as const) {
      if (pattern.test(type))
        risks.push({ code, type })
    }
  }
  if (entry.timeLimitSeconds !== undefined && entry.timeLimitSeconds > 0)
    risks.push({ code: 'timed' })
  return risks
}

/** Adds only character-matched observations. The remote database never supplies player progress. */
export function enrichWowQuestEntries(entries: readonly WowQuestEntry[], query: WowQuestQuery, context?: WowQuestContext): WowQuestEntry[] {
  return entries.map(entry => ({ ...entry, risks: assessWowQuestRisks(entry, query), progress: readWowQuestProgress(entry.questId, context, query.game) }))
}

/** Creates a bounded failure result without leaking paths, network responses, or implementation errors. */
export function wowQuestFailure(query: WowQuestQuery, errorCode: WowQuestError): WowQuestResult {
  return { operation: query.operation, game: query.game, outcome: errorCode === 'source-invalid' || errorCode === 'invalid-query' ? 'error' : 'unavailable', entries: [], offset: query.operation === 'search' ? query.offset ?? 0 : 0, limit: query.operation === 'search' ? query.limit ?? 20 : 1, hasMore: false, sources: [], notices: [], errorCode }
}

/** Retail searches cover the observed quest log. They do not query a quest catalog or infer missing task chains. */
export function queryWowQuestLog(query: WowQuestQuery, context?: WowQuestContext): WowQuestResult {
  if (!context || context.game !== query.game)
    return wowQuestFailure(query, 'telemetry-game-mismatch')
  const snapshot = context.snapshot
  if (!snapshot || !context.guid || !context.session || snapshot.guid !== context.guid || snapshot.session !== context.session)
    return wowQuestFailure(query, 'telemetry-unavailable')
  const notices = ['local-quest-log-only', 'progress-snapshot-only', 'quest-log-header-not-map', 'prerequisites-unverified', 'coordinates-unavailable', 'faction-filter-unavailable']
  if (query.operation === 'search')
    notices.push('level-window-three')
  if (!snapshot.log.complete || snapshot.log.truncated)
    notices.push('quest-log-partial')
  const candidates = query.operation === 'detail'
    ? snapshot.log.entries.filter(row => row.questID === query.questId)
    : snapshot.log.entries.filter(row => (row.level === null || row.level <= 0 || Math.abs(row.level - query.level) <= 3) && (!query.query || `${row.title ?? ''} ${row.questID}`.includes(query.query.trim())) && (!query.zone || (row.header ?? '').includes(query.zone.trim())))
  const entries: WowQuestEntry[] = candidates.map(row => ({
    id: `quest:${row.questID}`,
    questId: row.questID,
    title: row.title ?? undefined,
    level: row.level !== null && row.level > 0 ? row.level : undefined,
    logCategory: row.header ?? undefined,
    requirements: [],
    starts: [],
    ends: [],
    locations: [],
    previous: [],
    chain: [],
    conditions: [],
    detail: true,
    risks: [],
    progress: { status: 'unknown' },
    notices: ['prerequisites-unverified', 'coordinates-unavailable', 'faction-unverified', 'quest-log-header-not-map', ...(row.level === null || row.level <= 0 ? ['level-unavailable'] : [])],
  }))
  if (query.operation === 'detail' && entries.length === 0) {
    const progress = readWowQuestProgress(query.questId, context, query.game)
    if (progress.status !== 'unknown')
      entries.push({ id: `quest:${query.questId}`, questId: query.questId, requirements: [], starts: [], ends: [], locations: [], previous: [], chain: [], conditions: [], detail: true, risks: [], progress, notices: ['title-unavailable', 'prerequisites-unverified', 'coordinates-unavailable'] })
  }
  const offset = query.operation === 'search' ? query.offset ?? 0 : 0
  const limit = query.operation === 'search' ? query.limit ?? 20 : 1
  const selected = enrichWowQuestEntries(entries.slice(offset, offset + limit), query, context)
  return { operation: query.operation, game: query.game, outcome: selected.length > 0 ? 'ok' : 'empty', entries: selected, total: entries.length, offset, limit, hasMore: entries.length > offset + limit, sources: [{ kind: 'quest-log', game: query.game, name: '角色任务遥测', observedAt: snapshot.observedAt }], notices }
}
