import type { EquipmentRecord } from '../../shared/wow-companion-equipment'
import type { CompanionMemoryEntry, CompanionMemoryState } from '../../shared/wow-companion-memory'
import type { ChatterTopicInput } from './wow-companion-chatter-context'

import { describe, expect, it } from 'vitest'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'
import { buildCompanionMemoryContext, companionMemoryContextReport, projectCompanionMemories, selectChatterTopic } from './wow-companion-chatter-context'

const now = Date.parse('2026-11-02T10:00:00Z')
const snapshot = { ...loadoutStateFixture().bridge!.snapshot!, loginId: 'game-login' }
const character = { game: 'retail', account: snapshot.account, guid: snapshot.guid } as const

function memory(values: Partial<CompanionMemoryEntry> = {}): CompanionMemoryEntry {
  return {
    id: 'memory-1',
    personaId: 'persona-1',
    character,
    characterName: snapshot.name,
    kind: 'experience',
    source: 'user',
    sourceId: null,
    text: 'I enjoyed exploring this morning.',
    fact: null,
    occurredAt: now - 60_000,
    updatedAt: now - 60_000,
    collected: false,
    suppressed: false,
    gameSessionId: 'game-login',
    chatSessionId: null,
    expiresAt: null,
    expired: false,
    ...values,
  }
}

function input(memories: readonly CompanionMemoryEntry[] = [], values: Partial<ChatterTopicInput> = {}): ChatterTopicInput {
  return { personaId: 'persona-1', game: 'retail', snapshot, memories, mentionedKeys: [], firstInteraction: false, now, ...values }
}

function equipment(): CompanionMemoryEntry {
  const record = loadoutStateFixture().bridge!.equipmentLoadout!.slots[0]!.item
  if (!record)
    throw new Error('Expected equipped fixture item')
  return memory({ id: 'favorite', kind: 'equipment', collected: true, fact: { kind: 'equipment', record: {
    v: 1,
    id: 1,
    session: snapshot.session,
    guid: snapshot.guid,
    itemID: record.itemID,
    itemGUID: null,
    link: 'item:1',
    name: 'Favorite Helm',
    type: 'Armor',
    subtype: 'Plate',
    equipLoc: 'INVTYPE_HEAD',
    quality: 4,
    itemLevel: 90,
    requiredLevel: 1,
    stats: [{ key: 'ITEM_MOD_STRENGTH_SHORT', value: 20 }],
    tooltip: ['Never reveal this full tooltip.'],
    quantity: 1,
    observedAt: Math.floor((now - 60_000) / 1000),
    source: 'bag_added',
    infoComplete: true,
    statsComplete: true,
    tooltipComplete: true,
    truncated: false,
  } } })
}

describe('scoped companion chatter topics', () => {
  it('prioritizes current login goals over equipment, live level changes and user experiences', () => {
    const goal = memory({ id: 'goal', kind: 'session-goal', text: 'Explore a dungeon.' })
    const level = memory({ id: 'level', source: 'game-live', fact: { kind: 'level', fromLevel: 20, level: 21, durationMs: 60_000 } })
    const topic = selectChatterTopic(input([memory(), level, equipment(), goal]))
    expect(topic?.kind).toBe('goal')
    expect(topic?.memoryIds).toEqual(['goal'])
  })

  it('requires current login identity for session goals across conversation and topic selection', () => {
    const goals = [memory({ kind: 'session-goal', gameSessionId: 'previous-login' })]
    expect(selectChatterTopic(input(goals))).toBeUndefined()
    expect(projectCompanionMemories(input(goals))).toEqual([])
    expect(selectChatterTopic(input([memory({ kind: 'session-goal' })], { snapshot: { ...snapshot, loginId: undefined } }))).toBeUndefined()
  })

  it.each([
    { personaId: 'another-persona' },
    { character: { ...character, game: 'forever' as const } },
    { character: { ...character, account: 'other-account' } },
    { character: { ...character, guid: 'other-character' } },
    { suppressed: true },
    { expired: true },
    { expiresAt: now },
    { occurredAt: now + 1 },
    { updatedAt: now + 1 },
  ])('does not recall out-of-scope or inactive memories %j', (values) => {
    const request = input([memory(values)])
    expect(selectChatterTopic(request)).toBeUndefined()
    expect(projectCompanionMemories(request)).toEqual([])
  })

  it('includes global preferences in context without making them idle topics', () => {
    const preference = memory({ character: null, kind: 'preference', text: 'Do not rush me.' })
    const request = input([preference])
    expect(selectChatterTopic(request)).toBeUndefined()
    expect(projectCompanionMemories(request)[0]?.text).toBe('Do not rush me.')
    expect(projectCompanionMemories({ personaId: 'persona-1', memories: [preference], now })).toHaveLength(1)
  })

  it('does not turn a preference with attached evidence into a topic', () => {
    const preference = memory({ kind: 'preference', source: 'game-live', fact: { kind: 'level', fromLevel: 20, level: 21, durationMs: null } })
    expect(selectChatterTopic(input([preference]))).toBeUndefined()
  })

  it('does not repeat a mentioned entry revision but permits an owner update', () => {
    const entry = memory()
    const first = selectChatterTopic(input([entry]))!
    expect(first.key).toBe(`memory:${JSON.stringify([entry.id, entry.updatedAt])}`)
    expect(selectChatterTopic(input([entry], { mentionedKeys: [first.key] }))).toBeUndefined()
    const updated = { ...entry, updatedAt: entry.updatedAt + 1 }
    expect(selectChatterTopic(input([updated], { mentionedKeys: [first.key] }))?.key).not.toBe(first.key)
  })

  it('uses the first interaction fallback once and never cycles empty greetings', () => {
    const first = selectChatterTopic(input([], { firstInteraction: true }))!
    expect(first.kind).toBe('check-in')
    expect(first.evidence.intent).toBe('ask-current-plan-or-recent-news')
    expect(first.memoryIds).toEqual([])
    expect(selectChatterTopic(input([], { firstInteraction: true, mentionedKeys: [first.key] }))).toBeUndefined()
    expect(selectChatterTopic(input())).toBeUndefined()
    expect(selectChatterTopic(input([], { firstInteraction: true, snapshot: { ...snapshot, loginId: undefined } }))).toBeUndefined()
  })

  it('requires an older same-map memory and evidence of returning there', () => {
    const old = memory({ source: 'game-live', fact: { kind: 'location', map: snapshot.map, zone: snapshot.zone, instanceType: 'none' }, occurredAt: now - 600_000 })
    expect(selectChatterTopic(input([old]))).toBeUndefined()
    const elsewhere = memory({ id: 'other-place', source: 'game-live', fact: { kind: 'location', map: snapshot.map + 1, zone: 'Other place', instanceType: 'none' }, occurredAt: now - 300_000 })
    const topic = selectChatterTopic(input([old, elsewhere]))
    expect(topic?.kind).toBe('location-memory')
    expect(topic?.evidence.memories[0]?.occurredAt).toBe(now - 600_000)
    expect(selectChatterTopic(input([{ ...old, gameSessionId: 'previous-login' }]))?.kind).toBe('location-memory')
  })

  it('does not immediately retell a just-recorded arrival', () => {
    const arrival = memory({ source: 'game-live', gameSessionId: 'previous-login', fact: { kind: 'location', map: snapshot.map, zone: snapshot.zone, instanceType: 'none' }, occurredAt: now - 60_000 })
    expect(selectChatterTopic(input([arrival]))).toBeUndefined()
  })

  it.each(['game-baseline', 'game-gap'] as const)('labels %s evidence as recorded history rather than a shared adventure', (source) => {
    const remembered = memory({ source, gameSessionId: 'previous-login', fact: { kind: 'location', map: snapshot.map, zone: snapshot.zone, instanceType: 'none' }, occurredAt: now - 600_000 })
    const topic = selectChatterTopic(input([remembered]))
    expect(topic?.evidence.memories[0]?.sharedExperience).toBe(false)
    expect(topic?.evidence.memories[0]?.source).toBe(source)
  })

  it('does not congratulate baseline or gap level observations as a new live level', () => {
    const baseline = memory({ source: 'game-baseline', fact: { kind: 'level', fromLevel: 20, level: 21, durationMs: 60_000 } })
    expect(selectChatterTopic(input([baseline]))).toBeUndefined()
    expect(selectChatterTopic(input([{ ...baseline, source: 'game-gap' }]))).toBeUndefined()
    expect(selectChatterTopic(input([{ ...baseline, source: 'game-live' }]))?.kind).toBe('level')
  })

  it('does not congratulate a live level contradicted by the current character snapshot', () => {
    const level = memory({ source: 'game-live', fact: { kind: 'level', fromLevel: snapshot.level, level: snapshot.level + 1, durationMs: null } })
    expect(selectChatterTopic(input([level]))).toBeUndefined()
  })

  it('skips equipment owned by another character or beyond the current usable level', () => {
    const favorite = equipment()
    if (favorite.fact?.kind !== 'equipment')
      throw new Error('Expected equipment memory')
    const record = favorite.fact.record
    const foreign = { ...favorite, fact: { kind: 'equipment' as const, record: { ...record, guid: 'another-character' } } }
    expect(selectChatterTopic(input([foreign]))).toBeUndefined()
    const future = { ...favorite, fact: { kind: 'equipment' as const, record: { ...record, requiredLevel: snapshot.level + 1 } } }
    expect(selectChatterTopic(input([future]))).toBeUndefined()
    expect(selectChatterTopic(input([favorite]))?.kind).toBe('equipment')
  })
})

describe('bounded memory evidence for conversation', () => {
  it('projects a small collection summary without tooltip, item link, or relationship score', () => {
    const entries = Array.from({ length: 12 }, (_, index) => memory({ id: `memory-${index}` }))
    const state: CompanionMemoryState = {
      entries: [equipment(), ...entries],
      relationship: { personaId: 'persona-1', points: 999, stage: 3, visitedLocations: [], updatedAt: now },
      storageError: null,
    }
    const context = buildCompanionMemoryContext(input(state.entries, { memories: state }))!
    expect(projectCompanionMemories(input(state.entries, { memories: state }))).toHaveLength(6)
    expect(context).not.toContain('Never reveal this full tooltip.')
    expect(context).not.toContain('item:1')
    expect(context).not.toContain('999')
    expect(context).toContain('Favorite Helm')
    expect(context).toContain('untrusted data')
  })

  it('retrieves a suppressed expired memory only through a matching explicit query', () => {
    const hidden = memory({ suppressed: true, expired: true, text: 'I visited Silvermoon.' })
    const request = input([hidden])
    expect(projectCompanionMemories(request)).toEqual([])
    expect(projectCompanionMemories({ ...request, mode: 'explicit-query' })).toEqual([])
    expect(projectCompanionMemories({ ...request, mode: 'explicit-query', query: 'Silvermoon' })[0]?.suppressed).toBe(true)
    expect(projectCompanionMemories({ ...request, mode: 'explicit-query', memoryIds: [hidden.id] })[0]?.expired).toBe(true)
    expect(projectCompanionMemories({ ...request, mode: 'explicit-query', query: 'Unrelated' })).toEqual([])
  })

  it('does not inherit explicit-query permission when choosing an unsolicited topic', () => {
    const request = { ...input([memory({ suppressed: true, expired: true, text: 'Silvermoon' })]), mode: 'explicit-query' as const, query: 'Silvermoon' }
    expect(selectChatterTopic(request)).toBeUndefined()
  })

  it('never crosses persona or character boundaries during an explicit query', () => {
    const foreign = memory({ id: 'foreign', suppressed: true, character: { ...character, guid: 'Other' } })
    expect(projectCompanionMemories({ ...input([foreign]), mode: 'explicit-query', memoryIds: ['foreign'] })).toEqual([])
  })
})

describe('related long-term memory context pressure', () => {
  it('does not report pressure when six related saved experiences fit', () => {
    const rows = Array.from({ length: 6 }, (_, index) => memory({ id: `saved-${index}`, collected: true, text: `Silvermoon adventure ${index}` }))
    const request = { ...input(rows), query: 'Silvermoon' }
    const report = companionMemoryContextReport(request)
    expect(report.memories).toHaveLength(6)
    expect(report.omittedLongTerm).toBe(0)
    expect(report.truncatedLongTerm).toBe(0)
    expect(report.context).toBe(buildCompanionMemoryContext(request))
    expect(report.memories).toEqual(projectCompanionMemories(request))
  })

  it('reports the related saved experience omitted by the six-row context budget', () => {
    const rows = Array.from({ length: 7 }, (_, index) => memory({ id: `saved-${index}`, collected: true, text: `Silvermoon adventure ${index}` }))
    const report = companionMemoryContextReport({ ...input(rows), query: 'Silvermoon' })
    expect(report.memories.map(entry => entry.id)).toEqual(rows.slice(0, 6).map(entry => entry.id))
    expect(report.omittedLongTerm).toBe(1)
    expect(report.truncatedLongTerm).toBe(0)
  })

  it('reports preference overflow even before the total six-row budget is reached', () => {
    const rows = Array.from({ length: 3 }, (_, index) => memory({ id: `preference-${index}`, character: null, kind: 'preference', text: `Silvermoon preference ${index}` }))
    const report = companionMemoryContextReport({ ...input(rows), query: 'Silvermoon' })
    expect(report.memories).toHaveLength(2)
    expect(report.omittedLongTerm).toBe(1)
    expect(report.truncatedLongTerm).toBe(0)
  })

  it('matches an explicit Chinese place name without treating every saved preference as related', () => {
    const rows = Array.from({ length: 3 }, (_, index) => memory({ id: `preference-${index}`, kind: 'preference', text: `我喜欢银月城的风景 ${index}` }))
    const report = companionMemoryContextReport({ ...input(rows), query: '银月城' })
    expect(report.omittedLongTerm).toBe(1)
    expect(report.truncatedLongTerm).toBe(0)
    const unrelated = companionMemoryContextReport({ ...input(rows), query: '雷霆崖' })
    expect(unrelated.omittedLongTerm).toBe(0)
    expect(unrelated.truncatedLongTerm).toBe(0)
  })

  it('reports a relevant long-term row pushed out by ordinary experiences', () => {
    const rows = Array.from({ length: 6 }, (_, index) => memory({ id: `ordinary-${index}`, text: 'I explored an unrelated forest.' }))
    const saved = memory({ id: 'saved-silvermoon', collected: true, text: 'Silvermoon was our favorite city.' })
    const report = companionMemoryContextReport({ ...input([...rows, saved]), query: 'Silvermoon' })
    expect(report.memories.some(entry => entry.id === saved.id)).toBe(false)
    expect(report.omittedLongTerm).toBe(1)
    expect(report.truncatedLongTerm).toBe(0)
  })

  it('does not treat ordinary experience overflow or shortened ordinary text as long-term pressure', () => {
    const rows = Array.from({ length: 7 }, (_, index) => memory({ id: `ordinary-${index}`, text: `Silvermoon ${'x'.repeat(300)}` }))
    const report = companionMemoryContextReport({ ...input(rows), query: 'Silvermoon' })
    expect(report.memories).toHaveLength(6)
    expect(report.memories[0]?.text).toHaveLength(280)
    expect(report.omittedLongTerm).toBe(0)
    expect(report.truncatedLongTerm).toBe(0)
  })

  it('ignores unrelated long-term rows even when their text or count exceeds the budget', () => {
    const rows = Array.from({ length: 7 }, (_, index) => memory({ id: `unrelated-${index}`, collected: true, text: `Thunder Bluff ${'x'.repeat(300)}` }))
    const report = companionMemoryContextReport({ ...input(rows), query: 'Silvermoon' })
    expect(report.memories).toHaveLength(6)
    expect(report.omittedLongTerm).toBe(0)
    expect(report.truncatedLongTerm).toBe(0)
  })

  it('requires a real query before classifying projected omissions as related', () => {
    const rows = Array.from({ length: 7 }, (_, index) => memory({ id: `saved-${index}`, collected: true, text: `Silvermoon ${'x'.repeat(300)}` }))
    const report = companionMemoryContextReport(input(rows))
    expect(report.memories).toHaveLength(6)
    expect(report.context).toBe(buildCompanionMemoryContext(input(rows)))
    expect(report.omittedLongTerm).toBe(0)
    expect(report.truncatedLongTerm).toBe(0)
  })

  it.each([
    { length: 280, truncated: 0 },
    { length: 281, truncated: 1 },
  ])('reports selected relevant text truncation at $length characters', ({ length, truncated }) => {
    const saved = memory({ collected: true, text: 'Silvermoon '.padEnd(length, 'x') })
    const report = companionMemoryContextReport({ ...input([saved]), query: 'Silvermoon' })
    expect(report.memories[0]?.text).toHaveLength(280)
    expect(report.omittedLongTerm).toBe(0)
    expect(report.truncatedLongTerm).toBe(truncated)
  })

  it('does not count an omitted long entry twice as a selected truncation', () => {
    const rows = Array.from({ length: 7 }, (_, index) => memory({ id: `saved-${index}`, collected: true, text: `Silvermoon ${'x'.repeat(300)}` }))
    const report = companionMemoryContextReport({ ...input(rows), query: 'Silvermoon' })
    expect(report.memories).toHaveLength(6)
    expect(report.omittedLongTerm).toBe(1)
    expect(report.truncatedLongTerm).toBe(6)
  })

  it.each<Partial<CompanionMemoryEntry>>([
    { personaId: 'another-persona' },
    { character: { ...character, game: 'forever' } },
    { character: { ...character, account: 'other-account' } },
    { character: { ...character, guid: 'other-character' } },
    { suppressed: true },
    { expired: true },
    { expiresAt: now },
    { occurredAt: now + 1 },
    { updatedAt: now + 1 },
  ])('does not report excluded long-term memory pressure %j', (values) => {
    const saved = memory({ collected: true, text: `Silvermoon ${'x'.repeat(300)}`, ...values })
    const report = companionMemoryContextReport({ ...input([saved]), query: 'Silvermoon' })
    expect(report.memories).toEqual([])
    expect(report.context).toBeUndefined()
    expect(report.omittedLongTerm).toBe(0)
    expect(report.truncatedLongTerm).toBe(0)
  })

  it.each([{ suppressed: true }, { expired: true }])('does not warn about a hidden or expired row retrieved explicitly %j', (values) => {
    const saved = memory({ collected: true, text: `Silvermoon ${'x'.repeat(300)}`, ...values })
    const report = companionMemoryContextReport({ ...input([saved]), mode: 'explicit-query', query: 'Silvermoon' })
    expect(report.memories).toHaveLength(1)
    expect(report.omittedLongTerm).toBe(0)
    expect(report.truncatedLongTerm).toBe(0)
  })

  it('does not use the last observed character to report private memory pressure while offline', () => {
    const saved = memory({ collected: true, text: `Silvermoon ${'x'.repeat(300)}` })
    const report = companionMemoryContextReport({ ...input([saved], { snapshot: { ...snapshot, online: false } }), query: 'Silvermoon' })
    expect(report.memories).toEqual([])
    expect(report.omittedLongTerm).toBe(0)
    expect(report.truncatedLongTerm).toBe(0)
  })

  it.each([
    { length: 120, truncated: 0 },
    { length: 121, truncated: 1 },
  ])('reports the selected saved place label budget at $length characters', ({ length, truncated }) => {
    const saved = memory({ collected: true, text: '', fact: { kind: 'location', map: snapshot.map, zone: 'Silvermoon '.padEnd(length, 'x'), instanceType: 'none' } })
    const report = companionMemoryContextReport({ ...input([saved]), query: 'Silvermoon' })
    expect(report.memories).toHaveLength(1)
    expect(report.omittedLongTerm).toBe(0)
    expect(report.truncatedLongTerm).toBe(truncated)
  })

  it.each<{ field: string, patch: Partial<EquipmentRecord> }>([
    { field: 'name', patch: { name: 'Favorite Helm '.padEnd(121, 'x') } },
    { field: 'type', patch: { type: 'Armor'.padEnd(81, 'x') } },
    { field: 'stats', patch: { stats: ['ITEM_MOD_STRENGTH_SHORT', 'ITEM_MOD_AGILITY_SHORT', 'ITEM_MOD_INTELLECT_SHORT', 'ITEM_MOD_STAMINA_SHORT', 'ITEM_MOD_CRIT_RATING_SHORT', 'ITEM_MOD_HASTE_RATING_SHORT', 'ITEM_MOD_MASTERY_RATING_SHORT'].map(key => ({ key, value: 10 })) } },
  ])('reports the selected relevant equipment $field projection budget', ({ patch }) => {
    const saved = equipment()
    if (saved.fact?.kind !== 'equipment')
      throw new Error('Expected equipment memory')
    const row = { ...saved, fact: { kind: 'equipment' as const, record: { ...saved.fact.record, ...patch } } }
    const report = companionMemoryContextReport({ ...input([row]), query: 'Favorite Helm' })
    expect(report.memories).toHaveLength(1)
    expect(report.omittedLongTerm).toBe(0)
    expect(report.truncatedLongTerm).toBe(1)
  })

  it('does not report a fully retained equipment projection at its exact limits', () => {
    const saved = equipment()
    if (saved.fact?.kind !== 'equipment')
      throw new Error('Expected equipment memory')
    const row = { ...saved, fact: { kind: 'equipment' as const, record: {
      ...saved.fact.record,
      name: 'Favorite Helm '.padEnd(120, 'x'),
      type: 'Armor'.padEnd(80, 'x'),
      stats: ['ITEM_MOD_STRENGTH_SHORT', 'ITEM_MOD_AGILITY_SHORT', 'ITEM_MOD_INTELLECT_SHORT', 'ITEM_MOD_STAMINA_SHORT', 'ITEM_MOD_CRIT_RATING_SHORT', 'ITEM_MOD_HASTE_RATING_SHORT'].map(key => ({ key, value: 10 })),
    } } }
    const report = companionMemoryContextReport({ ...input([row]), query: 'Favorite Helm' })
    expect(report.memories).toHaveLength(1)
    expect(report.omittedLongTerm).toBe(0)
    expect(report.truncatedLongTerm).toBe(0)
  })
})
