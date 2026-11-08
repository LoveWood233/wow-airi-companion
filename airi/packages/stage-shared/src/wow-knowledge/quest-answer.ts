import type { WowQuestResult } from './quest-assistant'

import { array, boolean, check, integer, literal, maxLength, maxValue, minLength, minValue, nullable, number, optional, picklist, pipe, regex, safeParse, strictObject, string, variant } from 'valibot'

import { readWowQuestToolRequest } from './quest-assistant'
import { readRecordedWowToolPayload } from './recorded-tool-result'
import { safeWowReferenceUrl } from './structured-answers'
import { wowDataCacheEvidenceSchema } from './wow-data-cache'

const text = (maximum: number) => pipe(string(), maxLength(maximum), check(value => !/[\p{Cc}\p{Cf}]/u.test(value.replaceAll('\n', ''))))
const identifier = pipe(number(), integer(), minValue(1), maxValue(2_147_483_647))
const count = pipe(number(), integer(), minValue(0), maxValue(2_147_483_647))
const level = pipe(number(), integer(), minValue(1), maxValue(255))
const faction = picklist(['Alliance', 'Horde', 'Neutral', 'Unknown'])
const notice = pipe(text(80), minLength(1), regex(/^[a-z]+(?:-[a-z]+)*$/))
const notices = pipe(array(notice), maxLength(24))
const localGame = picklist(['forever', 'retail'])
const sourceUrl = pipe(string(), maxLength(2048), check(value => safeWowReferenceUrl(value) === value))
const timestamp = pipe(string(), maxLength(40), check((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    return false
  const day = value.slice(0, 10)
  return Number(value.slice(11, 13)) < 24 && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day)
}))
const reference = strictObject({ questId: identifier, title: optional(text(400)), url: optional(sourceUrl), temporary: boolean(), current: optional(boolean()) })
const actor = strictObject({ kind: picklist(['npc', 'object', 'item', 'unknown']), id: optional(identifier), name: pipe(text(400), minLength(1)), temporary: boolean() })
const coordinate = pipe(number(), minValue(0), maxValue(1))
const location = pipe(strictObject({ mapId: optional(count), mapName: optional(text(400)), mapUrl: optional(sourceUrl), kind: picklist(['start', 'end', 'both', 'objective', 'unknown']), who: optional(text(400)), place: optional(text(400)), x: optional(coordinate), y: optional(coordinate), text: optional(text(1000)), source: optional(text(400)), temporary: boolean() }), check(value => (value.x === undefined) === (value.y === undefined)))
const observedObjective = strictObject({ index: pipe(number(), integer(), minValue(1), maxValue(8)), text: nullable(text(256)), type: nullable(text(40)), fulfilled: nullable(count), required: nullable(count), finished: nullable(boolean()) })
const progress = pipe(strictObject({
  status: picklist(['unknown', 'active', 'ready-to-turn-in', 'objectives-complete', 'failed', 'completed-flag', 'turned-in']),
  inLog: optional(boolean()),
  observedAt: optional(timestamp),
  clientCompleted: optional(literal(true)),
  completionScope: optional(literal('unknown')),
  lastTurnInAt: optional(timestamp),
  objectives: optional(pipe(array(observedObjective), maxLength(8))),
  objectivesCovered: optional(boolean()),
}), check(value => (value.status === 'unknown' || value.observedAt !== undefined)
  && (!['active', 'ready-to-turn-in', 'objectives-complete', 'failed'].includes(value.status) || value.inLog === true)
  && (!['turned-in', 'completed-flag'].includes(value.status) || value.inLog !== true)
  && ((value.clientCompleted === true) === (value.completionScope === 'unknown'))
  && (value.status !== 'turned-in' || value.lastTurnInAt !== undefined)
  && (value.status !== 'completed-flag' || (value.clientCompleted === true && value.completionScope === 'unknown'))
  && (value.status !== 'objectives-complete' || (value.objectivesCovered === true && value.objectives !== undefined && value.objectives.length > 0 && value.objectives.every(objective => objective.finished === true)))))

/** The card accepts only bounded domain results. It cannot turn arbitrary MCP text into a quest result. */
export const wowQuestEntrySchema = pipe(strictObject({
  id: pipe(string(), regex(/^quest:[1-9]\d{0,9}$/)),
  questId: identifier,
  title: optional(text(400)),
  url: optional(sourceUrl),
  level: optional(level),
  levelTemporary: optional(boolean()),
  minLevel: optional(level),
  minLevelTemporary: optional(boolean()),
  zone: optional(text(400)),
  logCategory: optional(text(128)),
  zoneTemporary: optional(boolean()),
  faction: optional(faction),
  factionTemporary: optional(boolean()),
  type: optional(text(120)),
  confirmed: optional(boolean()),
  reward: optional(text(1000)),
  timeLimitSeconds: optional(identifier),
  requirements: pipe(array(strictObject({ objectiveId: optional(identifier), itemId: optional(identifier), type: optional(text(80)), name: optional(text(400)), count: optional(count), text: optional(text(1000)), optional: optional(boolean()), temporary: boolean() })), maxLength(20)),
  starts: pipe(array(actor), maxLength(12)),
  ends: pipe(array(actor), maxLength(12)),
  locations: pipe(array(location), maxLength(64)),
  previous: pipe(array(reference), maxLength(20)),
  next: optional(reference),
  chain: pipe(array(reference), maxLength(40)),
  conditions: pipe(array(strictObject({ key: pipe(text(80), minLength(1)), value: text(1000), temporary: boolean() })), maxLength(12)),
  detail: boolean(),
  risks: pipe(array(strictObject({ code: picklist(['minimum-level', 'higher-level', 'elite', 'dungeon', 'raid', 'pvp', 'timed', 'faction-mismatch']), questLevel: optional(level), minimumLevel: optional(level), playerLevel: optional(level), type: optional(text(120)) })), maxLength(8)),
  progress,
  notices,
}), check(value => value.id === `quest:${value.questId}` && (!value.url || new URL(value.url).pathname === `/quest/${value.questId}`)))

const source = variant('kind', [
  pipe(strictObject({ kind: literal('wuxianwow'), game: literal('forever'), name: literal('无限图鉴 wuxianwow.com'), sourceUrl: literal('https://wuxianwow.com/'), build: optional(pipe(string(), maxLength(40), regex(/^\d+\.\d+\.\d+\.\d+$/))), buildCreatedAt: optional(timestamp), receivedAt: optional(timestamp), cache: optional(wowDataCacheEvidenceSchema) }), check(value => value.cache === undefined || value.cache.sourceReceivedAt === value.receivedAt)),
  strictObject({ kind: literal('quest-log'), game: localGame, name: literal('角色任务遥测'), observedAt: timestamp }),
])

export const wowQuestResultSchema = pipe(strictObject({
  operation: picklist(['search', 'detail']),
  game: localGame,
  outcome: picklist(['ok', 'empty', 'unavailable', 'error']),
  entries: pipe(array(wowQuestEntrySchema), maxLength(20)),
  total: optional(count),
  offset: pipe(count, maxValue(10_000)),
  limit: pipe(count, minValue(1), maxValue(20)),
  hasMore: boolean(),
  sources: pipe(array(source), maxLength(2)),
  notices,
  errorCode: optional(picklist(['invalid-query', 'source-unavailable', 'source-invalid', 'telemetry-unavailable', 'telemetry-game-mismatch'])),
}), check(value => value.sources.every(source => source.game === value.game)
  && (value.game !== 'retail' || value.sources.every(source => source.kind === 'quest-log'))
  && (value.game !== 'retail' || value.entries.every(entry => entry.url === undefined && entry.starts.length === 0 && entry.ends.length === 0 && entry.locations.length === 0 && entry.previous.length === 0 && entry.next === undefined && entry.chain.length === 0 && entry.conditions.length === 0 && entry.requirements.length === 0))
  && (value.outcome !== 'ok' || (value.entries.length > 0 && value.sources.length > 0))
  && (value.outcome !== 'empty' || value.sources.length > 0)
  && ((value.outcome === 'error' || value.outcome === 'unavailable') === (value.errorCode !== undefined))
  && (value.outcome === 'ok' || value.entries.length === 0)
  && value.entries.every(entry => entry.progress.observedAt === undefined ? entry.progress.status === 'unknown' : value.sources.some(source => source.kind === 'quest-log' && source.observedAt === entry.progress.observedAt))
  && value.entries.every(entry => entry.progress.lastTurnInAt === undefined || (entry.progress.observedAt !== undefined && Date.parse(entry.progress.lastTurnInAt) <= Date.parse(entry.progress.observedAt)))
  && new Set(value.entries.map(entry => entry.questId)).size === value.entries.length))

/**
 * Validates a recorded built-in result against its exact version, operation, page, and selected task.
 * @example readWowQuestAnswer({ operation: 'search' }, '{"request":"{}"}') // => undefined
 */
export function readWowQuestAnswer(raw: unknown, args: string): WowQuestResult | undefined {
  if (args.length > 8192)
    return undefined
  let request: ReturnType<typeof readWowQuestToolRequest>
  try {
    request = readWowQuestToolRequest(JSON.parse(args) as unknown)
  }
  catch { return undefined }
  if (!request)
    return undefined
  const value = readRecordedWowToolPayload(raw)
  const result = safeParse(wowQuestResultSchema, value)
  if (!result.success || result.output.game !== request.game || result.output.operation !== request.operation)
    return undefined
  const output = result.output
  if (request.operation === 'detail' ? output.offset !== 0 || output.limit !== 1 || output.hasMore || output.entries.some(entry => entry.questId !== request.questId) : output.offset !== (request.offset ?? 0) || output.limit !== (request.limit ?? 20))
    return undefined
  return output
}
