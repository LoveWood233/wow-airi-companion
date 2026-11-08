import type { BridgeStatus, Snapshot } from '../../../shared/wow-companion'
import type { EquipmentRecord } from '../../../shared/wow-companion-equipment'
import type { LevelHistoryRecord } from '../../../shared/wow-companion-level-history'
import type { MemoryObservation } from '../../../shared/wow-companion-memory'

import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { parse } from 'valibot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { equipmentSchema } from '../../../shared/wow-companion-equipment'
import { suggestedMemoryGrowthRules } from '../../../shared/wow-companion-memory'
import { CompanionMemoryRepository } from './wow-companion-memory'

vi.mock('node:fs/promises', async (importOriginal) => {
  const filesystem = await importOriginal<typeof import('node:fs/promises')>()
  return { ...filesystem, rename: vi.fn(filesystem.rename) }
})

const character = { game: 'retail' as const, account: 'account-1', guid: 'Player-1' }
const scope = { personaId: 'ranger', character }

function level(id: number, value: number, source: LevelHistoryRecord['source'] = 'live'): LevelHistoryRecord {
  return { id, fromLevel: id === 1 ? null : value - 1, level: value, recordedAt: Date.now(), source, durationMs: source === 'live' ? 1000 : null, durationBasis: source === 'live' ? 'complete' : 'unknown' }
}

function observation(seq: number, records: LevelHistoryRecord[], options: { map?: number, event?: number, bridgeId?: string, snapshot?: Partial<Snapshot> } = {}): MemoryObservation {
  const snapshot: Snapshot = {
    v: 3,
    session: 'frames-1',
    seq,
    tick: seq * 100,
    guid: character.guid,
    name: 'Ranger',
    realm: 'Realm',
    level: records.at(-1)?.level ?? 10,
    class: 'HUNTER',
    faction: 'Horde',
    race: 'Blood Elf',
    spec: 1,
    map: options.map ?? 1,
    zone: 'Forest',
    combat: false,
    dead: false,
    online: true,
    account: character.account,
    moneyEpoch: 'money-1',
    copper: 1000,
    earned: 0,
    spent: 0,
    px: null,
    py: null,
    loginId: 'login-1',
    combatEnds: 0,
    ...options.snapshot,
  }
  const bridge: BridgeStatus = {
    instanceId: options.bridgeId ?? 'bridge-1',
    status: 'live',
    source: 'screen',
    snapshot,
    lastSeen: new Date().toISOString(),
    ageSeconds: 0,
    eventCursor: options.event ?? 0,
    events: options.event ? [{ id: options.event, type: 'zone', timestamp: new Date().toISOString(), title: '', detail: '', snapshot, demo: false }] : [],
    equipment: [],
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
    config: { x: 0, y: 0, cellSize: 1, pollMs: 750, paused: false },
    error: null,
  }
  return { game: 'retail', bridge, levels: { characters: [{ account: character.account, guid: character.guid, name: 'Ranger', realm: 'Realm', currentLevel: snapshot.level, firstSeen: Date.now(), lastSeen: Date.now(), records }], storageError: null } }
}

function equipment(): EquipmentRecord {
  return parse(equipmentSchema, {
    v: 1,
    id: 1,
    session: 'frames-1',
    guid: character.guid,
    itemID: 123,
    itemGUID: 'Item-123',
    link: 'item:123',
    name: 'Helm',
    type: 'Armor',
    subtype: 'Mail',
    equipLoc: 'INVTYPE_HEAD',
    quality: 4,
    itemLevel: 100,
    requiredLevel: 10,
    stats: [],
    tooltip: [],
    quantity: 1,
    observedAt: 1793600000,
    source: 'bag_added',
    infoComplete: true,
    statsComplete: true,
    tooltipComplete: true,
    truncated: false,
  })
}

describe('companion memory repository', () => {
  let directory: string
  let path: string
  let memory: CompanionMemoryRepository

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T04:00:00Z'))
    directory = await mkdtemp(join(tmpdir(), 'airi-wow-memory-'))
    path = join(directory, 'memory.json')
    memory = new CompanionMemoryRepository(path, { growth: suggestedMemoryGrowthRules })
    await memory.load()
    await memory.setActivePersona(scope.personaId)
  })

  afterEach(async () => {
    vi.useRealTimers()
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir(), 'airi-wow-memory-')))
      throw new Error('Refusing to remove a path outside the memory test prefix')
    await rm(target, { recursive: true, force: true })
  })

  it('awards only live upgrades and first shared maps, caps each day, and preserves stages across offline time', async () => {
    const records = [level(1, 10, 'baseline')]
    await memory.observe(observation(1, records))
    expect(memory.read(scope).entries).toHaveLength(0)
    records.push(level(2, 11))
    await memory.observe(observation(2, records, { event: 1, map: 2 }))
    expect(memory.read(scope).relationship.points).toBe(15)
    records.push(level(3, 15, 'gap'))
    await memory.observe(observation(3, records, { event: 1, map: 2 }))
    expect(memory.read(scope).relationship.points).toBe(15)
    records.push(level(4, 16))
    await memory.observe(observation(4, records, { event: 2, map: 2 }))
    expect(memory.read(scope).relationship.points).toBe(25)
    records.push(level(5, 17))
    await memory.observe(observation(5, records, { event: 3, map: 3 }))
    expect(memory.read(scope).relationship.points).toBe(30)
    vi.setSystemTime(new Date('2026-11-04T04:00:00Z'))
    await memory.observe(observation(6, records, { event: 3, map: 3 }))
    expect(memory.read(scope).relationship.points).toBe(30)
    records.push(level(6, 18))
    await memory.observe(observation(7, records, { event: 3, map: 3 }))
    records.push(level(7, 19))
    await memory.observe(observation(8, records, { event: 3, map: 3 }))
    expect(memory.read(scope).relationship.points).toBe(50)
    expect(memory.read(scope).relationship.stage).toBe(1)
    const saved = CompanionMemoryRepository.validateBackup(JSON.parse(await readFile(path, 'utf8')))
    expect(saved.relationships[0]?.points).toBe(50)
    expect(saved.rewards.reduce((sum, reward) => sum + reward.points, 0)).toBe(50)
  })

  it('does not replay existing history after restart, reconnect, missing level capability, or a card switch', async () => {
    const records = [level(1, 10, 'baseline')]
    await memory.observe(observation(1, records))
    records.push(level(2, 11))
    const current = observation(2, records, { event: 1, map: 2 })
    await memory.observe(current)
    const restarted = new CompanionMemoryRepository(path, { growth: suggestedMemoryGrowthRules })
    await restarted.load()
    await restarted.setActivePersona('ranger')
    await restarted.observe(current)
    await restarted.observe(observation(3, records, { event: 1, map: 2, bridgeId: 'new-bridge' }))
    expect(restarted.read(scope).relationship.points).toBe(15)
    await restarted.setActivePersona('mage')
    await restarted.observe(observation(3, records, { event: 1, map: 2, bridgeId: 'new-bridge' }))
    expect(restarted.read({ personaId: 'mage' }).entries).toHaveLength(0)
    await restarted.observe(observation(4, records, { event: 2, map: 3, bridgeId: 'new-bridge' }))
    expect(restarted.read({ personaId: 'mage' }).entries).toHaveLength(1)
    expect(restarted.read({ personaId: 'mage' }).relationship.points).toBe(5)
    const missing = new CompanionMemoryRepository(join(directory, 'missing.json'), { growth: suggestedMemoryGrowthRules })
    await missing.setActivePersona('ranger')
    const noLevels = observation(1, records)
    delete noLevels.levels
    await missing.observe(noLevels)
    await missing.observe(observation(2, records))
    expect(missing.read(scope).relationship.points).toBe(0)
  })

  it('keeps suppression separate from deletion and prevents forgotten sources from returning', async () => {
    const entry = await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'Quiet during raids.', sourceId: 'chat:1:turn:1' })
    expect(entry).toBeDefined()
    if (!entry)
      throw new Error('Preference was not saved')
    expect(await memory.suppress({ personaId: 'ranger', id: entry.id, suppressed: true })).toBe(true)
    expect(memory.read(scope).entries[0]?.text).toBe('Quiet during raids.')
    expect(memory.read(scope).entries[0]?.suppressed).toBe(true)
    expect(await memory.edit({ personaId: 'mage', id: entry.id, text: 'Changed.' })).toBe(false)
    expect(await memory.forget({ personaId: 'mage', id: entry.id })).toBe(false)
    expect(memory.read({ personaId: 'mage' }).entries).toHaveLength(0)
    expect(await memory.forget({ personaId: 'ranger', id: entry.id })).toBe(true)
    const restarted = new CompanionMemoryRepository(path)
    await restarted.load()
    expect(await restarted.remember({ personaId: 'ranger', kind: 'preference', text: 'Quiet during raids.', sourceId: 'chat:1:turn:1' })).toBeUndefined()
    expect(restarted.read(scope).entries).toHaveLength(0)
    expect(await restarted.remember({ personaId: 'ranger', kind: 'preference', text: 'Quiet during raids.', sourceId: 'chat:2:turn:1' })).toBeDefined()
  })

  it('forgets a game fact without rolling back growth and ignores its replay after restart', async () => {
    const records = [level(1, 10, 'baseline')]
    await memory.observe(observation(1, records))
    records.push(level(2, 11))
    const current = observation(2, records)
    await memory.observe(current)
    const entry = memory.read(scope).entries[0]!
    await memory.forget({ personaId: 'ranger', id: entry.id })
    const restarted = new CompanionMemoryRepository(path, { growth: suggestedMemoryGrowthRules })
    await restarted.load()
    await restarted.setActivePersona('ranger')
    await restarted.observe(current)
    expect(restarted.read(scope).entries).toHaveLength(0)
    expect(restarted.read(scope).relationship.points).toBe(10)
  })

  it('retains one hundred ordinary entries per card while preserving preferences and explicit equipment collections', async () => {
    await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'Exploration.' })
    const collected = await memory.remember({ personaId: 'ranger', kind: 'experience', text: 'An important trip.', collected: true })
    const gear = await memory.collectEquipment({ personaId: 'ranger', character, record: equipment() })
    await Promise.all(Array.from({ length: 101 }, (_, index) => memory.remember({ personaId: 'ranger', character, kind: 'experience', text: `Trip ${index}` })))
    await memory.remember({ personaId: 'mage', kind: 'experience', text: 'Another card.' })
    const entries = memory.read(scope).entries
    expect(entries.filter(entry => entry.kind !== 'preference' && !entry.collected)).toHaveLength(100)
    expect(entries.some(entry => entry.text === 'Trip 0')).toBe(false)
    expect(entries.some(entry => entry.text === 'Trip 100')).toBe(true)
    expect(entries.some(entry => entry.id === collected?.id)).toBe(true)
    expect(entries.some(entry => entry.id === gear.id)).toBe(true)
    expect(entries.some(entry => entry.kind === 'preference')).toBe(true)
    expect(memory.read({ personaId: 'mage' }).entries).toHaveLength(1)
    const otherCharacter = { ...character, guid: 'Player-2' }
    expect(memory.read({ personaId: 'ranger', character: otherCharacter }).entries).toHaveLength(2)
  })

  it('never automatically copies equipment observations into long-term memory', async () => {
    const records = [level(1, 10, 'baseline')]
    const initial = observation(1, records)
    if (!initial.bridge)
      throw new Error('Missing test bridge')
    initial.bridge.equipment = [equipment()]
    await memory.observe(initial)
    await memory.observe({ ...initial, bridge: { ...initial.bridge, snapshot: { ...initial.bridge.snapshot!, seq: 2, tick: 200 } } })
    expect(memory.read(scope).entries).toHaveLength(0)
    expect(memory.read(scope).relationship.points).toBe(0)
    const saved = await memory.collectEquipment({ personaId: 'ranger', character, record: equipment() })
    expect(memory.read(scope).entries[0]?.collected).toBe(true)
    expect(memory.read(scope).entries[0]?.gameSessionId).toBeNull()
    await memory.collect({ personaId: 'ranger', id: saved.id, collected: false })
    expect(memory.read(scope).entries).toHaveLength(0)
  })

  it('binds goals to real login IDs, retains them across reload, and expires them on a new game login', async () => {
    const records = [level(1, 10, 'baseline')]
    await memory.observe(observation(1, records))
    const goal = await memory.remember({ personaId: 'ranger', character, kind: 'session-goal', text: 'Reach the next town.', gameSessionId: 'login-1', chatSessionId: 'chat-thread-1' })
    expect(goal?.expired).toBe(false)
    await memory.observe(observation(2, records, { snapshot: { session: 'frames-2' } }))
    expect(memory.read(scope).entries[0]?.expired).toBe(false)
    await memory.observe(observation(3, records, { snapshot: { session: 'frames-3', loginId: 'login-2' } }))
    expect(memory.read(scope).entries[0]?.expired).toBe(true)
    await expect(memory.remember({ personaId: 'ranger', character, kind: 'session-goal', text: 'Stale goal.', gameSessionId: 'login-1' })).rejects.toThrow('memory-game-login-required')
    expect(memory.read(scope).relationship.points).toBe(0)
  })

  it('does not substitute a decoder session for missing login telemetry', async () => {
    const legacy = observation(1, [level(1, 10, 'baseline')])
    if (!legacy.bridge?.snapshot)
      throw new Error('Missing test snapshot')
    delete legacy.bridge.snapshot.loginId
    delete legacy.bridge.snapshot.combatEnds
    await memory.observe(legacy)
    await expect(memory.remember({ personaId: 'ranger', character, kind: 'session-goal', text: 'A goal.', gameSessionId: 'frames-1' })).rejects.toThrow('memory-game-login-required')
    const saved = CompanionMemoryRepository.validateBackup(JSON.parse(await memory.serializeBackup()))
    expect(saved.cursors[0]?.gameSessionId).toBeNull()
  })

  it('keeps the structure usable without growth rules and invalidates queued work when clearing all data', async () => {
    const disabled = new CompanionMemoryRepository(join(directory, 'disabled.json'))
    await disabled.setActivePersona('ranger')
    const records = [level(1, 10, 'baseline')]
    await disabled.observe(observation(1, records))
    records.push(level(2, 11))
    await disabled.observe(observation(2, records))
    expect(disabled.read(scope).entries).toHaveLength(1)
    expect(disabled.read(scope).relationship.points).toBe(0)
    const pending = disabled.remember({ personaId: 'ranger', kind: 'preference', text: 'An old queued write.' })
    const cleared = disabled.clear()
    const results = await Promise.allSettled([pending, cleared])
    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('fulfilled')
    const archive = CompanionMemoryRepository.validateBackup(JSON.parse(await disabled.serializeBackup()))
    expect(archive.entries).toHaveLength(0)
    expect(archive.relationships).toHaveLength(0)
    expect(archive.seenSources).toHaveLength(0)
    expect(archive.cursors).toHaveLength(0)
    expect(archive.rewards).toHaveLength(0)
  })

  it('preserves corrupt files and reports a real write failure without producing a partial backup', async () => {
    const corruptPath = join(directory, 'corrupt.json')
    await writeFile(corruptPath, '{broken', 'utf8')
    const corrupt = new CompanionMemoryRepository(corruptPath)
    await corrupt.load()
    await expect(corrupt.remember({ personaId: 'ranger', kind: 'preference', text: 'No overwrite.' })).rejects.toThrow('memory-storage-blocked')
    expect(await readFile(corruptPath, 'utf8')).toBe('{broken')
    expect(corrupt.read(scope).storageError).not.toBeNull()
    const collisionPath = join(directory, 'collision.json')
    const collision = new CompanionMemoryRepository(collisionPath)
    await collision.load()
    await mkdir(collisionPath)
    await expect(collision.remember({ personaId: 'ranger', kind: 'preference', text: 'Retry after fixing storage.' })).rejects.toThrow('memory-write-failed')
    await expect(collision.serializeBackup()).rejects.toThrow('memory-backup-unavailable')
  })

  it('preserves the previous durable snapshot when atomic replacement fails and retries all pending facts', async () => {
    await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'Previously saved.' })
    const previous = await readFile(path, 'utf8')
    vi.mocked(rename).mockRejectedValueOnce(new Error('Replacement temporarily unavailable'))
    await expect(memory.remember({ personaId: 'ranger', kind: 'preference', text: 'Keep the pending change.' })).rejects.toThrow('memory-write-failed')
    expect(await readFile(path, 'utf8')).toBe(previous)
    expect(memory.read(scope).storageError).not.toBeNull()
    const recovered = CompanionMemoryRepository.validateBackup(JSON.parse(await memory.serializeBackup()))
    expect(recovered.entries.map(entry => entry.text)).toEqual(['Previously saved.', 'Keep the pending change.'])
    expect(memory.read(scope).storageError).toBeNull()
  })

  it('rejects edits of witnessed and collected game facts without changing their records or saved bytes', async () => {
    const records = [level(1, 10, 'baseline')]
    await memory.observe(observation(1, records))
    records.push(level(2, 11))
    await memory.observe(observation(2, records))
    const upgrade = memory.read(scope).entries[0]!
    const collected = await memory.collectEquipment({ personaId: 'ranger', character, record: equipment(), text: 'Kept for its appearance.' })
    const before = await memory.serializeBackup()
    expect(await memory.edit({ personaId: 'ranger', id: upgrade.id, text: 'I reached level 255.' })).toBe(false)
    expect(await memory.edit({ personaId: 'ranger', id: collected.id, text: 'A different item.' })).toBe(false)
    const after = memory.read(scope).entries
    expect(after.find(entry => entry.id === upgrade.id)).toEqual(upgrade)
    expect(after.find(entry => entry.id === collected.id)).toEqual(collected)
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  it('rejects whitespace-only text before it changes memory data or consumes source receipts', async () => {
    const original = await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'Keep this preference.' })
    if (!original)
      throw new Error('Preference was not saved')
    const before = await memory.serializeBackup()
    for (const [index, text] of ['   ', '\n\t', '\u3000'].entries()) {
      expect(() => memory.remember({ personaId: 'ranger', kind: 'preference', text, sourceId: `blank-${index}` })).toThrow()
      expect(() => memory.edit({ personaId: 'ranger', id: original.id, text })).toThrow()
    }
    expect(memory.read(scope).entries).toEqual([original])
    expect(await readFile(path, 'utf8')).toBe(before)
    expect(await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'A valid retry.', sourceId: 'blank-0' })).toBeDefined()
  })

  it('deduplicates normalized preferences and keeps both source aliases forgotten across a restart', async () => {
    const first = { personaId: 'ranger', kind: 'preference' as const, text: 'ＱＵＩＥＴ　ＤＵＲＩＮＧ　ＲＡＩＤＳ', sourceId: 'preference-original' }
    const alias = { ...first, text: 'quiet \t during \n raids', sourceId: 'preference-alias' }
    const saved = await memory.remember(first)
    const duplicate = await memory.remember(alias)
    expect(saved).toBeDefined()
    expect(duplicate?.id).toBe(saved?.id)
    expect(memory.read(scope).entries).toHaveLength(1)
    if (!saved)
      throw new Error('Preference was not saved')
    await memory.forget({ personaId: 'ranger', id: saved.id })
    const restarted = new CompanionMemoryRepository(path)
    await restarted.load()
    expect(await restarted.remember(first)).toBeUndefined()
    expect(await restarted.remember(alias)).toBeUndefined()
    expect(restarted.read(scope).entries).toHaveLength(0)
  })

  it('deduplicates a goal for the same login and expires only that character previous goal when its goal changes', async () => {
    const records = [level(1, 10, 'baseline')]
    const otherCharacter = { ...character, guid: 'Player-2' }
    const otherObservation = observation(1, records, { snapshot: { guid: otherCharacter.guid, loginId: 'login-other' } })
    if (otherObservation.levels)
      otherObservation.levels.characters = otherObservation.levels.characters.map(row => ({ ...row, guid: otherCharacter.guid }))
    await memory.observe(otherObservation)
    const otherGoal = await memory.remember({ personaId: 'ranger', character: otherCharacter, kind: 'session-goal', text: 'Explore the forest.', gameSessionId: 'login-other', sourceId: 'other-goal' })
    await memory.observe(observation(1, records))
    const original = await memory.remember({ personaId: 'ranger', character, kind: 'session-goal', text: 'Reach the town.', gameSessionId: 'login-1', sourceId: 'goal-original' })
    const duplicate = await memory.remember({ personaId: 'ranger', character, kind: 'session-goal', text: 'REACH  THE TOWN.', gameSessionId: 'login-1', sourceId: 'goal-alias' })
    expect(duplicate?.id).toBe(original?.id)
    expect(memory.read(scope).entries).toHaveLength(1)
    const current = await memory.remember({ personaId: 'ranger', character, kind: 'session-goal', text: 'Collect some herbs.', gameSessionId: 'login-1', sourceId: 'goal-current' })
    const all = memory.read({ personaId: 'ranger' }).entries
    expect(all.find(entry => entry.id === original?.id)?.expired).toBe(true)
    expect(all.find(entry => entry.id === current?.id)?.expired).toBe(false)
    expect(all.find(entry => entry.id === otherGoal?.id)?.expired).toBe(false)
    expect(all).toHaveLength(3)
    expect(memory.read(scope).relationship.points).toBe(0)
  })

  it('keeps separate user experiences across messages instead of promoting or merging them as lasting preferences', async () => {
    const first = await memory.remember({ personaId: 'ranger', character, kind: 'experience', text: 'This armor took a long time to find.', sourceId: 'experience-1' })
    const second = await memory.remember({ personaId: 'ranger', character, kind: 'experience', text: 'This armor took a long time to find.', sourceId: 'experience-2' })
    expect(first?.id).not.toBe(second?.id)
    const entries = memory.read(scope).entries
    expect(entries).toHaveLength(2)
    expect(entries.every(entry => entry.kind === 'experience' && !entry.collected && entry.fact === null)).toBe(true)
    expect(memory.read(scope).relationship.points).toBe(0)
  })

  it('does not revive a pruned goal through either source alias or replace the current goal during replay', async () => {
    await memory.observe(observation(1, [level(1, 10, 'baseline')]))
    const first = { personaId: 'ranger', character, kind: 'session-goal' as const, text: 'An early goal.', gameSessionId: 'login-1', sourceId: 'early-original' }
    const alias = { ...first, sourceId: 'early-alias' }
    await memory.remember(first)
    await memory.remember(alias)
    await Promise.all(Array.from({ length: 100 }, (_, index) => memory.remember({ ...first, text: `Goal ${index}`, sourceId: `goal-${index}` })))
    expect(memory.read(scope).entries).toHaveLength(100)
    expect(memory.read(scope).entries.some(entry => entry.text === first.text)).toBe(false)
    const restarted = new CompanionMemoryRepository(path)
    await restarted.load()
    expect(await restarted.remember(first)).toBeUndefined()
    expect(await restarted.remember(alias)).toBeUndefined()
    expect(restarted.read(scope).entries).toHaveLength(100)
    expect(restarted.read(scope).entries.filter(entry => !entry.expired).map(entry => entry.text)).toEqual(['Goal 99'])
  })

  it('uses the default capacity for original version 1 archives and persists a persona limit without deleting memories', async () => {
    await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'Keep this preference.' })
    const original = JSON.parse(await readFile(path, 'utf8'))
    expect(original.capacities).toBeUndefined()
    expect(original.noticeReceipts).toBeUndefined()
    const restarted = new CompanionMemoryRepository(path)
    await restarted.load()
    expect(restarted.read(scope).capacity).toEqual({ limit: 1000, used: 1, full: false })
    await restarted.setLimit({ personaId: 'ranger', limit: 2000 })
    const updated = new CompanionMemoryRepository(path)
    await updated.load()
    expect(updated.read(scope).capacity).toEqual({ limit: 2000, used: 1, full: false })
    expect(updated.read(scope).entries[0]?.text).toBe('Keep this preference.')
    expect(updated.read({ personaId: 'another-card' }).capacity).toEqual({ limit: 1000, used: 0, full: false })
    for (const limit of [0, 99, 100.5, 100_001, Number.NaN])
      expect(() => updated.setLimit({ personaId: 'ranger', limit })).toThrow()
    expect(updated.read(scope).capacity?.limit).toBe(2000)
  })

  it('refuses only new long-term entries when full and preserves deduplication, editing and retry after expansion', async () => {
    await memory.setLimit({ personaId: 'ranger', limit: 100 })
    const first = await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'Preference 0', sourceId: 'original' })
    if (!first)
      throw new Error('Preference was not saved')
    await Promise.all(Array.from({ length: 99 }, (_, index) => memory.remember({ personaId: 'ranger', kind: 'preference', text: `Preference ${index + 1}` })))
    const before = await memory.serializeBackup()
    expect(memory.read(scope).capacity).toEqual({ limit: 100, used: 100, full: true })
    await expect(memory.remember({ personaId: 'ranger', kind: 'preference', text: 'Overflow preference.', sourceId: 'retry-after-expansion' })).rejects.toThrow('memory-capacity-full')
    expect(await readFile(path, 'utf8')).toBe(before)
    expect((await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'PREFERENCE 0', sourceId: 'alias-at-capacity' }))?.id).toBe(first.id)
    expect(await memory.edit({ personaId: 'ranger', id: first.id, text: 'An edited preference.' })).toBe(true)
    expect(await memory.collect({ personaId: 'ranger', id: first.id, collected: true })).toBe(true)
    await memory.remember({ personaId: 'ranger', character, kind: 'experience', text: 'An ordinary experience still fits.' })
    expect(memory.read(scope).entries).toHaveLength(101)
    await memory.setLimit({ personaId: 'ranger', limit: 101 })
    expect(await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'Overflow preference.', sourceId: 'retry-after-expansion' })).toBeDefined()
    expect(memory.read(scope).capacity).toEqual({ limit: 101, used: 101, full: true })
    expect(memory.read(scope).storageError).toBeNull()
  })

  it('counts collections once and across a persona characters while protecting existing entries after a limit reduction', async () => {
    await Promise.all(Array.from({ length: 100 }, (_, index) => memory.remember({ personaId: 'ranger', kind: 'preference', text: `Preference ${index}` })))
    const ordinary = await memory.remember({ personaId: 'ranger', character, kind: 'experience', text: 'An ordinary battle.' })
    if (!ordinary)
      throw new Error('Experience was not saved')
    const collected = await memory.collectEquipment({ personaId: 'ranger', character, record: equipment(), text: 'Keep this equipment.' })
    await memory.setLimit({ personaId: 'ranger', limit: 100 })
    expect(memory.read({ personaId: 'ranger', character: { ...character, guid: 'another-character' } }).capacity).toEqual({ limit: 100, used: 101, full: true })
    expect(memory.read(scope).entries).toHaveLength(102)
    await expect(memory.collect({ personaId: 'ranger', id: ordinary.id, collected: true })).rejects.toThrow('memory-capacity-full')
    await expect(memory.collectEquipment({ personaId: 'ranger', character, record: { ...equipment(), id: 2 }, text: 'Another item.' })).rejects.toThrow('memory-capacity-full')
    expect((await memory.collectEquipment({ personaId: 'ranger', character, record: equipment(), text: 'Duplicate item.' })).id).toBe(collected.id)
    expect(memory.read(scope).entries.find(entry => entry.id === ordinary.id)?.collected).toBe(false)
    expect(await memory.collect({ personaId: 'ranger', id: collected.id, collected: false })).toBe(true)
    expect(memory.read(scope).capacity?.used).toBe(100)
    const preference = memory.read(scope).entries.find(entry => entry.kind === 'preference')!
    expect(await memory.forget({ personaId: 'ranger', id: preference.id })).toBe(true)
    expect(await memory.collect({ personaId: 'ranger', id: ordinary.id, collected: true })).toBe(true)
    expect(memory.read(scope).capacity?.used).toBe(100)
    expect(await memory.remember({ personaId: 'another-card', kind: 'preference', text: 'An independent preference.' })).toBeDefined()
    expect(memory.read({ personaId: 'another-card' }).capacity?.used).toBe(1)
  })

  it('claims each notice once per local day across simultaneous windows, process restarts and clock rollback', async () => {
    const request = { personaId: 'ranger', kind: 'context-limited' as const }
    expect(await Promise.all([memory.claimNotice(request), memory.claimNotice(request)])).toEqual([true, false])
    expect(await memory.claimNotice({ ...request, kind: 'capacity-full' })).toBe(false)
    const restarted = new CompanionMemoryRepository(path)
    await restarted.load()
    expect(await restarted.claimNotice(request)).toBe(false)
    expect(await restarted.claimNotice({ ...request, personaId: 'another-card' })).toBe(true)
    vi.setSystemTime(new Date('2026-11-03T04:00:00Z'))
    expect(await restarted.claimNotice(request)).toBe(true)
    vi.setSystemTime(new Date('2026-11-02T04:00:00Z'))
    expect(await restarted.claimNotice(request)).toBe(false)
    const backup = CompanionMemoryRepository.validateBackup(JSON.parse(await restarted.serializeBackup()))
    expect(backup.noticeReceipts).toHaveLength(2)
  })

  it('requires actual full capacity for a capacity notice and permits it once independently from the context notice', async () => {
    await memory.setLimit({ personaId: 'ranger', limit: 100 })
    await Promise.all(Array.from({ length: 100 }, (_, index) => memory.remember({ personaId: 'ranger', kind: 'preference', text: `Preference ${index}` })))
    expect(await memory.claimNotice({ personaId: 'ranger', kind: 'context-limited' })).toBe(true)
    expect(await memory.claimNotice({ personaId: 'ranger', kind: 'capacity-full' })).toBe(true)
    expect(await memory.claimNotice({ personaId: 'ranger', kind: 'capacity-full' })).toBe(false)
    await memory.setLimit({ personaId: 'ranger', limit: 200 })
    vi.setSystemTime(new Date('2026-11-03T04:00:00Z'))
    expect(await memory.claimNotice({ personaId: 'ranger', kind: 'capacity-full' })).toBe(false)
  })

  it('grants no notice on a failed atomic write and retries after storage recovery', async () => {
    await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'A durable preference.' })
    const previous = await readFile(path, 'utf8')
    const request = { personaId: 'ranger', kind: 'context-limited' as const }
    vi.mocked(rename).mockRejectedValueOnce(new Error('Replacement temporarily unavailable'))
    await expect(memory.claimNotice(request)).rejects.toThrow('memory-write-failed')
    expect(await readFile(path, 'utf8')).toBe(previous)
    expect(await memory.claimNotice(request)).toBe(true)
    expect(await memory.claimNotice(request)).toBe(false)
    expect(memory.read(scope).storageError).toBeNull()
  })

  it('validates and backs up capacity policy and notice receipts, then resets both with all data', async () => {
    await memory.setLimit({ personaId: 'ranger', limit: 200 })
    await memory.claimNotice({ personaId: 'ranger', kind: 'context-limited' })
    const backup = CompanionMemoryRepository.validateBackup(JSON.parse(await memory.serializeBackup()))
    expect(backup.capacities).toEqual([{ personaId: 'ranger', limit: 200 }])
    expect(backup.noticeReceipts?.[0]?.kind).toBe('context-limited')
    expect(() => CompanionMemoryRepository.validateBackup({ ...backup, capacities: [{ personaId: 'ranger', limit: 0 }] })).toThrow()
    expect(() => CompanionMemoryRepository.validateBackup({ ...backup, capacities: [...backup.capacities!, ...backup.capacities!] })).toThrow()
    expect(() => CompanionMemoryRepository.validateBackup({ ...backup, noticeReceipts: [...backup.noticeReceipts!, ...backup.noticeReceipts!] })).toThrow()
    await memory.clear()
    expect(memory.read(scope).capacity).toEqual({ limit: 1000, used: 0, full: false })
    expect(await memory.claimNotice({ personaId: 'ranger', kind: 'context-limited' })).toBe(true)
    const empty = CompanionMemoryRepository.validateBackup(JSON.parse(await memory.serializeBackup()))
    expect(empty.capacities).toBeUndefined()
    expect(empty.entries).toHaveLength(0)
  })
})
