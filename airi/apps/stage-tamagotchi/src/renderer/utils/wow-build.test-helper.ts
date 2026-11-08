import type { CompanionState, GameVersion } from '../../shared/wow-companion'

import { loadoutStateFixture } from '../../shared/wow-companion-loadout.test-helper'

/** A synthetic stable committed allocation and a matching earlier equipment capture. */
export function buildStateFixture(game: GameVersion = 'forever'): CompanionState {
  const state = loadoutStateFixture()
  state.game = game
  state.settings.enabled = true
  state.bridge!.snapshot!.level = 15
  state.bridge!.equipmentLoadout!.observedAt = Math.floor(Date.now() / 1000) - 3600
  const weapon = state.bridge!.equipmentLoadout!.slots[15]
  weapon.state = 'equipped'
  weapon.item = {
    itemID: 100,
    itemGUID: 'Item-actual-100',
    link: '|Hitem:100::::::::15:::::2:1234:5678::|h[Observed weapon]|h',
    name: 'Observed weapon',
    type: 'Weapon',
    subtype: 'Sword',
    equipLoc: 'INVTYPE_WEAPONMAINHAND',
    quality: 2,
    itemLevel: 12,
    requiredLevel: 10,
    stats: [{ key: 'ITEM_MOD_STAMINA_SHORT', value: 2 }, { key: 'ITEM_MOD_SPIRIT_SHORT', value: 1 }],
    tooltip: ['Observed instance effect', 'Set (2): A description does not establish an active bonus'],
    infoComplete: true,
    statsComplete: true,
    tooltipComplete: true,
    truncated: false,
  }
  state.bridge!.talentsReceivedAt = new Date().toISOString()
  state.bridge!.talentsError = null
  state.bridge!.talents = {
    v: 1,
    id: 1,
    guid: 'Player-1',
    session: 'login',
    observedAt: Math.floor(Date.now() / 1000),
    source: 'class-traits',
    clientBuild: game === 'forever' ? '1.60.1.70707' : '12.1.5.70575',
    locale: 'zhCN',
    class: 'WARRIOR',
    classID: 1,
    specID: 71,
    configID: 1,
    configName: 'Observed committed build',
    configType: 1,
    status: 'active',
    hasStagedChanges: false,
    scope: 'selected-nodes',
    complete: true,
    truncated: false,
    treeIDs: [161],
    knownZeroNodes: [{ treeID: 161, nodeID: 105957 }],
    nodes: [{ treeID: 161, nodeID: 105958, ranksPurchased: 1, activeRank: 1, maxRanks: 3, isAvailable: true, isVisible: true, meetsEdgeRequirements: true, entriesComplete: true, entries: [{ entryID: 10, definitionID: 20, spellID: 12282, rank: 1, isActive: true }], conditionsComplete: true, conditions: [{ conditionID: 30, isMet: false, playerLevel: 20, spentAmountRequired: 5, traitCurrencyID: 40 }] }],
  }
  return state
}
