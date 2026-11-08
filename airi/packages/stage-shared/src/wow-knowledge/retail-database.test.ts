import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import area from './fixtures/retail-database-area.json'
import encounter from './fixtures/retail-database-encounter.json'
import item from './fixtures/retail-database-item.json'
import map from './fixtures/retail-database-map.json'
import serviceResults from './fixtures/retail-database-service-results.json'
import spell from './fixtures/retail-database-spell.json'
import stats from './fixtures/retail-database-stats.json'
import uimap from './fixtures/retail-database-uimap.json'

import { retailDatabaseQuerySchema, retailDatabaseResultSchema } from './retail-database'
import { readWowRetailAnswer as readRecordedRetailAnswer } from './retail-database-answer'

const fixtures = [item, map, uimap, area, spell, encounter]

function readWowRetailAnswer(result: unknown, request: string) {
  return readRecordedRetailAnswer(result, JSON.stringify({ request }))
}

describe('retail database query boundary', () => {
  it.each(serviceResults)('reads real Python service output for $request.operation $request.kind $request.id', ({ request, result }) => {
    const answer = readRecordedRetailAnswer(JSON.stringify(result), JSON.stringify({ request: JSON.stringify(request) }))
    expect(answer.status).not.toBe('invalid')
    expect(answer.operation).toBe(request.operation)
    expect(answer.source?.build).toBe('12.1.5.70575')
  })
  it('accepts the three fixed query operations, including the real base map zero', () => {
    expect(safeParse(retailDatabaseQuerySchema, { operation: 'stats' }).success).toBe(true)
    expect(safeParse(retailDatabaseQuerySchema, { operation: 'search', kind: 'item', query: '瑟银', limit: 50, offset: 10000 }).success).toBe(true)
    expect(safeParse(retailDatabaseQuerySchema, { operation: 'fetch', id: 'map:0' }).success).toBe(true)
    expect(readRecordedRetailAnswer(map, '{"operation":"fetch","id":"map:0"}').status).toBe('invalid')
    expect(readRecordedRetailAnswer(map, JSON.stringify({ request: '{"operation":"fetch","id":"map:0"}', path: '/private' })).status).toBe('invalid')
  })

  it.each([
    { operation: 'search', kind: 'item', query: 'x', sql: 'SELECT * FROM Item' },
    { operation: 'stats', path: 'I:/private/retail.sqlite3' },
    { operation: 'stats', url: 'https://example.com/' },
    { operation: 'fetch', id: 'item:12359', table: 'Item' },
    { operation: 'fetch', id: 'quest:1' },
    { operation: 'fetch', id: 'map:00' },
    { operation: 'fetch', id: 'map:-1' },
    { operation: 'fetch', id: 'item:2147483648' },
    { operation: 'search', kind: 'item', query: ' ', limit: 20 },
    { operation: 'search', kind: 'item', query: 'x', limit: 0 },
    { operation: 'search', kind: 'spell', query: 'x', offset: 10001 },
  ])('rejects extra capabilities and invalid query parameters: %j', (value) => {
    expect(safeParse(retailDatabaseQuerySchema, value).success).toBe(false)
  })

  it.each(fixtures)('reads actual local $entries.0.kind records without substituting another namespace', (fixture) => {
    const entity = fixture.entries[0]!
    const answer = readWowRetailAnswer(JSON.stringify(fixture), JSON.stringify({ operation: 'fetch', id: entity.id }))
    expect(answer.status).toBe('success')
    expect(answer.entries[0]?.id).toBe(entity.id)
    expect(answer.source?.game).toBe('retail')
    expect(answer.source?.name).toBe('正式服本地 DB2')
    expect(answer.entries[0]?.fields).toEqual(entity.fields)
    expect(answer.notices).toContain('hotfixes-not-applied')
  })

  it('preserves the actual seven-digit export time separately from query receipt', () => {
    const answer = readWowRetailAnswer(item, '{"operation":"fetch","id":"item:12359"}')
    expect(answer.source?.exportedAt).toBe('2026-10-30T15:32:33.5754384+00:00')
    expect(answer.receivedAt).toBe(item.receivedAt)
    expect(answer.receivedAt).not.toBe(answer.source?.exportedAt)
  })

  it('retains the original SQL receipt when a matching cached result is delivered later', () => {
    const time = Date.parse(item.receivedAt) + 1
    const cache = { status: 'hit', sourceReceivedAt: item.receivedAt, storedAt: new Date(time).toISOString(), servedAt: new Date(time + 1000).toISOString(), expiresAt: new Date(time + 86400000).toISOString() }
    const answer = readWowRetailAnswer({ ...item, cache }, '{"operation":"fetch","id":"item:12359"}')
    expect(answer.status).toBe('success')
    expect(answer.receivedAt).toBe(item.receivedAt)
    expect(answer.cache?.servedAt).toBe(cache.servedAt)
    expect(readWowRetailAnswer({ ...item, cache: { ...cache, sourceReceivedAt: '2001-01-01T00:00:00Z' } }, '{"operation":"fetch","id":"item:12359"}').status).toBe('invalid')
  })

  it('reads the existing recorded text-part representation', () => {
    const answer = readWowRetailAnswer([{ type: 'text', text: JSON.stringify(map) }], '{"operation":"fetch","id":"map:0"}')
    expect(answer.entries[0]?.title).toBe('东部王国')
    expect(answer.entries[0]?.numericId).toBe(0)
  })

  it('keeps wide integer strings, empty text, and raw spell templates as source strings', () => {
    const changed = { ...spell, entries: [{ ...spell.entries[0]!, fields: [{ key: 'Field_Unknown', value: '900719925474099312345' }, { key: 'Description_lang', value: '$s1 damage; $d duration' }, { key: 'AuraDescription_lang', value: '' }] }] }
    const answer = readWowRetailAnswer(changed, JSON.stringify({ operation: 'fetch', id: spell.entries[0]!.id }))
    expect(answer.entries[0]?.fields).toEqual(changed.entries[0]?.fields)
    expect(answer.notices).toContain('raw-spell-template')
  })

  it('validates typed identity, table provenance, pagination, and operation against the actual request', () => {
    const args = '{"operation":"fetch","id":"item:12359"}'
    expect(readWowRetailAnswer(map, args).status).toBe('invalid')
    expect(readWowRetailAnswer({ ...item, source: map.source }, args).status).toBe('invalid')
    expect(readWowRetailAnswer({ ...item, operation: 'search', limit: 20 }, args).status).toBe('invalid')
    const search = { ...item, operation: 'search', limit: 20 }
    expect(readWowRetailAnswer(search, '{"operation":"search","kind":"map","query":"x"}').status).toBe('invalid')
    expect(readWowRetailAnswer(search, '{"operation":"search","kind":"item","query":"x","offset":20}').status).toBe('invalid')
    expect(readWowRetailAnswer({ ...item, entries: [{ ...item.entries[0]!, numericId: 99 }] }, args).status).toBe('invalid')
  })

  it('requires local Retail metadata and never accepts hidden paths or arbitrary related URLs', () => {
    const args = '{"operation":"fetch","id":"item:12359"}'
    for (const patch of [{ game: 'forever' }, { product: 'wowf' }, { localOnly: false }, { path: 'I:/private/path' }, { exportedAt: '2026-02-30T00:00:00Z' }])
      expect(readWowRetailAnswer({ ...item, source: { ...item.source, ...patch } }, args).status).toBe('invalid')
    const badLink = { kind: 'map', id: 'javascript:alert(1)', title: 'unsafe' }
    expect(readWowRetailAnswer({ ...item, entries: [{ ...item.entries[0]!, links: [badLink] }] }, args).status).toBe('invalid')
    expect(readWowRetailAnswer({ ...item, error: 'private database path' }, args).status).toBe('invalid')
  })

  it('reads bounded stats and keeps encrypted counts explicit', () => {
    const answer = readWowRetailAnswer(stats, '{"operation":"stats"}')
    expect(answer.status).toBe('success')
    expect(answer.stats?.counts.item).toBe(stats.stats.counts.item)
    expect(answer.source?.tables).toHaveLength(8)
    expect(answer.partial).toBe(true)
    expect(answer.notices).toContain('encrypted-sections')
  })

  it('distinguishes empty search results from an absent ID and service errors', () => {
    const empty = { ...item, operation: 'search', outcome: 'empty', entries: [], limit: 20 }
    expect(readWowRetailAnswer(empty, '{"operation":"search","kind":"item","query":"unknown"}').status).toBe('empty')
    expect(readWowRetailAnswer({ ...item, outcome: 'not_found', entries: [] }, '{"operation":"fetch","id":"item:99"}').status).toBe('not-found')
    const failed = { operation: 'stats', outcome: 'error', source: null, entries: [], offset: 0, limit: 0, hasMore: false, notices: [], errorCode: 'database-unconfigured', receivedAt: item.receivedAt }
    expect(readWowRetailAnswer(failed, '{"operation":"stats"}').errorCode).toBe('database-unconfigured')
    expect(readWowRetailAnswer(failed, '{"operation":"stats"}').status).toBe('error')
    expect(readWowRetailAnswer({ ...failed, errorCode: 'raw private error' }, '{"operation":"stats"}').status).toBe('invalid')
  })

  it('marks partial pages without replacing absent rows, and rejects oversized or contradictory results', () => {
    const search = { ...item, operation: 'search', limit: 20, hasMore: true }
    expect(readWowRetailAnswer(search, '{"operation":"search","kind":"item","query":"瑟银"}').partial).toBe(true)
    expect(safeParse(retailDatabaseResultSchema, { ...item, entries: Array.from({ length: 51 }).fill(item.entries[0]) }).success).toBe(false)
    expect(readWowRetailAnswer('x'.repeat(1024 * 1024 + 1), '{"operation":"stats"}').status).toBe('invalid')
    expect(readWowRetailAnswer(undefined, '{"operation":"stats"}').status).toBe('loading')
    expect(readWowRetailAnswer(stats, '{broken').status).toBe('invalid')
  })
})
