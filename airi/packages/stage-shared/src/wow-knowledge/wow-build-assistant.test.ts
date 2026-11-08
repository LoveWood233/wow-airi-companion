import type { WowBuildContext, WowBuildEquippedItem, WowBuildQuery, WowBuildTalentNode } from './wow-build-assistant'

import { describe, expect, it } from 'vitest'

import armor from './fixtures/build-item-armor.json'
import item from './fixtures/build-item-base.json'
import proc from './fixtures/build-item-proc.json'
import spell from './fixtures/build-spell-warrior.json'
import allocation from './fixtures/build-talents-plan.json'
import talents from './fixtures/build-talents-warrior.json'

import { parseWowTalentPlan, readWowBuildQuery, readWowBuildToolRequest } from './wow-build-assistant'
import { compareWowBuildItem, explainWowTalentNodes } from './wow-build-explain'
import { readWowBuildItem, readWowBuildSpell, readWowBuildTalents } from './wow-build-source'

const query: Extract<WowBuildQuery, { operation: 'talents' }> = { operation: 'talents', game: 'forever', classId: 1, level: 15 }
const catalog = () => readWowBuildTalents(talents, 1)!.nodes
function equipped(): WowBuildEquippedItem {
  return { itemID: 25, itemGUID: 'Item-1', link: '|Hitem:25:0:0:0:0:0:0:0:15:0:0:0|h[Test]|h', name: '实际装备', type: '武器', subtype: '单手剑', equipLoc: 'INVTYPE_WEAPONMAINHAND', quality: 1, itemLevel: 2, requiredLevel: 1, stats: [{ key: 'ITEM_MOD_STAMINA_SHORT', value: 10 }, { key: 'ITEM_MOD_STRENGTH_SHORT', value: 3 }], tooltip: ['实际触发描述'], infoComplete: true, statsComplete: true, tooltipComplete: true, truncated: false }
}
function context(): WowBuildContext {
  return { game: 'forever', guid: 'Player-1', session: 's1', classId: 1, talents: { guid: 'Player-1', session: 's1', observedAt: '2026-11-01T09:00:00Z', clientBuild: '1.60.1.70707', locale: 'zhCN', classID: 1, status: 'active', hasStagedChanges: false, scope: 'selected-nodes', complete: true, truncated: false, knownZeroNodes: [{ treeID: 999, nodeID: 105957 }], nodes: [{ treeID: 999, nodeID: 105958, ranksPurchased: 3, activeRank: 3, maxRanks: 3, isAvailable: true, isVisible: true, meetsEdgeRequirements: true, entriesComplete: true, entries: [{ entryID: 777, definitionID: 888, spellID: 12282, rank: 3, isActive: true }], conditionsComplete: true, conditions: [] }] }, loadout: { guid: 'Player-1', session: 's1', observedAt: '2026-10-31T09:00:00Z', slots: Array.from({ length: 19 }, (_, index) => ({ slot: index + 1, state: index === 15 ? 'equipped' : 'empty', item: index === 15 ? equipped() : null })) } }
}

describe('build assistant requests and explicit plan identities', () => {
  it('validates each read-only operation and rejects extra fields', () => {
    expect(readWowBuildQuery(query)).toEqual(query)
    expect(readWowBuildQuery({ operation: 'spell', game: 'retail', spellId: 12282 })).toBeDefined()
    expect(readWowBuildQuery({ operation: 'compare-item', game: 'forever', slot: 12, itemId: 25 })).toBeDefined()
    for (const patch of [{ game: 'classic' }, { level: 256 }, { classId: 0 }, { nodeId: 0 }, { sql: 'select 1' }, { equip: true }])
      expect(readWowBuildQuery({ ...query, ...patch })).toBeUndefined()
    expect(readWowBuildToolRequest({ request: JSON.stringify(query) })).toEqual(query)
    expect(readWowBuildToolRequest({ request: JSON.stringify(query), path: 'private' })).toBeUndefined()
  })

  it('requires explicit unique node IDs instead of positions or entry IDs', () => {
    expect(parseWowTalentPlan('[{"nodeId":105958,"rank":3}]')).toEqual({ kind: 'nodes', nodes: [{ nodeId: 105958, rank: 3 }] })
    for (const text of ['[{"pos":0,"rank":3}]', '[{"entryId":105958,"rank":3}]', '[{"nodeId":1,"rank":3},{"nodeId":1,"rank":2}]', '[{"nodeId":1,"rank":1001}]', 'C4DAAAAGameImportCode', '{"nodes":[{"nodeId":1,"rank":2}]}'])
      expect(parseWowTalentPlan(text)).toBeUndefined()
  })

  it('accepts only verified calculator links and never treats an item or home page as an empty plan', () => {
    expect(parseWowTalentPlan('https://wuxianwow.com/talents/1?t=3--&lv=15')).toMatchObject({ kind: 'source', classId: 1 })
    expect(parseWowTalentPlan('3--')).toEqual({ kind: 'source', build: '3--' })
    for (const value of ['https://wuxianwow.com/', 'https://wuxianwow.com/item/25?t=3', 'https://wuxianwow.com/talents/1', 'https://wuxianwow.com/talents/1?t=3&t=2', 'https://wuxianwow.com/talents/1?t=3&lv=61', 'https://evil.example/talents/1?t=3', 'https://user@wuxianwow.com/talents/1?t=3'])
      expect(parseWowTalentPlan(value)).toBeUndefined()
  })
})

describe('actual Forever talent, spell and item shapes', () => {
  it('retains real node and prerequisite IDs separately from classic group and spell IDs', () => {
    const nodes = catalog()
    expect(nodes[0]).toMatchObject({ nodeId: 105958, name: '强化英勇打击', maxRank: 3, ranks: [{ rank: 1, spellId: 12282 }, { rank: 2, spellId: 12282 }, { rank: 3, spellId: 12282 }] })
    expect(nodes.find(node => node.nodeId === 105951)?.prerequisites[0]).toMatchObject({ nodeId: 105954, rank: 5, any: true })
    expect(readWowBuildTalents(talents, 2)).toBeUndefined()
    expect(readWowBuildTalents({ ...talents, game: 'classic' }, 1)).toBeUndefined()
    expect(readWowBuildTalents(allocation, 1)?.nodes[0]?.plannedRank).toBe(3)
    expect(readWowBuildTalents(allocation, 1)?.plan).toMatchObject({ normalized: '3', total: 3, cap: 11, remaining: 8 })
  })

  it('does not fill a hidden higher-rank description with rank-one text', () => {
    expect(readWowBuildSpell(spell, 12282)?.description).toContain('减少1点')
    expect(readWowBuildSpell(spell, 12664)).toMatchObject({ spellId: 12664, notices: ['base-spell-values', 'description-unavailable'] })
    expect(readWowBuildSpell(spell, 12664)?.description).toBeUndefined()
    expect(readWowBuildSpell(spell, 999)).toBeUndefined()
  })

  it('keeps base stats, effects and weapon properties as source facts without inventing proc rates', () => {
    expect(readWowBuildItem(item, 277979)?.stats).toEqual([{ key: 'ITEM_MOD_SPIRIT_SHORT', value: 6 }, { key: 'ITEM_MOD_STAMINA_SHORT', value: 5 }])
    const record = readWowBuildItem(proc, 19019)
    expect(record?.effects[0]).toBe('击中时可能')
    expect(record?.effects[1]).toContain('300点自然伤害')
    expect(record?.notices).toContain('proc-rate-unverified')
    expect(record?.statsComplete).toBe(false)
    expect(readWowBuildItem(item, 25)).toBeUndefined()
    expect(readWowBuildItem({ ...item, product: 'wow_classic' }, 277979)).toBeUndefined()
    expect(readWowBuildItem({ ...item, url: 'https://wuxianwow.com/item/25' }, 277979)?.url).toBeUndefined()
  })

  it('retains explicit armor, rejects conflicting duplicate armor, and leaves unverified rating labels unmapped', () => {
    const record = readWowBuildItem(armor, 12640)
    expect(record?.stats).toContainEqual({ key: 'RESISTANCE0_NAME', value: 565 })
    expect(record?.stats).toContainEqual({ key: 'ITEM_MOD_STRENGTH_SHORT', value: 18 })
    expect(record?.stats).toContainEqual({ key: '爆击等级', value: 28 })
    expect(record?.stats).toContainEqual({ key: '命中等级', value: 20 })
    const conflicting = { ...armor, equipment: { ...armor.equipment, stats: [...armor.equipment.stats, { stat: '护甲', value: 1 }] } }
    expect(readWowBuildItem(conflicting, 12640)).toBeUndefined()
  })
})

describe('committed talent explanation and comparison', () => {
  it('separates purchased and active ranks, and uses only verified same-build node identity', () => {
    const actual = context()
    actual.talents!.nodes[0]!.ranksPurchased = 2
    const nodes = explainWowTalentNodes(catalog(), query, actual, '1.60.1.70707')
    expect(nodes[0]).toMatchObject({ nodeId: 105958, currentRank: 3, mapping: 'same-build', activeSpellIds: [12282] })
    expect(nodes[0]?.plannedRank).toBeUndefined()
    expect(nodes[1]?.currentRank).toBe(0)
    expect(nodes[2]?.currentRank).toBeUndefined()
  })

  it('does not turn staged changes, absent nodes, or a different build into committed ranks', () => {
    const actual = context()
    expect(explainWowTalentNodes(catalog(), query, actual, '1.60.1.70708')[0]?.currentRank).toBeUndefined()
    actual.talents!.hasStagedChanges = true
    expect(explainWowTalentNodes(catalog(), query, actual, '1.60.1.70707')[0]?.currentRank).toBeUndefined()
    actual.talents!.hasStagedChanges = false
    actual.guid = 'Player-2'
    expect(explainWowTalentNodes(catalog(), query, actual, '1.60.1.70707')[0]?.currentRank).toBeUndefined()
  })

  it('compares only explicitly supplied plan nodes and keeps omitted plan ranks unspecified', () => {
    const request = { ...query, operation: 'compare-talents' as const, build: '[{"nodeId":105958,"rank":1}]' }
    const nodes = explainWowTalentNodes(catalog(), request, context(), '1.60.1.70707', parseWowTalentPlan(request.build))
    expect(nodes[0]).toMatchObject({ currentRank: 3, plannedRank: 1, delta: -2 })
    expect(nodes[1]?.plannedRank).toBeUndefined()
    expect(nodes[1]?.delta).toBeUndefined()
  })

  it('does not borrow an unverified observed max rank for a foreign reference plan', () => {
    const foreign: WowBuildTalentNode = { nodeId: 105958, mapping: 'unverified', ranks: [], prerequisites: [], activeSpellIds: [], conditions: [], notices: [] }
    const request = { ...query, operation: 'compare-talents' as const, build: '[{"nodeId":105958,"rank":5}]' }
    const node = explainWowTalentNodes([foreign], request, context(), '1.60.1.70708', parseWowTalentPlan(request.build))[0]
    expect(node?.maxRank).toBeUndefined()
    expect(node?.notices).not.toContain('plan-rank-exceeds-node')
    expect(node?.delta).toBeUndefined()
  })

  it('compares investments with purchased ranks instead of subtracting granted active ranks', () => {
    const actual = context()
    actual.talents!.nodes[0]!.activeRank = 4
    const request = { ...query, operation: 'compare-talents' as const, build: '[{"nodeId":105958,"rank":3}]' }
    const node = explainWowTalentNodes(catalog(), request, actual, '1.60.1.70707', parseWowTalentPlan(request.build))[0]
    expect(node).toMatchObject({ currentRank: 4, purchasedRank: 3, plannedRank: 3, delta: 0 })
    actual.talents!.nodes[0]!.ranksPurchased = null
    expect(explainWowTalentNodes(catalog(), request, actual, '1.60.1.70707', parseWowTalentPlan(request.build))[0]?.delta).toBeUndefined()
  })
})

describe('one-slot base-reference equipment comparison', () => {
  const request: Extract<WowBuildQuery, { operation: 'compare-item' }> = { operation: 'compare-item', game: 'forever', slot: 16, itemId: 277979 }
  it('compares matching stat keys and leaves missing catalog attributes unknown', () => {
    const result = compareWowBuildItem(readWowBuildItem(item, 277979)!, request, context())
    expect(result.compatibility).toBe('compatible')
    expect(result.differences).toContainEqual({ key: 'ITEM_MOD_STAMINA_SHORT', current: 10, candidate: 5, delta: -5 })
    expect(result.differences).toContainEqual({ key: 'ITEM_MOD_STRENGTH_SHORT', current: 3, candidate: undefined, delta: undefined })
    expect(result.notices).toContain('base-item-not-instance')
    expect(result.notices).toContain('weapon-pair-requires-review')
    expect(result.baseline?.link).toContain('item:25:')
  })

  it('uses an observed empty slot as zero without treating unknown slots as empty', () => {
    const candidate = { ...readWowBuildItem(item, 277979)!, slot: '戒指' }
    const empty = compareWowBuildItem(candidate, { ...request, slot: 11 }, context())
    expect(empty.baselineState).toBe('empty')
    expect(empty.differences).toContainEqual({ key: 'ITEM_MOD_STAMINA_SHORT', current: 0, candidate: 5, delta: 5 })
    const unknown = context()
    unknown.loadout!.slots[10]!.state = 'unknown'
    expect(compareWowBuildItem(candidate, { ...request, slot: 11 }, unknown).differences.every(row => row.current === undefined && row.delta === undefined)).toBe(true)
  })

  it('does not sum paired slots or produce deltas for an incompatible destination', () => {
    const candidate = readWowBuildItem(item, 277979)!
    const result = compareWowBuildItem(candidate, { ...request, slot: 11 }, context())
    expect(result.compatibility).toBe('incompatible')
    expect(result.differences.every(row => row.delta === undefined)).toBe(true)
    expect(compareWowBuildItem({ ...candidate, slot: '双手' }, request, context()).notices).toContain('two-hand-requires-review')
  })

  it('does not compare another character or fill unmapped source labels with zero', () => {
    const candidate = readWowBuildItem(item, 277979)!
    expect(compareWowBuildItem(candidate, request, { ...context(), session: 'new-session' }).baselineState).toBe('unknown')
    const unmapped = { ...candidate, stats: [{ key: '未知本地化词条', value: 5 }] }
    expect(compareWowBuildItem(unmapped, request, context()).differences.find(row => row.key === '未知本地化词条')?.current).toBeUndefined()
  })
})
