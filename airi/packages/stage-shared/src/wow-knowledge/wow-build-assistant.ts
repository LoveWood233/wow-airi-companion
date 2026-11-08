import type { InferOutput } from 'valibot'

import type { RetailDatabaseSource } from './retail-database'
import type { WowDataCacheEvidence } from './wow-data-cache'

import { array, check, integer, literal, maxLength, maxValue, minLength, minValue, number, optional, picklist, pipe, safeParse, strictObject, string, variant } from 'valibot'

export const WOW_BUILD_ASSISTANT_TOOL_NAME = 'builtIn_wowBuildAssistant'
export const WOW_BUILD_ASSISTANT_TOOL_DESCRIPTION = 'Explain actual committed talents, a specified spell, a pasted talent plan, or one equipped slot versus a specified item. request is a JSON string. Operations: {"operation":"talents","game":"forever","classId":1,"level":15,"nodeId":105958}; {"operation":"compare-talents","game":"forever","classId":1,"level":15,"build":"https://wuxianwow.com/talents/1?t=3"}; {"operation":"compare-item","game":"forever","slot":16,"itemId":277979}; {"operation":"spell","game":"retail","spellId":12282}. Plan input also accepts a JSON array [{"nodeId":105958,"rank":3}]. Never map positions, entry IDs or spell IDs to node IDs. Retail game import codes are unsupported. Forever references come from 无限图鉴 wuxianwow.com. Retail uses only actual telemetry and local DB2, whose raw scaling fields are not flat item stats. Missing ranks, prerequisites or attributes remain unknown. Explicit slots distinguish rings, trinkets and weapons. Base catalog items are not proven bonus instances. Do not infer DPS, weights, optimal builds, or automate talent or equipment changes.'

const identifier = pipe(number(), integer(), minValue(1), maxValue(2_147_483_647))
const level = pipe(number(), integer(), minValue(1), maxValue(255))
const classId = pipe(number(), integer(), minValue(1), maxValue(255))
const game = picklist(['retail', 'forever'])
const planText = pipe(string(), minLength(1), maxLength(8192), check(value => value.trim().length > 0 && !/[\p{Cc}\p{Cf}]/u.test(value.replaceAll('\n', '').replaceAll('\r', '').replaceAll('\t', ''))))
export const wowBuildQuerySchema = variant('operation', [
  strictObject({ operation: literal('talents'), game, classId, level, nodeId: optional(identifier) }),
  strictObject({ operation: literal('compare-talents'), game, classId, level, build: planText }),
  strictObject({ operation: literal('spell'), game, spellId: identifier, classId: optional(classId) }),
  strictObject({ operation: literal('compare-item'), game, slot: pipe(number(), integer(), minValue(1), maxValue(19)), itemId: identifier }),
])
export type WowBuildQuery = InferOutput<typeof wowBuildQuerySchema>
export const wowBuildToolArgumentsSchema = strictObject({ request: pipe(string(), minLength(1), maxLength(16384)) })
const nodesPlan = pipe(array(strictObject({ nodeId: identifier, rank: pipe(number(), integer(), minValue(0), maxValue(1000)) })), minLength(1), maxLength(180), check(nodes => new Set(nodes.map(node => node.nodeId)).size === nodes.length))
export type WowTalentPlan = { kind: 'nodes', nodes: { nodeId: number, rank: number }[] } | { kind: 'source', build: string, classId?: number }

/** Normalized committed observations use ISO clocks. They never include draft talent edits. */
export interface WowBuildTalentsObservation {
  guid: string
  session: string
  observedAt: string
  clientBuild: string | null
  locale: string | null
  classID: number | null
  status: 'active' | 'staged' | 'unknown' | 'inaccessible'
  hasStagedChanges: boolean | null
  scope: 'selected-nodes'
  complete: boolean
  truncated: boolean
  knownZeroNodes: { treeID: number, nodeID: number }[]
  nodes: {
    treeID: number
    nodeID: number
    ranksPurchased: number | null
    activeRank: number | null
    maxRanks: number | null
    isAvailable: boolean | null
    isVisible: boolean | null
    meetsEdgeRequirements: boolean | null
    entriesComplete: boolean
    entries: { entryID: number, definitionID: number | null, spellID: number | null, rank: number | null, isActive: boolean | null }[]
    conditionsComplete: boolean
    conditions: { conditionID: number, isMet: boolean | null, playerLevel: number | null, spentAmountRequired: number | null, traitCurrencyID: number | null }[]
  }[]
}
export interface WowBuildEquippedItem {
  itemID: number
  itemGUID: string | null
  link: string
  name: string | null
  type: string | null
  subtype: string | null
  equipLoc: string | null
  quality: number | null
  itemLevel: number | null
  requiredLevel: number | null
  stats: { key: string, value: number }[]
  tooltip: string[]
  infoComplete: boolean
  statsComplete: boolean
  tooltipComplete: boolean
  truncated: boolean
}
export interface WowBuildLoadoutObservation { guid: string, session: string, observedAt: string, slots: { slot: number, state: 'equipped' | 'empty' | 'unknown', item: WowBuildEquippedItem | null }[] }
export interface WowBuildContext { game: 'retail' | 'forever' | 'unknown', guid?: string, session?: string, classId?: number, talents?: WowBuildTalentsObservation, loadout?: WowBuildLoadoutObservation }
export interface WowBuildSourceEvidence { kind: 'wuxianwow' | 'talent-observation' | 'equipment-observation' | 'retail-db2', game: 'retail' | 'forever', name: string, sourceUrl?: string, build?: string, receivedAt?: string, observedAt?: string, cache?: WowDataCacheEvidence, database?: RetailDatabaseSource }
export interface WowBuildTalentNode {
  nodeId: number
  name?: string
  group?: string
  maxRank?: number
  currentRank?: number
  purchasedRank?: number
  plannedRank?: number
  delta?: number
  mapping: 'same-build' | 'unverified' | 'observation-only'
  ranks: { rank: number, spellId?: number, description?: string }[]
  prerequisites: { nodeId: number, name?: string, rank?: number, any?: boolean }[]
  gate?: number
  activeSpellIds: number[]
  conditions: { conditionId: number, isMet?: boolean, playerLevel?: number, spentAmountRequired?: number }[]
  notices: string[]
}
export interface WowBuildSpell { spellId: number, name?: string, url?: string, description?: string, origin?: string, fields: { key: string, value: string }[], notices: string[] }
export interface WowBuildCatalogItem { itemId: number, name?: string, url?: string, slot?: string, equipLoc?: string, itemLevel?: number, requiredLevel?: number, stats: { key: string, value: number }[], statsComplete: boolean, effects: string[], fields: { key: string, value: string }[], notices: string[] }
export interface WowBuildItemComparison {
  slot: number
  baselineState: 'equipped' | 'empty' | 'unknown'
  baseline?: WowBuildEquippedItem
  candidate: WowBuildCatalogItem
  compatibility: 'compatible' | 'incompatible' | 'unknown'
  basis: 'base-reference' | 'unresolved'
  differences: { key: string, current?: number, candidate?: number, delta?: number }[]
  notices: string[]
}
export interface WowBuildResult {
  operation: WowBuildQuery['operation']
  game: 'retail' | 'forever'
  outcome: 'ok' | 'empty' | 'unavailable' | 'unsupported' | 'error'
  classId?: number
  referenceUrl?: string
  nodes: WowBuildTalentNode[]
  spell?: WowBuildSpell
  item?: WowBuildItemComparison
  plan?: { kind: 'nodes' | 'source', normalized?: string, validation: 'source-validated' | 'source-adjusted' | 'partial', total?: number, cap?: number, remaining?: number, adjustments: string[] }
  sources: WowBuildSourceEvidence[]
  notices: string[]
  errorCode?: 'invalid-query' | 'invalid-plan' | 'source-unavailable' | 'source-invalid' | 'telemetry-unavailable' | 'unsupported-plan' | 'database-unavailable'
}

/**
 * Reads only explicitly named bounded operations. No tool input can select SQL, files, or arbitrary network addresses.
 * @example readWowBuildQuery({ operation: 'compare-item', game: 'forever', slot: 16, itemId: 25 })?.operation // => 'compare-item'
 */
export function readWowBuildQuery(raw: unknown): WowBuildQuery | undefined {
  const parsed = safeParse(wowBuildQuerySchema, raw)
  return parsed.success ? parsed.output : undefined
}

/**
 * Decodes a flat provider-friendly wrapper before the operation schema.
 * @example readWowBuildToolRequest({ request: '{"operation":"spell","game":"retail","spellId":12282}' })?.operation // => 'spell'
 */
export function readWowBuildToolRequest(raw: unknown): WowBuildQuery | undefined {
  const parsed = safeParse(wowBuildToolArgumentsSchema, raw)
  if (!parsed.success)
    return undefined
  try {
    return readWowBuildQuery(JSON.parse(parsed.output.request) as unknown)
  }
  catch { return undefined }
}

/**
 * Explicit node lists never use array positions as node IDs. Website strings are decoded only by their source server.
 * @example parseWowTalentPlan('[{"nodeId":105958,"rank":3}]') // => { kind: 'nodes', nodes: [{ nodeId: 105958, rank: 3 }] }
 */
export function parseWowTalentPlan(raw: string): WowTalentPlan | undefined {
  if (raw.length > 8192)
    return undefined
  const value = raw.trim()
  if (value.startsWith('[')) {
    try {
      const parsed = safeParse(nodesPlan, JSON.parse(value) as unknown)
      return parsed.success ? { kind: 'nodes', nodes: parsed.output } : undefined
    }
    catch { return undefined }
  }
  if (/^[0-9-]{1,4096}$/.test(value))
    return { kind: 'source', build: value }
  try {
    const url = new URL(value)
    const path = /^\/talents\/([1-9]\d{0,2})\/?$/.exec(url.pathname)
    const allocation = url.searchParams.get('t')
    const keys = [...url.searchParams.keys()]
    if (url.protocol === 'https:' && url.hostname === 'wuxianwow.com' && !url.port && !url.username && !url.password && !url.hash && path && allocation && /^[0-9-]{1,4096}$/.test(allocation)
      && keys.every(key => key === 't' || key === 'lv') && new Set(keys).size === keys.length
      && (!url.searchParams.has('lv') || /^(?:[1-9]|[1-5]\d|60)$/.test(url.searchParams.get('lv')!))) {
      return { kind: 'source', build: value, classId: Number(path[1]) }
    }
  }
  catch { /* Game import codes are not website allocation strings. */ }
  return undefined
}

/** Failure results contain machine codes and no raw provider errors. */
export function wowBuildFailure(query: WowBuildQuery, errorCode: NonNullable<WowBuildResult['errorCode']>): WowBuildResult {
  return { operation: query.operation, game: query.game, outcome: errorCode === 'unsupported-plan' ? 'unsupported' : errorCode === 'invalid-plan' || errorCode === 'invalid-query' || errorCode === 'source-invalid' ? 'error' : 'unavailable', nodes: [], sources: [], notices: [], errorCode }
}
