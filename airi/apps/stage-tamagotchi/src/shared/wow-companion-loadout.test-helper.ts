import type { BridgeStatus, CompanionState } from './wow-companion'
import type { EquipmentLoadout } from './wow-companion-loadout'

import { defaultSettings } from './wow-companion'

/**
 * Synthetic equipped items share the real wire contract across Node and browser tests.
 * @example
 * loadoutFixture({ id: 2 }).slots[0].item?.name
 * // => 'Test helm'
 */
export function loadoutFixture(overrides: Partial<EquipmentLoadout> = {}): EquipmentLoadout {
  return {
    v: 1,
    id: 1,
    session: 'login',
    guid: 'Player-1',
    observedAt: 1792900000,
    reason: 'login',
    slots: Array.from({ length: 19 }, (_, index) => ({
      slot: index + 1,
      state: index === 0 ? 'equipped' : index === 1 ? 'unknown' : 'empty',
      item: index === 0
        ? {
            itemID: 123,
            itemGUID: 'Item-123',
            link: '|Hitem:123|h[Test helm]|h',
            name: 'Test helm',
            type: 'Armor',
            subtype: 'Plate',
            equipLoc: 'INVTYPE_HEAD',
            quality: 3,
            itemLevel: 158,
            requiredLevel: 80,
            stats: [{ key: 'ITEM_MOD_STRENGTH_SHORT', value: 37 }],
            tooltip: ['Equip: A public effect', 'Set (2): A described bonus'],
            infoComplete: true,
            statsComplete: true,
            tooltipComplete: true,
            truncated: false,
          }
        : null,
    })),
    ...overrides,
  }
}

/** A synthetic live screen observation with matching character and equipment identities. */
export function loadoutBridgeFixture(loadout: EquipmentLoadout = loadoutFixture()): BridgeStatus {
  return {
    instanceId: 'loadout-bridge',
    status: 'live',
    source: 'screen',
    lastSeen: new Date().toISOString(),
    ageSeconds: 0,
    eventCursor: 0,
    events: [],
    equipmentComparisons: [],
    equipmentComparisonError: null,
    equipmentLoadout: loadout,
    equipmentLoadoutError: null,
    config: { x: 8, y: 8, cellSize: 2, pollMs: 100, paused: false },
    error: null,
    snapshot: { v: 3, session: loadout.session, seq: 1, tick: 1, guid: loadout.guid, name: 'Warrior', realm: 'Realm', level: 80, class: 'WARRIOR', faction: 'Horde', race: 'Orc', spec: 71, map: 84, zone: 'City', combat: false, dead: false, online: true, account: 'account', moneyEpoch: 'epoch', copper: 1, earned: 0, spent: 0 },
  }
}

/** Synthetic profile state includes all required persistence projections without Electron. */
export function loadoutStateFixture(): CompanionState {
  return {
    game: 'retail',
    settings: { ...defaultSettings },
    bridge: loadoutBridgeFixture(),
    error: null,
    updatedAt: Date.now(),
    gold: { accounts: [], storageError: null },
    equipmentHistory: { entries: [], storageError: null },
    levelHistory: { characters: [], storageError: null },
    equipmentComparisons: { entries: [], storageError: null },
    equipmentLoadouts: { entries: [], latestCharacter: null, storageError: null },
  }
}
