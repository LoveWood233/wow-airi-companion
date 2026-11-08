import type { WowBuildCatalogItem, WowBuildSourceEvidence, WowBuildSpell, WowBuildTalentNode } from './wow-build-assistant'

import { readWowCraftingPayload } from './crafting-source'
import { safeWowReferenceUrl } from './structured-answers'
import { readWowDataCacheEvidence } from './wow-data-cache'

type Row = Record<string, unknown>
function object(value: unknown): Row | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined
}
function label(value: unknown, maximum = 800): string | undefined {
  if (typeof value !== 'string')
    return undefined
  const cleaned = value.replace(/[\p{Cc}\p{Cf}]/gu, character => character === '\n' ? character : '').trim()
  return cleaned ? cleaned.slice(0, maximum) : undefined
}
function count(value: unknown, maximum = 2_147_483_647): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : undefined
}
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : undefined
}
function rows(value: unknown, maximum: number): Row[] {
  return Array.isArray(value) ? value.slice(0, maximum).map(object).filter((row): row is Row => row !== undefined) : []
}

function forever(data: Row) {
  return (data.game === undefined || data.game === 'forever') && (data.product === undefined || data.product === 'wowf')
}

/** Source receipt extraction keeps original network and cache times independent of later character observations. */
export function readWowBuildSourceEvidence(raw: unknown): WowBuildSourceEvidence {
  const outer = object(raw)
  const receipt = object(outer?.wowReference)
  const trusted = receipt?.game === 'forever' && receipt.source === '无限图鉴 wuxianwow.com' && receipt.sourceUrl === 'https://wuxianwow.com/'
  const receivedAt = trusted && typeof receipt.receivedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(receipt.receivedAt) && Number.isFinite(Date.parse(receipt.receivedAt)) ? receipt.receivedAt : undefined
  const cache = readWowDataCacheEvidence(outer?.cache)
  const build = trusted && typeof receipt.build === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(receipt.build) ? receipt.build : undefined
  return { kind: 'wuxianwow', game: 'forever', name: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', build, receivedAt, cache: cache?.sourceReceivedAt === receivedAt ? cache : undefined }
}

/**
 * Uses server-returned node IDs and ranks. Display positions and classic talent IDs are never identity fallbacks.
 * @example readWowBuildTalents({ outcome: 'ok', class_id: 1, trees: [] }, 1)?.nodes // => []
 */
export function readWowBuildTalents(raw: unknown, classId: number): { nodes: WowBuildTalentNode[], url?: string, plan?: { normalized?: string, total?: number, cap?: number, remaining?: number, adjustments: string[] } } | undefined {
  const data = readWowCraftingPayload(raw)
  if (!data || data.outcome !== 'ok' || data.class_id !== classId || !forever(data) || !Array.isArray(data.trees))
    return undefined
  const nodes = rows(data.trees, 8).flatMap(tree => rows(tree.talents, 80).flatMap((talent): WowBuildTalentNode[] => {
    const nodeId = count(talent.id)
    if (!nodeId)
      return []
    return [{ nodeId, name: label(talent.name, 200), group: label(tree.name, 120), maxRank: count(talent.max_rank, 100), plannedRank: count(talent.rank, 100), mapping: 'unverified', ranks: rows(talent.ranks, 8).map((rank, index) => ({ rank: index + 1, spellId: count(rank.spell), description: label(rank.description) })), prerequisites: rows(talent.prereq, 12).flatMap((prereq) => {
      const nodeId = count(prereq.talent)
      return nodeId ? [{ nodeId, name: label(prereq.name, 200), rank: count(prereq.rank, 100), any: typeof prereq.any === 'boolean' ? prereq.any : undefined }] : []
    }), gate: count(talent.gate, 1000), activeSpellIds: [], conditions: [], notices: [] }]
  })).slice(0, 180)
  if (new Set(nodes.map(node => node.nodeId)).size !== nodes.length)
    return undefined
  const build = object(data.build)
  const adjustments = Array.isArray(build?.dropped) ? build.dropped.slice(0, 20).map(value => label(value) ?? label(object(value)?.reason) ?? label(object(value)?.name) ?? 'source-adjusted-node') : []
  const referenceUrl = safeWowReferenceUrl(data.url)
  return { nodes, url: referenceUrl && new URL(referenceUrl).pathname === `/talents/${classId}` ? referenceUrl : undefined, plan: build ? { normalized: label(build.normalized, 4096), total: count(build.total, 1000), cap: count(build.cap, 1000), remaining: count(build.remaining, 1000), adjustments: adjustments.filter((value): value is string => value !== undefined) } : undefined }
}

/**
 * Reads explicit spellbook details. Missing or encrypted descriptions remain absent, and rank-one text stays labeled as base data.
 * @example readWowBuildSpell({ outcome: 'empty' }, 12282) // => undefined
 */
export function readWowBuildSpell(raw: unknown, spellId: number): WowBuildSpell | undefined {
  const data = readWowCraftingPayload(raw)
  const spell = object(data?.spell)
  const rank = rows(spell?.ranks, 40).find(rank => rank.spell_id === spellId)
  if (!data || data.outcome !== 'ok' || !spell || (count(spell.id) !== spellId && !rank) || !forever(data))
    return undefined
  const description = count(spell.id) === spellId ? label(spell.description, 1600) : label(rank?.description, 1600)
  // The source documents typed /id/ links. Spellbook's returned URL groups ranks by name and cannot identify one selected spell ID.
  return { spellId, name: label(spell.name, 200), url: `https://wuxianwow.com/id/spell:${spellId}`, description, origin: label(spell.origin, 120), fields: ['line', 'kind', 'school', 'level', 'rank_count'].flatMap(key => typeof spell[key] === 'number' || typeof spell[key] === 'string' ? [{ key, value: String(spell[key]).slice(0, 400) }] : []), notices: ['base-spell-values', ...(description ? [] : ['description-unavailable'])] }
}

const statNames: Record<string, string> = { 力量: 'ITEM_MOD_STRENGTH_SHORT', 敏捷: 'ITEM_MOD_AGILITY_SHORT', 耐力: 'ITEM_MOD_STAMINA_SHORT', 智力: 'ITEM_MOD_INTELLECT_SHORT', 精神: 'ITEM_MOD_SPIRIT_SHORT', 护甲: 'RESISTANCE0_NAME' }

/**
 * Catalog attributes describe a base item. Missing catalog stats never imply zero or a complete bonus-instance record.
 * @example readWowBuildItem({ outcome: 'ok', id: 'item:25', equipment: {} }, 25)?.statsComplete // => false
 */
export function readWowBuildItem(raw: unknown, itemId: number): WowBuildCatalogItem | undefined {
  const data = readWowCraftingPayload(raw)
  const metadata = object(data?.metadata)
  const row = data ? { ...metadata, ...data } : undefined
  if (!row || row.outcome !== 'ok' || row.id !== `item:${itemId}` || !forever(row) || (metadata !== undefined && !forever(metadata)))
    return undefined
  const equipment = object(row.equipment)
  const stats = rows(equipment?.stats, 32).flatMap((stat) => {
    const key = label(stat.stat, 100)
    const value = finite(stat.value)
    return key && value !== undefined ? [{ key: statNames[key] ?? key, value }] : []
  })
  const armor = finite(equipment?.armor)
  if (armor !== undefined) {
    const declared = stats.find(stat => stat.key === 'RESISTANCE0_NAME')
    if (declared && declared.value !== armor)
      return undefined
    if (!declared)
      stats.push({ key: 'RESISTANCE0_NAME', value: armor })
  }
  if (new Set(stats.map(stat => stat.key)).size !== stats.length)
    return undefined
  const effects = [label(row.use_kind, 80), label(row.use, 1600)].filter((value): value is string => value !== undefined)
  const damage = object(equipment?.damage)
  const fields = ['min', 'max', 'speed', 'dps'].flatMap(key => finite(damage?.[key]) !== undefined ? [{ key: `weapon-${key}`, value: String(damage![key]) }] : [])
  const referenceUrl = safeWowReferenceUrl(row.url)
  return { itemId, name: label(row.title, 200), url: referenceUrl && new URL(referenceUrl).pathname === `/item/${itemId}` ? referenceUrl : undefined, slot: label(equipment?.slot ?? row.slot, 120), itemLevel: finite(equipment?.ilvl ?? row.ilvl), requiredLevel: count(equipment?.req_level ?? row.req_level, 255), stats, statsComplete: false, effects, fields, notices: ['base-item-not-instance', 'candidate-stats-partial', ...(effects.length ? ['proc-rate-unverified'] : ['effects-unavailable'])] }
}
