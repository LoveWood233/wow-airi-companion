import type { BridgeStatus } from '../../../shared/wow-companion'

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { comparisonFixture } from '../../../shared/wow-companion-comparison.test-helper'
import { CompanionEquipmentComparisons } from './wow-companion-equipment-comparisons'

function observation(): BridgeStatus {
  return {
    instanceId: 'bridge',
    status: 'live',
    source: 'screen',
    lastSeen: new Date().toISOString(),
    ageSeconds: 0,
    eventCursor: 0,
    events: [],
    error: null,
    equipmentComparisons: [comparisonFixture()],
    equipmentComparisonError: null,
    equipmentLoadout: null,
    equipmentLoadoutError: null,
    config: { x: 8, y: 8, cellSize: 1, pollMs: 500, paused: false },
    snapshot: { v: 3, session: 'login', seq: 1, tick: 1, guid: 'Player-1', name: 'Mage', realm: 'Realm', level: 80, class: 'MAGE', faction: 'Alliance', race: 'Human', spec: 64, map: 84, zone: 'City', combat: false, dead: false, online: true, account: 'account', moneyEpoch: 'epoch', copper: 1, earned: 0, spent: 0 },
  }
}

describe('persistent equipment comparisons', () => {
  let directory: string
  let file: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'airi-comparisons-'))
    file = join(directory, 'history.json')
  })
  afterEach(async () => {
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir(), 'airi-comparisons-')))
      throw new Error('Refusing to remove a directory outside the comparison test prefix')
    await rm(target, { recursive: true, force: true })
  })

  it('persists across restart and keeps the first observation immutable across repeated identities', async () => {
    const history = new CompanionEquipmentComparisons(file)
    const bridge = observation()
    await history.observe(bridge)
    await history.observe(bridge)
    const restarted = new CompanionEquipmentComparisons(file)
    await restarted.load()
    expect(restarted.read().entries).toHaveLength(1)
    bridge.equipmentComparisons[0].candidate.complete = false
    await restarted.observe(bridge)
    expect(restarted.read().entries[0].comparison.candidate.complete).toBe(true)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved.entries[0].comparison.candidate.complete).toBe(true)
  })

  it('retains ten entries and rejects replay of discarded acquisitions', async () => {
    const history = new CompanionEquipmentComparisons(file)
    const bridge = observation()
    for (let id = 1; id <= 12; id++) {
      bridge.equipmentComparisons = [comparisonFixture({ id })]
      await history.observe(bridge)
    }
    expect(history.read().entries.map(entry => entry.comparison.id)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    bridge.equipmentComparisons = [comparisonFixture({ id: 1 })]
    await history.observe(bridge)
    expect(history.read().entries[0].comparison.id).toBe(3)
    const result = history.read()
    result.entries[0].comparison.candidate.name = 'Mutated'
    expect(history.read().entries[0].comparison.candidate.name).toBe('New robe')
  })

  it('ignores demo, stale, offline, mismatched and failed observations', async () => {
    const history = new CompanionEquipmentComparisons(file)
    for (const status of ['stale', 'demo', 'paused'] as const) {
      const bridge = observation()
      bridge.status = status
      await history.observe(bridge)
    }
    const bridge = observation()
    bridge.snapshot!.online = false
    await history.observe(bridge)
    bridge.snapshot!.online = true
    bridge.equipmentComparisons[0].session = 'other'
    await history.observe(bridge)
    bridge.equipmentComparisons[0].session = 'login'
    await history.observe(bridge, 'unavailable')
    expect(history.read().entries).toEqual([])
  })

  it('keeps identical acquisition IDs separate by account and character', async () => {
    const history = new CompanionEquipmentComparisons(file)
    const bridge = observation()
    await history.observe(bridge)
    bridge.snapshot!.account = 'other-account'
    await history.observe(bridge)
    expect(history.read().entries).toHaveLength(2)
  })

  it('preserves corrupt files and blocks writes', async () => {
    await writeFile(file, '{corrupt')
    const history = new CompanionEquipmentComparisons(file)
    await history.observe(observation())
    await history.flush()
    expect(history.read().storageError).toContain('comparisons-read')
    expect(await readFile(file, 'utf8')).toBe('{corrupt')
  })

  it('keeps failed writes visible and retries them after the game disconnects', async () => {
    const obstacle = join(directory, 'blocked')
    const target = join(obstacle, 'history.json')
    const history = new CompanionEquipmentComparisons(target)
    await history.load()
    await writeFile(obstacle, 'occupied')
    await history.observe(observation())
    expect(history.read().storageError).toContain('comparisons-write')
    expect(history.read().entries).toHaveLength(1)
    await rm(obstacle)
    await history.observe(null)
    expect(history.read().storageError).toBeNull()
    expect(JSON.parse(await readFile(target, 'utf8')).entries).toHaveLength(1)
  })
})
