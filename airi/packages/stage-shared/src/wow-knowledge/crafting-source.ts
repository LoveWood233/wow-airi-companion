import type { WowCraftingPrices, WowCraftingQuantity, WowCraftingRecipe, WowCraftingRoute, WowCraftingRoutePrep, WowCraftingRouteStep, WowCraftingTraining } from './crafting'

import { record, safeParse, string, unknown } from 'valibot'

import { readWowReferenceAnswer, readWowReferenceBuild, safeWowReferenceUrl } from './structured-answers'

type Payload = Record<string, unknown>
const payloadSchema = record(string(), unknown())

function object(value: unknown): Payload | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const result = safeParse(payloadSchema, value)
  return result.success ? result.output : undefined
}

function parsed(value: unknown) {
  if (typeof value !== 'string')
    return value
  if (value.length > 2 * 1024 * 1024)
    return undefined
  try {
    return JSON.parse(value) as unknown
  }
  catch {
    return undefined
  }
}

function decode(value: unknown, depth: number): Payload | undefined {
  if (depth > 8)
    return undefined
  const data = object(parsed(value))
  if (!data || data.isError === true)
    return undefined
  if (data.structuredContent !== undefined)
    return decode(data.structuredContent, depth + 1)
  if (data.toolResult !== undefined)
    return decode(data.toolResult, depth + 1)
  if (Array.isArray(data.content)) {
    for (const item of data.content.slice(0, 8)) {
      const part = object(item)
      if (part?.type === 'text') {
        const payload = decode(part.text, depth + 1)
        if (payload)
          return payload
      }
    }
    return undefined
  }
  return data
}

/**
 * Reads recorded MCP text or envelopes without interpreting prose as facts.
 * @example readWowCraftingPayload({ content: [{ type: 'text', text: '{"outcome":"ok"}' }] }) // => { outcome: 'ok' }
 */
export function readWowCraftingPayload(value: unknown): Payload | undefined {
  return decode(value, 0)
}

function label(value: unknown, limit = 400) {
  if (typeof value !== 'string')
    return undefined
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
  return text ? text.slice(0, limit) : undefined
}

function integer(value: unknown, minimum = 0): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : undefined
}

function recipeId(value: unknown): number | undefined {
  if (typeof value !== 'string')
    return undefined
  const match = /^recipe:([1-9]\d{0,11})$/.exec(value)
  return match ? Number(match[1]) : undefined
}

function itemId(value: unknown): number | undefined {
  if (typeof value !== 'string')
    return undefined
  const match = /^item:([1-9]\d{0,11})$/.exec(value)
  return match ? Number(match[1]) : undefined
}

function linkedItem(value: unknown) {
  const url = safeWowReferenceUrl(value)
  if (!url)
    return undefined
  const match = /^\/(?:id\/item:|item\/)([1-9]\d{0,11})\/?$/.exec(new URL(url).pathname)
  return match ? Number(match[1]) : undefined
}

function wrongGame(data: Payload) {
  return (data.product !== undefined && data.product !== 'wowf')
    || (typeof data.game === 'string' && !['forever', 'wowf', '魔兽世界：无限'].includes(data.game))
}

function quantities(value: unknown): { items: WowCraftingQuantity[], complete: boolean } {
  if (!Array.isArray(value) || value.length > 60)
    return { items: [], complete: false }
  const items: WowCraftingQuantity[] = []
  let complete = true
  for (const raw of value) {
    const item = object(raw)
    const nested = object(item?.['wxw:item'])
    const id = integer(item?.item_id, 1) ?? itemId(item?.id) ?? linkedItem(nested?.['@id'])
    const count = integer(item?.count ?? item?.['wxw:count'], 1)
    const random = item?.random === true || item?.variable === true || item?.chance !== undefined || item?.count_min !== undefined || item?.count_max !== undefined || item?.min_count !== undefined || item?.max_count !== undefined
    if (!id || !count || random) {
      complete = false
      continue
    }
    items.push({ itemId: id, name: label(item?.name ?? nested?.name, 160) ?? String(id), count })
  }
  return { items, complete }
}

/**
 * Extracts fixed reagent and product counts from actual recipe records. It never derives item IDs from prose.
 * @example readWowCraftingRecipe({ id: 'recipe:1', title: 'Example', metadata: { reagents: [], products: [] } })?.recipeId // => 1
 */
export function readWowCraftingRecipe(raw: unknown): WowCraftingRecipe | undefined {
  const payload = readWowCraftingPayload(raw)
  if (!payload || wrongGame(payload) || (payload.outcome !== undefined && payload.outcome !== 'ok'))
    return undefined
  const graph = Array.isArray(payload['@graph']) ? payload['@graph'].slice(0, 100).map(object) : undefined
  const entity = graph?.find(node => recipeId(node?.identifier) !== undefined)
  const metadata = object(payload.metadata)
  const data = entity ?? metadata ?? payload
  if (wrongGame(data))
    return undefined
  const identifier = recipeId(data.identifier ?? data.id ?? payload.id)
  const numericId = integer(data.recipe_id, 1)
  if (identifier !== undefined && numericId !== undefined && identifier !== numericId)
    return undefined
  const id = numericId ?? identifier
  const name = label(data.name ?? payload.title, 160)
  if (!id || !name)
    return undefined
  const reagents = quantities(data.reagents ?? data['wxw:reagent'])
  const products = quantities(data.products ?? data['wxw:product'])
  const complete = reagents.complete && products.complete
  const profession = object(data['wxw:profession'])
  const url = safeWowReferenceUrl(data.url ?? payload.url)
  const canonicalUrl = `https://wuxianwow.com/recipe/${id}`
  const notices: string[] = []
  if (!reagents.complete)
    notices.push('incomplete-reagents')
  if (!products.complete)
    notices.push('unknown-yield')
  if (data.product_hidden === true)
    notices.push('hidden-product')
  if (url && new URL(url).pathname !== `/recipe/${id}`)
    notices.push('conflicting-source-link')
  const reference = readWowReferenceAnswer(payload, JSON.stringify({ name: 'wuxianwow::fetch', arguments: JSON.stringify({ id: `recipe:${id}` }) }))
  return {
    id: `recipe:${id}`,
    recipeId: id,
    spellId: integer(data.spell_id ?? data['wxw:spellId'], 1),
    name,
    profession: label(data.profession ?? profession?.name, 160),
    reagents: reagents.items,
    products: products.items,
    url: canonicalUrl,
    build: reference?.build,
    updatedAt: reference?.updatedAt,
    complete,
    notices,
  }
}

function range(value: unknown) {
  if (typeof value !== 'string')
    return undefined
  const match = /^(\d{1,3})\s*[–—-]\s*(\d{1,3})$/.exec(value.trim())
  if (!match)
    return undefined
  const start = Number(match[1])
  const end = Number(match[2])
  return start >= 1 && end > start && end <= 300 ? { start, end } : undefined
}

function preparation(value: unknown, startSkill: number): WowCraftingRoutePrep | undefined {
  const data = object(value)
  const id = integer(data?.recipe_id, 1)
  const crafts = integer(data?.crafts, 1)
  const atSkill = integer(data?.at_skill, 1)
  const name = label(data?.name, 160)
  if (!data || !id || !crafts || !atSkill || !name)
    return undefined
  const materials = quantities(data.reagents_per_craft)
  return { recipeId: id, name, atSkill: Math.max(atSkill, startSkill), crafts, materials: materials.items, complete: materials.complete }
}

/**
 * Clips the source's route to the selected skill interval. Source totals and remaining.reagents cannot supply procurement totals.
 * @example readWowCraftingRoute(payload, 'free', 150, 225)?.toSkill // => 225
 */
export function readWowCraftingRoute(raw: unknown, selected: 'best' | 'free', fromSkill: number, toSkill: number): WowCraftingRoute | undefined {
  const data = readWowCraftingPayload(raw)
  if (!data || wrongGame(data) || data.outcome !== 'ok' || !['best', 'free'].includes(selected)
    || integer(fromSkill, 1) === undefined || integer(toSkill, 1) === undefined || toSkill <= fromSkill || toSkill > 300) {
    return undefined
  }
  const route = object(object(data.routes)?.[selected])
  if (!route || !Array.isArray(route.steps) || route.steps.length > 100)
    return undefined
  const notices: string[] = []
  const steps: WowCraftingRouteStep[] = []
  let complete = true
  for (const rawStep of route.steps) {
    const step = object(rawStep)
    const interval = range(step?.skill)
    if (!step || !interval) {
      complete = false
      continue
    }
    const startSkill = Math.max(fromSkill, interval.start)
    const endSkill = Math.min(toSkill, interval.end)
    if (startSkill >= endSkill)
      continue
    const id = integer(step.recipe_id, 1)
    const name = label(step.name, 160)
    const sourceCrafts = integer(step.crafts, 1)
    if (!id || !name || !sourceCrafts) {
      complete = false
      continue
    }
    // The source uses one craft per point. A different ratio has no exact subrange allocation.
    const clipped = startSkill !== interval.start || endSkill !== interval.end
    const crafts = clipped ? Math.ceil(sourceCrafts * ((endSkill - startSkill) / (interval.end - interval.start))) : sourceCrafts
    const estimated = step.certainty !== 'sure' || (clipped && sourceCrafts !== interval.end - interval.start)
    if (estimated)
      notices.push('estimated-skillups')
    const materials = quantities(step.reagents_per_craft)
    if (!materials.complete)
      notices.push('route-materials-unresolved')
    const prep: WowCraftingRoutePrep[] = []
    if (Array.isArray(step.prep)) {
      if (step.prep.length > 20)
        complete = false
      for (const rawPrep of step.prep.slice(0, 20)) {
        const item = preparation(rawPrep, startSkill)
        if (item)
          prep.push(item)
        else
          complete = false
      }
    }
    steps.push({ recipeId: id, name, startSkill, endSkill, crafts, materials: materials.items, prep, estimated })
  }
  let cursor = fromSkill
  for (const step of steps) {
    if (step.startSkill !== cursor)
      complete = false
    cursor = step.endSkill
  }
  if (cursor !== toSkill)
    complete = false
  if (!complete)
    notices.push('incomplete-route')
  const method = object(data.method)
  const premises = ['goal', 'counting', 'learn_point', 'choice', 'reuse', 'excluded', 'routes', 'training']
    .map(key => label(method?.[key], 1200))
    .filter((entry): entry is string => entry !== undefined)
  const training: WowCraftingTraining[] = []
  if (Array.isArray(route.training)) {
    for (const raw of route.training.slice(0, 12)) {
      const entry = object(raw)
      const atSkill = integer(entry?.at_skill, 1)
      const name = label(entry?.learn, 160)
      if (entry && atSkill !== undefined && atSkill >= fromSkill && atSkill < toSkill && name)
        training.push({ atSkill, name, requiredLevel: integer(entry.required_level, 1), levelAssumed: entry.level_assumed === true, newMaxSkill: integer(entry.new_max_skill, 1) })
    }
  }
  return { route: selected, profession: label(data.name, 160), fromSkill, toSkill, steps, complete, notices: [...new Set(notices)], url: safeWowReferenceUrl(data.url), build: readWowReferenceBuild(data)?.build, method: premises, training }
}

/**
 * Reads an explicit auction collection clock. Unknown timezones and invalid calendar dates remain unknown.
 * @example readWowAuctionCollectionTime('北京时间 2026-10-26 16:49') === Date.parse('2026-10-26T08:49:00Z') // => true
 */
export function readWowAuctionCollectionTime(value: string): number | undefined {
  const chinese = /^北京时间 (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(value)
  const iso = chinese ? `${chinese[1]}T${chinese[2]}:00+08:00` : value
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(iso) || Number(iso.slice(11, 13)) > 23)
    return undefined
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp))
    return undefined
  const day = iso.slice(0, 10)
  return new Date(`${day}T00:00:00Z`).toISOString().startsWith(day) ? timestamp : undefined
}

function quote(value: unknown) {
  const data = object(value)
  const id = integer(data?.item_id, 1)
  const unitCopper = integer(data?.guidance)
  const variants = [data?.variant, data?.variant_key, data?.suffix_id, data?.random_suffix, data?.random_property, data?.bonus]
  return id && unitCopper !== undefined && variants.every(ordinaryVariant) ? { itemId: id, unitCopper } : undefined
}

function ordinaryVariant(value: unknown) {
  return value === undefined || value === null || value === 0 || value === ''
}

/**
 * Reads copper guidance quotes from one real auction snapshot. Arrays merge only matching collection time, realm, and faction.
 * @example readWowCraftingPrices({ outcome: 'ok', view: 'item', snapshot: { collected_at: '北京时间 2026-10-26 16:49' }, today: { item_id: 1, guidance: 10 } })?.quotes // => [{ itemId: 1, unitCopper: 10 }]
 */
export function readWowCraftingPrices(raw: unknown): WowCraftingPrices | undefined {
  if (Array.isArray(raw)) {
    if (!raw.length || raw.length > 100)
      return undefined
    const groups = raw.map(readWowCraftingPrices)
    const first = groups[0]
    if (!first)
      return undefined
    const compatible = groups.every(group => group && group.realm === first.realm && group.faction === first.faction && group.collectedAt === first.collectedAt)
    if (!compatible)
      return { ...first, complete: false, notices: [...(first.notices ?? []), 'conflicting-price-snapshots'] }
    const quotes = new Map<number, number>()
    const conflicts = new Set<number>()
    let complete = groups.every(group => group?.complete)
    const notices = new Set<string>()
    for (const group of groups) {
      for (const notice of group?.notices ?? [])
        notices.add(notice)
      for (const item of group?.quotes ?? []) {
        if (conflicts.has(item.itemId))
          continue
        const previous = quotes.get(item.itemId)
        if (previous !== undefined && previous !== item.unitCopper) {
          complete = false
          notices.add('conflicting-prices')
          conflicts.add(item.itemId)
          quotes.delete(item.itemId)
        }
        else { quotes.set(item.itemId, item.unitCopper) }
      }
    }
    return { ...first, complete, quotes: [...quotes].map(([itemId, unitCopper]) => ({ itemId, unitCopper })), notices: [...notices] }
  }
  const data = readWowCraftingPayload(raw)
  const snapshot = object(data?.snapshot)
  const collectedAt = label(snapshot?.collected_at, 100)
  if (!data || wrongGame(data) || !collectedAt || !['ok', 'empty'].includes(String(data.outcome)) || !['prices', 'item'].includes(String(data.view)))
    return undefined
  const notices = [label(snapshot?.notice, 3000), label(data.stale_notice, 3000)].filter((entry): entry is string => entry !== undefined)
  const candidates: unknown[] = []
  let complete = true
  if (data.view === 'item') {
    const today = object(data.today)
    const id = integer(data.item_id, 1)
    if (!ordinaryVariant(data.bonus) || !ordinaryVariant(today?.bonus)) {
      complete = false
      notices.push('variant-price-unverified')
    }
    else if (today && id && integer(today.item_id, 1) === id) {
      candidates.push(today)
    }
    else {
      complete = false
    }
  }
  else if (Array.isArray(data.results) && data.results.length <= 100) {
    candidates.push(...data.results)
    if (data.has_more === true || (integer(data.total) ?? 0) > candidates.length)
      complete = false
  }
  else { return undefined }
  const quotes = candidates.map(quote).filter((entry): entry is { itemId: number, unitCopper: number } => entry !== undefined)
  if (candidates.some(candidate => !ordinaryVariant(object(candidate)?.bonus)))
    notices.push('variant-price-unverified')
  if (quotes.length !== candidates.length)
    complete = false
  if (!complete)
    notices.push('price-incomplete')
  return { realm: label(snapshot?.realm, 160), faction: label(snapshot?.side, 160), collectedAt, collectedAtEpochMs: readWowAuctionCollectionTime(collectedAt), quotes, complete, notices, source: label(data.source, 3000), sourceUrl: safeWowReferenceUrl(data.url) }
}
