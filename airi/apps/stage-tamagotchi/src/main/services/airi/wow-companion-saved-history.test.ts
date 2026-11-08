import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadoutStateFixture } from '../../../shared/wow-companion-loadout.test-helper'
import { CompanionArchive } from './wow-companion-archive'
import { CompanionSavedHistory, readSavedSnapshot } from './wow-companion-saved-history'

function history() {
  return { version: 1, game: 'retail', account: 'account', updatedAt: 100, characters: {
    'Player-1': { snapshot: loadoutStateFixture().bridge!.snapshot, money: [{ id: 1, observedAt: 100, deltaCopper: -100, balanceCopper: 99900, epoch: 'epoch', source: 'addon-money-observation' }], levels: [], levelSeconds: 10, levelComplete: false },
  } }
}

function lua(value: unknown) {
  return `WoWMapCompanionDB = { ["snapshotJSON"] = ${JSON.stringify(JSON.stringify({ offlineHistory: value }))}, }`
}

describe('addon SavedVariables import', () => {
  let root: string
  let user: string
  let source: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wow-saved-history-'))
    user = join(root, 'profile')
    source = join(root, 'client', 'WTF', 'Account', 'account', 'SavedVariables', 'WoWMapCompanion.lua')
    await mkdir(user, { recursive: true })
    await mkdir(join(source, '..'), { recursive: true })
    await writeFile(join(user, 'wow-launcher-v1.json'), JSON.stringify({ defaultTarget: 'retail', paths: { 'retail': join(root, 'client', 'Wow.exe'), 'forever': '', 'classic': '', 'battle-net': '' } }))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(100000)
  })
  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('reads Lua escapes and Unicode without executing Lua statements', () => {
    const encoded = `error("never execute"); DB={ ["snapshotJSON"] = "\\123\\\"name\\\":\\\"瑟银锭\\\"\\125" }`
    expect(readSavedSnapshot(Buffer.from(encoded))).toEqual({ name: '瑟银锭' })
    expect(() => readSavedSnapshot(Buffer.from('["snapshotJSON"] = "unfinished'))).toThrow('Truncated')
  })

  it('imports history with no running game or live bridge and includes it in the fixed JSON archive', async () => {
    await writeFile(source, lua(history()))
    const importer = new CompanionSavedHistory(user, 'retail')
    await importer.refresh()
    expect(importer.read().accounts[0]!.history.characters['Player-1']!.money[0]!.deltaCopper).toBe(-100)
    const archivePath = join(user, 'archive.json')
    await new CompanionArchive(archivePath, 'retail').observe(loadoutStateFixture(), true, importer.read())
    const result = JSON.parse(await readFile(archivePath, 'utf8'))
    expect(result.addonHistory.accounts).toHaveLength(1)
    expect(result.goldJournal).toHaveLength(0)
    const restarted = new CompanionSavedHistory(user, 'retail')
    await restarted.refresh()
    expect(restarted.read().accounts).toHaveLength(1)
  })

  it('retains the last valid history when the source is partial or older', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await writeFile(source, lua(history()))
    const importer = new CompanionSavedHistory(user, 'retail')
    await importer.refresh()
    await writeFile(source, 'incomplete')
    vi.setSystemTime(131000)
    await importer.refresh()
    expect(importer.read().accounts[0]!.history.updatedAt).toBe(100)
    await writeFile(source, lua({ ...history(), updatedAt: 50 }))
    vi.setSystemTime(162000)
    await importer.refresh()
    expect(importer.read().accounts[0]!.history.updatedAt).toBe(100)
  })

  it('rejects cross-game and mismatched character data', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await writeFile(source, lua({ ...history(), game: 'forever' }))
    const importer = new CompanionSavedHistory(user, 'retail')
    await importer.refresh()
    expect(importer.read().accounts).toHaveLength(0)
    const bad = history()
    bad.characters['Player-1'].snapshot!.account = 'other'
    await writeFile(source, lua(bad))
    vi.setSystemTime(131000)
    await importer.refresh()
    expect(importer.read().accounts).toHaveLength(0)
  })
})
