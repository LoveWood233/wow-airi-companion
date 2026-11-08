import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from 'node:process'

import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { comparisonFixture } from './wow-companion-comparison.test-helper'
import { assessEquipment, equipmentComparisonSchema, liveEquipmentComparisonSchema } from './wow-companion-equipment-comparisons'

describe('addon-owned equipment conclusions', () => {
  it('reads the producer conclusion without reconstructing a second equipment rule', () => {
    const comparison = comparisonFixture({ assessment: { verdict: 'review', reason: 'complex_item' } })
    expect(assessEquipment(comparison)).toEqual({ verdict: 'review', reason: 'complex_item' })
    comparison.candidate.itemLevel = 1000
    expect(assessEquipment(comparison)).toEqual({ verdict: 'review', reason: 'complex_item' })
  })

  it('retains v1 archives as manual-review facts without promoting them to a live offer', () => {
    const { assessment: _assessment, deltas: _deltas, ...facts } = comparisonFixture()
    const record = { ...facts, v: 1 }
    const archived = parse(equipmentComparisonSchema, record)
    expect(archived).toEqual(record)
    expect(assessEquipment(archived)).toEqual({ verdict: 'review', reason: 'incomplete' })
    expect(safeParse(liveEquipmentComparisonSchema, record).success).toBe(false)
  })

  it('rejects missing or inconsistent producer conclusions and forged stat differences', () => {
    const record = comparisonFixture()
    for (const patch of [
      { assessment: undefined },
      { assessment: { verdict: 'upgrade', reason: 'complex_item' } },
      { assessment: { verdict: 'upgrade', reason: 'invented' } },
      { deltas: [{ key: 'ITEM_MOD_INTELLECT_SHORT', before: 10, after: 100 }] },
      { deltas: [{ key: 'UNKNOWN', before: 0, after: 0 }] },
      { deltas: [record.deltas[0], record.deltas[0]] },
    ]) {
      expect(safeParse(liveEquipmentComparisonSchema, { ...record, ...patch }).success).toBe(false)
    }
    expect(parse(liveEquipmentComparisonSchema, record)).toEqual(record)
  })

  it('keeps item and identity validation separate from the producer conclusion', () => {
    for (const patch of [{ slot: 0 }, { current: null }, { guid: 'bad\nidentity' }, { spec: true }, { primary: 3 }])
      expect(safeParse(liveEquipmentComparisonSchema, { ...comparisonFixture(), ...patch }).success).toBe(false)
    const record = comparisonFixture()
    record.candidate.stats.push(record.candidate.stats[0])
    expect(safeParse(liveEquipmentComparisonSchema, record).success).toBe(false)
  })
})

describe.skipIf(!env.WOW_COMPANION_BRIDGE_DIR)('actual Lua comparison conclusions', () => {
  it.each(['WoWMapCompanion', 'WoWForeverCompanion'])('preserves all %s producer decisions across the desktop boundary', (addon) => {
    const path = join(env.WOW_COMPANION_BRIDGE_DIR!, '..', addon, 'tests/fixtures/lua-comparison-cases.json')
    const cases = JSON.parse(readFileSync(path, 'utf8')) as { name: string, comparison: unknown, assessment: unknown }[]
    for (const value of cases) {
      const comparison = parse(liveEquipmentComparisonSchema, value.comparison)
      expect(assessEquipment(comparison), value.name).toEqual(value.assessment)
    }
  })
})
