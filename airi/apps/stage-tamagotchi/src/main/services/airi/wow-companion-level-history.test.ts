import type { BridgeStatus, Snapshot } from '../../../shared/wow-companion'

import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CompanionLevelHistory } from './wow-companion-level-history'

function live(snapshot: Partial<Snapshot> = {}, bridge: Partial<BridgeStatus> = {}): BridgeStatus {
  return {
    instanceId: 'bridge-1',
    status: 'live',
    source: 'screen',
    snapshot: {
      v: 3,
      session: 'session-1',
      seq: 1,
      tick: 1,
      guid: 'Player-1',
      name: 'Mage',
      realm: 'Silvermoon',
      level: 30,
      class: 'MAGE',
      faction: 'Horde',
      race: 'Undead',
      spec: 1,
      map: 1,
      zone: 'Town',
      combat: false,
      dead: false,
      online: true,
      account: 'account-1',
      moneyEpoch: 'epoch-1',
      copper: null,
      earned: 0,
      spent: 0,
      ...snapshot,
    },
    lastSeen: new Date().toISOString(),
    ageSeconds: 0,
    eventCursor: 0,
    events: [],
    equipmentComparisons: [],
    equipmentComparisonError: null,
    equipmentLoadout: null,
    equipmentLoadoutError: null,
    config: { x: 0, y: 0, cellSize: 2, pollMs: 750, paused: false },
    error: null,
    ...bridge,
  }
}

describe('companion level history', () => {
  const start = Date.UTC(2026, 9, 25, 0)
  let directory: string
  let path: string
  let history: CompanionLevelHistory
  let cursor: number

  async function sample(level: number, offset: number, snapshot: Partial<Snapshot> = {}, bridge: Partial<BridgeStatus> = {}) {
    vi.setSystemTime(start + offset)
    cursor += 1
    await history.observe(live({ level, seq: cursor, tick: cursor, ...snapshot }, bridge))
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(start)
    directory = await mkdtemp(join(tmpdir(), 'airi-wow-levels-'))
    path = join(directory, 'levels.json')
    history = new CompanionLevelHistory(path)
    cursor = 0
    await history.load()
  })

  afterEach(async () => {
    vi.useRealTimers()
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir(), 'airi-wow-levels-')))
      throw new Error('Refusing to remove a directory outside the level history test prefix')
    await rm(target, { recursive: true, force: true })
  })

  it('starts with the first observed level without inventing earlier upgrades', async () => {
    await sample(30, 0)
    expect(history.read().characters[0]).toMatchObject({ account: 'account-1', guid: 'Player-1', currentLevel: 30, firstSeen: start, lastSeen: start })
    expect(history.read().characters[0]?.records).toEqual([
      { id: 1, fromLevel: null, level: 30, recordedAt: start, source: 'baseline', durationMs: null, durationBasis: 'unknown' },
    ])
    const saved = new CompanionLevelHistory(path)
    await saved.load()
    expect(saved.read()).toEqual(history.read())
  })

  it('marks the initial interval partial and measures subsequent consecutive upgrades', async () => {
    await sample(30, 0)
    await sample(31, 2000)
    await sample(32, 5000)
    expect(history.read().characters[0]?.records[1]).toMatchObject({ fromLevel: 30, level: 31, recordedAt: start + 2000, source: 'live', durationMs: 2000, durationBasis: 'partial' })
    expect(history.read().characters[0]?.records[2]).toMatchObject({ fromLevel: 31, level: 32, recordedAt: start + 5000, source: 'live', durationMs: 3000, durationBasis: 'complete' })
  })

  it('includes two offline days and a desktop restart when the returning level is unchanged', async () => {
    await sample(30, 0)
    await sample(31, 1000)
    await history.observe(null)
    await history.flush()
    history = new CompanionLevelHistory(path)
    await history.load()
    const twoDays = 2 * 24 * 60 * 60 * 1000
    await sample(31, twoDays, { session: 'session-2' }, { instanceId: 'bridge-2' })
    await sample(32, twoDays + 1000, { session: 'session-2' }, { instanceId: 'bridge-2' })
    expect(history.read().characters[0]?.records).toHaveLength(3)
    expect(history.read().characters[0]?.records[2]).toMatchObject({ source: 'live', durationMs: twoDays, durationBasis: 'complete' })
  })

  it('records a changed level on desktop restart as a gap instead of an exact upgrade', async () => {
    await sample(30, 0)
    history = new CompanionLevelHistory(path)
    await history.load()
    await sample(31, 1000)
    await sample(32, 2000)
    expect(history.read().characters[0]?.records[1]).toMatchObject({ source: 'gap', recordedAt: start + 1000, durationMs: null, durationBasis: 'unknown' })
    expect(history.read().characters[0]?.records[2]).toMatchObject({ source: 'live', durationMs: 1000, durationBasis: 'partial' })
  })

  it('does not split skipped levels into invented per-level times', async () => {
    await sample(30, 0)
    await sample(34, 1000)
    await sample(35, 2000)
    expect(history.read().characters[0]?.records.map(record => record.level)).toEqual([30, 34, 35])
    expect(history.read().characters[0]?.records[1]).toMatchObject({ fromLevel: 30, source: 'gap', durationMs: null, durationBasis: 'unknown' })
    expect(history.read().characters[0]?.records[2]).toMatchObject({ source: 'live', durationMs: 1000, durationBasis: 'partial' })
  })

  it('ignores duplicate polls without losing normal heartbeat continuity', async () => {
    await sample(30, 0)
    vi.setSystemTime(start + 750)
    await history.observe(live())
    await sample(31, 1000)
    expect(history.read().characters[0]?.records).toHaveLength(2)
    expect(history.read().characters[0]?.records[1]).toMatchObject({ source: 'live', durationMs: 1000 })
  })

  it('does not let repeated frames extend the five-second continuity window', async () => {
    await sample(30, 0)
    for (let second = 1; second <= 6; second++) {
      vi.setSystemTime(start + second * 1000)
      await history.observe(live())
    }
    await sample(31, 7000)
    expect(history.read().characters[0]?.records[1]).toMatchObject({ source: 'gap', durationMs: null })
  })

  it('rejects older cursors and replay of retired sessions without changing the character', async () => {
    await sample(30, 0, { seq: 10, tick: 10 })
    await sample(31, 1000, { seq: 11, tick: 11 })
    await sample(30, 2000, { seq: 9, tick: 9 })
    await sample(31, 3000, { session: 'session-2', seq: 1, tick: 1 })
    await sample(99, 3500, { seq: 100, tick: 100 })
    await sample(32, 4000, { session: 'session-2', seq: 2, tick: 2 })
    expect(history.read().characters[0]?.records.map(record => record.level)).toEqual([30, 31, 32])
    expect(history.read().characters[0]?.records[2]).toMatchObject({ source: 'live', durationMs: 3000, durationBasis: 'complete' })
    expect(history.read().characters[0]?.currentLevel).toBe(32)
  })

  it('separates accounts and GUIDs even when their display names match', async () => {
    await sample(30, 0)
    await sample(40, 1000, { account: 'account-2' })
    await sample(50, 2000, { guid: 'Player-2' })
    await sample(30, 3000, { name: 'Renamed', realm: 'Other realm' })
    expect(history.read().characters).toHaveLength(3)
    expect(history.read().characters[0]).toMatchObject({ account: 'account-1', guid: 'Player-1', name: 'Renamed', realm: 'Other realm', currentLevel: 30 })
    expect(history.read().characters[1]).toMatchObject({ account: 'account-2', guid: 'Player-1', currentLevel: 40 })
    expect(history.read().characters[2]).toMatchObject({ account: 'account-1', guid: 'Player-2', currentLevel: 50 })
    expect(history.read().characters[0]?.records).toHaveLength(1)
  })

  it('persists a new same-level session before shutdown and rejects the retired session after restart', async () => {
    await sample(30, 0)
    await sample(30, 1000, { session: 'session-2', seq: 1, tick: 1 })
    history = new CompanionLevelHistory(path)
    await history.load()
    await sample(31, 2000, { session: 'session-1', seq: 50, tick: 50 })
    expect(history.read().characters[0]?.currentLevel).toBe(30)
    expect(history.read().characters[0]?.records).toHaveLength(1)
    expect(history.read().characters[0]?.lastSeen).toBe(start + 1000)
  })

  it('counts time spent on another character after observing the original level again', async () => {
    await sample(30, 0)
    await sample(31, 1000)
    await sample(10, 2000, { guid: 'Player-2' })
    await sample(31, 60_000)
    await sample(32, 61_000)
    expect(history.read().characters[0]?.records[2]).toMatchObject({ source: 'live', durationMs: 60_000, durationBasis: 'complete' })
    expect(history.read().characters[1]?.records).toHaveLength(1)
  })

  it('marks an unobserved upgrade during character changes or session changes as a gap', async () => {
    await sample(30, 0)
    await sample(20, 1000, { guid: 'Player-2' })
    await sample(31, 2000)
    await sample(32, 3000, { session: 'session-2' })
    expect(history.read().characters[0]?.records.slice(1).map(record => record.source)).toEqual(['gap', 'gap'])
    expect(history.read().characters[0]?.records.slice(1).map(record => record.durationMs)).toEqual([null, null])
  })

  it.each(['demo', 'stale', 'waiting', 'paused'] as const)('ignores %s observations and breaks continuity', async (status) => {
    await sample(30, 0)
    await sample(31, 1000, {}, { status })
    await sample(32, 2000)
    expect(history.read().characters[0]?.records.map(record => record.level)).toEqual([30, 32])
    expect(history.read().characters[0]?.records[1]?.source).toBe('gap')
  })

  it('ignores offline, invalid, demo, expired, and failed observations without requiring a gold balance', async () => {
    await history.observe(live({ online: false }))
    await history.observe(live({ level: 0 }))
    await history.observe(live({ level: 1.5 }))
    await history.observe(live({ guid: '' }))
    await history.observe(live({}, { source: 'demo' }))
    await history.observe(live({}, { ageSeconds: 6 }))
    await history.observe(live({}, { ageSeconds: null }))
    await history.observe(live({}, { error: 'Bad capture' }))
    await history.observe(live(), 'Connection failed')
    expect(history.read().characters).toEqual([])
    await sample(30, 1000)
    expect(history.read().characters).toHaveLength(1)
  })

  it('records decreases and starts a partial interval at the new observed level', async () => {
    await sample(80, 0)
    await sample(40, 1000)
    await sample(41, 2000)
    expect(history.read().characters[0]?.records[1]).toMatchObject({ fromLevel: 80, level: 40, source: 'decrease', durationMs: null, durationBasis: 'unknown' })
    expect(history.read().characters[0]?.records[2]).toMatchObject({ source: 'live', durationMs: 1000, durationBasis: 'partial' })
  })

  it('persists a clock rollback at the same level and excludes the next interval', async () => {
    await sample(30, 10_000)
    await sample(31, 11_000)
    await sample(31, 5000)
    history = new CompanionLevelHistory(path)
    await history.load()
    await sample(31, 6000)
    await sample(32, 12_000)
    expect(history.read().characters[0]?.records[2]).toMatchObject({ source: 'clock-change', durationMs: null, durationBasis: 'unknown' })
    expect(history.read().characters[0]?.records).toHaveLength(3)
  })

  it('never emits a negative duration after the local clock moves backward', async () => {
    await sample(30, 10_000)
    await sample(31, 9000)
    await sample(32, 10_000)
    await sample(33, 11_000)
    expect(history.read().characters[0]?.records[1]).toMatchObject({ recordedAt: start + 9000, source: 'clock-change', durationMs: null })
    expect(history.read().characters[0]?.records[2]).toMatchObject({ source: 'live', durationMs: 1000, durationBasis: 'partial' })
    expect(history.read().characters[0]?.records[3]).toMatchObject({ source: 'live', durationMs: 1000, durationBasis: 'complete' })
    const saved = new CompanionLevelHistory(path)
    await saved.load()
    expect(saved.read()).toEqual(history.read())
  })

  it('remembers a clock rollback even when the bridge repeats the same frame', async () => {
    await sample(30, 10_000)
    vi.setSystemTime(start + 5000)
    await history.observe(live())
    await sample(31, 6000)
    expect(history.read().characters[0]?.records[1]).toMatchObject({ source: 'clock-change', durationMs: null, durationBasis: 'unknown' })
  })

  it('does not trim level records to the equipment history limit', async () => {
    for (let level = 1; level <= 20; level++)
      await sample(level, level * 1000)
    const saved = new CompanionLevelHistory(path)
    await saved.load()
    expect(saved.read().characters[0]?.records).toHaveLength(20)
    expect(saved.read().characters[0]?.records[0]?.level).toBe(1)
    expect(saved.read().characters[0]?.records[19]).toMatchObject({ level: 20, durationBasis: 'complete' })
  })

  it('does not expose mutable saved records through read', async () => {
    await sample(30, 0)
    const output = history.read()
    output.characters[0]!.name = 'Altered'
    output.characters[0]!.records[0]!.level = 99
    output.characters.length = 0
    expect(history.read().characters[0]?.name).toBe('Mage')
    expect(history.read().characters[0]?.records[0]?.level).toBe(30)
  })

  it('preserves corrupt files and stops mutations', async () => {
    const original = '{broken history'
    await writeFile(path, original, 'utf8')
    history = new CompanionLevelHistory(path)
    await history.load()
    await sample(31, 0)
    await history.flush()
    expect(history.read().characters).toEqual([])
    expect(history.read().storageError).toContain('Cannot load WoW level history')
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('rejects stored records whose duration disagrees with their timestamps', async () => {
    await sample(30, 0)
    await sample(31, 1000)
    const original = await readFile(path, 'utf8')
    const corrupt = original.replace('"durationMs":1000', '"durationMs":9999')
    await writeFile(path, corrupt, 'utf8')
    history = new CompanionLevelHistory(path)
    await history.load()
    await sample(32, 2000)
    expect(history.read().storageError).toContain('Cannot load WoW level history')
    expect(await readFile(path, 'utf8')).toBe(corrupt)
  })

  it('rejects saved timestamps outside the JavaScript Date range without replacing the file', async () => {
    await sample(30, 0)
    const original = await readFile(path, 'utf8')
    const corrupt = original.replaceAll(String(start), String(Number.MAX_SAFE_INTEGER))
    await writeFile(path, corrupt, 'utf8')
    history = new CompanionLevelHistory(path)
    await history.load()
    await sample(31, 1000)
    expect(history.read().characters).toEqual([])
    expect(history.read().storageError).toContain('Cannot load WoW level history')
    expect(await readFile(path, 'utf8')).toBe(corrupt)
  })

  it('retries failed writes while disconnected and cleans temporary files', async () => {
    await mkdir(path)
    await sample(30, 0)
    await sample(31, 1000)
    expect(history.read().characters[0]?.records).toHaveLength(2)
    expect(history.read().storageError).toContain('Cannot save WoW level history')
    await rename(path, join(directory, 'blocked-destination'))
    await history.observe(null, 'Offline')
    expect(history.read().storageError).toBeNull()
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([])
    const saved = new CompanionLevelHistory(path)
    await saved.load()
    expect(saved.read().characters[0]?.records).toHaveLength(2)
  })

  it('serializes concurrent observations using their receipt times', async () => {
    await sample(30, 0)
    vi.setSystemTime(start + 1000)
    const first = history.observe(live({ level: 31, seq: 2, tick: 2 }))
    vi.setSystemTime(start + 2000)
    const second = history.observe(live({ level: 32, seq: 3, tick: 3 }))
    await Promise.all([first, second, history.flush()])
    expect(history.read().characters[0]?.records.map(record => record.recordedAt)).toEqual([start, start + 1000, start + 2000])
    expect(history.read().characters[0]?.records[2]).toMatchObject({ durationMs: 1000, durationBasis: 'complete' })
  })
})
