import type { InferOutput } from 'valibot'

import { array, boolean, check, integer, literal, maxLength, maxValue, minValue, number, pipe, regex, strictObject, string } from 'valibot'

const identifier = pipe(number(), integer(), minValue(1), maxValue(2147483647))
const encoder = new TextEncoder()
const identity = (maximum: number) => pipe(string(), regex(/^[\w-]+$/), maxLength(maximum))

/** One aggregated carried-inventory capture. Partial captures never establish zero for absent item IDs. */
export const inventorySnapshotSchema = pipe(strictObject({
  v: literal(1),
  id: identifier,
  session: identity(40),
  guid: identity(48),
  observedAt: pipe(number(), integer(), minValue(1), maxValue(4102444800)),
  source: literal('bags'),
  bank: literal('unknown'),
  complete: boolean(),
  items: pipe(array(strictObject({ itemID: identifier, quantity: identifier })), maxLength(1000)),
}), check(value => value.items.every((item, index) => index === 0 || value.items[index - 1]!.itemID < item.itemID)
  && encoder.encode(JSON.stringify(value)).length <= 65536, 'Invalid inventory ordering or size'))

export type InventorySnapshot = InferOutput<typeof inventorySnapshotSchema>
