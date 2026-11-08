import type { WowBuildResult } from './wow-build-assistant'

import { array, boolean, check, finite, integer, literal, maxLength, maxValue, minLength, minValue, nullable, number, optional, picklist, pipe, regex, safeParse, strictObject, string, variant } from 'valibot'

import { readRecordedWowToolPayload } from './recorded-tool-result'
import { retailDatabaseSourceSchema } from './retail-database'
import { safeWowReferenceUrl } from './structured-answers'
import { parseWowTalentPlan, readWowBuildToolRequest } from './wow-build-assistant'
import { wowDataCacheEvidenceSchema } from './wow-data-cache'

const text = (maximum: number) => pipe(string(), maxLength(maximum), check(value => !/[\p{Cc}\p{Cf}]/u.test(value.replaceAll('\n', ''))))
const id = pipe(number(), integer(), minValue(1), maxValue(2_147_483_647))
const rank = pipe(number(), integer(), minValue(0), maxValue(1000))
const amount = pipe(number(), finite(), minValue(-1e12), maxValue(1e12))
const notices = pipe(array(pipe(text(80), regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/))), maxLength(32))
const fields = pipe(array(strictObject({ key: pipe(text(128), minLength(1)), value: text(4096) })), maxLength(64))
const stats = pipe(array(strictObject({ key: pipe(text(100), minLength(1)), value: amount })), maxLength(32), check(rows => new Set(rows.map(row => row.key)).size === rows.length))
const url = pipe(string(), maxLength(2048), check(value => safeWowReferenceUrl(value) === value))
const build = pipe(string(), maxLength(40), regex(/^\d+\.\d+\.\d+\.\d+$/))
const game = picklist(['retail', 'forever'])
const timestamp = pipe(string(), maxLength(40), check((value) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    return false
  const day = value.slice(0, 10)
  return Number(value.slice(11, 13)) < 24 && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day)
}))
const equipped = pipe(strictObject({ itemID: id, itemGUID: nullable(text(128)), link: pipe(text(1024), minLength(1)), name: nullable(text(128)), type: nullable(text(128)), subtype: nullable(text(128)), equipLoc: nullable(text(128)), quality: nullable(pipe(number(), integer(), minValue(0), maxValue(8))), itemLevel: nullable(pipe(number(), finite(), minValue(0), maxValue(100000))), requiredLevel: nullable(pipe(number(), integer(), minValue(0), maxValue(255))), stats, tooltip: pipe(array(text(256)), maxLength(48)), infoComplete: boolean(), statsComplete: boolean(), tooltipComplete: boolean(), truncated: boolean() }), check(item => Number(/item:(\d+)/.exec(item.link)?.[1]) === item.itemID
  && (!item.infoComplete || [item.name, item.type, item.subtype, item.equipLoc, item.quality, item.itemLevel, item.requiredLevel].every(value => value !== null))
  && (!item.tooltipComplete || item.tooltip.length > 0)))
const catalog = pipe(strictObject({ itemId: id, name: optional(text(200)), url: optional(url), slot: optional(text(120)), equipLoc: optional(text(128)), itemLevel: optional(pipe(number(), finite(), minValue(0), maxValue(100000))), requiredLevel: optional(pipe(number(), integer(), minValue(0), maxValue(255))), stats, statsComplete: boolean(), effects: pipe(array(text(1600)), maxLength(8)), fields, notices }), check(item => item.url === undefined || new URL(item.url).pathname === `/item/${item.itemId}`))

export const wowBuildTalentNodeSchema = pipe(strictObject({
  nodeId: id,
  name: optional(text(200)),
  group: optional(text(120)),
  maxRank: optional(rank),
  currentRank: optional(rank),
  purchasedRank: optional(rank),
  plannedRank: optional(rank),
  delta: optional(pipe(number(), integer(), minValue(-1000), maxValue(1000))),
  mapping: picklist(['same-build', 'unverified', 'observation-only']),
  ranks: pipe(array(strictObject({ rank: pipe(rank, minValue(1)), spellId: optional(id), description: optional(text(800)) })), maxLength(8)),
  prerequisites: pipe(array(strictObject({ nodeId: id, name: optional(text(200)), rank: optional(rank), any: optional(boolean()) })), maxLength(12)),
  gate: optional(pipe(number(), integer(), minValue(0), maxValue(1000))),
  activeSpellIds: pipe(array(id), maxLength(16)),
  conditions: pipe(array(strictObject({ conditionId: id, isMet: optional(boolean()), playerLevel: optional(pipe(number(), integer(), minValue(0), maxValue(255))), spentAmountRequired: optional(pipe(number(), integer(), minValue(0), maxValue(2_147_483_647))) })), maxLength(32)),
  notices,
}), check(node => (node.mapping !== 'unverified' || (node.currentRank === undefined && node.purchasedRank === undefined && node.delta === undefined && node.activeSpellIds.length === 0))
  && (node.activeSpellIds.length === 0 || (node.currentRank !== undefined && node.currentRank > 0))
  && (node.delta === undefined || (node.purchasedRank !== undefined && node.plannedRank !== undefined && node.delta === node.plannedRank - node.purchasedRank))))

const source = variant('kind', [
  pipe(strictObject({ kind: literal('wuxianwow'), game: literal('forever'), name: literal('无限图鉴 wuxianwow.com'), sourceUrl: literal('https://wuxianwow.com/'), build: optional(build), receivedAt: optional(timestamp), cache: optional(wowDataCacheEvidenceSchema) }), check(source => source.cache === undefined || source.cache.sourceReceivedAt === source.receivedAt)),
  strictObject({ kind: literal('talent-observation'), game, name: literal('已提交天赋观察'), build: optional(build), observedAt: timestamp }),
  strictObject({ kind: literal('equipment-observation'), game, name: literal('最近穿戴快照'), observedAt: timestamp }),
  pipe(strictObject({ kind: literal('retail-db2'), game: literal('retail'), name: literal('正式服本地 DB2'), build, receivedAt: timestamp, cache: optional(wowDataCacheEvidenceSchema), database: retailDatabaseSourceSchema }), check(source => source.database.build === source.build && (source.cache === undefined || source.cache.sourceReceivedAt === source.receivedAt))),
])
const item = pipe(strictObject({ slot: pipe(number(), integer(), minValue(1), maxValue(19)), baselineState: picklist(['equipped', 'empty', 'unknown']), baseline: optional(equipped), candidate: catalog, compatibility: picklist(['compatible', 'incompatible', 'unknown']), basis: picklist(['base-reference', 'unresolved']), differences: pipe(array(strictObject({ key: pipe(text(100), minLength(1)), current: optional(amount), candidate: optional(amount), delta: optional(pipe(number(), finite(), minValue(-2e12), maxValue(2e12))) })), maxLength(64)), notices }), check(item => (item.baselineState === 'equipped') === (item.baseline !== undefined)
  && item.differences.every(row => row.delta === undefined || (item.compatibility === 'compatible' && row.current !== undefined && row.candidate !== undefined && row.delta === row.candidate - row.current))
  && (item.baselineState !== 'unknown' || item.differences.every(row => row.current === undefined && row.delta === undefined))
  && new Set(item.differences.map(row => row.key)).size === item.differences.length
  && item.differences.every((row) => {
    const candidate = item.candidate.stats.find(stat => stat.key === row.key)
    const baseline = item.baseline?.stats.find(stat => stat.key === row.key)
    if (!candidate && !baseline)
      return false
    const canonical = row.key.startsWith('ITEM_MOD_') || /^RESISTANCE\d_NAME$/.test(row.key)
    const current = item.baselineState === 'empty' ? 0 : baseline?.value ?? (canonical && item.baseline?.statsComplete && !item.baseline.truncated ? 0 : undefined)
    return row.current === current && row.candidate === candidate?.value
  })))

/** Recorded build explanations keep local observations, base references and raw DB2 fields in separate evidence scopes. */
export const wowBuildResultSchema = pipe(strictObject({
  operation: picklist(['talents', 'compare-talents', 'spell', 'compare-item']),
  game,
  outcome: picklist(['ok', 'empty', 'unavailable', 'unsupported', 'error']),
  classId: optional(pipe(number(), integer(), minValue(1), maxValue(255))),
  referenceUrl: optional(url),
  nodes: pipe(array(wowBuildTalentNodeSchema), maxLength(180)),
  spell: optional(pipe(strictObject({ spellId: id, name: optional(text(200)), url: optional(url), description: optional(text(1600)), origin: optional(text(120)), fields, notices }), check(spell => spell.url === undefined || new URL(spell.url).pathname === `/id/spell:${spell.spellId}`))),
  item: optional(item),
  plan: optional(strictObject({ kind: picklist(['nodes', 'source']), normalized: optional(text(4096)), validation: picklist(['source-validated', 'source-adjusted', 'partial']), total: optional(pipe(number(), integer(), minValue(0), maxValue(1000))), cap: optional(pipe(number(), integer(), minValue(0), maxValue(1000))), remaining: optional(pipe(number(), integer(), minValue(0), maxValue(1000))), adjustments: pipe(array(text(800)), maxLength(20)) })),
  sources: pipe(array(source), maxLength(3)),
  notices,
  errorCode: optional(picklist(['invalid-query', 'invalid-plan', 'source-unavailable', 'source-invalid', 'telemetry-unavailable', 'unsupported-plan', 'database-unavailable'])),
}), check(value => value.sources.every(source => source.game === value.game)
  && (value.referenceUrl === undefined || (value.game === 'forever' && value.classId !== undefined && new URL(value.referenceUrl).pathname === `/talents/${value.classId}`))
  && ((value.outcome === 'unavailable' || value.outcome === 'unsupported' || value.outcome === 'error') === (value.errorCode !== undefined))
  && (!['ok', 'empty'].includes(value.outcome) || value.sources.length > 0)
  && (value.outcome === 'ok' || (value.nodes.length === 0 && value.item === undefined && value.spell === undefined))
  && new Set(value.nodes.map(node => node.nodeId)).size === value.nodes.length
  && value.nodes.every(node => node.currentRank === undefined || value.sources.some(source => source.kind === 'talent-observation'))
  && value.nodes.every(node => node.mapping !== 'same-build' || value.sources.some(source => source.kind === 'wuxianwow' && source.build !== undefined && value.sources.some(observed => observed.kind === 'talent-observation' && observed.build === source.build)))
  && (value.game !== 'retail' || value.nodes.every(node => node.mapping === 'observation-only'))
  && (value.game !== 'forever' || value.nodes.every(node => node.mapping !== 'observation-only'))
  && (value.item?.baseline === undefined || value.sources.some(source => source.kind === 'equipment-observation'))
  && (value.game !== 'retail' || (value.spell?.url === undefined && value.item?.candidate.url === undefined && value.item?.basis !== 'base-reference'))
  && (value.operation !== 'spell' || (value.nodes.length === 0 && value.item === undefined && value.plan === undefined))
  && (value.operation !== 'compare-item' || (value.nodes.length === 0 && value.spell === undefined && value.plan === undefined))
  && (!['talents', 'compare-talents'].includes(value.operation) || (value.item === undefined && value.spell === undefined))
  && (value.operation !== 'talents' || (value.plan === undefined && value.nodes.every(node => node.plannedRank === undefined && node.delta === undefined)))
  && (value.outcome !== 'ok' || value.operation !== 'compare-talents' || value.plan !== undefined)))

/**
 * Validates a bounded result for the exact recorded operation, game and selected node, spell or equipment slot.
 * @example readWowBuildAnswer({}, '{"request":"{}"}') // => undefined
 */
export function readWowBuildAnswer(raw: unknown, args: string): WowBuildResult | undefined {
  if (args.length > 32768)
    return undefined
  let query: ReturnType<typeof readWowBuildToolRequest>
  try {
    query = readWowBuildToolRequest(JSON.parse(args) as unknown)
  }
  catch { return undefined }
  if (!query)
    return undefined
  const parsed = safeParse(wowBuildResultSchema, readRecordedWowToolPayload(raw, 2_097_152))
  if (!parsed.success || parsed.output.game !== query.game || parsed.output.operation !== query.operation)
    return undefined
  const result = parsed.output
  if (query.operation === 'compare-item') {
    if (result.item && (result.item.slot !== query.slot || result.item.candidate.itemId !== query.itemId))
      return undefined
  }
  else if (query.operation === 'spell') {
    if (result.spell && result.spell.spellId !== query.spellId)
      return undefined
  }
  else if (result.outcome === 'ok' || result.outcome === 'empty') {
    if (result.classId !== query.classId || (query.operation === 'talents' && query.nodeId !== undefined && result.nodes.some(node => node.nodeId !== query.nodeId)))
      return undefined
  }
  if (query.operation === 'compare-talents' && result.outcome === 'ok') {
    const plan = parseWowTalentPlan(query.build)
    if (!plan || result.plan?.kind !== plan.kind || (plan.kind === 'source' && plan.classId !== undefined && plan.classId !== query.classId))
      return undefined
    if (plan.kind === 'nodes' && (result.nodes.some(node => node.plannedRank !== undefined && node.plannedRank !== plan.nodes.find(entry => entry.nodeId === node.nodeId)?.rank) || plan.nodes.some(entry => !result.nodes.some(node => node.nodeId === entry.nodeId && node.plannedRank === entry.rank))))
      return undefined
  }
  return result
}
