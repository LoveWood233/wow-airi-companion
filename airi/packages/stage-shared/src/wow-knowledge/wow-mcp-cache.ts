import { readWowAuctionCollectionTime, readWowCraftingPayload } from './crafting-source'
import { WOW_AUCTION_CACHE_TTL_MS, WOW_STATIC_CACHE_TTL_MS } from './wow-data-cache'

const staticTools = new Set([
  'search',
  'fetch',
  'recipes',
  'item_usage',
  'list_professions',
  'list_categories',
  'profession_guide',
  'leveling_route',
  'quests',
  'npcs',
  'instances',
  'atlas',
  'talents',
  'spellbook',
  'legacy_tree',
  'races',
  'gear_items',
  'item_sets',
  'epic_items',
])

export interface WowMcpMarket { collectedAt: string, realm: string, side: string }

/** Item responses can embed auction prices even when the caller asks only for item attributes. */
export function isWowMcpPriceRequest(name: string, args: Record<string, unknown>) {
  return name === 'wuxianwow::auction_house' || name === 'wuxianwow::item_usage'
    || (name === 'wuxianwow::fetch' && typeof args.id === 'string' && /^item:[1-9]\d{0,11}$/.test(args.id))
}

/** Only explicit database reads use persistent caching. Unknown and creative tools retain their original transport behavior. */
export function wowMcpCacheTtl(name: string, args: Record<string, unknown>): number | undefined {
  if (name === 'wuxianwow::auction_house')
    return WOW_AUCTION_CACHE_TTL_MS
  const tool = name.startsWith('wuxianwow::') ? name.slice('wuxianwow::'.length) : undefined
  if (!tool || !staticTools.has(tool))
    return undefined
  if (tool === 'fetch' && (typeof args.id !== 'string'
    || (!/^(?:item|recipe|spell|set|achievement|quest|npc|instance|faction|title|map|profession|race):[1-9]\d{0,11}$/.test(args.id)
      && !/^(?:talents|spellbook):[\w-]{0,32}$/.test(args.id)))) {
    return undefined
  }
  return isWowMcpPriceRequest(name, args) ? WOW_AUCTION_CACHE_TTL_MS : WOW_STATIC_CACHE_TTL_MS
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function containsAuction(value: unknown, budget = { remaining: 10000 }, depth = 0): boolean {
  if (--budget.remaining < 0 || depth > 12)
    return true
  if (!value || typeof value !== 'object')
    return false
  if (Array.isArray(value))
    return value.some(item => containsAuction(item, budget, depth + 1))
  return Object.entries(value).some(([key, item]) => ['auction', 'auction_house', 'wxw:auction', 'wxw:auctionHouse', 'guidance', 'stale_notice', 'price', 'prices', 'auction_price', 'unit_price', 'market_price'].includes(key)
    || containsAuction(item, budget, depth + 1))
}

/**
 * Reads a structured, explicitly timed market identity without inferring it from prose.
 * @example readWowMcpMarket({ collected_at: '北京时间 2026-10-26 16:49', realm: 'Realm', side: 'Alliance' })?.realm // => 'Realm'
 */
export function readWowMcpMarket(value: unknown): WowMcpMarket | undefined {
  const data = object(value)
  if (!data || ['collected_at', 'realm', 'side'].some(key => typeof data[key] !== 'string' || (data[key] as string).trim().length === 0 || (data[key] as string).length > 160))
    return undefined
  if (readWowAuctionCollectionTime(data.collected_at as string) === undefined)
    return undefined
  return { collectedAt: data.collected_at as string, realm: data.realm as string, side: data.side as string }
}

/** Embedded item quotes omit market labels. Their explicit time must agree with the market observed before and after the request. */
export function matchesWowMcpMarket(result: unknown, name: string, market: WowMcpMarket | undefined): boolean {
  const data = readWowCraftingPayload(result)
  if (!data || !market)
    return false
  if (name === 'wuxianwow::auction_house') {
    const snapshot = readWowMcpMarket(data.snapshot)
    return snapshot !== undefined && snapshot.collectedAt === market.collectedAt && snapshot.realm === market.realm && snapshot.side === market.side
  }
  const auction = object(data.auction) ?? object(object(data.metadata)?.auction)
  if (!auction)
    return !containsAuction(data)
  return auction.collected_at === market.collectedAt && readWowAuctionCollectionTime(market.collectedAt) !== undefined
    && (auction.realm === undefined || auction.realm === market.realm) && (auction.side === undefined || auction.side === market.side)
}

/** Cached responses still require successful source evidence. A false transport error flag cannot override an embedded database failure. */
export function isWowMcpCacheableResult(result: unknown, name: string, sourceBuild: string, priceScoped = name === 'wuxianwow::auction_house' || name === 'wuxianwow::item_usage'): boolean {
  const outer = object(result)
  if (!outer || outer.isError === true)
    return false
  if (outer.content !== undefined && (!Array.isArray(outer.content) || outer.content.length > 20 || outer.content.some((part) => {
    const item = object(part)
    return item?.type !== 'text' || typeof item.text !== 'string' || item.text.length > 1024 * 1024
  }))) {
    return false
  }
  if (outer.structuredContent !== undefined && !object(outer.structuredContent))
    return false
  const data = readWowCraftingPayload(result)
  if (!data || data.error || data.ok === false || data.isError === true)
    return false
  if (!priceScoped && containsAuction(data))
    return false
  for (const scope of [data, object(data.metadata)]) {
    if (!scope)
      continue
    if ((scope.product !== undefined && scope.product !== 'wowf') || (typeof scope.game === 'string' && ['retail', 'classic', 'wow', 'wow_classic'].includes(scope.game)))
      return false
    if ([scope.build, scope.source_build, scope['wxw:sourceBuild']].some(build => build !== undefined && build !== sourceBuild))
      return false
  }
  if (Array.isArray(data['@graph'])) {
    if (name !== 'wuxianwow::fetch')
      return false
    const dataset = data['@graph'].map(object).find(node => node?.['@type'] === 'Dataset')
    return dataset?.version === sourceBuild
  }
  if (!['ok', 'empty', 'not_found'].includes(String(data.outcome)))
    return false
  if (name === 'wuxianwow::auction_house') {
    const snapshot = object(data.snapshot)
    return ['collected_at', 'realm', 'side'].every(key => typeof snapshot?.[key] === 'string' && (snapshot[key] as string).trim().length > 0)
      && readWowAuctionCollectionTime(snapshot!.collected_at as string) !== undefined
  }
  return true
}
