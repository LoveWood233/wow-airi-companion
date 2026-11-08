import type { SQLOutputValue } from 'node:sqlite'

import type { InferOutput } from 'valibot'

import type { BridgeStatus, GameVersion } from '../../../shared/wow-companion'
import type { ItemStorage, ItemStoragePage, ItemStorageQuery, ItemStorageQueryResult, ItemStorageSummary, StoredItem } from '../../../shared/wow-companion-item-storage'

import { Buffer } from 'node:buffer'
import { mkdir } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { errorMessageFrom } from '@moeru/std'
import { array, boolean, check, integer, literal, maxLength, maxValue, minValue, nullable, number, parse, picklist, pipe, strictObject, string } from 'valibot'

import { gameVersionSchema, snapshotSchema } from '../../../shared/wow-companion'
import { moneyIdSchema } from '../../../shared/wow-companion-gold'
import { itemStoragePageSchema, itemStorageQuerySchema, itemStorageSchema, storedItemCategory, storedItemSchema } from '../../../shared/wow-companion-item-storage'

const applicationId = 0x57435049
const maximumBackupBytes = 64 * 1024 * 1024
const whole = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER))
const label = pipe(string(), maxLength(256))
const archiveContainerSchema = strictObject({ game: gameVersionSchema, account: moneyIdSchema, name: label, realm: label, receivedAt: whole, record: itemStorageSchema })
const archiveSlotSchema = strictObject({
  game: gameVersionSchema,
  account: moneyIdSchema,
  guid: pipe(string(), maxLength(48)),
  scope: picklist(['bags', 'bank', 'account-bank']),
  container: pipe(number(), integer(), minValue(-10), maxValue(1000)),
  slot: pipe(number(), integer(), minValue(1), maxValue(200)),
  state: picklist(['occupied', 'empty', 'unknown']),
  quantity: pipe(whole, maxValue(1000000)),
  item: nullable(storedItemSchema),
  observedAt: whole,
  receivedAt: whole,
  cached: boolean(),
  uncertain: boolean(),
})
type ArchiveContainer = InferOutput<typeof archiveContainerSchema>
type ArchiveSlot = InferOutput<typeof archiveSlotSchema>
type SqlRow = Record<string, SQLOutputValue>

function owner(record: Pick<ItemStorage, 'scope' | 'guid'>) {
  return record.scope === 'account-bank' ? '' : record.guid
}
function key(game: GameVersion, account: string, guid: string, scope: ItemStorage['scope'], container: number) {
  return JSON.stringify([game, account, guid, scope, container])
}
function containerKey(entry: ArchiveContainer) {
  return key(entry.game, entry.account, owner(entry.record), entry.record.scope, entry.record.container)
}
function slotKey(entry: ArchiveSlot) {
  return `${key(entry.game, entry.account, entry.guid, entry.scope, entry.container)}:${entry.slot}`
}

const archiveSchema = pipe(strictObject({
  format: literal('wow-companion-items'),
  version: literal(1),
  containers: pipe(array(archiveContainerSchema), maxLength(40000)),
  slots: pipe(array(archiveSlotSchema), maxLength(2000000)),
}), check((archive) => {
  const containers = new Map(archive.containers.map(entry => [containerKey(entry), entry]))
  const rows = new Map<string, Map<number, ArchiveSlot>>()
  for (const slot of archive.slots) {
    const identity = key(slot.game, slot.account, slot.guid, slot.scope, slot.container)
    let slots = rows.get(identity)
    if (!slots) {
      slots = new Map()
      rows.set(identity, slots)
    }
    slots.set(slot.slot, slot)
  }
  return containers.size === archive.containers.length && new Set(archive.slots.map(slotKey)).size === archive.slots.length
    && archive.slots.every((slot) => {
      const container = containers.get(key(slot.game, slot.account, slot.guid, slot.scope, slot.container))
      return !!container && (slot.scope === 'account-bank' ? slot.guid === '' : slot.guid === container.record.guid)
        && (!container.record.complete || slot.slot <= container.record.capacity)
        && (slot.state === 'occupied' ? !!slot.item && slot.quantity > 0 : slot.item === null && slot.quantity === 0)
    }) && archive.containers.every((container) => {
    const slots = rows.get(containerKey(container))
    if (container.record.complete && (slots?.size ?? 0) !== container.record.capacity)
      return false
    return container.record.slots.every((observed) => {
      const saved = slots?.get(observed.slot)
      if (!saved)
        return false
      if (!container.record.complete && observed.state !== 'occupied')
        return saved.uncertain
      return saved.state === observed.state && saved.quantity === observed.quantity && !saved.uncertain
        && saved.observedAt === container.record.observedAt * 1000 && saved.cached === container.record.cached
        && JSON.stringify(saved.item) === JSON.stringify(observed.item ? normalizeItem(observed.item) : null)
    })
  })
}, 'Invalid item archive identities'))

function normalizeItem(item: NonNullable<ItemStorage['slots'][number]['item']>): StoredItem {
  return 'classID' in item ? item : { ...item, classID: null, subclassID: null }
}

function sqlText(row: SqlRow, field: string) {
  return parse(string(), row[field])
}
function sqlNumber(row: SqlRow, field: string) {
  return parse(number(), row[field])
}
function errorText(error: unknown) {
  return errorMessageFrom(error) ?? 'Item database operation failed'
}

/**
 * One main-process owner commits each validated container and its bridge cursor in a SQLite transaction.
 * Unknown or partial empties retain previous observations. Only a complete enumeration deletes confirmed items.
 */
export class CompanionItemStorage {
  static validateBackup(value: unknown) { return parse(archiveSchema, value) }

  private database: DatabaseSync | undefined
  private loading: Promise<void> | undefined
  private queue = Promise.resolve()
  private storageError: string | null = null
  private readonly transferErrors = new Map<GameVersion, string | null>()

  constructor(private readonly filePath: string) {}

  load() {
    this.loading ??= this.open()
    return this.loading
  }

  after(game: GameVersion, instanceId: string) {
    const row = this.database?.prepare('SELECT instance_id, cursor FROM bridge_cursors WHERE game=?').get(game)
    return row && sqlText(row, 'instance_id') === instanceId ? sqlNumber(row, 'cursor') : 0
  }

  reportTransferError(game: GameVersion, error: string | null) { this.transferErrors.set(game, error) }

  read(game: GameVersion): ItemStorageSummary {
    const result: ItemStorageSummary = { characters: [], sharedBankItems: 0, sharedBankObservedAt: null, storageError: this.storageError, transferError: this.transferErrors.get(game) ?? null, fileName: basename(this.filePath) }
    if (!this.database)
      return result
    try {
      const rows = this.database.prepare(`SELECT c.account, c.owner_guid, c.scope, c.name, c.realm,
        MIN(c.observed_at) AS observed_at, MIN(c.complete) AS complete,
        COUNT(s.item_json) AS items, COALESCE(MAX(s.uncertain),0) AS uncertain,
        COALESCE(MIN(s.details_complete),1) AS details_complete,
        COALESCE(SUM(s.category='equipment' AND s.item_json IS NOT NULL),0) AS equipment,
        COALESCE(SUM(s.category IN ('profession','profession-product') AND s.item_json IS NOT NULL),0) AS profession
        FROM containers c LEFT JOIN slots s USING(game,account,owner_guid,scope,container)
        WHERE c.game=? GROUP BY c.account,c.owner_guid,c.scope,c.name,c.realm`).all(game)
      const characters = new Map<string, ItemStorageSummary['characters'][number]>()
      for (const row of rows) {
        const scope = sqlText(row, 'scope')
        const observedAt = sqlNumber(row, 'observed_at') * 1000
        const items = sqlNumber(row, 'items')
        if (scope === 'account-bank') {
          result.sharedBankItems += items
          result.sharedBankObservedAt = Math.min(result.sharedBankObservedAt ?? Infinity, observedAt)
          continue
        }
        const account = sqlText(row, 'account')
        const guid = sqlText(row, 'owner_guid')
        const id = JSON.stringify([account, guid])
        let character = characters.get(id)
        if (!character) {
          character = { account, guid, name: sqlText(row, 'name'), realm: sqlText(row, 'realm'), bags: 0, bank: 0, bankObservedAt: null, incomplete: false, equipmentItems: 0, professionItems: 0 }
          characters.set(id, character)
        }
        if (scope === 'bags') {
          character.bags += items
        }
        else {
          character.bank += items
          character.bankObservedAt = Math.min(character.bankObservedAt ?? Infinity, observedAt)
        }
        character.equipmentItems += sqlNumber(row, 'equipment')
        character.professionItems += sqlNumber(row, 'profession')
        character.incomplete ||= !sqlNumber(row, 'complete') || !!sqlNumber(row, 'uncertain') || !sqlNumber(row, 'details_complete')
      }
      result.characters = [...characters.values()]
    }
    catch (error) {
      this.storageError = result.storageError = errorText(error)
    }
    return result
  }

  query(input: ItemStorageQuery): ItemStorageQueryResult {
    const request = parse(itemStorageQuerySchema, input)
    const result: ItemStorageQueryResult = { rows: [], total: 0, offset: request.offset, limit: request.limit, storageError: this.storageError }
    if (!this.database)
      return result
    const conditions = ['s.game=?', 's.item_json IS NOT NULL']
    const parameters: (string | number)[] = [request.game]
    if (request.account) {
      conditions.push('s.account=?')
      parameters.push(request.account)
    }
    if (request.guid) {
      conditions.push('(s.owner_guid=? OR s.scope=\'account-bank\')')
      parameters.push(request.guid)
    }
    if (request.scope) {
      conditions.push('s.scope=?')
      parameters.push(request.scope)
    }
    if (request.category === 'profession') {
      conditions.push('(s.category=\'profession\' OR s.category=\'profession-product\')')
    }
    else if (request.category !== 'all') {
      conditions.push('s.category=?')
      parameters.push(request.category)
    }
    if (request.search.trim()) {
      conditions.push('(s.item_name LIKE ? ESCAPE \'\\\' OR s.item_link LIKE ? ESCAPE \'\\\' OR CAST(s.item_id AS TEXT) LIKE ? ESCAPE \'\\\')')
      const search = `%${request.search.trim().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
      parameters.push(search, search, search)
    }
    const where = conditions.join(' AND ')
    try {
      result.total = sqlNumber(this.database.prepare(`SELECT COUNT(*) AS total FROM slots s WHERE ${where}`).get(...parameters)!, 'total')
      const rows = this.database.prepare(`SELECT s.*,c.name,c.realm,c.complete AS container_complete,c.cached AS container_cached
        FROM slots s JOIN containers c USING(game,account,owner_guid,scope,container) WHERE ${where}
        ORDER BY s.account,s.owner_guid,s.scope,s.container,s.slot LIMIT ? OFFSET ?`).all(...parameters, request.limit, request.offset)
      result.rows = rows.map((row) => {
        const itemValue: unknown = JSON.parse(sqlText(row, 'item_json'))
        const scope = parse(picklist(['bags', 'bank', 'account-bank']), row.scope)
        return {
          game: request.game,
          account: sqlText(row, 'account'),
          guid: sqlText(row, 'owner_guid'),
          name: scope === 'account-bank' ? '' : sqlText(row, 'name'),
          realm: scope === 'account-bank' ? '' : sqlText(row, 'realm'),
          scope,
          container: sqlNumber(row, 'container'),
          slot: sqlNumber(row, 'slot'),
          quantity: sqlNumber(row, 'quantity'),
          item: parse(storedItemSchema, itemValue),
          category: parse(picklist(['equipment', 'profession', 'profession-product', 'other', 'unknown']), row.category),
          craftingOrigin: 'unknown',
          observedAt: sqlNumber(row, 'observed_at') * 1000,
          receivedAt: sqlNumber(row, 'received_at'),
          cached: !!sqlNumber(row, 'cached') || !!sqlNumber(row, 'container_cached'),
          uncertain: !!sqlNumber(row, 'uncertain'),
          complete: !!sqlNumber(row, 'container_complete') && !!sqlNumber(row, 'details_complete') && !sqlNumber(row, 'uncertain'),
        }
      })
    }
    catch (error) {
      this.storageError = result.storageError = errorText(error)
    }
    return result
  }

  observe(game: GameVersion, bridge: BridgeStatus, input: ItemStoragePage) {
    return this.enqueue(async () => {
      await this.load()
      const page = parse(itemStoragePageSchema, input)
      const snapshot = bridge.snapshot && parse(snapshotSchema, bridge.snapshot)
      const now = Date.now()
      if (!this.database || bridge.source !== 'screen' || bridge.status !== 'live' || bridge.error || !snapshot?.online
        || (bridge.game !== undefined && bridge.game !== game) || bridge.config.paused
        || bridge.ageSeconds === null || bridge.ageSeconds < 0 || bridge.ageSeconds > 5
        || !Number.isFinite(Date.parse(bridge.lastSeen ?? '')) || Math.abs(now - Date.parse(bridge.lastSeen!)) > 5000
        || page.instanceId !== bridge.instanceId || page.cursor <= this.after(game, page.instanceId)) {
        return
      }
      if (page.record && (page.record.guid !== snapshot.guid || page.record.session !== snapshot.session || page.record.observedAt * 1000 > now + 120000))
        return
      try {
        this.transaction(() => {
          if (page.record) {
            const entry = parse(archiveContainerSchema, { game, account: snapshot.account, name: snapshot.name, realm: snapshot.realm, receivedAt: now, record: page.record })
            const prior = this.database!.prepare('SELECT observed_at, capture_session, capture_id, cached FROM containers WHERE game=? AND account=? AND owner_guid=? AND scope=? AND container=?')
              .get(game, entry.account, owner(entry.record), entry.record.scope, entry.record.container)
            const newer = !prior || (entry.record.observedAt >= sqlNumber(prior, 'observed_at')
              && (entry.record.observedAt !== sqlNumber(prior, 'observed_at') || !entry.record.cached)
              && (entry.record.session !== sqlText(prior, 'capture_session') || entry.record.id > sqlNumber(prior, 'capture_id')))
            if (newer)
              this.storeContainer(entry, true)
          }
          this.database!.prepare('INSERT INTO bridge_cursors(game,instance_id,cursor) VALUES(?,?,?) ON CONFLICT(game) DO UPDATE SET instance_id=excluded.instance_id,cursor=excluded.cursor').run(game, page.instanceId, page.cursor)
        })
        this.storageError = null
        this.reportTransferError(game, bridge.itemStorageError ?? null)
      }
      catch (error) {
        this.storageError = errorText(error)
        throw error
      }
    })
  }

  /** Exports a validated logical snapshot. SQLite bytes are never decoded as UTF-8 for the backup archive. */
  serializeBackup() {
    return this.enqueue(async () => {
      await this.load()
      const db = this.requireDatabase()
      const snapshot = this.transaction(() => {
        const containers = db.prepare('SELECT * FROM containers ORDER BY game,account,owner_guid,scope,container').all().map((row) => {
          const record: unknown = JSON.parse(sqlText(row, 'record_json'))
          return parse(archiveContainerSchema, { game: row.game, account: row.account, name: row.name, realm: row.realm, receivedAt: row.received_at, record })
        })
        const slots = db.prepare('SELECT * FROM slots ORDER BY game,account,owner_guid,scope,container,slot').all().map(row => this.archiveSlot(row))
        return parse(archiveSchema, { format: 'wow-companion-items', version: 1, containers, slots })
      })
      const content = JSON.stringify(snapshot)
      if (Buffer.byteLength(content) > maximumBackupBytes)
        throw new Error('item-storage-backup-too-large')
      return content
    })
  }

  /** Replaces both game profiles atomically and resets live bridge cursors so restored history cannot suppress fresh observations. */
  restoreBackup(data: string | null) {
    if (data !== null && Buffer.byteLength(data) > maximumBackupBytes)
      return Promise.reject(new Error('item-storage-backup-too-large'))
    const snapshot = data === null ? null : CompanionItemStorage.validateBackup(JSON.parse(data))
    return this.enqueue(async () => {
      await this.load()
      this.requireDatabase()
      this.transaction(() => {
        this.database!.exec('DELETE FROM slots; DELETE FROM containers; DELETE FROM bridge_cursors;')
        if (snapshot) {
          for (const container of snapshot.containers)
            this.storeContainer(container, false)
          for (const slot of snapshot.slots)
            this.storeSlot(slot)
        }
      })
      this.storageError = null
      this.transferErrors.clear()
    })
  }

  clear() { return this.restoreBackup(null) }

  flush() {
    return this.enqueue(async () => {
      await this.load()
      this.database?.exec('PRAGMA wal_checkpoint(PASSIVE)')
    })
  }

  close() {
    return this.enqueue(async () => {
      this.database?.close()
      this.database = undefined
    })
  }

  private requireDatabase() {
    if (!this.database)
      throw new Error(this.storageError ?? 'Item database is unavailable')
    return this.database
  }

  private async open() {
    let database: DatabaseSync | undefined
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      database = new DatabaseSync(this.filePath)
      const version = sqlNumber(database.prepare('PRAGMA user_version').get()!, 'user_version')
      const identifier = sqlNumber(database.prepare('PRAGMA application_id').get()!, 'application_id')
      const tables = sqlNumber(database.prepare('SELECT COUNT(*) AS count FROM sqlite_schema WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\'').get()!, 'count')
      if ((identifier !== applicationId || version !== 1) && (identifier !== 0 || version !== 0 || tables !== 0))
        throw new Error('Unsupported item database schema')
      if (version === 1) {
        database.prepare('SELECT game,account,owner_guid,scope,container,observer_guid,name,realm,observed_at,received_at,capture_session,capture_id,complete,cached,capacity,record_json FROM containers LIMIT 0')
        database.prepare('SELECT game,account,owner_guid,scope,container,slot,state,quantity,item_json,item_id,item_name,item_link,category,details_complete,observed_at,received_at,cached,uncertain FROM slots LIMIT 0')
        database.prepare('SELECT game,instance_id,cursor FROM bridge_cursors LIMIT 0')
      }
      database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1500; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      if (!version) {
        database.exec(`BEGIN IMMEDIATE;
          CREATE TABLE containers(game TEXT NOT NULL,account TEXT NOT NULL,owner_guid TEXT NOT NULL,scope TEXT NOT NULL,container INTEGER NOT NULL,
            observer_guid TEXT NOT NULL,name TEXT NOT NULL,realm TEXT NOT NULL,observed_at INTEGER NOT NULL,received_at INTEGER NOT NULL,
            capture_session TEXT NOT NULL,capture_id INTEGER NOT NULL,complete INTEGER NOT NULL,cached INTEGER NOT NULL,capacity INTEGER NOT NULL,record_json TEXT NOT NULL,
            PRIMARY KEY(game,account,owner_guid,scope,container));
          CREATE TABLE slots(game TEXT NOT NULL,account TEXT NOT NULL,owner_guid TEXT NOT NULL,scope TEXT NOT NULL,container INTEGER NOT NULL,slot INTEGER NOT NULL,
            state TEXT NOT NULL,quantity INTEGER NOT NULL,item_json TEXT,item_id INTEGER,item_name TEXT,item_link TEXT,category TEXT NOT NULL,
            details_complete INTEGER NOT NULL,observed_at INTEGER NOT NULL,received_at INTEGER NOT NULL,cached INTEGER NOT NULL,uncertain INTEGER NOT NULL,
            PRIMARY KEY(game,account,owner_guid,scope,container,slot),
            FOREIGN KEY(game,account,owner_guid,scope,container) REFERENCES containers(game,account,owner_guid,scope,container) ON DELETE CASCADE);
          CREATE INDEX slots_category ON slots(game,account,category);
          CREATE TABLE bridge_cursors(game TEXT PRIMARY KEY,instance_id TEXT NOT NULL,cursor INTEGER NOT NULL);
          PRAGMA application_id=${applicationId}; PRAGMA user_version=1; COMMIT;`)
      }
      this.database = database
    }
    catch (error) {
      database?.close()
      this.storageError = errorText(error)
    }
  }

  private storeContainer(entry: ArchiveContainer, applySlots: boolean) {
    const db = this.requireDatabase()
    const record = entry.record
    const guid = owner(record)
    db.prepare(`INSERT INTO containers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(game,account,owner_guid,scope,container) DO UPDATE SET observer_guid=excluded.observer_guid,name=excluded.name,realm=excluded.realm,
      observed_at=excluded.observed_at,received_at=excluded.received_at,capture_session=excluded.capture_session,capture_id=excluded.capture_id,
      complete=excluded.complete,cached=excluded.cached,capacity=excluded.capacity,record_json=excluded.record_json`).run(
      entry.game,
      entry.account,
      guid,
      record.scope,
      record.container,
      record.guid,
      entry.name,
      entry.realm,
      record.observedAt,
      entry.receivedAt,
      record.session,
      record.id,
      Number(record.complete),
      Number(record.cached),
      record.capacity,
      JSON.stringify(record),
    )
    if (!applySlots)
      return
    const identity = [entry.game, entry.account, guid, record.scope, record.container]
    if (record.complete)
      db.prepare('DELETE FROM slots WHERE game=? AND account=? AND owner_guid=? AND scope=? AND container=? AND slot>?').run(...identity, record.capacity)
    else db.prepare('UPDATE slots SET uncertain=1 WHERE game=? AND account=? AND owner_guid=? AND scope=? AND container=?').run(...identity)
    for (const slot of record.slots) {
      if (!record.complete && slot.state !== 'occupied') {
        db.prepare('INSERT OR IGNORE INTO slots VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...identity, slot.slot, 'unknown', 0, null, null, null, null, 'unknown', 0, record.observedAt, entry.receivedAt, Number(record.cached), 1)
        continue
      }
      this.storeSlot({ game: entry.game, account: entry.account, guid, scope: record.scope, container: record.container, slot: slot.slot, state: slot.state, quantity: slot.quantity, item: slot.item ? normalizeItem(slot.item) : null, observedAt: record.observedAt * 1000, receivedAt: entry.receivedAt, cached: record.cached, uncertain: slot.state === 'unknown' })
    }
  }

  private storeSlot(slot: ArchiveSlot) {
    const item = slot.item
    this.requireDatabase().prepare(`INSERT INTO slots VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(game,account,owner_guid,scope,container,slot) DO UPDATE SET state=excluded.state,quantity=excluded.quantity,item_json=excluded.item_json,
      item_id=excluded.item_id,item_name=excluded.item_name,item_link=excluded.item_link,category=excluded.category,details_complete=excluded.details_complete,
      observed_at=excluded.observed_at,received_at=excluded.received_at,cached=excluded.cached,uncertain=excluded.uncertain`).run(
      slot.game,
      slot.account,
      slot.guid,
      slot.scope,
      slot.container,
      slot.slot,
      slot.state,
      slot.quantity,
      item ? JSON.stringify(item) : null,
      item?.itemID ?? null,
      item?.name ?? null,
      item?.link ?? null,
      item ? storedItemCategory(item) : 'unknown',
      Number(!item || (item.infoComplete && item.statsComplete && item.tooltipComplete && !item.truncated)),
      slot.observedAt / 1000,
      slot.receivedAt,
      Number(slot.cached),
      Number(slot.uncertain),
    )
  }

  private archiveSlot(row: SqlRow): ArchiveSlot {
    const item: unknown = row.item_json === null ? null : JSON.parse(sqlText(row, 'item_json'))
    return parse(archiveSlotSchema, { game: row.game, account: row.account, guid: row.owner_guid, scope: row.scope, container: row.container, slot: row.slot, state: row.state, quantity: row.quantity, item, observedAt: sqlNumber(row, 'observed_at') * 1000, receivedAt: row.received_at, cached: !!row.cached, uncertain: !!row.uncertain })
  }

  private transaction<T>(operation: () => T): T {
    const db = this.requireDatabase()
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      db.exec('COMMIT')
      return result
    }
    catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => {}, () => {})
    return result
  }
}
