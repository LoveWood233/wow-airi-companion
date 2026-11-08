import type { LiveEquipmentComparison } from './wow-companion-equipment-comparisons'

/**
 * Creates a fully observed, simple cloth upgrade for transport, persistence, and prompt tests.
 * @example
 * comparisonFixture({ specMatch: false })
 * // => a comparison that cannot request equipment changes
 */
export function comparisonFixture(changes: Partial<LiveEquipmentComparison> = {}): LiveEquipmentComparison {
  const current = {
    itemID: 99,
    name: 'Old robe',
    itemLevel: 100,
    equipLoc: 'INVTYPE_ROBE',
    type: 'Armor',
    subtype: 'Cloth',
    stats: [{ key: 'ITEM_MOD_INTELLECT_SHORT', value: 10 }, { key: 'ITEM_MOD_STAMINA_SHORT', value: 20 }],
    complex: false,
    complete: true,
  }
  return {
    v: 2,
    assessment: { verdict: 'upgrade', reason: 'stats_upgrade' },
    deltas: [{ key: 'ITEM_MOD_INTELLECT_SHORT', before: 10, after: 12 }, { key: 'ITEM_MOD_STAMINA_SHORT', before: 20, after: 24 }],
    id: 1,
    session: 'login',
    guid: 'Player-1',
    class: 'MAGE',
    spec: 64,
    primary: 4,
    observedAt: 1792800000,
    slot: 5,
    usable: true,
    specMatch: true,
    current,
    candidate: { ...current, itemID: 100, name: 'New robe', itemLevel: 120, stats: [{ key: 'ITEM_MOD_INTELLECT_SHORT', value: 12 }, { key: 'ITEM_MOD_STAMINA_SHORT', value: 24 }] },
    ...changes,
  }
}
