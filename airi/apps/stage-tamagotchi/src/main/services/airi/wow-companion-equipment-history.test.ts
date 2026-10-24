import type { BridgeStatus, Snapshot } from '../../../shared/wow-companion'
import type { EquipmentRecord } from '../../../shared/wow-companion-equipment'

import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CompanionEquipmentHistory } from './wow-companion-equipment-history'

function equipment(id: number, overrides: Partial<EquipmentRecord> = {}): EquipmentRecord {
  return {
    v: 1,
    id,
    session: 'session-1',
    guid: 'Player-1',
    itemID: 1000 + id,
    itemGUID: `Item-${id}`,
    link: `item:${1000 + id}`,
    name: `Equipment ${id}`,
    type: 'Armor',
    subtype: 'Cloth',
    equipLoc: 'INVTYPE_HEAD',
    quality: 4,
    itemLevel: 100,
    requiredLevel: 10,
    stats: [{ key: 'ITEM_MOD_INTELLECT_SHORT', value: 20 }],
    tooltip: ['Equip: A useful effect.'],
    quantity: 1,
    observedAt: 1792800000 + id,
    source: 'bag_added',
    infoComplete: true,
    statsComplete: true,
    tooltipComplete: true,
    truncated: false,
    ...overrides,
  }
}

function live(records: EquipmentRecord[], snapshot: Partial<Snapshot> = {}, bridge: Partial<BridgeStatus> = {}): BridgeStatus {
  return {
    instanceId: 'bridge-1',
    status: 'live',
    source: 'screen',
    snapshot: {
      v: 2,
      session: 'session-1',
      seq: 1,
      tick: 100,
      guid: 'Player-1',
      name: 'Mage',
      realm: 'Silvermoon',
      level: 80,
      class: 'MAGE',
      spec: 1,
      map: 1,
      zone: 'Town',
      combat: false,
      dead: false,
      online: true,
      account: 'account-1',
      moneyEpoch: 'epoch-1',
      copper: 100000,
      earned: 0,
      spent: 0,
      ...snapshot,
    },
    lastSeen: new Date().toISOString(),
    ageSeconds: 0,
    eventCursor: 0,
    events: [],
    equipment: records,
    config: { x: 0, y: 0, cellSize: 1, pollMs: 750, paused: false },
    error: null,
    ...bridge,
  }
}

describe('companion equipment history', () => {
  let directory: string
  let path: string
  let history: CompanionEquipmentHistory

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'airi-wow-equipment-history-'))
    path = join(directory, 'equipment.json')
    history = new CompanionEquipmentHistory(path)
    await history.load()
  })

  afterEach(async () => {
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir(), 'airi-wow-equipment-history-')))
      throw new Error('Refusing to remove a directory outside the equipment history test prefix')
    await rm(target, { recursive: true, force: true })
  })

  it('retains records 2 through 11 after eleven acquisitions and discards the oldest full record on disk', async () => {
    const firstTen = Array.from({ length: 10 }, (_, index) => equipment(index + 1))
    await history.observe(live(firstTen))
    await history.observe(live([equipment(11)]))
    const saved = JSON.parse(await readFile(path, 'utf8'))
    expect(history.read().entries.map(entry => entry.record.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(saved.entries.map((entry: { record: EquipmentRecord }) => entry.record.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(saved.seen).toHaveLength(11)
    expect(Object.keys(saved)).toEqual(['version', 'entries', 'seen'])
    expect(await readdir(directory)).toEqual(['equipment.json'])
  })

  it('does not let a repeated old batch displace new entries, including after restart', async () => {
    const firstTen = Array.from({ length: 10 }, (_, index) => equipment(index + 1))
    await history.observe(live(firstTen))
    await history.observe(live([equipment(11)]))
    const before = history.read()
    await history.observe(live(firstTen))
    expect(history.read()).toEqual(before)
    const restarted = new CompanionEquipmentHistory(path)
    await restarted.load()
    await restarted.observe(live(firstTen, {}, { instanceId: 'restarted-bridge' }))
    expect(restarted.read()).toEqual(before)
  })

  it('keeps first-receipt order when complete records arrive out of ID order and preserves receipt times on replay', async () => {
    await history.observe(live([equipment(2), equipment(1)]))
    const first = history.read()
    expect(first.entries.map(entry => entry.record.id)).toEqual([2, 1])
    expect(first.entries[0].receivedAt).toBeGreaterThan(0)
    await history.observe(live([equipment(1), equipment(2)]))
    expect(history.read()).toEqual(first)
  })

  it('keeps character identity across offline periods and counts one capacity across accounts and characters', async () => {
    await history.observe(live(Array.from({ length: 8 }, (_, index) => equipment(index + 1))))
    await history.observe(live([equipment(1, { guid: 'Player-2' })], { guid: 'Player-2', name: 'Warrior' }))
    await history.observe(live([equipment(1)], { account: 'account-2', name: 'Other Mage', realm: 'Other Realm' }))
    await history.observe(live([equipment(1, { session: 'session-2' })], { session: 'session-2' }))
    await history.observe(null, 'Disconnected')
    const entries = history.read().entries
    expect(entries).toHaveLength(10)
    expect(entries[0].record.id).toBe(2)
    expect(entries[7]).toMatchObject({ name: 'Warrior', record: { guid: 'Player-2' } })
    expect(entries[8]).toMatchObject({ account: 'account-2', name: 'Other Mage', realm: 'Other Realm' })
    expect(entries[9].record.session).toBe('session-2')
    const restarted = new CompanionEquipmentHistory(path)
    await restarted.load()
    expect(restarted.read().entries).toEqual(entries)
  })

  it('keeps independent files for different games even with identical equipment identities', async () => {
    const forever = new CompanionEquipmentHistory(join(directory, 'forever.json'))
    await history.observe(live([equipment(1)]))
    await forever.observe(live([equipment(1, { name: 'Forever equipment' })]))
    expect(history.read().entries[0].record.name).toBe('Equipment 1')
    expect(forever.read().entries[0].record.name).toBe('Forever equipment')
  })

  it.each(['demo', 'stale', 'waiting', 'paused'] as const)('does not save %s observations', async (status) => {
    await history.observe(live([equipment(1)], {}, { status }))
    expect(history.read().entries).toEqual([])
  })

  it('ignores demo sources, connection errors, offline characters, and mismatched sessions or characters', async () => {
    await history.observe(live([equipment(1)], {}, { source: 'demo' }))
    await history.observe(live([equipment(1)], {}, { error: 'Bad capture' }))
    await history.observe(live([equipment(1)]), 'Disconnected')
    await history.observe(live([equipment(1)], { online: false }))
    await history.observe(live([equipment(1)], { session: 'session-other' }))
    await history.observe(live([equipment(1)], { guid: 'Player-other' }))
    await history.observe(live([equipment(1)], {}, { snapshot: null }))
    await history.observe(live([], {}, { equipment: undefined }))
    expect(history.read().entries).toEqual([])
  })

  it('rejects invalid equipment records without losing valid records in the same batch', async () => {
    await history.observe(live([equipment(1, { id: 0 }), equipment(2, { name: 'Bad\nname' }), equipment(3)]))
    expect(history.read().entries.map(entry => entry.record.id)).toEqual([3])
  })

  it('retains the first valid version of a repeated identity without replacing its details', async () => {
    await history.observe(live([equipment(1)]))
    await history.observe(live([equipment(1, { itemID: 9999, name: 'Conflicting replay' })]))
    expect(history.read().entries[0].record.itemID).toBe(1001)
    expect(history.read().entries[0].record.name).toBe('Equipment 1')
  })

  it('bounds deduplication metadata at 512 hashes without retaining discarded equipment details', async () => {
    for (let id = 1; id <= 513; id += 10)
      await history.observe(live(Array.from({ length: Math.min(10, 514 - id) }, (_, offset) => equipment(id + offset))))
    const saved = JSON.parse(await readFile(path, 'utf8'))
    expect(saved.entries).toHaveLength(10)
    expect(saved.entries[0].record.id).toBe(504)
    expect(saved.entries[9].record.id).toBe(513)
    expect(saved.seen).toHaveLength(512)
    expect(saved.seen.every((value: string) => /^[a-f0-9]{64}$/.test(value))).toBe(true)
    const restarted = new CompanionEquipmentHistory(path)
    await restarted.load()
    await restarted.observe(live([equipment(2)]))
    expect(restarted.read().entries.map(entry => entry.record.id)).toEqual(history.read().entries.map(entry => entry.record.id))
  })

  it.each([
    '{broken history',
    JSON.stringify({ version: 1, entries: [], seen: ['not-an-identity'] }),
    JSON.stringify({ version: 99, entries: [], seen: [] }),
  ])('preserves corrupt files and reports a separate storage error', async (original) => {
    await writeFile(path, original, 'utf8')
    const broken = new CompanionEquipmentHistory(path)
    await broken.load()
    await broken.observe(live([equipment(1)]))
    await broken.flush()
    expect(broken.read().entries).toEqual([])
    expect(broken.read().storageError).toContain('Cannot load WoW equipment history')
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('preserves a structurally valid file with missing record deduplication metadata', async () => {
    await history.observe(live([equipment(1)]))
    const saved = JSON.parse(await readFile(path, 'utf8'))
    saved.seen = []
    const original = JSON.stringify(saved)
    await writeFile(path, original, 'utf8')
    const broken = new CompanionEquipmentHistory(path)
    await broken.load()
    await broken.flush()
    expect(broken.read().storageError).toContain('Cannot load WoW equipment history')
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('does not throw on read errors or replace an inaccessible source', async () => {
    await mkdir(path)
    const blocked = new CompanionEquipmentHistory(path)
    await expect(blocked.load()).resolves.toBeUndefined()
    await blocked.observe(live([equipment(1)]))
    await blocked.flush()
    expect(blocked.read().storageError).toContain('Cannot load WoW equipment history')
    expect(await readdir(path)).toEqual([])
  })

  it('rejects saved receipt times outside the supported date range', async () => {
    await history.observe(live([equipment(1)]))
    const saved = JSON.parse(await readFile(path, 'utf8'))
    saved.entries[0].receivedAt = Number.MAX_SAFE_INTEGER
    const original = JSON.stringify(saved)
    await writeFile(path, original, 'utf8')
    const broken = new CompanionEquipmentHistory(path)
    await broken.load()
    await broken.observe(live([equipment(2)]))
    expect(broken.read().storageError).toContain('Cannot load WoW equipment history')
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('retains memory on write errors and retries while disconnected', async () => {
    await mkdir(path)
    await history.observe(live([equipment(1)]))
    expect(history.read().entries[0].record.id).toBe(1)
    expect(history.read().storageError).toContain('Cannot save WoW equipment history')
    expect(await readdir(directory)).toEqual(['equipment.json'])
    await rename(path, join(directory, 'blocked-destination'))
    await history.observe(null, 'Disconnected')
    expect(history.read().storageError).toBeNull()
    const restarted = new CompanionEquipmentHistory(path)
    await restarted.load()
    expect(restarted.read().entries[0].record.id).toBe(1)
  })

  it('serializes concurrent observations and flushes before returning', async () => {
    await Promise.all([
      history.observe(live([equipment(1)])),
      history.observe(live([equipment(2)])),
      history.observe(live([equipment(1), equipment(3)])),
      history.flush(),
    ])
    const restarted = new CompanionEquipmentHistory(path)
    await restarted.load()
    expect(restarted.read().entries.map(entry => entry.record.id)).toEqual([1, 2, 3])
  })

  it('does not let a caller mutate saved entries through a returned snapshot', async () => {
    await history.observe(live([equipment(1)]))
    const first = history.read()
    first.entries[0].record.tooltip.push('Caller change')
    first.entries.length = 0
    expect(history.read().entries[0].record.tooltip).toEqual(['Equip: A useful effect.'])
  })
})
