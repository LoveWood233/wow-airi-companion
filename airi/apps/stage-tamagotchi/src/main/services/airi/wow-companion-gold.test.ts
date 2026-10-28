import type { BridgeStatus, Snapshot } from '../../../shared/wow-companion'

import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { safeParse } from 'valibot'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { snapshotSchema } from '../../../shared/wow-companion'
import { CompanionGoldLedger } from './wow-companion-gold'

function live(snapshot: Partial<Snapshot> = {}, bridge: Partial<BridgeStatus> = {}): BridgeStatus {
  return {
    instanceId: 'bridge-1',
    status: 'live',
    source: 'screen',
    snapshot: {
      v: 3,
      session: 'session-1',
      seq: 1,
      tick: 100,
      guid: 'Player-1',
      name: 'Mage',
      realm: 'Silvermoon',
      level: 80,
      class: 'MAGE',
      faction: 'Alliance',
      race: 'Human',
      spec: 1,
      map: 1,
      zone: 'Town',
      combat: false,
      dead: false,
      online: true,
      account: 'account-1',
      moneyEpoch: 'epoch-1',
      copper: 100_000,
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

describe('companion gold ledger', () => {
  let directory: string
  let path: string
  let ledger: CompanionGoldLedger

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'airi-wow-gold-'))
    path = join(directory, 'gold.json')
    ledger = new CompanionGoldLedger(path)
    await ledger.load()
  })

  afterEach(async () => {
    const target = resolve(directory)
    if (!target.startsWith(resolve(tmpdir(), 'airi-wow-gold-')))
      throw new Error('Refusing to remove a directory outside the gold test prefix')
    await rm(target, { recursive: true, force: true })
  })

  it('keeps the initial balance separate and records both earnings and spending between polls', async () => {
    await ledger.observe(live())
    expect(ledger.read().accounts[0]).toMatchObject({ earned: '0', spent: '0', net: '0', balance: '100000' })

    await ledger.observe(live({ seq: 2, earned: 600, spent: 400, copper: 100_200 }))
    expect(ledger.read().accounts[0]).toMatchObject({ earned: '600', spent: '400', net: '200', balance: '100200' })
    expect(ledger.read().accounts[0]?.characters[0]).toMatchObject({ earned: '600', spent: '400', net: '200', copper: 100_200 })
    expect(ledger.read().storageError).toBeNull()
  })

  it('imports cumulative counters once and catches up after a disconnect and desktop restart', async () => {
    const first = live({ earned: 1200, spent: 300, copper: 900 })
    await ledger.observe(first)
    await ledger.observe(first)
    await ledger.observe(null, 'Bridge disconnected')
    await ledger.flush()

    const restarted = new CompanionGoldLedger(path)
    await restarted.load()
    expect(restarted.read().accounts[0]).toMatchObject({ earned: '1200', spent: '300' })
    await restarted.observe(first)
    await restarted.observe(live({ session: 'session-2', earned: 1800, spent: 800, copper: 1000 }, { instanceId: 'bridge-2' }))
    expect(restarted.read().accounts[0]).toMatchObject({ earned: '1800', spent: '800', net: '1000', balance: '1000' })
    expect(restarted.read().accounts[0]?.characterCount).toBe(1)
  })

  it('groups multiple characters by account and saves account labels', async () => {
    await ledger.observe(live({ earned: 1000, spent: 200, copper: 800 }))
    await ledger.observe(live({ guid: 'Player-2', name: 'Warrior', earned: 300, spent: 100, copper: 200 }))
    await ledger.observe(live({ account: 'account-2', earned: 50, spent: 10, copper: 40 }))
    await ledger.observe(live({ earned: 1000, spent: 200, copper: 800 }))
    await ledger.setAccountName({ account: 'account-1', name: '  Main account  ' })

    const restarted = new CompanionGoldLedger(path)
    await restarted.load()
    expect(restarted.read().accounts).toHaveLength(2)
    expect(restarted.read().accounts[0]).toMatchObject({ name: 'Main account', characterCount: 2, earned: '1300', spent: '300', balance: '1000' })
    expect(restarted.read().accounts[1]).toMatchObject({ account: 'account-2', characterCount: 1, earned: '50', spent: '10', balance: '40' })
    expect(restarted.read().accounts[0]?.firstSeen).toBeGreaterThan(0)
    expect(restarted.read().accounts[0]?.lastSeen).toBeGreaterThanOrEqual(restarted.read().accounts[0]?.firstSeen ?? 0)
    await restarted.setAccountName({ account: 'account-1', name: '' })
    expect(restarted.read().accounts[0]?.name).toBe('')
    await expect(restarted.setAccountName({ account: 'unknown', name: 'Other' })).rejects.toThrow('gold-account-unknown')
    expect(() => restarted.setAccountName({ account: 'account-1', name: 'a'.repeat(65) })).toThrow()
  })

  it('rejects counter rollback, older frames, and replay of a retired epoch after restart', async () => {
    await ledger.observe(live({ seq: 10, earned: 100, spent: 40, copper: 60 }))
    await ledger.observe(live({ seq: 11, earned: 90, spent: 50, copper: 40 }))
    await ledger.observe(live({ seq: 9, earned: 110, spent: 45, copper: 65 }))
    expect(ledger.read().accounts[0]).toMatchObject({ earned: '100', spent: '40', balance: '60' })

    await ledger.observe(live({ seq: 12, moneyEpoch: 'epoch-2', earned: 20, spent: 5, copper: 75 }))
    await ledger.observe(live({ seq: 13, moneyEpoch: 'epoch-1', earned: 5000, spent: 1, copper: 4999 }))
    expect(ledger.read().accounts[0]).toMatchObject({ earned: '120', spent: '45', balance: '75' })

    const restarted = new CompanionGoldLedger(path)
    await restarted.load()
    await restarted.observe(live({ session: 'old-replay', moneyEpoch: 'epoch-1', earned: 6000, spent: 5, copper: 5995 }))
    await restarted.observe(live({ session: 'session-2', moneyEpoch: 'epoch-2', earned: 30, spent: 10, copper: 80 }))
    expect(restarted.read().accounts[0]).toMatchObject({ earned: '130', spent: '50', net: '80', balance: '80' })
  })

  it.each(['demo', 'stale', 'waiting', 'paused'] as const)('does not record %s snapshots', async (status) => {
    await ledger.observe(live({ earned: 999, spent: 1 }, { status }))
    expect(ledger.read().accounts).toEqual([])
  })

  it('excludes demo sources, bridge errors, offline characters, and unknown balances', async () => {
    await ledger.observe(live({ earned: 999 }, { source: 'demo' }))
    await ledger.observe(live({ earned: 999 }, { error: 'Bad capture' }))
    await ledger.observe(live({ earned: 999 }), 'Connection failed')
    await ledger.observe(live({ earned: 999, online: false }))
    await ledger.observe(live({ earned: 999, copper: null }))
    expect(ledger.read().accounts).toEqual([])

    await ledger.observe(live({ earned: 100, spent: 20, copper: 80 }))
    await ledger.observe(live({ earned: 500, spent: 50, copper: null }))
    expect(ledger.read().accounts[0]).toMatchObject({ earned: '100', spent: '20', balance: '80' })
  })

  it('preserves exact account totals above the JavaScript safe integer limit', async () => {
    await ledger.observe(live({ copper: Number.MAX_SAFE_INTEGER, earned: Number.MAX_SAFE_INTEGER }))
    await ledger.observe(live({ guid: 'Player-2', copper: Number.MAX_SAFE_INTEGER, earned: Number.MAX_SAFE_INTEGER, spent: 1 }))
    expect(ledger.read().accounts[0]).toMatchObject({ earned: '18014398509481982', spent: '1', net: '18014398509481981', balance: '18014398509481982' })

    const restarted = new CompanionGoldLedger(path)
    await restarted.load()
    expect(restarted.read().accounts[0]?.earned).toBe('18014398509481982')
  })

  it('keeps corrupt saved data untouched and blocks observations and renames', async () => {
    const original = '{broken ledger'
    await writeFile(path, original, 'utf8')
    const broken = new CompanionGoldLedger(path)
    await broken.load()
    await broken.observe(live({ earned: 500 }))
    await broken.setAccountName({ account: 'account-1', name: 'Cannot save' })
    await broken.flush()
    expect(broken.read().accounts).toEqual([])
    expect(broken.read().storageError).toContain('gold-read')
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('shows write failures and retries retained totals and labels even while disconnected', async () => {
    await mkdir(path)
    await ledger.observe(live({ earned: 700, spent: 100, copper: 600 }))
    await ledger.setAccountName({ account: 'account-1', name: 'Main' })
    expect(ledger.read().accounts[0]).toMatchObject({ name: 'Main', earned: '700', spent: '100' })
    expect(ledger.read().storageError).toContain('gold-write')

    await rename(path, join(directory, 'blocked-destination'))
    await ledger.observe(null, 'Bridge disconnected')
    expect(ledger.read().storageError).toBeNull()
    const restarted = new CompanionGoldLedger(path)
    await restarted.load()
    expect(restarted.read().accounts[0]).toMatchObject({ name: 'Main', earned: '700', spent: '100', balance: '600' })
  })

  it('serializes concurrent money updates and account label changes', async () => {
    await ledger.observe(live())
    await Promise.all([
      ledger.observe(live({ seq: 2, earned: 100, copper: 100_100 })),
      ledger.setAccountName({ account: 'account-1', name: 'Main' }),
      ledger.observe(live({ seq: 3, earned: 200, spent: 50, copper: 100_150 })),
    ])
    const restarted = new CompanionGoldLedger(path)
    await restarted.load()
    expect(restarted.read().accounts[0]).toMatchObject({ name: 'Main', earned: '200', spent: '50', net: '150' })
  })
})

describe('gold snapshot contract', () => {
  it('requires v2 and nonempty ASCII account and epoch identifiers within 40 bytes', () => {
    const snapshot = live().snapshot
    expect(safeParse(snapshotSchema, snapshot).success).toBe(true)
    expect(safeParse(snapshotSchema, { ...snapshot, v: 1 }).success).toBe(false)
    expect(safeParse(snapshotSchema, { ...snapshot, account: '' }).success).toBe(false)
    expect(safeParse(snapshotSchema, { ...snapshot, moneyEpoch: 'x'.repeat(41) }).success).toBe(false)
    expect(safeParse(snapshotSchema, { ...snapshot, account: '金'.repeat(14) }).success).toBe(false)
    expect(safeParse(snapshotSchema, { ...snapshot, account: 'a@b' }).success).toBe(false)
    expect(safeParse(snapshotSchema, { ...snapshot, moneyEpoch: '金' }).success).toBe(false)
  })

  it.each(['copper', 'earned', 'spent'])('rejects fractional, negative, and unsafe %s values', (field) => {
    const snapshot = live().snapshot
    expect(safeParse(snapshotSchema, { ...snapshot, [field]: -1 }).success).toBe(false)
    expect(safeParse(snapshotSchema, { ...snapshot, [field]: 1.5 }).success).toBe(false)
    expect(safeParse(snapshotSchema, { ...snapshot, [field]: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false)
  })
})
