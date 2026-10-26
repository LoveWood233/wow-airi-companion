import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from 'node:process'

import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { comparisonFixture } from './wow-companion-comparison.test-helper'
import { assessEquipment, equipmentComparisonSchema } from './wow-companion-equipment-comparisons'

describe('equipment comparison rules', () => {
  it('requires actual attribute gains and accepts equal-item-level improvements', () => {
    const comparison = comparisonFixture()
    expect(assessEquipment(comparison)).toEqual({ verdict: 'upgrade', reason: 'stats_upgrade' })
    comparison.candidate.itemLevel = comparison.current!.itemLevel
    expect(assessEquipment(comparison).verdict).toBe('upgrade')
    comparison.candidate.stats = structuredClone(comparison.current!.stats)
    comparison.candidate.itemLevel = 150
    expect(assessEquipment(comparison)).toEqual({ verdict: 'not_upgrade', reason: 'equivalent' })
  })

  it('rejects the observed one-handed mace for the Retribution character', () => {
    const comparison = comparisonFixture({ class: 'PALADIN', spec: 70, primary: 1, slot: 16, specMatch: false })
    comparison.current = { itemID: 219354, name: '塑山者的巨斧', itemLevel: 111, equipLoc: 'INVTYPE_2HWEAPON', type: '武器', subtype: '双手斧', stats: [{ key: 'ITEM_MOD_STRENGTH_SHORT', value: 24 }, { key: 'ITEM_MOD_STAMINA_SHORT', value: 131 }, { key: 'ITEM_MOD_HASTE_RATING_SHORT', value: 26 }, { key: 'ITEM_MOD_VERSATILITY', value: 22 }, { key: 'ITEM_MOD_DAMAGE_PER_SECOND_SHORT', value: 17.6 }], complex: false, complete: true }
    comparison.candidate = { itemID: 257013, name: '新绿碎击者', itemLevel: 158, equipLoc: 'INVTYPE_WEAPON', type: '武器', subtype: '单手锤', stats: [{ key: 'ITEM_MOD_STRENGTH_SHORT', value: 18 }, { key: 'ITEM_MOD_STAMINA_SHORT', value: 201 }, { key: 'ITEM_MOD_HASTE_RATING_SHORT', value: 16 }, { key: 'ITEM_MOD_VERSATILITY', value: 17 }, { key: 'ITEM_MOD_DAMAGE_PER_SECOND_SHORT', value: 20.769 }], complex: false, complete: true }
    expect(assessEquipment(comparison)).toEqual({ verdict: 'not_upgrade', reason: 'wrong_spec' })
    comparison.specMatch = true
    expect(assessEquipment(comparison)).toEqual({ verdict: 'review', reason: 'weapon_change' })
  })

  it.each([
    { changes: { usable: false }, reason: 'unusable', verdict: 'not_upgrade' },
    { changes: { specMatch: false }, reason: 'wrong_spec', verdict: 'not_upgrade' },
    { changes: { specMatch: null }, reason: 'unknown_spec', verdict: 'review' },
    { changes: { primary: 0 as const }, reason: 'unknown_spec', verdict: 'review' },
    { changes: { spec: 0 }, reason: 'unknown_spec', verdict: 'review' },
    { changes: { slot: 0, current: null }, reason: 'no_target', verdict: 'review' },
  ])('classifies $reason without requesting a change', ({ changes, reason, verdict }) => {
    expect(assessEquipment(comparisonFixture(changes))).toEqual({ reason, verdict })
  })

  it('distinguishes trade-offs, weaker stats, complex items, and incomplete information', () => {
    const comparison = comparisonFixture()
    comparison.candidate.stats[0].value = 9
    expect(assessEquipment(comparison).reason).toBe('stat_tradeoff')
    comparison.candidate.stats[1].value = 19
    expect(assessEquipment(comparison).reason).toBe('weaker_stats')
    comparison.candidate.complex = true
    expect(assessEquipment(comparison).reason).toBe('complex_item')
    comparison.candidate.complete = false
    expect(assessEquipment(comparison).reason).toBe('incomplete')
  })

  it('offers the observed plate legs with explicit primary and secondary trade-offs', () => {
    const comparison = comparisonFixture({ class: 'PALADIN', spec: 70, primary: 1, slot: 7 })
    comparison.current = {
      itemID: 237993,
      name: '虚痕队长护胫',
      itemLevel: 134,
      equipLoc: 'INVTYPE_LEGS',
      type: '护甲',
      subtype: '板甲',
      stats: [{ key: 'ITEM_MOD_STRENGTH_SHORT', value: 29 }, { key: 'ITEM_MOD_STAMINA_SHORT', value: 244 }, { key: 'RESISTANCE0_NAME', value: 69 }, { key: 'ITEM_MOD_CRIT_RATING_SHORT', value: 20 }, { key: 'ITEM_MOD_MASTERY_RATING_SHORT', value: 37 }],
      complex: false,
      complete: true,
    }
    comparison.candidate = {
      ...comparison.current,
      itemID: 257002,
      name: '钢皮腿铠',
      itemLevel: 158,
      stats: [{ key: 'ITEM_MOD_STRENGTH_SHORT', value: 37 }, { key: 'ITEM_MOD_STAMINA_SHORT', value: 402 }, { key: 'RESISTANCE0_NAME', value: 92 }, { key: 'ITEM_MOD_CRIT_RATING_SHORT', value: 36 }, { key: 'ITEM_MOD_MASTERY_RATING_SHORT', value: 30 }],
    }
    expect(assessEquipment(comparison)).toEqual({ verdict: 'review', reason: 'primary_upgrade_tradeoff' })
    comparison.candidate.complex = true
    expect(assessEquipment(comparison).reason).toBe('complex_item')
  })

  it.each(['equal-level', 'no-primary-gain', 'stamina-loss', 'dps-loss', 'armor-loss'] as const)('keeps %s trade-offs out of equipment offers', (condition) => {
    const comparison = comparisonFixture()
    comparison.current!.stats.push({ key: 'ITEM_MOD_MASTERY_RATING_SHORT', value: 37 })
    comparison.candidate.stats.push({ key: 'ITEM_MOD_MASTERY_RATING_SHORT', value: 30 })
    if (condition === 'equal-level')
      comparison.candidate.itemLevel = comparison.current!.itemLevel
    if (condition === 'no-primary-gain')
      comparison.candidate.stats[0].value = comparison.current!.stats[0].value
    if (condition === 'stamina-loss')
      comparison.candidate.stats[1].value = 19
    if (condition === 'dps-loss') {
      comparison.current!.stats.push({ key: 'ITEM_MOD_DAMAGE_PER_SECOND_SHORT', value: 10 })
      comparison.candidate.stats.push({ key: 'ITEM_MOD_DAMAGE_PER_SECOND_SHORT', value: 9 })
    }
    if (condition === 'armor-loss') {
      comparison.current!.stats.push({ key: 'RESISTANCE0_NAME', value: 10 })
      comparison.candidate.stats.push({ key: 'RESISTANCE0_NAME', value: 9 })
    }
    expect(assessEquipment(comparison)).toEqual({ verdict: 'review', reason: 'stat_tradeoff' })
  })

  it('ignores adaptive primary stats that do not belong to the current specialization', () => {
    const comparison = comparisonFixture()
    comparison.current!.stats.push({ key: 'ITEM_MOD_STRENGTH_SHORT', value: 100 })
    comparison.candidate.stats.push({ key: 'ITEM_MOD_STRENGTH_SHORT', value: 1 })
    expect(assessEquipment(comparison).verdict).toBe('upgrade')
    comparison.candidate.stats.push({ key: 'UNKNOWN_SPECIAL_POWER', value: 10 })
    expect(assessEquipment(comparison).reason).toBe('incomplete')
  })

  it('fills a known empty slot and keeps lower-item-level trade-offs for manual review', () => {
    const comparison = comparisonFixture()
    comparison.candidate.itemLevel = 99
    expect(assessEquipment(comparison).reason).toBe('stat_tradeoff')
    comparison.current = { ...comparison.current!, itemID: 0, itemLevel: -1, name: 'Empty', stats: [] }
    expect(assessEquipment(comparison).reason).toBe('empty_slot')
  })

  it('canonicalizes robes and chest slots without crossing armor categories', () => {
    const comparison = comparisonFixture()
    comparison.candidate.equipLoc = 'INVTYPE_CHEST'
    expect(assessEquipment(comparison).verdict).toBe('upgrade')
    comparison.candidate.subtype = 'Plate'
    expect(assessEquipment(comparison).reason).toBe('weapon_change')
  })

  it('validates complete comparisons and rejects malformed boundaries', () => {
    expect(safeParse(equipmentComparisonSchema, comparisonFixture()).success).toBe(true)
    for (const changes of [{ slot: 0 }, { candidate: { ...comparisonFixture().candidate, itemID: 0 } }, { guid: 'bad\nidentity' }, { class: '\u0085' }, { current: null }, { spec: true }, { primary: 3 }])
      expect(safeParse(equipmentComparisonSchema, { ...comparisonFixture(), ...changes }).success).toBe(false)
    const comparison = comparisonFixture()
    comparison.candidate.stats.push(comparison.candidate.stats[0])
    expect(safeParse(equipmentComparisonSchema, comparison).success).toBe(false)
  })
})

describe.skipIf(!env.WOW_COMPANION_BRIDGE_DIR)('actual Lua comparison rules', () => {
  it.each(['WoWMapCompanion', 'WoWForeverCompanion'])('matches all %s producer assessments', (addon) => {
    const path = join(env.WOW_COMPANION_BRIDGE_DIR!, '..', addon, 'tests/fixtures/lua-comparison-cases.json')
    const cases = JSON.parse(readFileSync(path, 'utf8')) as { name: string, comparison: unknown, assessment: unknown }[]
    for (const value of cases) {
      const comparison = parse(equipmentComparisonSchema, value.comparison)
      expect(assessEquipment(comparison), value.name).toEqual(value.assessment)
    }
  })
})
