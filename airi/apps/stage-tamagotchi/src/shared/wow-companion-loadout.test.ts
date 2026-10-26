import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { equipmentLoadoutSchema } from './wow-companion-loadout'
import { loadoutFixture } from './wow-companion-loadout.test-helper'

describe('equipped-item protocol', () => {
  it('accepts complete slots and rejects mixed, duplicate, or incomplete lists', () => {
    expect(safeParse(equipmentLoadoutSchema, loadoutFixture()).success).toBe(true)
    for (const kind of ['missing', 'duplicate', 'wrong-state', 'link-mismatch', 'inconsistent-flags'] as const) {
      const value = loadoutFixture()
      if (kind === 'missing')
        value.slots.pop()
      if (kind === 'duplicate')
        value.slots[1].slot = 1
      if (kind === 'wrong-state')
        value.slots[0].state = 'empty'
      if (kind === 'link-mismatch')
        value.slots[0].item!.itemID = 999
      if (kind === 'inconsistent-flags')
        value.slots[0].item!.name = null
      expect(safeParse(equipmentLoadoutSchema, value).success).toBe(false)
    }
  })

  it('allows partial public information and rejects contradictory completeness', () => {
    const value = loadoutFixture()
    value.slots[0].item!.tooltip = []
    value.slots[0].item!.tooltipComplete = false
    value.slots[0].item!.truncated = true
    expect(safeParse(equipmentLoadoutSchema, value).success).toBe(true)
    value.slots[0].item!.tooltipComplete = true
    expect(safeParse(equipmentLoadoutSchema, value).success).toBe(false)
  })

  it.each(['\u0000', '\u0085', '\uD800'])('rejects invalid text %j', (character) => {
    const value = loadoutFixture()
    value.slots[0].item!.name = `Helm${character}`
    expect(safeParse(equipmentLoadoutSchema, value).success).toBe(false)
  })

  for (const game of ['retail', 'forever']) {
    it.runIf(Boolean(process.env.WOW_COMPANION_BRIDGE_DIR))(`accepts the real ${game} Lua wire fixture`, async () => {
      const root = process.env.WOW_COMPANION_BRIDGE_DIR!
      const value = JSON.parse(await readFile(resolve(root, '..', game === 'retail' ? 'WoWMapCompanion' : 'WoWForeverCompanion', 'tests', 'fixtures', `lua-${game}-gear.json`), 'utf8'))
      expect(safeParse(equipmentLoadoutSchema, value).success).toBe(true)
    })
  }
})
