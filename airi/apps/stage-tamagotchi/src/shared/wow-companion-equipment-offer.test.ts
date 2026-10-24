import type { EquipmentOffer } from './wow-companion-equipment-offer'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env } from 'node:process'

import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { equipmentOfferSchema } from './wow-companion-equipment-offer'

function offer(): EquipmentOffer {
  return { v: 1, kind: 'offer', s: 'session-1', g: 'Player-1', id: 2, q: 3, st: 'ready', slot: 5, item: 123, n: '星辰胸甲', il: 150.5, old: 122, ol: 140, until: 1700000120 }
}

describe('game equipment confirmation contract', () => {
  it('accepts item-level upgrades, empty slots, and closed confirmations', () => {
    expect(parse(equipmentOfferSchema, offer())).toEqual(offer())
    expect(parse(equipmentOfferSchema, { ...offer(), old: 0, ol: -1 }).old).toBe(0)
    expect(parse(equipmentOfferSchema, { ...offer(), st: 'closed', q: 4 }).st).toBe('closed')
  })

  it('rejects non-upgrades, malformed identities, oversized names, and extra actions', () => {
    for (const patch of [{ il: 140 }, { old: 0 }, { ol: -1 }, { s: '' }, { g: 'Player 1' }, { q: 0 }, { q: true }, { n: '中'.repeat(33) }, { n: '' }, { n: 'bad\u007F' }, { il: Number.NaN }, { until: 0 }, { st: 'execute' }, { command: 'equip' }]) {
      expect(safeParse(equipmentOfferSchema, { ...offer(), ...patch }).success).toBe(false)
    }
  })

  it('keeps item text literal and accepts the maximum UTF-8 boundary', () => {
    expect(parse(equipmentOfferSchema, { ...offer(), n: '<script>alert(1)</script>' }).n).toBe('<script>alert(1)</script>')
    expect(parse(equipmentOfferSchema, { ...offer(), n: '中'.repeat(32) }).n).toHaveLength(32)
  })
})

const bridgeDirectory = env.WOW_COMPANION_BRIDGE_DIR
describe.skipIf(!bridgeDirectory)('actual Lua confirmation fixtures', () => {
  it.each(['WoWMapCompanion', 'WoWForeverCompanion'])('parses the %s producer output', (addon) => {
    const fixture = JSON.parse(readFileSync(join(bridgeDirectory!, '..', addon, 'tests/fixtures/lua-offer.json'), 'utf8'))
    const parsed = parse(equipmentOfferSchema, fixture)
    expect(parsed).toEqual(fixture)
    expect(parsed.st).toBe('ready')
    expect(parsed.il).toBeGreaterThan(parsed.ol)
  })
})
