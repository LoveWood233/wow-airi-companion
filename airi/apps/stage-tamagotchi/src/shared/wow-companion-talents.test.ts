import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'

import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { bridgeSchema } from './wow-companion'
import { talentSnapshotSchema } from './wow-companion-talents'

function snapshot() {
  return { v: 1, id: 1, session: 'session-1', guid: 'Player-1', observedAt: 1700000000, source: 'class-traits', clientBuild: '1.60.1.70707', locale: 'zhCN', class: 'WARRIOR', classID: 1, specID: 71, configID: 7, configName: 'Committed', configType: 1, status: 'active', hasStagedChanges: false, scope: 'selected-nodes', complete: true, truncated: false, treeIDs: [777], knownZeroNodes: [{ treeID: 777, nodeID: 9002 }], nodes: [{ treeID: 777, nodeID: 9001, ranksPurchased: 1, activeRank: 1, maxRanks: 2, isAvailable: true, isVisible: true, meetsEdgeRequirements: true, entriesComplete: true, conditionsComplete: true, entries: [{ entryID: 101, definitionID: 501, spellID: 1001, rank: 1, isActive: true }], conditions: [{ conditionID: 601, isMet: true, playerLevel: 10, spentAmountRequired: 1, traitCurrencyID: 4 }] }] }
}

describe('committed talent observation contract', () => {
  it.skipIf(!env.WOW_COMPANION_BRIDGE_DIR).each(['retail', 'forever'] as const)('accepts %s actual Lua CRC to Python bridge output', async (game) => {
    const addon = game === 'retail' ? 'WoWMapCompanion' : 'WoWForeverCompanion'
    const folder = join(env.WOW_COMPANION_BRIDGE_DIR!, '..', addon, 'tests', 'fixtures')
    const value: unknown = JSON.parse(await readFile(join(folder, `lua-${game}-talents.json`), 'utf8'))
    const bridge: unknown = JSON.parse(await readFile(join(folder, `lua-${game}-talents-bridge.json`), 'utf8'))
    expect(safeParse(talentSnapshotSchema, value).success).toBe(true)
    expect(parse(bridgeSchema, bridge).talents).toEqual(value)
  })

  it('keeps node, entry, definition and spell identifiers separate and preserves zero evidence', () => {
    const value = parse(talentSnapshotSchema, snapshot())
    expect(value.nodes[0].nodeID).toBe(9001)
    expect(value.nodes[0].entries[0].entryID).toBe(101)
    expect(value.nodes[0].entries[0].definitionID).toBe(501)
    expect(value.nodes[0].entries[0].spellID).toBe(1001)
    expect(value.knownZeroNodes).toEqual([{ treeID: 777, nodeID: 9002 }])
    expect(safeParse(talentSnapshotSchema, { ...snapshot(), complete: false, truncated: true, knownZeroNodes: [] }).success).toBe(true)
  })

  it('staged or unavailable snapshots cannot carry effective ranks or zero-rank claims', () => {
    const staged = { ...snapshot(), status: 'staged', hasStagedChanges: true, complete: false, nodes: [], knownZeroNodes: [] }
    expect(safeParse(talentSnapshotSchema, staged).success).toBe(true)
    expect(safeParse(talentSnapshotSchema, { ...staged, nodes: snapshot().nodes }).success).toBe(false)
    expect(safeParse(talentSnapshotSchema, { ...staged, knownZeroNodes: snapshot().knownZeroNodes }).success).toBe(false)
    expect(safeParse(talentSnapshotSchema, { ...staged, status: 'unknown', hasStagedChanges: null, configID: null, classID: null, specID: null, clientBuild: null }).success).toBe(true)
  })

  it.each([
    { observedAt: 0 },
    { classID: 0 },
    { clientBuild: '70707' },
    { source: 'talent-preview' },
    { status: 'active', hasStagedChanges: true },
    { status: 'staged', hasStagedChanges: false },
    { configID: null },
    { configType: 2 },
    { complete: true, truncated: true },
    { treeIDs: [] },
    { knownZeroNodes: [{ treeID: 777, nodeID: 9001 }] },
    { knownZeroNodes: [{ treeID: 777, nodeID: 9002 }, { treeID: 777, nodeID: 9002 }] },
    { knownZeroNodes: [{ treeID: 888, nodeID: 9002 }] },
    { nodes: [{ ...snapshot().nodes[0], activeRank: 0, ranksPurchased: 0 }] },
    { nodes: [{ ...snapshot().nodes[0], entries: [{ ...snapshot().nodes[0].entries[0], rank: true }] }] },
  ])('rejects unsupported commit evidence or ambiguous identifiers %j', (change) => {
    expect(safeParse(talentSnapshotSchema, { ...snapshot(), ...change }).success).toBe(false)
  })
})
