import type { GameVersion } from '../../../shared/wow-companion'

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { createContext, defineInvoke } from '@moeru/eventa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { wowCompanionDemo, wowCompanionGet, wowCompanionSetAccountName, wowCompanionSetCapture, wowCompanionSetSettings } from '../../../shared/eventa/wow-companion'
import { defaultSettings } from '../../../shared/wow-companion'
import { emitAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { setupWowCompanion } from './wow-companion'

const electron = vi.hoisted(() => ({ getPath: vi.fn(), getAppPath: vi.fn() }))
vi.mock('electron', () => ({ app: electron }))

function ledger(earned: number) {
  return JSON.stringify({
    version: 1,
    accounts: [{
      account: 'same-local-id',
      name: '',
      characters: [{
        guid: 'Player-1',
        name: 'Mage',
        realm: 'Realm',
        copper: earned,
        earned: String(earned),
        spent: '0',
        epoch: 'epoch-1',
        counterEarned: earned,
        counterSpent: 0,
        retiredEpochs: [],
        session: 's1',
        seq: 1,
        tick: 1,
        firstSeen: 1,
        lastSeen: 1,
      }],
    }],
  })
}

function equipmentHistory(itemID: number) {
  return JSON.stringify({
    version: 1,
    entries: [{
      account: 'same-local-id',
      name: 'Mage',
      realm: 'Realm',
      receivedAt: 1792800000000,
      record: {
        v: 1,
        id: 1,
        session: 's1',
        guid: 'Player-1',
        itemID,
        itemGUID: null,
        link: `item:${itemID}`,
        name: `Equipment ${itemID}`,
        type: 'Armor',
        subtype: 'Cloth',
        equipLoc: 'INVTYPE_HEAD',
        quality: 4,
        itemLevel: 100,
        requiredLevel: 10,
        stats: [],
        tooltip: [],
        quantity: 1,
        observedAt: 1792800000,
        source: 'bag_added',
        infoComplete: true,
        statsComplete: true,
        tooltipComplete: true,
        truncated: false,
      },
    }],
    seen: [createHash('sha256').update(JSON.stringify(['same-local-id', 'Player-1', 's1', 1])).digest('hex')],
  })
}

describe('companion profile IPC and persistence', () => {
  let directory: string
  let context: ReturnType<typeof createContext>
  const retailSettings = { ...defaultSettings, enabled: false, muted: true, cooldownSeconds: 42 }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'airi-wow-profiles-'))
    electron.getPath.mockReturnValue(directory)
    electron.getAppPath.mockReturnValue(join(directory, 'airi', 'apps', 'stage-tamagotchi'))
    await writeFile(join(directory, 'wow-companion-v1.json'), JSON.stringify(retailSettings))
    await writeFile(join(directory, 'wow-companion-gold-v1.json'), ledger(1000))
    await writeFile(join(directory, 'wow-companion-forever-gold-v1.json'), ledger(200))
    await writeFile(join(directory, 'wow-companion-equipment-history-v1.json'), equipmentHistory(1001))
    await writeFile(join(directory, 'wow-companion-forever-equipment-history-v1.json'), equipmentHistory(2001))
    context = createContext()
    setupWowCompanion(context as never)
  })

  afterEach(async () => {
    await emitAppBeforeQuit()
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir(), 'airi-wow-profiles-')))
      throw new Error('Refusing to remove a directory outside the profile test prefix')
    await rm(target, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('keeps existing Retail settings and starts Forever disabled with independent preferences', async () => {
    const get = defineInvoke(context, wowCompanionGet)
    const set = defineInvoke(context, wowCompanionSetSettings)
    expect((await get({ game: 'retail' })).settings).toEqual(retailSettings)
    expect((await get({ game: 'forever' })).settings).toEqual({ ...defaultSettings, enabled: false })
    const changed = { ...defaultSettings, enabled: false, cooldownSeconds: 90 }
    expect((await set({ game: 'forever', settings: changed })).game).toBe('forever')
    expect((await get({ game: 'retail' })).settings).toEqual(retailSettings)
    expect((await get({ game: 'forever' })).settings).toEqual(changed)
    await expect.poll(async () => JSON.parse(await readFile(join(directory, 'wow-companion-forever-v1.json'), 'utf8'))).toEqual(changed)
    expect(JSON.parse(await readFile(join(directory, 'wow-companion-v1.json'), 'utf8'))).toEqual(retailSettings)
  })

  it('isolates saved gold and account names when both games report the same account ID', async () => {
    const get = defineInvoke(context, wowCompanionGet)
    const rename = defineInvoke(context, wowCompanionSetAccountName)
    await expect.poll(async () => (await get({ game: 'retail' })).gold.accounts.length).toBe(1)
    await expect.poll(async () => (await get({ game: 'forever' })).gold.accounts.length).toBe(1)
    expect((await get({ game: 'retail' })).gold.accounts[0].earned).toBe('1000')
    expect((await get({ game: 'forever' })).gold.accounts[0].earned).toBe('200')
    await rename({ game: 'forever', request: { account: 'same-local-id', name: 'Forever account' } })
    expect((await get({ game: 'forever' })).gold.accounts[0].name).toBe('Forever account')
    expect((await get({ game: 'retail' })).gold.accounts[0].name).toBe('')
    const retail = JSON.parse(await readFile(join(directory, 'wow-companion-gold-v1.json'), 'utf8'))
    const forever = JSON.parse(await readFile(join(directory, 'wow-companion-forever-gold-v1.json'), 'utf8'))
    expect(retail.accounts[0].name).toBe('')
    expect(forever.accounts[0].name).toBe('Forever account')
  })

  it('loads separate equipment histories while both game connections are disabled', async () => {
    const get = defineInvoke(context, wowCompanionGet)
    await expect.poll(async () => (await get({ game: 'retail' })).equipmentHistory.entries.length).toBe(1)
    await expect.poll(async () => (await get({ game: 'forever' })).equipmentHistory.entries.length).toBe(1)
    const retail = await get({ game: 'retail' })
    const forever = await get({ game: 'forever' })
    expect(retail.bridge).toBeNull()
    expect(forever.bridge).toBeNull()
    expect(retail.equipmentHistory.entries[0].record.itemID).toBe(1001)
    expect(forever.equipmentHistory.entries[0].record.itemID).toBe(2001)
    expect(retail.equipmentHistory.storageError).toBeNull()
    expect(forever.equipmentHistory.storageError).toBeNull()
  })

  it('isolates corrupt equipment history from gold and the other game profile', async () => {
    await emitAppBeforeQuit()
    const original = '{corrupt equipment'
    const path = join(directory, 'wow-companion-equipment-history-v1.json')
    await writeFile(path, original, 'utf8')
    context = createContext()
    setupWowCompanion(context as never)
    const get = defineInvoke(context, wowCompanionGet)
    await expect.poll(async () => (await get({ game: 'retail' })).equipmentHistory.storageError).toContain('Cannot load WoW equipment history')
    const retail = await get({ game: 'retail' })
    const forever = await get({ game: 'forever' })
    expect(retail.error).toBeNull()
    expect(retail.gold.storageError).toBeNull()
    expect(retail.gold.accounts[0].earned).toBe('1000')
    expect(retail.equipmentHistory.entries).toEqual([])
    expect(forever.equipmentHistory.entries[0].record.itemID).toBe(2001)
    expect(forever.equipmentHistory.storageError).toBeNull()
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it.each(['__proto__', '../retail', 'http://example.com'])('rejects unrecognized IPC game keys: %s', async (value) => {
    const game = value as GameVersion
    const get = defineInvoke(context, wowCompanionGet)
    const set = defineInvoke(context, wowCompanionSetSettings)
    const capture = defineInvoke(context, wowCompanionSetCapture)
    const demo = defineInvoke(context, wowCompanionDemo)
    const rename = defineInvoke(context, wowCompanionSetAccountName)
    await expect(get({ game })).rejects.toThrow()
    await expect(set({ game, settings: retailSettings })).rejects.toThrow()
    await expect(capture({ game, capture: { x: 8, y: 8, cellSize: 1, pollMs: 500, paused: false } })).rejects.toThrow()
    await expect(demo({ game, request: { enabled: true, action: 'none' } })).rejects.toThrow()
    await expect(rename({ game, request: { account: 'same-local-id', name: 'Invalid' } })).rejects.toThrow()
    expect((await get({ game: 'retail' })).settings).toEqual(retailSettings)
    expect((await get({ game: 'forever' })).settings.enabled).toBe(false)
  })

  it('does not start a disabled profile for capture or demo writes', async () => {
    const capture = defineInvoke(context, wowCompanionSetCapture)
    const demo = defineInvoke(context, wowCompanionDemo)
    await expect(capture({ game: 'forever', capture: { x: 80, y: 64, cellSize: 1, pollMs: 500, paused: false } })).rejects.toThrow('Enable the companion connection')
    await expect(demo({ game: 'forever', request: { enabled: true, action: 'none' } })).rejects.toThrow('Enable the companion connection')
  })
})
