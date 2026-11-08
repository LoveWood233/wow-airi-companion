import type { BridgeStatus, GameVersion } from '../../../shared/wow-companion'
import type { ItemStorage, ItemStoragePage, StoredItem } from '../../../shared/wow-companion-item-storage'

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { parse } from 'valibot'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { itemStorageSchema, storedItemCategory } from '../../../shared/wow-companion-item-storage'
import { equipmentLoadoutSchema } from '../../../shared/wow-companion-loadout'
import { loadoutBridgeFixture, loadoutFixture } from '../../../shared/wow-companion-loadout.test-helper'
import { CompanionItemStorage } from './wow-companion-item-storage'

function equipment(): StoredItem {
  return { ...loadoutFixture().slots[0]!.item!, classID: 4, subclassID: 4 }
}

function material(): StoredItem {
  return { ...equipment(), itemID: 124, itemGUID: null, link: '|Hitem:124|h[矿石_%]|h', name: '矿石_%', type: 'Trade Goods', subtype: 'Metal', equipLoc: '', classID: 7, subclassID: 7, stats: [], tooltip: ['制作材料'] }
}

function container(overrides: Partial<ItemStorage> = {}): ItemStorage {
  return parse(itemStorageSchema, {
    v: 2,
    id: 1,
    session: 'login',
    guid: 'Player-1',
    observedAt: Math.floor(Date.now() / 1000),
    scope: 'bags',
    container: 0,
    capacity: 2,
    complete: true,
    cached: false,
    slots: [{ slot: 1, state: 'occupied', quantity: 1, item: equipment() }, { slot: 2, state: 'occupied', quantity: 25, item: material() }],
    ...overrides,
  })
}

function bridge(record: ItemStorage, account = 'account'): BridgeStatus {
  const result = loadoutBridgeFixture()
  result.snapshot = { ...result.snapshot!, account, guid: record.guid, session: record.session }
  return result
}

function page(record: ItemStorage | null, cursor = record?.id ?? 1, instanceId = 'loadout-bridge'): ItemStoragePage {
  return { instanceId, cursor, record, hasMore: false }
}

describe('sQLite companion item storage', () => {
  let directory: string
  let file: string
  let repository: CompanionItemStorage
  const owners: CompanionItemStorage[] = []

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'wow-items-sqlite-'))
    file = join(directory, 'wow-companion-items.sqlite')
    repository = new CompanionItemStorage(file)
    owners.push(repository)
    await repository.load()
  })

  afterEach(async () => {
    for (const owner of owners.splice(0))
      await owner.close()
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()))
    expect(directory.includes('wow-items-sqlite-')).toBe(true)
    await rm(directory, { recursive: true, force: true })
  })

  async function ingest(record: ItemStorage, cursor = record.id, account = 'account', game: GameVersion = 'retail') {
    await repository.observe(game, bridge(record, account), page(record, cursor))
  }

  it('writes genuine SQLite and retains item instances, profession stacks, attributes and tooltips across restarts', async () => {
    await ingest(container())
    await repository.flush()
    expect((await readFile(file)).subarray(0, 16).toString()).toBe('SQLite format 3\0')
    const reopened = new CompanionItemStorage(file)
    owners.push(reopened)
    await reopened.load()
    const result = reopened.query({ game: 'retail' })
    expect(result.storageError).toBeNull()
    expect(result.total).toBe(2)
    expect(result.rows[0]?.item.itemGUID).toBe('Item-123')
    expect(result.rows[0]?.item.stats).toEqual([{ key: 'ITEM_MOD_STRENGTH_SHORT', value: 37 }])
    expect(result.rows[0]?.item.tooltip).toContain('Set (2): A described bonus')
    expect(result.rows[1]?.quantity).toBe(25)
    expect(result.rows[1]?.item.equipLoc).toBe('')
    expect(reopened.query({ game: 'retail', category: 'profession' }).rows[0]?.item.name).toBe('矿石_%')
    expect(reopened.read('retail').characters[0]).toMatchObject({ bags: 2, equipmentItems: 1, professionItems: 1, incomplete: false })
    expect(reopened.after('retail', 'loadout-bridge')).toBe(1)
  })

  it('isolates game, account and character while sharing account-bank containers only within their account', async () => {
    await ingest(container())
    await ingest(container({ id: 2, guid: 'Player-2' }), 2)
    await ingest(container({ id: 3, guid: 'Player-2', scope: 'account-bank', container: 13 }), 3)
    await ingest(container({ id: 4, guid: 'Player-3', scope: 'account-bank', container: 13 }), 4)
    await ingest(container({ id: 5 }), 5, 'another-account')
    await ingest(container({ id: 1 }), 1, 'account', 'forever')
    expect(repository.query({ game: 'retail', account: 'account', guid: 'Player-1' }).total).toBe(4)
    expect(repository.query({ game: 'retail', account: 'another-account', guid: 'Player-1' }).total).toBe(2)
    expect(repository.query({ game: 'forever' }).total).toBe(2)
    const shared = repository.query({ game: 'retail', account: 'account', scope: 'account-bank' })
    expect(shared.total).toBe(2)
    expect(shared.rows.every(row => row.guid === '' && row.name === '')).toBe(true)
    expect(repository.read('retail').sharedBankItems).toBe(2)
  })

  it('preserves old items as uncertain when a partial page reports unknown or empty slots', async () => {
    await ingest(container({ scope: 'bank', container: -1 }))
    const partial = container({ id: 2, scope: 'bank', container: -1, complete: false, slots: [
      { slot: 1, state: 'unknown', quantity: 0, item: null },
      { slot: 2, state: 'empty', quantity: 0, item: null },
    ] })
    await ingest(partial)
    const rows = repository.query({ game: 'retail', scope: 'bank' }).rows
    expect(rows.length).toBe(2)
    expect(rows.every(row => row.uncertain && !row.complete)).toBe(true)
    expect(rows[1]?.quantity).toBe(25)
    expect(repository.read('retail').characters[0]?.incomplete).toBe(true)
    const complete = container({ id: 3, scope: 'bank', container: -1, slots: [
      { slot: 1, state: 'empty', quantity: 0, item: null },
      { slot: 2, state: 'occupied', quantity: 7, item: material() },
    ] })
    await ingest(complete)
    expect(repository.query({ game: 'retail', scope: 'bank' }).total).toBe(1)
    expect(repository.query({ game: 'retail', scope: 'bank' }).rows[0]).toMatchObject({ quantity: 7, uncertain: false, complete: true })
  })

  it('does not prune slots beyond an incomplete smaller capacity but applies a later complete resize', async () => {
    await ingest(container())
    await ingest(container({ id: 2, capacity: 0, slots: [], complete: false }))
    expect(repository.query({ game: 'retail' }).total).toBe(2)
    expect(repository.query({ game: 'retail' }).rows.every(row => row.uncertain)).toBe(true)
    await ingest(container({ id: 3, capacity: 0, slots: [], complete: true }))
    expect(repository.query({ game: 'retail' }).total).toBe(0)
  })

  it('keeps a live bank observation when a cached or older snapshot is replayed after reconnect', async () => {
    const initial = container({ scope: 'bank', container: -1 })
    await ingest(initial)
    const cached = container({ id: 99, scope: 'bank', container: -1, session: 'reload', cached: true, observedAt: initial.observedAt, slots: [{ slot: 1, state: 'empty', quantity: 0, item: null }, { slot: 2, state: 'empty', quantity: 0, item: null }] })
    await ingest(cached, 2)
    await ingest({ ...cached, id: 100, cached: false, observedAt: initial.observedAt - 10 }, 3)
    expect(repository.query({ game: 'retail', scope: 'bank' }).total).toBe(2)
    expect(repository.query({ game: 'retail', scope: 'bank' }).rows.every(row => !row.cached)).toBe(true)
    expect(repository.read('retail').characters[0]?.bankObservedAt).toBe(initial.observedAt * 1000)
    expect(repository.after('retail', 'loadout-bridge')).toBe(3)
    expect(repository.after('retail', 'new-bridge')).toBe(0)
  })

  it.each(['demo', 'stale', 'paused', 'wrong-character', 'wrong-session', 'wrong-instance', 'wrong-game', 'future'] as const)('rejects %s observations without advancing the cursor', async (kind) => {
    const record = container()
    const source = bridge(record)
    const input = page(record)
    if (kind === 'demo')
      source.source = 'demo'
    if (kind === 'stale')
      source.lastSeen = new Date(Date.now() - 6000).toISOString()
    if (kind === 'paused')
      source.config.paused = true
    if (kind === 'wrong-character')
      source.snapshot!.guid = 'Player-Other'
    if (kind === 'wrong-session')
      source.snapshot!.session = 'another-login'
    if (kind === 'wrong-instance')
      input.instanceId = 'another-bridge'
    if (kind === 'wrong-game')
      source.game = 'forever'
    if (kind === 'future')
      input.record!.observedAt += 121
    await repository.observe('retail', source, input)
    expect(repository.query({ game: 'retail' }).total).toBe(0)
    expect(repository.after('retail', source.instanceId)).toBe(0)
  })

  it('commits inventory and cursor together and retries the same page after a real SQLite write failure', async () => {
    const fault = new DatabaseSync(file)
    try {
      fault.exec('CREATE TRIGGER fail_inventory BEFORE INSERT ON slots BEGIN SELECT RAISE(ABORT,\'controlled write failure\'); END')
      const record = container()
      await expect(ingest(record)).rejects.toThrow('controlled write failure')
      expect(repository.after('retail', 'loadout-bridge')).toBe(0)
      expect(repository.query({ game: 'retail' }).total).toBe(0)
      expect(repository.read('retail').characters.length).toBe(0)
      fault.exec('DROP TRIGGER fail_inventory')
      await ingest(record)
      expect(repository.after('retail', 'loadout-bridge')).toBe(1)
      expect(repository.query({ game: 'retail' }).total).toBe(2)
      expect(repository.read('retail').storageError).toBeNull()
    }
    finally { fault.close() }
  })

  it('binds search parameters and treats LIKE wildcards literally', async () => {
    await ingest(container())
    expect(repository.query({ game: 'retail', search: '%' }).total).toBe(1)
    expect(repository.query({ game: 'retail', search: '_' }).total).toBe(1)
    expect(repository.query({ game: 'retail', search: '\' OR 1=1 --' }).total).toBe(0)
    expect(repository.query({ game: 'retail', search: '矿石' }).rows[0]?.quantity).toBe(25)
    expect(repository.query({ game: 'retail', limit: 1, offset: 1 }).rows[0]?.item.itemID).toBe(124)
  })

  it.each([0, 1, 8])('includes class %i as a profession-product candidate without claiming a crafting origin', async (classID) => {
    const product = { ...material(), classID, name: 'A useful item', type: 'Public class', subtype: 'Public subclass' }
    await ingest(container({ capacity: 1, slots: [{ slot: 1, state: 'occupied', quantity: 4, item: product }] }))
    const candidates = repository.query({ game: 'retail', category: 'profession-product' })
    expect(candidates.total).toBe(1)
    expect(candidates.rows[0]).toMatchObject({ category: 'profession-product', craftingOrigin: 'unknown', quantity: 4 })
    expect(repository.query({ game: 'retail', category: 'profession' }).total).toBe(1)
    expect(repository.query({ game: 'retail', category: 'equipment' }).total).toBe(0)
    expect(repository.read('retail').characters[0]?.professionItems).toBe(1)
  })

  it('exports and atomically restores a logical backup including retained unknown items', async () => {
    await ingest(container())
    await ingest(container({ id: 2, complete: false, slots: [
      { slot: 1, state: 'unknown', quantity: 0, item: null },
      { slot: 2, state: 'occupied', quantity: 10, item: material() },
    ] }))
    const backup = await repository.serializeBackup()
    expect(CompanionItemStorage.validateBackup(JSON.parse(backup)).slots.length).toBe(2)
    await repository.clear()
    expect(repository.query({ game: 'retail' }).total).toBe(0)
    await repository.restoreBackup(backup)
    expect(repository.query({ game: 'retail' }).rows[0]?.uncertain).toBe(true)
    expect(repository.query({ game: 'retail' }).rows[1]?.quantity).toBe(10)
    expect(repository.after('retail', 'loadout-bridge')).toBe(0)
    expect(await repository.serializeBackup()).toBe(backup)
  })

  it('rejects invalid backups before touching existing data', async () => {
    await ingest(container())
    const backup = CompanionItemStorage.validateBackup(JSON.parse(await repository.serializeBackup()))
    backup.slots.pop()
    expect(() => repository.restoreBackup(JSON.stringify(backup))).toThrow('Invalid item archive identities')
    expect(repository.query({ game: 'retail' }).total).toBe(2)
    await expect(repository.restoreBackup('x'.repeat(64 * 1024 * 1024 + 1))).rejects.toThrow('too-large')
    expect(repository.query({ game: 'retail' }).total).toBe(2)
  })

  it('supports v1 without inventing class IDs and keeps the equipment schema strict', async () => {
    const item = equipment()
    const { classID: _class, subclassID: _subclass, ...v1Item } = item
    const record = container({ v: 1, capacity: 1, slots: [{ slot: 1, state: 'occupied', quantity: 1, item: v1Item }] })
    await ingest(record)
    expect(repository.query({ game: 'retail' }).rows[0]?.category).toBe('unknown')
    expect(repository.query({ game: 'retail' }).rows[0]?.item.classID).toBeNull()
    expect(storedItemCategory({ ...material(), classID: 19 })).toBe('profession')
    expect(storedItemCategory({ ...material(), classID: 4 })).toBe('unknown')
    const equipped = loadoutFixture()
    equipped.slots[0]!.item!.equipLoc = ''
    expect(() => parse(equipmentLoadoutSchema, equipped)).toThrow()
  })

  it('validates the recorded schema before changing a database with a matching version but missing columns', async () => {
    const malformed = join(directory, 'malformed.sqlite')
    const connection = new DatabaseSync(malformed)
    connection.exec('PRAGMA application_id=0x57435049; PRAGMA user_version=1; CREATE TABLE containers(wrong_column TEXT)')
    connection.close()
    const original = await readFile(malformed)
    const bad = new CompanionItemStorage(malformed)
    owners.push(bad)
    await bad.load()
    expect(bad.read('retail').storageError).toContain('no such column: game')
    expect(await readFile(malformed)).toEqual(original)
  })

  it('preserves corrupted or unsupported database files instead of replacing them', async () => {
    await repository.close()
    const broken = join(directory, 'broken.sqlite')
    await writeFile(broken, 'not a sqlite database')
    const bad = new CompanionItemStorage(broken)
    owners.push(bad)
    await bad.load()
    expect(bad.read('retail').storageError).not.toBeNull()
    expect(await readFile(broken, 'utf8')).toBe('not a sqlite database')
    const future = join(directory, 'future.sqlite')
    const connection = new DatabaseSync(future)
    connection.exec('PRAGMA user_version=99; CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES(\'keep\')')
    connection.close()
    const before = await readFile(future)
    const unsupported = new CompanionItemStorage(future)
    owners.push(unsupported)
    await unsupported.load()
    expect(unsupported.read('retail').storageError).toContain('Unsupported')
    expect(await readFile(future)).toEqual(before)
  })
})
