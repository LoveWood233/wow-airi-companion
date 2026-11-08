import type { WowDataCacheEvidence } from './wow-data-cache'

import { looseObject, optional, safeParse, string, unknown } from 'valibot'

import { readWowDataCacheEvidence } from './wow-data-cache'

export type WowReferenceKind = 'item' | 'recipe' | 'quest' | 'npc' | 'instance' | 'map'
export type WowReferenceStatus = 'success' | 'empty' | 'error' | 'invalid' | 'loading'

/** Evidence belongs to the transport that received the result. Query time never implies that game data is fresh. */
export interface WowReferenceEvidence {
  game: 'forever'
  source: '无限图鉴 wuxianwow.com'
  sourceUrl: 'https://wuxianwow.com/'
  build?: string
  buildCreatedAt?: string
  receivedAt: string
}

export interface WowReferenceField { key: string, value: string, temporary?: boolean }
export interface WowReferenceSection { key: string, lines: string[], temporary?: boolean }
export interface WowReferenceEntry {
  id: string
  kind: WowReferenceKind
  title: string
  url?: string
  summary?: string
  fields: WowReferenceField[]
  sections: WowReferenceSection[]
  temporary: boolean
  incomplete: boolean
}

/** A bounded presentation of recorded evidence. Entries contain plain text, never model-authored facts or executable markup. */
export interface WowReferenceAnswer {
  status: WowReferenceStatus
  mode: 'search' | 'detail' | 'list'
  tool: string
  query?: string
  source: '无限图鉴 wuxianwow.com'
  sourceUrl: string
  game: 'forever'
  build?: string
  buildCreatedAt?: string
  updatedAt?: string
  collectedAt?: string
  receivedAt?: string
  cache?: WowDataCacheEvidence
  realm?: string
  total?: number
  hasMore?: boolean
  notices: string[]
  entries: WowReferenceEntry[]
}

type RecordValue = Record<string, unknown>
const callSchema = looseObject({ name: string(), arguments: optional(unknown()) })
const tools = new Set(['search', 'fetch', 'recipes', 'quests', 'npcs', 'instances', 'atlas', 'item_usage'])
const kinds = new Set<WowReferenceKind>(['item', 'recipe', 'quest', 'npc', 'instance', 'map'])
const namedKinds: Record<string, WowReferenceKind> = { recipes: 'recipe', quests: 'quest', npcs: 'npc', instances: 'instance', atlas: 'map', item_usage: 'item' }

function object(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
}

function json(value: unknown): unknown {
  if (typeof value !== 'string')
    return value
  if (value.length > 2 * 1024 * 1024)
    return undefined
  try {
    return JSON.parse(value)
  }
  catch { return undefined }
}

function text(value: unknown, maximum = 1800): string | undefined {
  if (typeof value !== 'string')
    return undefined
  const result = value.replace(/[\p{Cc}\p{Cf}]/gu, character => character === '\n' || character === '\t' ? character : '').trim()
  return result ? result.slice(0, maximum) : undefined
}

function scalar(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)
  return text(value, 600)
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function build(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(value) ? value : undefined
}

function date(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 80 || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) || !Number.isFinite(Date.parse(value)))
    return undefined
  const day = value.slice(0, 10)
  const parsed = new Date(`${day}T00:00:00Z`)
  return parsed.toISOString().startsWith(day) ? value : undefined
}

/**
 * Accepts only public links to this data source, including root-relative links returned by the source.
 * @example safeWowReferenceUrl('https://wuxianwow.com/item/12359') // => 'https://wuxianwow.com/item/12359'
 */
export function safeWowReferenceUrl(value: unknown): string | undefined {
  const raw = text(value, 2048)
  if (!raw)
    return undefined
  try {
    const url = new URL(raw, raw.startsWith('/') && !raw.startsWith('//') ? 'https://wuxianwow.com/' : undefined)
    return url.protocol === 'https:' && url.hostname === 'wuxianwow.com' && !url.port && !url.username && !url.password ? url.href : undefined
  }
  catch { return undefined }
}

function identity(value: unknown): { id: string, kind: WowReferenceKind } | undefined {
  if (typeof value !== 'string')
    return undefined
  const match = /^(item|recipe|quest|npc|instance|map):[1-9]\d{0,11}$/.exec(value)
  return match ? { id: value, kind: match[1] as WowReferenceKind } : undefined
}

function linkIdentity(value: unknown) {
  const url = safeWowReferenceUrl(value)
  if (!url)
    return undefined
  const path = new URL(url).pathname
  if (new URL(url).hash)
    return undefined
  const canonical = /^\/id\/([^/]+)$/.exec(path)
  if (canonical)
    return identity(canonical[1])
  const entry = /^\/(item|recipe|quest|npc|instance|atlas)\/([1-9]\d{0,11})\/?$/.exec(path)
  return entry ? identity(`${entry[1] === 'atlas' ? 'map' : entry[1]}:${entry[2]}`) : undefined
}

function call(args: string) {
  const parsed = safeParse(callSchema, json(args))
  if (!parsed.success)
    return undefined
  const match = /^wuxianwow::([a-z_]+)$/.exec(parsed.output.name)
  if (!match || !tools.has(match[1]!))
    return undefined
  const raw = parsed.output.arguments
  const input = raw === undefined || raw === '' ? {} : object(json(raw))
  // Other fetch families retain the generic MCP renderer. A malformed input to a recognized family remains an invalid card.
  if (match[1] === 'fetch' && input && typeof input.id === 'string' && !identity(input.id) && !linkIdentity(input.id))
    return undefined
  return { tool: match[1]!, input }
}

/** Matches the read-only reference families. Other servers and creative tools retain their existing renderer. */
export function isWowReferenceCall(args: string): boolean {
  return !!call(args)
}

interface Unwrapped { payload?: RecordValue, evidence?: RecordValue, cache?: WowDataCacheEvidence, failed: boolean }

function recognizable(payload: RecordValue | undefined) {
  return payload && ['outcome', '@graph', 'id', 'fetch_id', 'results', 'error', 'build'].some(key => key in payload)
}

function unwrap(value: unknown, depth = 0): Unwrapped {
  if (depth > 8)
    return { failed: false }
  const current = json(value)
  const record = object(current)
  if (record) {
    const evidence = object(record.wowReference)
    const cache = evidence ? readWowDataCacheEvidence(record.cache) : undefined
    if (record.isError === true)
      return { failed: true, evidence, cache }
    for (const candidate of [record.structuredContent, record.toolResult]) {
      if (candidate === undefined)
        continue
      const nested = unwrap(candidate, depth + 1)
      if (recognizable(nested.payload) || nested.failed)
        return { ...nested, evidence: evidence ?? nested.evidence, cache: evidence ? cache : nested.cache }
    }
    if (Array.isArray(record.content)) {
      for (const part of record.content.slice(0, 20)) {
        const item = object(part)
        if (item?.type !== 'text')
          continue
        const nested = unwrap(item.text, depth + 1)
        if (nested.payload || nested.failed)
          return { ...nested, evidence: evidence ?? nested.evidence, cache: evidence ? cache : nested.cache }
      }
      return { failed: false, evidence, cache }
    }
    return { payload: record, evidence, cache, failed: false }
  }
  // xsAI can store a tool result as an array of common content parts.
  if (Array.isArray(current)) {
    for (const part of current.slice(0, 20)) {
      const item = object(part)
      if (item?.type === 'text') {
        const nested = unwrap(item.text, depth + 1)
        if (nested.payload || nested.failed)
          return nested
      }
    }
  }
  return { failed: false }
}

/**
 * Reads only a successful stats envelope for the Forever product. Collection time remains separate from the build timestamp.
 * @example readWowReferenceBuild({ outcome: 'ok', product: 'wowf', build: '1.60.1.70707' }) // => { build: '1.60.1.70707' }
 */
export function readWowReferenceBuild(value: unknown): { build: string, buildCreatedAt?: string } | undefined {
  const result = unwrap(value)
  const version = build(result.payload?.build)
  return !result.failed && result.payload?.outcome === 'ok' && result.payload.product === 'wowf' && version
    ? { build: version, ...(date(result.payload.built_at) ? { buildCreatedAt: date(result.payload.built_at) } : {}) }
    : undefined
}

function label(value: unknown): string | undefined {
  if (typeof value === 'string')
    return text(value, 600)
  const record = object(value)
  if (!record)
    return undefined
  const name = text(record.name ?? record.title ?? record.text, 600)
  const count = finite(record.count)
  return name && count !== undefined ? `${name} × ${count}` : name
}

function entries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function present(value: unknown) {
  return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== false && value !== ''
}

function wrongGame(value: unknown) {
  const record = object(value)
  return [record?.product, record?.game].some(scope => typeof scope === 'string' && ['retail', 'classic', 'wow', 'wow_classic', 'wow_classic_era'].includes(scope))
}

/** One read owns its bounded entries and notices. Unknown source fields remain in the original tool result for inspection. */
class ReferenceReader {
  private readonly notices = new Set<string>()
  constructor(private readonly tool: string) {}

  private field(target: WowReferenceEntry, key: string, value: unknown, temporary = false) {
    const display = scalar(value)
    if (typeof value === 'string' && value.length > 600)
      this.notices.add('truncated')
    if (display && target.fields.length < 20 && !target.fields.some(field => field.key === key))
      target.fields.push({ key, value: display, ...(temporary ? { temporary: true } : {}) })
  }

  private section(target: WowReferenceEntry, key: string, value: unknown, temporary = false) {
    const values = typeof value === 'string' ? [value] : entries(value)
    const lines = values.slice(0, 20).map(label).filter((line): line is string => !!line)
    const existing = target.sections.find(section => section.key === key)
    if (existing) {
      existing.lines.push(...lines.slice(0, 20 - existing.lines.length))
      existing.temporary ||= temporary
    }
    else if (lines.length && target.sections.length < 12) {
      target.sections.push({ key, lines, ...(temporary ? { temporary: true } : {}) })
    }
    if (values.length > 20)
      this.notices.add('truncated')
  }

  private entry(value: unknown, inherited?: RecordValue): WowReferenceEntry | undefined {
    const record = object(value)
    if (!record)
      return undefined
    const metadata = object(record.metadata)
    const data = metadata ? { ...record, ...metadata } : record
    const hint = namedKinds[this.tool]
    const identifiers = [identity(record.id), identity(record.fetch_id), identity(record.identifier), linkIdentity(record['@id']), identity(metadata?.id)]
      .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
    const known = identifiers[0]
      ?? (hint && finite(record.id) ? identity(`${hint}:${record.id}`) : undefined)
    const title = text(record.title ?? record.name ?? record.display_name, 240)
    if (!known || !title || identifiers.some(candidate => candidate.id !== known.id) || wrongGame(data) || (hint && hint !== known.kind) || (typeof data.kind === 'string' && kinds.has(data.kind as WowReferenceKind) && data.kind !== known.kind))
      return undefined
    const temporary = present(data.temporary) || present(data.temporary_drops) || present(data.temporary_dropped_by) || present(data.temporary_name)
    const candidateUrl = safeWowReferenceUrl(record.url)
    const urlIdentity = candidateUrl ? linkIdentity(candidateUrl.split('#')[0]) : undefined
    const matchingUrl = urlIdentity?.id === known.id
    const incomplete = data.incomplete === true || data.hidden === true || (record.url !== undefined && !matchingUrl) || data.confirmed === false
    const result: WowReferenceEntry = { ...known, title, url: matchingUrl ? candidateUrl : `https://wuxianwow.com/id/${known.id}`, summary: text(record.snippet ?? record.description ?? data.effect ?? record.text, 1800), fields: [], sections: [], temporary, incomplete }
    if (temporary)
      this.notices.add('temporary')
    if (incomplete)
      this.notices.add('incomplete')
    this.field(result, 'quality', data.quality ?? data['wxw:quality'])
    this.field(result, 'item-level', data.ilvl ?? data.item_level ?? data['wxw:itemLevel'])
    this.field(result, 'level', data.level_text ?? scalar(data.level) ?? data['wxw:level'])
    this.field(result, 'min-level', data.min_level ?? data.req_level ?? data['wxw:minLevel'])
    this.field(result, 'profession', data.profession)
    this.field(result, 'category', data.category)
    this.field(result, 'zone', data.zone ?? data.dungeon)
    this.field(result, 'faction', data.side ?? data.faction)
    this.field(result, 'players', data.players_text)
    this.field(result, 'boss-count', data.boss_count)
    this.field(result, 'craft-at', data.craft_at)
    this.field(result, 'source-type', data.source_type ?? data.source)
    this.field(result, 'temporary-source', object(data.temporary)?.source ?? object(data.temporary_drops)?.source, true)
    this.field(result, 'uses-count', data.used_by_count ?? data['wxw:usedByCount'])
    if (data.side === null)
      this.field(result, 'faction', data.temporary_side, true)
    this.section(result, 'materials', data.reagents ?? data['wxw:reagents'])
    this.section(result, 'products', data.products ?? data['wxw:products'])
    this.section(result, 'objectives', data.requirements ?? data.objectives)
    this.section(result, 'rewards', data.reward_brief ? [data.reward_brief] : [])
    this.section(result, 'quest-chain', data.quest_chain)
    this.section(result, 'bosses', data.bosses)
    this.section(result, 'sources', data.made_by ?? data['wxw:madeBy'])
    const usedBy = entries(data.used_by ?? data['wxw:usedBy'])
    if (usedBy.length)
      this.section(result, 'uses', usedBy)
    if ((finite(data.used_by_count ?? data['wxw:usedByCount']) ?? 0) > usedBy.length)
      this.notices.add('truncated')
    const temporaryData = object(data.temporary)
    this.section(result, 'givers', data.temporary_givers ?? temporaryData?.starts, true)
    this.section(result, 'temporary-drops', object(data.temporary_drops)?.items ?? data.temporary_drops ?? data.temporary_dropped_by, true)
    const locations = entries(data.map_marks).slice(0, 20).flatMap((map) => {
      const group = object(map)
      return entries(group?.marks).slice(0, 20).map(mark => ({ text: object(mark)?.text }))
    })
    this.section(result, 'locations', locations, temporary || locations.some(location => /临时|QuestieDB|RestedXP/.test(text(location.text) ?? '')))
    const entrance = object(data.entrance)
    if (entrance?.approx === true || entrance?.confidence === 'low' || data.approx === true)
      this.notices.add('approximate')
    if (entrance) {
      const lines = entries(entrance.atlas).slice(0, 5).map((candidate) => {
        const location = object(candidate)
        const x = location?.x
        const y = location?.y
        return typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1
          ? `${label(location) ?? ''} (${(x * 100).toFixed(1)}, ${(y * 100).toFixed(1)})`
          : undefined
      }).filter((line): line is string => !!line)
      this.section(result, 'locations', lines)
    }
    this.section(result, 'details', [data.entry_note, data.loot_note, data.source_note].filter(value => typeof value === 'string'))
    if (object(data.auction) || object(inherited?.auction))
      this.notices.add('auction')
    return result
  }

  read(payload: RecordValue): { entries: WowReferenceEntry[], notices: string[], listed: boolean, invalid: boolean } {
    let values: unknown[]
    let listed = false
    const graph = entries(payload['@graph'])
    if (graph.length) {
      values = graph.filter((node) => {
        const record = object(node)
        const types = Array.isArray(record?.['@type']) ? record['@type'] : [record?.['@type']]
        if (types.some(type => ['ItemPage', 'WebPage', 'Organization', 'Dataset', 'BreadcrumbList', 'WebSite', 'VideoGame'].includes(String(type))))
          return false
        return identity(record?.identifier) || linkIdentity(record?.['@id'])
      })
    }
    else {
      const primary = identity(payload.id) ?? identity(payload.fetch_id) ?? identity(payload.identifier)
        ?? linkIdentity(payload['@id']) ?? (namedKinds[this.tool] && finite(payload.id) ? identity(`${namedKinds[this.tool]}:${payload.id}`) : undefined)
      const list = primary ? undefined : ['results', 'recipes', 'quests', 'npcs', 'instances', 'maps', 'items'].find(key => Array.isArray(payload[key]))
      listed = !!list
      values = list ? entries(payload[list]) : [payload]
    }
    if (values.length > 20)
      this.notices.add('truncated')
    const read = values.slice(0, 20).map(value => this.entry(value, payload))
    const unique = new Set<string>()
    const normalized = read.filter((entry): entry is WowReferenceEntry => {
      if (!entry || unique.has(entry.id))
        return false
      unique.add(entry.id)
      return true
    })
    return { entries: normalized, notices: [...this.notices], listed, invalid: read.some(entry => !entry) }
  }
}

/**
 * Normalizes only recorded read-only Forever reference calls. It never queries a service, infers player state, or evaluates source markup.
 * @example readWowReferenceAnswer({ outcome: 'ok', results: [] }, '{"name":"wuxianwow::search","arguments":"{}"}')?.status // => 'empty'
 */
export function readWowReferenceAnswer(result: unknown, args: string): WowReferenceAnswer | undefined {
  const request = call(args)
  if (!request)
    return undefined
  const answer: WowReferenceAnswer = { status: 'loading', mode: request.tool === 'search' ? 'search' : request.tool === 'fetch' ? 'detail' : 'list', tool: request.tool, query: scalar(request.input?.query ?? request.input?.id ?? request.input?.name ?? request.input?.item ?? request.input?.item_id)?.slice(0, 240), source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', game: 'forever', notices: [], entries: [] }
  if (!request.input)
    return { ...answer, status: 'invalid' }
  if (result === undefined)
    return answer
  const unwrapped = unwrap(result)
  const evidence = unwrapped.evidence
  if (evidence?.game === 'forever' && evidence.source === answer.source && evidence.sourceUrl === answer.sourceUrl) {
    answer.build = build(evidence.build)
    answer.buildCreatedAt = date(evidence.buildCreatedAt)
    answer.receivedAt = date(evidence.receivedAt)
    if (unwrapped.cache?.sourceReceivedAt === answer.receivedAt)
      answer.cache = unwrapped.cache
  }
  if (unwrapped.failed)
    return { ...answer, status: 'error' }
  const payload = unwrapped.payload
  if (!payload)
    return { ...answer, status: 'invalid' }
  if (wrongGame(payload) || (evidence?.game !== undefined && evidence.game !== 'forever'))
    return { ...answer, status: 'invalid' }
  if (payload.isError === true || payload.ok === false || payload.error || ['error', 'failed', 'unavailable'].includes(String(payload.outcome)))
    return { ...answer, status: 'error' }
  const dataset = entries(payload['@graph']).map(object).find(record => record?.['@type'] === 'Dataset')
  const graphEntity = entries(payload['@graph']).map(object).find(record => identity(record?.identifier))
  answer.build = build(payload.build ?? payload.source_build ?? payload['wxw:sourceBuild']) ?? build(graphEntity?.['wxw:sourceBuild']) ?? build(dataset?.version) ?? answer.build
  answer.updatedAt = date(payload.updated_at ?? payload.updatedAt ?? payload.dateModified) ?? date(dataset?.dateModified)
  const auction = object(payload.auction) ?? object(object(payload.metadata)?.auction)
  answer.collectedAt = text(auction?.collected_at ?? payload.collected_at, 100)
  answer.realm = text(auction?.realm ?? payload.realm, 160)
  answer.total = finite(payload.total)
  answer.hasMore = typeof payload.has_more === 'boolean' ? payload.has_more : undefined
  if (answer.build || answer.updatedAt || answer.collectedAt)
    answer.notices.push('snapshot')
  const reading = new ReferenceReader(request.tool).read(payload)
  answer.entries = reading.entries
  answer.notices.push(...reading.notices)
  answer.mode = request.tool === 'search' ? 'search' : reading.listed ? 'list' : 'detail'
  if (['empty', 'no_results', 'not_found', 'not-found'].includes(String(payload.outcome)) || (reading.listed && !answer.entries.length && !reading.invalid))
    answer.status = 'empty'
  else
    answer.status = answer.entries.length ? 'success' : 'invalid'
  if (reading.invalid && answer.entries.length)
    answer.notices.push('incomplete')
  return answer
}
