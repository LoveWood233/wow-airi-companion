import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadoutStateFixture } from '../../../shared/wow-companion-loadout.test-helper'
import { CompanionArchive } from './wow-companion-archive'

function state(earned = '0', spent = '0', copper = 10000, at = 100) {
  const value = loadoutStateFixture()
  value.gold.accounts = [{
    account: 'account',
    name: 'Account',
    earned,
    spent,
    net: (BigInt(earned) - BigInt(spent)).toString(),
    balance: String(copper),
    characterCount: 1,
    firstSeen: 100,
    lastSeen: at,
    characters: [{ guid: 'Player-1', name: 'Warrior', realm: 'Realm', copper, earned, spent, net: (BigInt(earned) - BigInt(spent)).toString(), firstSeen: 100, lastSeen: at }],
  }]
  return value
}

describe('fixed character archive', () => {
  let directory: string
  let path: string
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'wow-archive-'))
    path = join(directory, 'archive.json')
  })
  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })

  it('stores offline projections without storing live combat state or manufacturing past bills', async () => {
    const archive = new CompanionArchive(path, 'retail')
    const value = state('500', '200')
    await archive.observe(value, true)
    const result = JSON.parse(await readFile(path, 'utf8'))
    expect(result.goldTotals.balanceCopper).toBe('10000')
    expect(result.goldTotals.spentCopper).toBe('200')
    expect(result.equipmentLoadouts).toEqual(value.equipmentLoadouts)
    expect(result.levelHistory).toEqual(value.levelHistory)
    expect(result.goldJournal).toEqual([])
    expect(result.bridge).toBeUndefined()
  })

  it('journals both income and spending even when the balance is unchanged, then deduplicates after restart', async () => {
    const archive = new CompanionArchive(path, 'retail')
    await archive.observe(state(), true)
    await archive.observe(state('50', '50', 10000, 200), true)
    const restarted = new CompanionArchive(path, 'retail')
    await restarted.observe(state('50', '50', 10000, 200), true)
    const result = JSON.parse(await readFile(path, 'utf8'))
    expect(result.goldJournal).toHaveLength(1)
    expect(result.goldJournal[0]).toMatchObject({ incomeCopper: '50', expenseCopper: '50', fromObservedAt: 100, toObservedAt: 200, occurredAt: null, reason: null })
  })

  it('preserves exact large totals and marks counter resets without inventing negative expenses', async () => {
    const archive = new CompanionArchive(path, 'retail')
    await archive.observe(state('9007199254740993123', '500'), true)
    await archive.observe(state('9007199254740993124', '550', 9950, 200), true)
    let result = JSON.parse(await readFile(path, 'utf8'))
    expect(result.goldJournal[0].incomeCopper).toBe('1')
    expect(result.goldTotals.earnedCopper).toBe('9007199254740993124')
    await archive.observe(state('0', '0', 9950, 300), true)
    result = JSON.parse(await readFile(path, 'utf8'))
    expect(result.goldJournal[1]).toMatchObject({ kind: 'counter-reset', incomeCopper: null, expenseCopper: null })
  })

  it('throttles disk output and flushes the latest pending change', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(10000)
    const archive = new CompanionArchive(path, 'retail')
    await archive.observe(state())
    await archive.observe(state('0', '100', 9900, 200))
    expect(JSON.parse(await readFile(path, 'utf8')).goldJournal).toHaveLength(0)
    await archive.flush()
    expect(JSON.parse(await readFile(path, 'utf8')).goldJournal).toHaveLength(1)
  })

  it('preserves corrupt files and isolates game profiles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await writeFile(path, '{broken')
    await new CompanionArchive(path, 'retail').observe(state(), true)
    expect(await readFile(path, 'utf8')).toBe('{broken')
    const forever = join(directory, 'forever.json')
    const archive = new CompanionArchive(forever, 'forever')
    await archive.observe({ ...state(), game: 'forever' }, true)
    await archive.observe(state('100', '100'), true)
    expect(JSON.parse(await readFile(forever, 'utf8')).goldJournal).toHaveLength(0)
  })

  it('ignores failed source stores when updating journal checkpoints', async () => {
    const archive = new CompanionArchive(path, 'retail')
    await archive.observe(state(), true)
    const failed = state('0', '100', 9900, 200)
    failed.gold.storageError = 'unreadable'
    await archive.observe(failed, true)
    const result = JSON.parse(await readFile(path, 'utf8'))
    expect(result.goldJournal).toHaveLength(0)
    expect(result.checkpoints[0].copper).toBe(10000)
  })
})
