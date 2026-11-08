import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'

import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { inventorySnapshotSchema } from './wow-companion-inventory'

function snapshot() {
  return { v: 1, id: 1, session: 'session-1', guid: 'Player-1', observedAt: 1793490000, source: 'bags', bank: 'unknown', complete: true, items: [{ itemID: 12359, quantity: 7 }] }
}

describe('carried inventory contract', () => {
  it.skipIf(!env.WOW_COMPANION_BRIDGE_DIR).each(['retail', 'forever'] as const)('accepts the %s fixture captured by the actual Lua collector', async (game) => {
    const addon = game === 'retail' ? 'WoWMapCompanion' : 'WoWForeverCompanion'
    const value: unknown = JSON.parse(await readFile(join(env.WOW_COMPANION_BRIDGE_DIR!, '..', addon, 'tests', 'fixtures', `lua-${game}-inventory.json`), 'utf8'))
    expect(safeParse(inventorySnapshotSchema, value).success).toBe(true)
  })

  it('retains complete, empty, and partial captures without inventing bank stock', () => {
    expect(safeParse(inventorySnapshotSchema, snapshot()).success).toBe(true)
    expect(safeParse(inventorySnapshotSchema, { ...snapshot(), items: [] }).success).toBe(true)
    const partial = { ...snapshot(), complete: false, items: [] }
    expect(safeParse(inventorySnapshotSchema, partial).output).toEqual(partial)
  })

  it.each([
    { id: 0 },
    { session: '' },
    { guid: 'Player/other' },
    { observedAt: 0 },
    { observedAt: 4102444801 },
    { source: 'bank' },
    { bank: 'empty' },
    { complete: 'true' },
    { items: [{ itemID: 12359, quantity: 0 }] },
    { items: [{ itemID: 12359, quantity: 1.5 }] },
    { items: [{ itemID: 12359, quantity: 2147483648 }] },
    { items: [{ itemID: 12359, quantity: 1 }, { itemID: 12359, quantity: 2 }] },
    { items: [{ itemID: 12359, quantity: 1 }, { itemID: 12358, quantity: 2 }] },
    { items: Array.from({ length: 1001 }, (_, index) => ({ itemID: index + 1, quantity: 1 })) },
    { inventoryFromOtherCharacter: true },
  ])('rejects invalid or ambiguous inventory evidence: %j', (invalid) => {
    expect(safeParse(inventorySnapshotSchema, { ...snapshot(), ...invalid }).success).toBe(false)
  })
})
