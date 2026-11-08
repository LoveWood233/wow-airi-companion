import type { BridgeStatus, GameVersion } from '../../../shared/wow-companion'

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { createContext, defineInvoke } from '@moeru/eventa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { wowCompanionDemo, wowCompanionGet, wowCompanionSetAccountName, wowCompanionSetCapture, wowCompanionSetSettings } from '../../../shared/eventa/wow-companion'
import { wowMemoryClaimNotice, wowMemoryCollect, wowMemoryCollectEquipment, wowMemoryEdit, wowMemoryForget, wowMemoryGet, wowMemoryGetCapacity, wowMemoryRemember, wowMemorySetLimit, wowMemorySuppress } from '../../../shared/eventa/wow-companion-memory'
import { defaultSettings } from '../../../shared/wow-companion'
import { comparisonFixture } from '../../../shared/wow-companion-comparison.test-helper'
import { emitAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { setupWowCompanion } from './wow-companion'
import { CompanionEquipmentComparisons } from './wow-companion-equipment-comparisons'
import { CompanionEquipmentHistory } from './wow-companion-equipment-history'
import { CompanionLevelHistory } from './wow-companion-level-history'

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

function levelBridge(level: number, tick = 1): BridgeStatus {
  return {
    instanceId: 'level-profile-test',
    status: 'live',
    source: 'screen',
    snapshot: {
      v: 3,
      session: 's1',
      seq: tick,
      tick,
      guid: 'Player-1',
      name: 'Mage',
      realm: 'Realm',
      level,
      class: 'MAGE',
      faction: 'Alliance',
      race: 'Human',
      spec: 64,
      map: 84,
      zone: 'Stormwind',
      combat: false,
      dead: false,
      online: true,
      account: 'same-local-id',
      moneyEpoch: 'epoch-1',
      copper: 100,
      earned: 0,
      spent: 0,
    },
    lastSeen: new Date().toISOString(),
    ageSeconds: 0,
    eventCursor: 0,
    events: [],
    equipmentComparisons: [],
    equipmentComparisonError: null,
    equipmentLoadout: null,
    equipmentLoadoutError: null,
    inventory: null,
    inventoryReceivedAt: null,
    inventoryError: null,
    quests: null,
    questsReceivedAt: null,
    questsError: null,
    talents: null,
    talentsReceivedAt: null,
    talentsError: null,
    config: { x: 8, y: 8, cellSize: 1, pollMs: 500, paused: false },
    error: null,
  }
}

async function saveLevelBaseline(file: string, level: number) {
  const history = new CompanionLevelHistory(file)
  await history.observe(levelBridge(level))
  await history.flush()
}

async function saveComparison(file: string, itemID: number) {
  const history = new CompanionEquipmentComparisons(file)
  const bridge = levelBridge(30)
  const comparison = comparisonFixture({ session: 's1' })
  comparison.candidate.itemID = itemID
  bridge.equipmentComparisons = [comparison]
  await history.observe(bridge)
  await history.flush()
}

describe('companion profile IPC and persistence', () => {
  let directory: string
  let context: ReturnType<typeof createContext>
  let service: ReturnType<typeof setupWowCompanion>
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
    await saveLevelBaseline(join(directory, 'wow-companion-level-history-v1.json'), 30)
    await saveLevelBaseline(join(directory, 'wow-companion-forever-level-history-v1.json'), 50)
    await saveComparison(join(directory, 'wow-companion-equipment-comparisons-v1.json'), 1001)
    await saveComparison(join(directory, 'wow-companion-forever-equipment-comparisons-v1.json'), 2001)
    context = createContext()
    service = setupWowCompanion(context as never)
  })

  afterEach(async () => {
    await emitAppBeforeQuit()
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir(), 'airi-wow-profiles-')))
      throw new Error('Refusing to remove a directory outside the profile test prefix')
    await rm(target, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('returns successful memory outcomes only for the owning companion and rejects missing targets', async () => {
    const remember = defineInvoke(context, wowMemoryRemember)
    const get = defineInvoke(context, wowMemoryGet)
    const edit = defineInvoke(context, wowMemoryEdit)
    const collect = defineInvoke(context, wowMemoryCollect)
    const suppress = defineInvoke(context, wowMemorySuppress)
    const forget = defineInvoke(context, wowMemoryForget)
    const input = { personaId: 'ranger', kind: 'preference' as const, text: 'Stay quiet during raids.', sourceId: 'chat:rpc:preference-1' }
    const state = await remember(input)
    const id = state.entries[0]!.id
    expect(state.entries[0].text).toBe(input.text)
    expect((await get({ personaId: 'another-card' })).entries).toEqual([])
    await expect(edit({ personaId: 'another-card', id, text: 'Changed.' })).rejects.toThrow('memory-entry-unavailable')
    await expect(collect({ personaId: 'another-card', id, collected: true })).rejects.toThrow('memory-entry-unavailable')
    await expect(suppress({ personaId: 'another-card', id, suppressed: true })).rejects.toThrow('memory-entry-unavailable')
    await expect(forget({ personaId: 'another-card', id })).rejects.toThrow('memory-entry-unavailable')
    await expect(edit({ personaId: 'ranger', id: 'missing', text: 'Changed.' })).rejects.toThrow('memory-entry-unavailable')
    const changed = await edit({ personaId: 'ranger', id, text: 'Quiet during every instance.' })
    expect(changed.entries[0].text).toBe('Quiet during every instance.')
    expect((await collect({ personaId: 'ranger', id, collected: true })).entries[0].collected).toBe(true)
    expect((await suppress({ personaId: 'ranger', id, suppressed: true })).entries[0].suppressed).toBe(true)
    expect((await forget({ personaId: 'ranger', id })).entries).toEqual([])
    await expect(remember(input)).rejects.toThrow('memory-entry-unavailable')
    expect((await get({ personaId: 'ranger' })).entries).toEqual([])
  })

  it('collects only authoritative equipment data and rejects acquisitions outside the retained history', async () => {
    const get = defineInvoke(context, wowCompanionGet)
    await expect.poll(async () => (await get({ game: 'retail' })).equipmentHistory.entries.length).toBe(1)
    const original = CompanionEquipmentHistory.validateBackup(JSON.parse(equipmentHistory(1001))).entries[0].record
    const collect = defineInvoke(context, wowMemoryCollectEquipment)
    const input = {
      personaId: 'ranger',
      character: { game: 'retail' as const, account: 'same-local-id', guid: 'Player-1' },
      characterName: 'Forged name',
      record: { ...original, name: 'Forged equipment', itemLevel: 999, stats: [{ key: 'ITEM_MOD_STRENGTH_SHORT', value: 999 }] },
    }
    const state = await collect(input)
    const entry = state.entries[0]
    expect(entry.characterName).toBe('Mage')
    expect(entry.fact?.kind).toBe('equipment')
    if (entry.fact?.kind !== 'equipment')
      throw new Error('Equipment was not collected')
    expect(entry.fact.record).toEqual(original)
    expect(entry.collected).toBe(true)
    await expect(collect({ ...input, record: { ...original, id: 999 } })).rejects.toThrow('memory-equipment-unavailable')
    expect((await defineInvoke(context, wowMemoryGet)({ personaId: 'ranger' })).entries).toHaveLength(1)
    await emitAppBeforeQuit()
    const history = new CompanionEquipmentHistory(join(directory, 'wow-companion-equipment-history-v1.json'))
    const bridge = levelBridge(30)
    bridge.equipment = Array.from({ length: 10 }, (_, index) => ({ ...original, id: index + 2, itemID: 1100 + index, link: `item:${1100 + index}` }))
    await history.observe(bridge)
    await history.flush()
    context = createContext()
    service = setupWowCompanion(context as never)
    const refreshedGet = defineInvoke(context, wowCompanionGet)
    await expect.poll(async () => (await refreshedGet({ game: 'retail' })).equipmentHistory.entries.length).toBe(10)
    expect((await refreshedGet({ game: 'retail' })).equipmentHistory.entries.some(entry => entry.record.id === original.id)).toBe(false)
    await expect(defineInvoke(context, wowMemoryCollectEquipment)({ ...input, record: original })).rejects.toThrow('memory-equipment-unavailable')
    expect((await defineInvoke(context, wowMemoryGet)({ personaId: 'ranger' })).entries).toHaveLength(1)
  })

  it('validates capacity settings and notice claims through the real shared IPC contracts', async () => {
    const limit = defineInvoke(context, wowMemorySetLimit)
    const claim = defineInvoke(context, wowMemoryClaimNotice)
    const get = defineInvoke(context, wowMemoryGet)
    const capacity = defineInvoke(context, wowMemoryGetCapacity)
    expect((await get({ personaId: 'ranger' })).capacity).toEqual({ limit: 1000, used: 0, full: false })
    expect((await limit({ personaId: 'ranger', limit: 200 })).capacity).toEqual({ limit: 200, used: 0, full: false })
    expect((await get({ personaId: 'another-card' })).capacity?.limit).toBe(1000)
    await expect(limit({ personaId: 'ranger', limit: 0 })).rejects.toThrow()
    await expect(limit({ personaId: 'ranger', limit: 100.5 })).rejects.toThrow()
    expect(await claim({ personaId: 'ranger', kind: 'capacity-full' })).toBe(false)
    expect(await claim({ personaId: 'ranger', kind: 'context-limited' })).toBe(true)
    expect(await claim({ personaId: 'ranger', kind: 'context-limited' })).toBe(false)
    const forgedClock = { personaId: 'ranger', kind: 'context-limited' as const, now: 8_000_000_000_000_000 }
    await expect(claim(forgedClock)).rejects.toThrow()
    expect(await claim({ personaId: 'another-card', kind: 'context-limited' })).toBe(true)
    expect((await get({ personaId: 'ranger' })).capacity?.limit).toBe(200)
    await defineInvoke(context, wowMemoryRemember)({ personaId: 'ranger', kind: 'preference', text: 'A private remembered fact.' })
    expect(await capacity({ personaId: 'ranger' })).toEqual({ limit: 200, used: 1, full: false })
  })

  it('does not serialize corrupt memory for a history-only service backup', async () => {
    await emitAppBeforeQuit()
    const memoryPath = join(directory, 'wow-companion-memory-v1.json')
    await writeFile(memoryPath, '{corrupt memories', 'utf8')
    context = createContext()
    service = setupWowCompanion(context as never)
    const memoryGet = defineInvoke(context, wowMemoryGet)
    expect((await memoryGet({ personaId: 'ranger' })).storageError).not.toBeNull()
    const snapshot = await service.snapshotForBackup({ settings: false, history: true, chats: false })
    expect(snapshot.some(file => file.id === 'companion-memories')).toBe(false)
    await expect(service.snapshotForBackup({ settings: true, history: false, chats: false })).rejects.toThrow('memory-backup-unavailable')
    expect(await readFile(memoryPath, 'utf8')).toBe('{corrupt memories')
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
    await expect.poll(async () => (await get({ game: 'retail' })).equipmentHistory.storageError).toContain('equipment-read')
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

  it('loads separate level histories for identical account and character IDs while disconnected', async () => {
    const get = defineInvoke(context, wowCompanionGet)
    await expect.poll(async () => (await get({ game: 'retail' })).levelHistory.characters.length).toBe(1)
    await expect.poll(async () => (await get({ game: 'forever' })).levelHistory.characters.length).toBe(1)
    const retail = await get({ game: 'retail' })
    const forever = await get({ game: 'forever' })
    expect(retail.bridge).toBeNull()
    expect(forever.bridge).toBeNull()
    expect(retail.levelHistory.characters[0].currentLevel).toBe(30)
    expect(forever.levelHistory.characters[0].currentLevel).toBe(50)
    expect(retail.levelHistory.characters[0].records[0].source).toBe('baseline')
    expect(retail.levelHistory.characters[0].records[0].durationMs).toBeNull()
    expect(retail.levelHistory.storageError).toBeNull()
    expect(forever.levelHistory.storageError).toBeNull()
  })

  it('loads comparison histories independently while both game connections are disabled', async () => {
    const get = defineInvoke(context, wowCompanionGet)
    await expect.poll(async () => (await get({ game: 'retail' })).equipmentComparisons.entries.length).toBe(1)
    await expect.poll(async () => (await get({ game: 'forever' })).equipmentComparisons.entries.length).toBe(1)
    expect((await get({ game: 'retail' })).equipmentComparisons.entries[0].comparison.candidate.itemID).toBe(1001)
    expect((await get({ game: 'forever' })).equipmentComparisons.entries[0].comparison.candidate.itemID).toBe(2001)
    expect((await get({ game: 'retail' })).equipmentComparisons.storageError).toBeNull()
    expect((await get({ game: 'forever' })).equipmentComparisons.storageError).toBeNull()
  })

  it('preserves corrupt level history without blocking the other profile or gold and equipment records', async () => {
    await emitAppBeforeQuit()
    const original = '{corrupt level history'
    const path = join(directory, 'wow-companion-level-history-v1.json')
    await writeFile(path, original, 'utf8')
    context = createContext()
    setupWowCompanion(context as never)
    const get = defineInvoke(context, wowCompanionGet)
    await expect.poll(async () => (await get({ game: 'retail' })).levelHistory.storageError).not.toBeNull()
    await expect.poll(async () => (await get({ game: 'forever' })).levelHistory.characters.length).toBe(1)
    const retail = await get({ game: 'retail' })
    expect(retail.error).toBeNull()
    expect(retail.levelHistory.characters).toEqual([])
    expect(retail.gold.accounts[0].earned).toBe('1000')
    expect(retail.equipmentHistory.entries[0].record.itemID).toBe(1001)
    expect((await get({ game: 'forever' })).levelHistory.characters[0].currentLevel).toBe(50)
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('records live level changes through the profile poller even when level reminders are disabled', async () => {
    let bridge = levelBridge(31, 2)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => String(input).endsWith('/health')
      ? Response.json({ ok: true, service: 'wow-companion-bridge', protocol: 'WCP1', game: 'retail', version: '2.20.0', instanceId: bridge.instanceId })
      : Response.json(bridge))
    const get = defineInvoke(context, wowCompanionGet)
    const set = defineInvoke(context, wowCompanionSetSettings)
    await set({ game: 'retail', settings: { ...retailSettings, enabled: true, levelUp: false } })
    await expect.poll(async () => (await get({ game: 'retail' })).levelHistory.characters[0].currentLevel).toBe(31)
    expect((await get({ game: 'retail' })).levelHistory.characters[0].records.at(-1)?.source).toBe('gap')
    bridge = levelBridge(32, 3)
    await expect.poll(async () => (await get({ game: 'retail' })).levelHistory.characters[0].currentLevel).toBe(32)
    const record = (await get({ game: 'retail' })).levelHistory.characters[0].records.at(-1)
    expect(record?.source).toBe('live')
    expect(record?.durationBasis).toBe('partial')
    expect(record?.durationMs).toBeGreaterThan(0)
    expect((await get({ game: 'retail' })).settings.muted).toBe(true)
    expect((await get({ game: 'forever' })).levelHistory.characters[0].currentLevel).toBe(50)
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
    await expect(capture({ game: 'forever', capture: { x: 80, y: 64, cellSize: 1, pollMs: 500, paused: false } })).rejects.toThrow('connection-disabled')
    await expect(demo({ game: 'forever', request: { enabled: true, action: 'none' } })).rejects.toThrow('connection-disabled')
  })
})
