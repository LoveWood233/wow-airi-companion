import { describe, expect, it } from 'vitest'

import prices from './fixtures/crafting-price-item.json'
import recipe from './fixtures/reference-recipe.json'

import { readWowDataCacheEvidence, serializeWowDataCacheKey } from './wow-data-cache'
import { isWowMcpCacheableResult, wowMcpCacheTtl } from './wow-mcp-cache'

const scope = { game: 'forever', source: 'wuxianwow', build: '1.60.1.70707', locale: 'zhCN', snapshot: '2026-10-30T22:25:37+11:00', connection: 'public-source', tool: 'wuxianwow::search', args: { query: '瑟银' } }

describe('shared query cache policy', () => {
  it('normalizes nested parameter objects while preserving order-sensitive arrays', () => {
    const left = { ...scope, args: { nested: { b: 2, a: 1 }, list: [1, 2] } }
    const right = { ...scope, args: { list: [1, 2], nested: { a: 1, b: 2 } } }
    expect(serializeWowDataCacheKey(left)).toBe(serializeWowDataCacheKey(right))
    expect(serializeWowDataCacheKey({ ...left, args: { ...left.args, list: [2, 1] } })).not.toBe(serializeWowDataCacheKey(right))
  })

  it('isolates build, language, snapshot, connection, entity namespace, and parameters', () => {
    const original = serializeWowDataCacheKey(scope)
    for (const patch of [{ build: '1.60.1.70708' }, { locale: 'enUS' }, { snapshot: '2026-11-01T00:00:00Z' }, { connection: 'another-source' }, { tool: 'wuxianwow::fetch' }, { args: { query: '秘银' } }])
      expect(serializeWowDataCacheKey({ ...scope, ...patch })).not.toBe(original)
    expect(serializeWowDataCacheKey({ ...scope, game: 'retail' })).toBeUndefined()
    expect(serializeWowDataCacheKey({ ...scope, snapshot: '' })).toBeUndefined()
    expect(serializeWowDataCacheKey({ ...scope, connection: '' })).toBeUndefined()
  })

  it('rejects ambiguous non-JSON values, cycles, huge strings, and excessive depth', () => {
    for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, () => 1, new Date(), 'x'.repeat(17000)])
      expect(serializeWowDataCacheKey({ ...scope, args: { value } })).toBeUndefined()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(serializeWowDataCacheKey({ ...scope, args: cyclic })).toBeUndefined()
    let nested: unknown = 'x'
    for (let index = 0; index < 20; index++)
      nested = { nested }
    expect(serializeWowDataCacheKey({ ...scope, args: { nested } })).toBeUndefined()
    expect(serializeWowDataCacheKey({ ...scope, args: { a: '中'.repeat(16000) } })).toBeUndefined()
  })

  it('does not silently discard reserved own argument keys during validation', () => {
    const ordinary = serializeWowDataCacheKey({ ...scope, args: { query: 'x' } })
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const args: unknown = JSON.parse(`{"query":"x","${key}":{"marker":"literal data"}}`)
      const encoded = serializeWowDataCacheKey({ ...scope, args })
      expect(encoded).not.toBe(ordinary)
      expect(encoded).toContain(`"${key}"`)
    }
  })

  it('rejects sparse and oversized arrays before serializing holes as null', () => {
    expect(serializeWowDataCacheKey({ ...scope, args: { list: new Array<unknown>(1) } })).toBeUndefined()
    expect(serializeWowDataCacheKey({ ...scope, args: { list: new Array<unknown>(1_000_000) } })).toBeUndefined()
    expect(serializeWowDataCacheKey({ ...scope, args: { list: [undefined] } })).toBeUndefined()
    expect(serializeWowDataCacheKey({ ...scope, args: { list: [null] } })).toBeDefined()
    expect(serializeWowDataCacheKey({ ...scope, args: Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [index, null])) })).toBeUndefined()
  })

  it('requires consistent original, storage, delivery, and expiry timestamps', () => {
    const cache = { status: 'hit', sourceReceivedAt: '2026-11-01T00:00:00Z', storedAt: '2026-11-01T00:00:01Z', servedAt: '2026-11-01T00:10:00Z', expiresAt: '2026-11-02T00:00:01Z' }
    expect(readWowDataCacheEvidence(cache)?.sourceReceivedAt).toBe('2026-11-01T00:00:00Z')
    expect(readWowDataCacheEvidence({ ...cache, servedAt: '2026-10-31T00:00:00Z' })).toBeUndefined()
    expect(readWowDataCacheEvidence({ ...cache, expiresAt: '2026-11-03T00:00:00Z' })).toBeUndefined()
    expect(readWowDataCacheEvidence({ ...cache, sourceReceivedAt: '2026-02-30T00:00:00Z' })).toBeUndefined()
  })

  it('uses the agreed static and auction TTLs and bypasses writes, creative tools, and unknown fetch families', () => {
    expect(wowMcpCacheTtl('wuxianwow::leveling_route', { profession: '工程学' })).toBe(86400000)
    expect(wowMcpCacheTtl('wuxianwow::auction_house', { view: 'item', item_id: 12359 })).toBe(900000)
    expect(wowMcpCacheTtl('wuxianwow::item_usage', { item_id: 12359 })).toBe(900000)
    expect(wowMcpCacheTtl('wuxianwow::fetch', { id: 'item:12359' })).toBe(900000)
    expect(wowMcpCacheTtl('wuxianwow::fetch', { id: 'recipe:8796' })).toBe(86400000)
    for (const name of ['wuxianwow::stats', 'wuxianwow::report_issue', 'wuxianwow::stage', 'wuxianwow::revise', 'memory::search'])
      expect(wowMcpCacheTtl(name, {})).toBeUndefined()
    expect(wowMcpCacheTtl('wuxianwow::fetch', { id: 'scene:12345' })).toBeUndefined()
    expect(wowMcpCacheTtl('wuxianwow::fetch', { id: 'spell:16153' })).toBe(86400000)
  })

  it('accepts actual successful records while rejecting embedded failures and mismatched builds', () => {
    const result = { content: [{ type: 'text', text: JSON.stringify(recipe) }] }
    expect(isWowMcpCacheableResult(result, 'wuxianwow::fetch', '1.60.1.70707')).toBe(true)
    expect(isWowMcpCacheableResult({ ...result, isError: true }, 'wuxianwow::fetch', '1.60.1.70707')).toBe(false)
    expect(isWowMcpCacheableResult({ structuredContent: { outcome: 'error', error: 'failed' } }, 'wuxianwow::fetch', '1.60.1.70707')).toBe(false)
    expect(isWowMcpCacheableResult({ structuredContent: { outcome: 'ok', build: 'other' } }, 'wuxianwow::fetch', '1.60.1.70707')).toBe(false)
    expect(isWowMcpCacheableResult({ ...result, content: 'bad content' }, 'wuxianwow::fetch', '1.60.1.70707')).toBe(false)
    expect(isWowMcpCacheableResult({ structuredContent: { ...recipe, metadata: { ...recipe.metadata, auction: { collected_at: '北京时间 2026-10-26 16:49', guidance: 50 } } } }, 'wuxianwow::fetch', '1.60.1.70707')).toBe(false)
  })

  it('requires an auction collection time and complete market scope without changing the original sample', () => {
    expect(isWowMcpCacheableResult({ structuredContent: prices }, 'wuxianwow::auction_house', '1.60.1.70707')).toBe(true)
    expect(isWowMcpCacheableResult({ structuredContent: { ...prices, snapshot: { ...prices.snapshot, collected_at: '' } } }, 'wuxianwow::auction_house', '1.60.1.70707')).toBe(false)
    expect(isWowMcpCacheableResult({ structuredContent: { ...prices, snapshot: { ...prices.snapshot, collected_at: 'yesterday' } } }, 'wuxianwow::auction_house', '1.60.1.70707')).toBe(false)
    expect(prices.snapshot.collected_at).toBe('北京时间 2026-10-26 16:49')
  })
})
