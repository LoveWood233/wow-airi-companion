import type { InferInput, InferOutput } from 'valibot'

import type { GameVersion } from './wow-companion'

import { array, boolean, check, finite, integer, literal, maxLength, maxValue, minLength, minValue, nullable, number, optional, picklist, pipe, regex, strictObject, string, variant } from 'valibot'

import { gameVersionSchema } from './wow-companion'
import { moneyIdSchema } from './wow-companion-gold'

const encoder = new TextEncoder()
const integerIn = (min: number, max: number) => pipe(number(), integer(), minValue(min), maxValue(max))
const identity = (max: number) => pipe(string(), minLength(1), maxLength(max), regex(/^[\w-]+$/))
const scopeSchema = picklist(['bags', 'bank', 'account-bank'])

function text(bytes: number, empty = false) {
  return pipe(string(), minLength(empty ? 0 : 1), check(value => encoder.encode(value).length <= bytes && [...value].every((character) => {
    const point = character.codePointAt(0)!
    return point >= 32 && (point < 127 || point > 159) && (point < 0xD800 || point > 0xDFFF)
  }), 'Invalid stored item text'))
}

const itemFields = {
  itemID: integerIn(1, 2147483647),
  itemGUID: nullable(text(128)),
  link: text(1024),
  name: nullable(text(128)),
  type: nullable(text(128)),
  subtype: nullable(text(128)),
  equipLoc: nullable(text(128, true)),
  quality: nullable(integerIn(0, 8)),
  itemLevel: nullable(pipe(number(), finite(), minValue(0), maxValue(100000))),
  requiredLevel: nullable(integerIn(0, 255)),
  stats: pipe(array(strictObject({ key: text(64), value: pipe(number(), finite(), minValue(-1e12), maxValue(1e12)) })), maxLength(32)),
  tooltip: pipe(array(text(256)), maxLength(48)),
  infoComplete: boolean(),
  statsComplete: boolean(),
  tooltipComplete: boolean(),
  truncated: boolean(),
}

const itemV1 = strictObject(itemFields)
const itemV2 = strictObject({ ...itemFields, classID: nullable(integerIn(0, 255)), subclassID: nullable(integerIn(0, 255)) })
type ItemShape = InferOutput<typeof itemV1>

function validItem(item: ItemShape) {
  return Number(/item:(\d+)/.exec(item.link)?.[1]) === item.itemID
    && new Set(item.stats.map(stat => stat.key)).size === item.stats.length
    && (!item.infoComplete || [item.name, item.type, item.subtype, item.equipLoc, item.quality, item.itemLevel, item.requiredLevel].every(value => value !== null))
    && (!item.tooltipComplete || item.tooltip.length > 0)
    && (!item.truncated || !item.infoComplete || !item.statsComplete || !item.tooltipComplete)
    && encoder.encode(JSON.stringify(item)).length <= 8192
}

/** Storage accepts non-equippable items without relaxing the worn-equipment protocol. V1 lacks stable class evidence. */
export const storedItemSchema = pipe(itemV2, check(item => validItem(item), 'Invalid stored item'))
export type StoredItem = InferOutput<typeof storedItemSchema>
const storedItemV1Schema = pipe(itemV1, check(item => validItem(item), 'Invalid stored item'))

const base = {
  id: integerIn(1, 2147483647),
  session: identity(40),
  guid: identity(48),
  observedAt: integerIn(1, 4102444800),
  scope: scopeSchema,
  container: integerIn(-10, 1000),
  capacity: integerIn(0, 200),
  complete: boolean(),
  cached: boolean(),
}

function slots<T extends typeof storedItemV1Schema | typeof storedItemSchema>(item: T) {
  return pipe(array(pipe(strictObject({
    slot: integerIn(1, 200),
    state: picklist(['occupied', 'empty', 'unknown']),
    quantity: integerIn(0, 1000000),
    item: nullable(item),
  }), check(slot => slot.state === 'occupied' ? slot.item !== null && slot.quantity > 0 : slot.item === null && slot.quantity === 0))), maxLength(200))
}

/** A full page proves empty slots. Partial pages preserve previous confirmations and mark their uncertainty. */
export const itemStorageSchema = pipe(variant('v', [
  strictObject({ ...base, v: literal(1), slots: slots(storedItemV1Schema) }),
  strictObject({ ...base, v: literal(2), slots: slots(storedItemSchema) }),
]), check(record => record.slots.length === record.capacity
  && record.slots.every((slot, index) => slot.slot === index + 1 && (!record.complete || slot.state !== 'unknown'))
  && encoder.encode(JSON.stringify(record)).length <= 2097152, 'Invalid item storage page'))
export type ItemStorage = InferOutput<typeof itemStorageSchema>

/** Publication cursors belong to one bridge instance, with at most one reassembled container per HTTP response. */
export const itemStoragePageSchema = strictObject({
  instanceId: pipe(string(), minLength(1), maxLength(256)),
  cursor: integerIn(0, 2147483647),
  record: nullable(itemStorageSchema),
  hasMore: boolean(),
})
export type ItemStoragePage = InferOutput<typeof itemStoragePageSchema>

/** Read-only queries cannot select a database path, SQL statement, or another game implicitly. */
export const itemStorageQuerySchema = strictObject({
  game: gameVersionSchema,
  account: optional(moneyIdSchema),
  guid: optional(identity(48)),
  scope: optional(scopeSchema),
  category: optional(picklist(['all', 'equipment', 'profession', 'profession-product']), 'all'),
  search: optional(pipe(string(), maxLength(128)), ''),
  offset: optional(integerIn(0, 100000), 0),
  limit: optional(integerIn(1, 100), 50),
})
export type ItemStorageQuery = InferInput<typeof itemStorageQuerySchema>

/** Cached records remain dated observations. The account bank has no character owner. All output times use milliseconds. */
export interface ItemStorageRow {
  game: GameVersion
  account: string
  guid: string
  name: string
  realm: string
  scope: ItemStorage['scope']
  container: number
  slot: number
  quantity: number
  item: StoredItem
  category: 'equipment' | 'profession' | 'profession-product' | 'other' | 'unknown'
  /** An observed class never proves that this particular item was crafted. */
  craftingOrigin: 'unknown'
  observedAt: number
  receivedAt: number
  cached: boolean
  uncertain: boolean
  complete: boolean
}

export interface ItemStorageQueryResult {
  rows: ItemStorageRow[]
  total: number
  offset: number
  limit: number
  storageError: string | null
}

/** Counts include retained uncertain items, which the management UI identifies explicitly. */
export interface ItemStorageSummary {
  characters: Array<{ account: string, guid: string, name: string, realm: string, bags: number, bank: number, bankObservedAt: number | null, incomplete: boolean, equipmentItems: number, professionItems: number }>
  sharedBankItems: number
  sharedBankObservedAt: number | null
  storageError: string | null
  transferError: string | null
  fileName: string
}

/** Class IDs are observed game evidence. V1 and missing classes remain unknown rather than inferring from localized names. */
export function storedItemCategory(item: StoredItem): ItemStorageRow['category'] {
  if (item.classID === null)
    return 'unknown'
  if ([3, 5, 7, 9, 19].includes(item.classID))
    return 'profession'
  if ([0, 1, 8].includes(item.classID))
    return 'profession-product'
  if (item.classID === 2 || item.classID === 4)
    return item.equipLoc ? 'equipment' : 'unknown'
  return 'other'
}
