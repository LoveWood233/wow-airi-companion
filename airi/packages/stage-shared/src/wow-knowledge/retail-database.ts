import type { InferOutput } from 'valibot'

import { array, boolean, check, integer, literal, maxLength, maxValue, minLength, minValue, nullable, number, optional, picklist, pipe, regex, strictObject, string, variant } from 'valibot'

import { wowDataCacheEvidenceSchema } from './wow-data-cache'

/** This built-in tool queries the selected local export. Its arguments never select files, SQL, tables, or network addresses. */
export const WOW_RETAIL_QUERY_TOOL_NAME = 'builtIn_wowRetailQuery'

export const retailDatabaseKindSchema = picklist(['item', 'map', 'uimap', 'area', 'spell', 'encounter'])
export type RetailDatabaseKind = InferOutput<typeof retailDatabaseKindSchema>

export const retailDatabaseErrorSchema = picklist([
  'database-unconfigured',
  'database-missing',
  'database-unreadable',
  'database-invalid',
  'database-changed',
  'query-invalid',
  'query-timeout',
  'query-failed',
  'bridge-unavailable',
])
export type RetailDatabaseError = InferOutput<typeof retailDatabaseErrorSchema>

export const retailDatabaseNoticeSchema = picklist([
  'client-db2-only',
  'hotfixes-not-applied',
  'encrypted-sections',
  'missing-fields',
  'raw-spell-template',
  'map-id-not-uimap-id',
  'content-tuning-not-exploration-level',
  'result-truncated',
])
export type RetailDatabaseNotice = InferOutput<typeof retailDatabaseNoticeSchema>

const count = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER))
const typedId = pipe(string(), regex(/^(item|map|uimap|area|spell|encounter):(0|[1-9]\d{0,9})$/), check(value => Number(value.split(':')[1]) <= 2_147_483_647))
const numericId = pipe(number(), integer(), minValue(0), maxValue(2_147_483_647))
const title = pipe(string(), minLength(1), maxLength(256))
const notices = pipe(array(retailDatabaseNoticeSchema), maxLength(16))

function isoTimestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    return false
  const day = value.slice(0, 10)
  return Number(value.slice(11, 13)) < 24 && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day)
}

const timestamp = pipe(string(), maxLength(40), check(isoTimestamp, 'An explicit valid ISO timestamp is required.'))

/** Request validation excludes additional parameters. Only the main process supplies a configured database path. */
export const retailDatabaseQuerySchema = variant('operation', [
  strictObject({ operation: literal('stats') }),
  strictObject({
    operation: literal('search'),
    kind: retailDatabaseKindSchema,
    query: pipe(string(), minLength(1), maxLength(160), check(value => value.trim().length > 0)),
    limit: optional(pipe(count, minValue(1), maxValue(50))),
    offset: optional(pipe(count, maxValue(10_000))),
  }),
  strictObject({ operation: literal('fetch'), id: typedId }),
])
export type RetailDatabaseQuery = InferOutput<typeof retailDatabaseQuerySchema>

/** The model tool keeps a flat provider-friendly schema. The encoded request still passes the restricted query schema. */
export const retailDatabaseToolArgumentsSchema = strictObject({ request: pipe(string(), minLength(1), maxLength(4096)) })

export const retailDatabaseTableSchema = pipe(strictObject({
  name: picklist(['Item', 'ItemSparse', 'Map', 'UiMap', 'AreaTable', 'SpellName', 'Spell', 'DungeonEncounter']),
  status: picklist(['decoded', 'decoded_with_encrypted_sections']),
  rows: count,
  encrypted: boolean(),
}), check(table => table.status !== 'decoded_with_encrypted_sections' || table.encrypted))
export type RetailDatabaseTable = InferOutput<typeof retailDatabaseTableSchema>

export const retailDatabaseSourceSchema = strictObject({
  name: literal('正式服本地 DB2'),
  game: literal('retail'),
  product: literal('wow'),
  localOnly: literal(true),
  build: pipe(string(), maxLength(40), regex(/^\d+\.\d+\.\d+\.\d+$/)),
  locale: pipe(string(), regex(/^[a-z]{2}[A-Z]{2}$/)),
  exportedAt: timestamp,
  hotfixesApplied: boolean(),
  datasetId: pipe(string(), regex(/^[a-f0-9]{64}$/)),
  tables: pipe(array(retailDatabaseTableSchema), minLength(1), maxLength(8), check(tables => new Set(tables.map(table => table.name)).size === tables.length)),
})
export type RetailDatabaseSource = InferOutput<typeof retailDatabaseSourceSchema>

export const retailDatabaseLinkSchema = pipe(strictObject({ kind: retailDatabaseKindSchema, id: typedId, title: optional(title) }), check(link => link.id.startsWith(`${link.kind}:`)))
export type RetailDatabaseLink = InferOutput<typeof retailDatabaseLinkSchema>

export const retailDatabaseEntrySchema = pipe(strictObject({
  id: typedId,
  kind: retailDatabaseKindSchema,
  numericId,
  title,
  fields: pipe(array(strictObject({ key: pipe(string(), minLength(1), maxLength(128)), value: pipe(string(), maxLength(4096)) })), maxLength(64)),
  links: pipe(array(retailDatabaseLinkSchema), maxLength(24)),
  notices,
}), check(entry => entry.id === `${entry.kind}:${entry.numericId}`), check(entry => new Set(entry.fields.map(field => field.key)).size === entry.fields.length))
export type RetailDatabaseEntry = InferOutput<typeof retailDatabaseEntrySchema>

const counts = strictObject({ item: count, map: count, uimap: count, area: count, spell: count, encounter: count })

/** Source metadata describes an exported snapshot. `receivedAt` records the main process receiving this query result. */
export const retailDatabaseResultSchema = pipe(strictObject({
  operation: picklist(['stats', 'search', 'fetch']),
  outcome: picklist(['ok', 'empty', 'not_found', 'error']),
  source: nullable(retailDatabaseSourceSchema),
  entries: pipe(array(retailDatabaseEntrySchema), maxLength(50)),
  offset: pipe(count, maxValue(10_000)),
  limit: pipe(count, maxValue(50)),
  hasMore: boolean(),
  notices,
  errorCode: optional(retailDatabaseErrorSchema),
  receivedAt: timestamp,
  cache: optional(wowDataCacheEvidenceSchema),
  stats: optional(strictObject({ counts })),
}), check((result) => {
  if (result.cache && result.cache.sourceReceivedAt !== result.receivedAt)
    return false
  if (new Set(result.entries.map(entry => entry.id)).size !== result.entries.length)
    return false
  if (result.outcome === 'error')
    return result.errorCode !== undefined && result.entries.length === 0 && result.limit === 0 && !result.hasMore && result.stats === undefined && result.cache === undefined
  if (!result.source || result.errorCode !== undefined)
    return false
  if (result.operation === 'stats')
    return result.outcome === 'ok' && result.entries.length === 0 && result.stats !== undefined && result.limit === 0 && result.offset === 0 && !result.hasMore
  if (result.stats !== undefined)
    return false
  if (result.operation === 'fetch')
    return result.limit === 1 && result.offset === 0 && !result.hasMore && ((result.outcome === 'ok' && result.entries.length === 1) || (result.outcome === 'not_found' && result.entries.length === 0))
  return result.limit >= 1 && result.entries.length <= result.limit && ((result.outcome === 'ok' && result.entries.length > 0) || (result.outcome === 'empty' && result.entries.length === 0 && !result.hasMore))
}))
export type RetailDatabaseResult = InferOutput<typeof retailDatabaseResultSchema>
