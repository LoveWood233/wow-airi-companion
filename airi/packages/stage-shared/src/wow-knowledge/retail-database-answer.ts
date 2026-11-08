import type { RetailDatabaseEntry, RetailDatabaseError, RetailDatabaseKind, RetailDatabaseNotice, RetailDatabaseQuery, RetailDatabaseResult, RetailDatabaseSource, RetailDatabaseTable } from './retail-database'
import type { WowDataCacheEvidence } from './wow-data-cache'

import { safeParse } from 'valibot'

import { retailDatabaseQuerySchema, retailDatabaseResultSchema, retailDatabaseToolArgumentsSchema } from './retail-database'

/** A local-source card keeps query state separate from snapshot metadata. It never requests another record or interprets unknown DB columns. */
export interface RetailDatabaseAnswer {
  status: 'loading' | 'success' | 'empty' | 'not-found' | 'error' | 'invalid'
  operation: RetailDatabaseQuery['operation']
  kind?: RetailDatabaseKind
  query?: string
  requestedId?: string
  source: RetailDatabaseSource | null
  receivedAt?: string
  cache?: WowDataCacheEvidence
  entries: RetailDatabaseEntry[]
  notices: RetailDatabaseNotice[]
  errorCode?: RetailDatabaseError
  stats?: RetailDatabaseResult['stats']
  offset: number
  limit: number
  hasMore: boolean
  partial: boolean
}

function json(value: unknown): unknown {
  if (typeof value !== 'string')
    return value
  if (value.length > 1024 * 1024)
    return undefined
  try {
    return JSON.parse(value)
  }
  catch {
    return undefined
  }
}

function payload(value: unknown): unknown {
  const parsed = json(value)
  if (!Array.isArray(parsed))
    return parsed
  // Recorded tool results use the same text-part representation as ordinary chat messages.
  if (parsed.length > 8)
    return undefined
  const parts: unknown[] = parsed
  for (const part of parts) {
    if (part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part) {
      const parsedText = json(part.text)
      if (parsedText && typeof parsedText === 'object')
        return parsedText
    }
  }
  return undefined
}

const dependencies: Record<RetailDatabaseKind, readonly RetailDatabaseTable['name'][]> = {
  item: ['Item', 'ItemSparse'],
  map: ['Map'],
  uimap: ['UiMap'],
  area: ['AreaTable'],
  spell: ['SpellName', 'Spell'],
  encounter: ['DungeonEncounter', 'Map'],
}

function matches(result: RetailDatabaseResult, request: RetailDatabaseQuery) {
  if (result.operation !== request.operation)
    return false
  if (result.outcome === 'error')
    return true
  if (request.operation === 'stats')
    return result.source?.tables.length === 8
  const kind = request.operation === 'search' ? request.kind : request.operation === 'fetch' ? request.id.split(':')[0] as RetailDatabaseKind : undefined
  if (request.operation === 'fetch' && result.entries.some(entry => entry.id !== request.id))
    return false
  if (request.operation === 'search' && result.entries.some(entry => entry.kind !== request.kind))
    return false
  if (request.operation === 'search' && (result.offset !== (request.offset ?? 0) || result.limit !== (request.limit ?? 20)))
    return false
  if (kind) {
    const tables = result.source?.tables.map(table => table.name)
    return tables?.length === dependencies[kind].length && dependencies[kind].every(name => tables.includes(name))
  }
  return true
}

/**
 * Reads actual recorded output only for the matching native query.
 * @example readWowRetailAnswer(undefined, JSON.stringify({ request: '{"operation":"stats"}' })).status // => 'loading'
 */
export function readWowRetailAnswer(result: unknown, args: string): RetailDatabaseAnswer {
  const parsedArgs = safeParse(retailDatabaseToolArgumentsSchema, json(args))
  const parsedQuery = safeParse(retailDatabaseQuerySchema, parsedArgs.success ? json(parsedArgs.output.request) : undefined)
  const request = parsedQuery.success ? parsedQuery.output : undefined
  const answer: RetailDatabaseAnswer = {
    status: result === undefined ? 'loading' : 'invalid',
    operation: request?.operation ?? 'stats',
    kind: request?.operation === 'search' ? request.kind : undefined,
    query: request?.operation === 'search' ? request.query : undefined,
    requestedId: request?.operation === 'fetch' ? request.id : undefined,
    source: null,
    entries: [],
    notices: [],
    offset: 0,
    limit: 0,
    hasMore: false,
    partial: false,
  }
  if (result === undefined || !request)
    return answer
  const parsed = safeParse(retailDatabaseResultSchema, payload(result))
  if (!parsed.success || !matches(parsed.output, request))
    return answer
  const data = parsed.output
  const notices = [...new Set([...data.notices, ...data.entries.flatMap(entry => entry.notices)])]
  if (data.source?.hotfixesApplied === false && !notices.includes('hotfixes-not-applied'))
    notices.push('hotfixes-not-applied')
  if (data.source?.tables.some(table => table.encrypted) && !notices.includes('encrypted-sections'))
    notices.push('encrypted-sections')
  return {
    ...answer,
    status: data.outcome === 'ok' ? 'success' : data.outcome === 'not_found' ? 'not-found' : data.outcome,
    source: data.source,
    receivedAt: data.receivedAt,
    cache: data.cache,
    entries: data.entries,
    notices,
    errorCode: data.errorCode,
    stats: data.stats,
    offset: data.offset,
    limit: data.limit,
    hasMore: data.hasMore,
    partial: data.hasMore || notices.some(notice => ['encrypted-sections', 'missing-fields', 'result-truncated'].includes(notice)),
  }
}
