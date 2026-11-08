import { describe, expect, it } from 'vitest'

import instance from './fixtures/reference-instance.json'
import itemJsonld from './fixtures/reference-item-jsonld.json'
import itemUsage from './fixtures/reference-item-usage.json'
import item from './fixtures/reference-item.json'
import map from './fixtures/reference-map.json'
import npc from './fixtures/reference-npc.json'
import quest from './fixtures/reference-quest.json'
import recipe from './fixtures/reference-recipe.json'
import recipes from './fixtures/reference-recipes.json'
import search from './fixtures/reference-search.json'
import stats from './fixtures/reference-stats.json'

import { isWowReferenceCall, readWowReferenceAnswer, readWowReferenceBuild, safeWowReferenceUrl } from './structured-answers'

function args(tool = 'fetch', input: Record<string, unknown> = { id: 'item:12359' }) {
  return JSON.stringify({ name: `wuxianwow::${tool}`, arguments: JSON.stringify(input) })
}

describe('structured Forever reference evidence', () => {
  it('retains a cache receipt only with its matching outer source timestamp', () => {
    const cache = { status: 'hit', sourceReceivedAt: '2026-11-01T00:00:00Z', storedAt: '2026-11-01T00:00:00Z', servedAt: '2026-11-01T01:00:00Z', expiresAt: '2026-11-02T00:00:00Z' }
    const wowReference = { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', receivedAt: cache.sourceReceivedAt }
    const result = readWowReferenceAnswer({ content: [{ type: 'text', text: JSON.stringify(item) }], wowReference, cache }, args())
    expect(result?.receivedAt).toBe(cache.sourceReceivedAt)
    expect(result?.cache?.servedAt).toBe(cache.servedAt)
    const mismatch = readWowReferenceAnswer({ content: [{ type: 'text', text: JSON.stringify(item) }], wowReference: { ...wowReference, receivedAt: '2026-11-01T02:00:00Z' }, cache }, args())
    expect(mismatch?.cache).toBeUndefined()
  })

  it('does not inherit cache metadata embedded inside source text over an outer receipt', () => {
    const cache = { status: 'hit', sourceReceivedAt: '2001-01-01T00:00:00Z', storedAt: '2001-01-01T00:00:00Z', servedAt: '2001-01-01T01:00:00Z', expiresAt: '2001-01-02T00:00:00Z' }
    const fake = { ...item, wowReference: { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', receivedAt: cache.sourceReceivedAt }, cache }
    const wowReference = { ...fake.wowReference, receivedAt: '2026-11-01T00:00:00Z' }
    const result = readWowReferenceAnswer({ content: [{ type: 'text', text: JSON.stringify(fake) }], wowReference }, args())
    expect(result?.receivedAt).toBe(wowReference.receivedAt)
    expect(result?.cache).toBeUndefined()
  })

  it('matches only this server and the read-only reference families', () => {
    expect(isWowReferenceCall(args())).toBe(true)
    expect(isWowReferenceCall(JSON.stringify({ name: 'wuxianwow::fetch' }))).toBe(true)
    expect(isWowReferenceCall(args('fetch', { id: 'scene:abc' }))).toBe(false)
    expect(isWowReferenceCall(args('fetch', { id: 'spell:16153' }))).toBe(false)
    expect(isWowReferenceCall(args('report_issue', { text: 'example' }))).toBe(false)
    expect(isWowReferenceCall(args('stage', {}))).toBe(false)
    expect(isWowReferenceCall(JSON.stringify({ name: 'other::fetch', arguments: '{}' }))).toBe(false)
    expect(readWowReferenceAnswer(item, JSON.stringify({ name: 'other::fetch', arguments: '{}' }))).toBeUndefined()
    expect(readWowReferenceAnswer(item, '{broken')).toBeUndefined()
  })

  it('distinguishes running calls from malformed reference arguments', () => {
    expect(readWowReferenceAnswer(undefined, args())?.status).toBe('loading')
    expect(readWowReferenceAnswer(undefined, JSON.stringify({ name: 'wuxianwow::search', arguments: '{broken' }))?.status).toBe('invalid')
    expect(readWowReferenceAnswer(undefined, JSON.stringify({ name: 'wuxianwow::search', arguments: '[]' }))?.status).toBe('invalid')
  })

  it('keeps search summaries distinct from a full entity detail', () => {
    const result = readWowReferenceAnswer(search, args('search', { query: '瑟银锭', kind: 'item' }))!
    expect(result.status).toBe('success')
    expect(result.mode).toBe('search')
    expect(result.entries.map(entry => entry.id)).toEqual(['item:12359', 'item:220925'])
    expect(result.source).toBe('无限图鉴 wuxianwow.com')
    expect(result.total).toBe(6)
    expect(result.hasMore).toBe(true)
    expect(result.query).toBe('瑟银锭')
    expect(result.build).toBeUndefined()
    expect(result.updatedAt).toBeUndefined()
  })

  it.each([
    { tool: 'fetch', payload: item, id: 'item:12359', kind: 'item' },
    { tool: 'fetch', payload: recipe, id: 'recipe:8796', kind: 'recipe' },
    { tool: 'quests', payload: quest, id: 'quest:11', kind: 'quest' },
    { tool: 'npcs', payload: npc, id: 'npc:902747', kind: 'npc' },
    { tool: 'instances', payload: instance, id: 'instance:36', kind: 'instance' },
    { tool: 'atlas', payload: map, id: 'map:1424', kind: 'map' },
  ])('reads captured $kind entity $id', ({ tool, payload, id, kind }) => {
    const result = readWowReferenceAnswer(payload, args(tool))!
    expect(result.status).toBe('success')
    expect(result.mode).toBe('detail')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.id).toBe(id)
    expect(result.entries[0]?.kind).toBe(kind)
    expect(result.entries[0]?.url).toMatch(/^https:\/\/wuxianwow\.com\//)
  })

  it('reads recipe material quantities, outputs, craft location, and list forms without calculating requirements', () => {
    const detail = readWowReferenceAnswer(recipe, args('fetch', { id: 'recipe:8796' }))!.entries[0]!
    expect(detail.fields.find(field => field.key === 'profession')?.value).toBe('采矿')
    expect(detail.fields.find(field => field.key === 'craft-at')?.value).toBe('熔炉')
    expect(detail.sections.find(section => section.key === 'materials')?.lines).toEqual(['瑟银矿石 × 1'])
    expect(detail.sections.find(section => section.key === 'products')?.lines).toEqual(['瑟银锭 × 1'])
    const list = readWowReferenceAnswer(recipes, args('recipes', {}))!
    expect(list.mode).toBe('list')
    expect(list.entries[0]?.sections.find(section => section.key === 'materials')?.lines).toEqual(['轻皮×2、粗线×1'])
  })

  it('keeps confirmed quest fields separate from temporary givers, faction, and locations', () => {
    const result = readWowReferenceAnswer(quest, args('quests', { id: 11 }))!
    const entry = result.entries[0]!
    expect(entry.fields.find(field => field.key === 'level')).toEqual({ key: 'level', value: '10' })
    expect(entry.fields.find(field => field.key === 'faction')).toEqual({ key: 'faction', value: '联盟', temporary: true })
    expect(entry.fields.find(field => field.key === 'temporary-source')?.value).toBe('QuestieDB')
    expect(entry.sections.find(section => section.key === 'givers')?.temporary).toBe(true)
    expect(entry.sections.find(section => section.key === 'locations')?.temporary).toBe(true)
    expect(entry.sections.find(section => section.key === 'objectives')?.lines).toContain('彩色豺狼人臂章 × 8')
    expect(entry.sections.find(section => section.key === 'rewards')?.lines[0]).toContain('840')
    expect(result.notices).toContain('temporary')
  })

  it('shows NPC drop provenance and instance uncertainty without inventing drop rates or entrance requirements', () => {
    const boss = readWowReferenceAnswer(npc, args('npcs', { id: 902747 }))!.entries[0]!
    expect(boss.temporary).toBe(true)
    expect(boss.fields.find(field => field.key === 'temporary-source')?.value).toBe('Spyglass')
    expect(boss.sections.find(section => section.key === 'temporary-drops')?.lines).toContain('残酷倒钩')
    const dungeon = readWowReferenceAnswer(instance, args('instances', { id: 36 }))!
    expect(dungeon.entries[0]?.fields.find(field => field.key === 'players')?.value).toBe('5 / 10 人')
    expect(dungeon.entries[0]?.sections.find(section => section.key === 'bosses')?.lines).toHaveLength(8)
    expect(dungeon.entries[0]?.sections.find(section => section.key === 'details')?.lines[0]).toContain('没写不等于没有')
    expect(readWowReferenceAnswer({ ...instance, entrance: { approx: true } }, args('instances', { id: 36 }))?.notices).toContain('approximate')
  })

  it('reads JSON-LD graph entities, excludes page/organization records, and never treats first-seen build as current', () => {
    const payload = { ...itemJsonld, '@graph': [...itemJsonld['@graph'], { '@id': 'https://wuxianwow.com/item/12359#webpage', '@type': 'ItemPage', 'name': 'Page title' }] }
    const result = readWowReferenceAnswer(payload, args())!
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.fields.find(field => field.key === 'quality')?.value).toBe('普通')
    expect(result.build).toBe('1.60.1.70707')
    expect(result.updatedAt).toBe('2026-10-30')
    expect(result.build).not.toBe('1.60.1.70094')
  })

  it('unwraps actual MCP and provider envelopes while preserving version and query-time evidence', () => {
    const result = readWowReferenceAnswer(JSON.stringify({
      wowReference: { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', build: '1.60.1.70707', buildCreatedAt: '2026-10-30T22:25:37+11:00', receivedAt: '2026-11-01T03:00:00.000Z' },
      toolResult: { content: [{ type: 'text', text: JSON.stringify(item) }] },
    }), args())!
    expect(result.status).toBe('success')
    expect(result.build).toBe('1.60.1.70707')
    expect(result.buildCreatedAt).toBe('2026-10-30T22:25:37+11:00')
    expect(result.receivedAt).toBe('2026-11-01T03:00:00.000Z')
    expect(result.updatedAt).toBeUndefined()
    expect(result.collectedAt).toBeUndefined()
    expect(readWowReferenceAnswer({ structuredContent: item }, args())?.status).toBe('success')
    expect(readWowReferenceAnswer([{ type: 'text', text: JSON.stringify(item) }], args())?.status).toBe('success')
    expect(readWowReferenceAnswer({ structuredContent: {}, content: [{ type: 'text', text: JSON.stringify(item) }] }, args())?.status).toBe('success')
  })

  it('separates explicit auction collection scope from the data build date', () => {
    const result = readWowReferenceAnswer({ ...item, auction: { collected_at: '北京时间 2026-10-26 16:49', realm: 'Realm A' } }, args())!
    expect(result.collectedAt).toBe('北京时间 2026-10-26 16:49')
    expect(result.realm).toBe('Realm A')
    expect(result.notices).toContain('auction')
    expect(result.updatedAt).toBeUndefined()
  })

  it('distinguishes empty, failed, malformed and partially readable data without exposing raw errors', () => {
    expect(readWowReferenceAnswer({ outcome: 'ok', results: [] }, args('search', { query: 'missing' }))?.status).toBe('empty')
    expect(readWowReferenceAnswer({ outcome: 'not_found' }, args())?.status).toBe('empty')
    const failure = readWowReferenceAnswer({ isError: true, content: [{ type: 'text', text: 'private credentials and paths' }] }, args())!
    expect(failure.status).toBe('error')
    expect(JSON.stringify(failure)).not.toContain('private credentials')
    expect(readWowReferenceAnswer('invalid JSON private', args())?.status).toBe('invalid')
    const partial = readWowReferenceAnswer({ results: [...search.results, { id: 'unknown', title: '' }] }, args('search', {}))!
    expect(partial.status).toBe('success')
    expect(partial.entries).toHaveLength(2)
    expect(partial.notices).toContain('incomplete')
    expect(readWowReferenceAnswer({ id: 12359, title: 'No typed identity' }, args())?.status).toBe('invalid')
  })

  it('rejects explicit game mismatches and does not treat unknown NPC game semantics as a Retail scope', () => {
    expect(readWowReferenceAnswer({ ...item, product: 'wow' }, args())?.status).toBe('invalid')
    expect(readWowReferenceAnswer({ ...itemJsonld, game: 'retail' }, args())?.status).toBe('invalid')
    expect(readWowReferenceAnswer({ structuredContent: item, wowReference: { game: 'classic' } }, args())?.status).toBe('invalid')
    expect(readWowReferenceAnswer({ ...npc, game: 'encounter' }, args('npcs', { id: 902747 }))?.status).toBe('success')
  })

  it('keeps known identity authoritative when a returned source URL points to another record', () => {
    const result = readWowReferenceAnswer({ ...item, url: 'https://wuxianwow.com/quest/11' }, args())!
    expect(result.entries[0]?.url).toBe('https://wuxianwow.com/id/item:12359')
    expect(result.entries[0]?.incomplete).toBe(true)
    expect(result.notices).toContain('incomplete')
    expect(readWowReferenceAnswer({ ...item, url: 'javascript:alert(1)' }, args())?.entries[0]?.url).not.toContain('javascript:')
  })

  it('rejects conflicting record and metadata identities instead of borrowing facts from another entity', () => {
    expect(readWowReferenceAnswer({ ...item, metadata: { ...item.metadata, id: 'item:999' } }, args())?.status).toBe('invalid')
    expect(readWowReferenceAnswer({ ...item, fetch_id: 'quest:11' }, args())?.status).toBe('invalid')
    expect(readWowReferenceAnswer({ ...item, metadata: { ...item.metadata, kind: 'quest' } }, args())?.status).toBe('invalid')
  })

  it('deduplicates source entries and carries the explicit total usage count', () => {
    const result = readWowReferenceAnswer({ results: [search.results[0], search.results[0]] }, args('search', {}))!
    expect(result.entries).toHaveLength(1)
    const detail = readWowReferenceAnswer(item, args())!
    expect(detail.entries[0]?.fields.find(field => field.key === 'uses-count')?.value).toBe('132')
  })

  it('reads the material-usage tool and marks a source-provided subset as incomplete', () => {
    const result = readWowReferenceAnswer(itemUsage, args('item_usage', { item_id: 12359 }))!
    expect(isWowReferenceCall(args('item_usage', { item: '瑟银锭' }))).toBe(true)
    expect(result.status).toBe('success')
    expect(result.mode).toBe('detail')
    expect(result.query).toBe('12359')
    expect(result.entries[0]?.sections.find(section => section.key === 'sources')?.lines).toEqual(['熔炼瑟银'])
    expect(result.entries[0]?.sections.find(section => section.key === 'uses')?.lines).toHaveLength(3)
    expect(result.entries[0]?.fields.find(field => field.key === 'uses-count')?.value).toBe('132')
    expect(result.entries[0]?.sections.find(section => section.key === 'details')?.lines[0]).toContain('首领掉落')
    expect(result.notices).toContain('truncated')
  })

  it('bounds lists and rejects unsafe external links', () => {
    const list = Array.from({ length: 25 }, (_, index) => ({ id: `item:${index + 1}`, title: `Item ${index}` }))
    const result = readWowReferenceAnswer({ results: list }, args('search', { query: 'x'.repeat(500) }))!
    expect(result.entries).toHaveLength(20)
    expect(result.notices).toContain('truncated')
    expect(result.query).toHaveLength(240)
    expect(safeWowReferenceUrl('/item/12359')).toBe('https://wuxianwow.com/item/12359')
    for (const link of ['https://wuxianwow.com.evil/item/1', 'https://user:password@wuxianwow.com/item/1', 'http://wuxianwow.com/item/1', '//evil.com/path', 'javascript:alert(1)'])
      expect(safeWowReferenceUrl(link)).toBeUndefined()
  })

  it('reads only genuine Forever stats and rejects malformed metadata dates', () => {
    expect(readWowReferenceBuild({ content: [{ type: 'text', text: JSON.stringify(stats) }] })).toEqual({ build: '1.60.1.70707', buildCreatedAt: '2026-10-30T22:25:37+11:00' })
    expect(readWowReferenceBuild({ ...stats, product: 'wow' })).toBeUndefined()
    expect(readWowReferenceBuild({ ...stats, outcome: 'error' })).toBeUndefined()
    expect(readWowReferenceBuild({ ...stats, build: 'unknown' })).toBeUndefined()
    expect(readWowReferenceBuild({ ...stats, built_at: '2026-02-30T00:00:00Z' })).toEqual({ build: '1.60.1.70707' })
  })
})
