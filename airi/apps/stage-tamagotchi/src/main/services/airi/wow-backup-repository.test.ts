import type { BackupArchive, BackupBrowserPort, BackupSelection, BrowserBackup } from '../../../shared/wow-backup'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultSettings } from '../../../shared/wow-companion'
import { loadoutBridgeFixture, loadoutFixture } from '../../../shared/wow-companion-loadout.test-helper'
import { BackupFiles, readBackupText } from './wow-backup-files'
import { BackupRepository } from './wow-backup-repository'
import { CompanionItemStorage } from './wow-companion-item-storage'
import { CompanionMemoryRepository } from './wow-companion-memory'

const selection: BackupSelection = { settings: true, history: true, chats: false }
const initial: BrowserBackup = { preferences: [['settings/language', '"en"']], chats: null }
const incoming: BrowserBackup = { preferences: [['settings/language', '"zh-Hans"']], chats: null }

/** The browser is an external process. This port models only its persisted state and write failure. */
class BrowserPort implements BackupBrowserPort {
  state = structuredClone(initial)
  failApply = false
  failRollback = false
  calls: boolean[] = []

  async read() {
    return structuredClone(this.state)
  }

  async apply(data: BrowserBackup, selection: BackupSelection, rollback: boolean) {
    this.calls.push(rollback)
    if (selection.settings)
      this.state.preferences = structuredClone(data.preferences)
    if (selection.chats)
      this.state.chats = structuredClone(data.chats)
    if (rollback ? this.failRollback : this.failApply)
      throw new Error('Browser storage write failed')
  }
}

function checksum(archive: BackupArchive) {
  const { sha256: _hash, ...body } = archive
  archive.sha256 = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  return JSON.stringify(archive)
}

describe('portable backup and durable cold restore', () => {
  let directory: string
  let backups: BackupRepository
  let files: BackupFiles
  let browser: BrowserPort
  let exported: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'wow-backup-'))
    files = new BackupFiles(join(directory, 'user'), join(directory, 'bridge'))
    backups = new BackupRepository(join(directory, 'recovery'), files, 'test-1')
    browser = new BrowserPort()
    exported = join(directory, 'export.wowbackup.json')
  })

  afterEach(async () => {
    const target = resolve(directory)
    expect(target.startsWith(`${resolve(tmpdir())}\\wow-backup-`) || target.startsWith(`${resolve(tmpdir())}/wow-backup-`)).toBe(true)
    await rm(target, { recursive: true, force: true })
  })

  async function stage(data = incoming) {
    await backups.export(data, selection, exported)
    const preview = backups.inspect(await readFile(exported, 'utf8'))
    await backups.schedule(preview.id, selection)
  }

  it('exports a manifest, excludes credentials, and reads current in-memory settings', async () => {
    const data: BrowserBackup = { preferences: [['airi-cards', JSON.stringify({ name: 'Hero', nested: { apiKey: 'private', token: 'private', prompt: 'hello' } })]], chats: null }
    await backups.export(data, selection, exported, [{ id: 'retail-settings', data: JSON.stringify(defaultSettings) }])
    const raw = await readFile(exported, 'utf8')
    expect(raw).not.toContain('private')
    const preview = backups.inspect(raw)
    expect(preview.scopes).toEqual(selection)
    expect(preview.manifest).toHaveLength(20)
    expect(preview.manifest.some(file => file.key === 'file:item-storage')).toBe(true)
    expect(preview.sha256).toMatch(/^[a-f\d]{64}$/)
    expect(JSON.parse(raw).payload.files.find((file: { id: string }) => file.id === 'retail-settings').data).toBe(JSON.stringify(defaultSettings))
  })

  it('rejects hash damage, unsupported versions, arbitrary keys, and invalid owning schemas before scheduling', async () => {
    await backups.export(incoming, selection, exported)
    const archive: BackupArchive = JSON.parse(await readFile(exported, 'utf8'))
    archive.payload.browser.preferences[0][1] = 'changed'
    expect(() => backups.inspect(JSON.stringify(archive))).toThrow('backup-checksum')
    expect(() => backups.inspect(JSON.stringify({ ...archive, version: 99 }))).toThrow()
    archive.payload.browser.preferences = [['auth:token', 'private']]
    expect(() => backups.inspect(checksum(archive))).toThrow()
    archive.payload.browser.preferences = []
    archive.payload.files[0].id = '../outside' as BackupArchive['payload']['files'][number]['id']
    expect(() => backups.inspect(checksum(archive))).toThrow()
    await expect(backups.export({ preferences: [], chats: null }, selection, exported, [{ id: 'retail-settings', data: '{}' }])).rejects.toThrow()
    expect(await backups.needsRecovery()).toBe(false)
  })

  it('creates a checkpoint before replacing files and browser data', async () => {
    const settingsPath = join(directory, 'user', 'wow-companion-v1.json')
    await mkdir(join(directory, 'user'))
    await writeFile(settingsPath, JSON.stringify(defaultSettings))
    await stage()
    await writeFile(settingsPath, JSON.stringify({ ...defaultSettings, enabled: !defaultSettings.enabled }))
    const original = await readFile(settingsPath, 'utf8')
    expect((await backups.status()).pending?.scopes).toEqual(selection)
    await backups.recover(browser)
    expect(browser.state).toEqual(incoming)
    expect(await readFile(settingsPath, 'utf8')).toBe(JSON.stringify(defaultSettings))
    const result = await backups.status()
    expect(result.pending).toBeNull()
    expect(result.last?.outcome).toBe('restored')
    const checkpoint: BackupArchive = JSON.parse(await readFile(join(backups.directory, result.last!.checkpoint), 'utf8'))
    expect(checkpoint.payload.files.find(file => file.id === 'retail-settings')?.data).toBe(original)
    expect(checkpoint.payload.browser).toEqual(initial)
    expect(await backups.needsRecovery()).toBe(false)
  })

  it('restores exact prior bytes and browser keys when applying fails', async () => {
    await stage()
    const path = join(directory, 'user', 'wow-companion-v1.json')
    await mkdir(join(directory, 'user'), { recursive: true })
    await writeFile(path, '{ "preexisting": "even a damaged source stays recoverable" }')
    browser.failApply = true
    await backups.recover(browser)
    expect(browser.calls).toEqual([false, true])
    expect(browser.state).toEqual(initial)
    expect(await readFile(path, 'utf8')).toBe('{ "preexisting": "even a damaged source stays recoverable" }')
    expect((await backups.status()).last?.outcome).toBe('rolled-back')
  })

  it('exports and cold-restores SQLite item rows through a validated logical archive', async () => {
    const databasePath = join(directory, 'user', 'wow-companion-items.sqlite')
    const storage = new CompanionItemStorage(databasePath)
    const loadout = loadoutFixture()
    const item = loadout.slots[0].item!
    await storage.observe('retail', loadoutBridgeFixture(loadout), {
      instanceId: 'loadout-bridge',
      cursor: 1,
      hasMore: false,
      record: { v: 2, id: 1, session: loadout.session, guid: loadout.guid, observedAt: loadout.observedAt, scope: 'bags', container: 0, capacity: 1, complete: true, cached: false, slots: [{ slot: 1, state: 'occupied', quantity: 1, item: { ...item, classID: 4, subclassID: 4 } }] },
    })
    await storage.close()
    await stage()
    const archive: BackupArchive = JSON.parse(await readFile(exported, 'utf8'))
    const logical = archive.payload.files.find(file => file.id === 'item-storage')?.data
    expect(logical).toBeTruthy()
    expect(CompanionItemStorage.validateBackup(JSON.parse(logical!)).slots).toHaveLength(1)
    const changed = new CompanionItemStorage(databasePath)
    await changed.clear()
    await changed.close()
    await backups.recover(browser)
    const restored = new CompanionItemStorage(databasePath)
    try {
      await restored.load()
      expect(restored.query({ game: 'retail', category: 'equipment' }).rows[0]?.item.itemID).toBe(item.itemID)
      expect((await readFile(databasePath)).subarray(0, 16).toString()).toBe('SQLite format 3\u0000')
    }
    finally {
      await restored.close()
    }
  })

  it('keeps the journal on rollback failure and retries it on the next startup', async () => {
    await stage()
    browser.failApply = true
    browser.failRollback = true
    await expect(backups.recover(browser)).rejects.toThrow('Browser storage write failed')
    expect(await readBackupText(join(backups.directory, 'restore-journal.json'))).not.toBeNull()
    await expect(backups.cancel()).rejects.toThrow('backup-busy')
    browser.failRollback = false
    const restarted = new BackupRepository(backups.directory, files, 'test-1')
    await restarted.recover(browser)
    expect(browser.calls).toEqual([false, true, true])
    expect((await restarted.status()).last?.outcome).toBe('rolled-back')
    expect(await restarted.needsRecovery()).toBe(false)
  })

  it('finishes committed cleanup without replaying either snapshot', async () => {
    await stage()
    browser.failApply = true
    browser.failRollback = true
    await expect(backups.recover(browser)).rejects.toThrow()
    const path = join(backups.directory, 'restore-journal.json')
    const journal = JSON.parse(await readFile(path, 'utf8'))
    await writeFile(path, JSON.stringify({ ...journal, phase: 'committed' }))
    browser.calls = []
    await backups.recover(browser)
    expect(browser.calls).toEqual([])
    expect((await backups.status()).last?.outcome).toBe('restored')
  })

  it('previews without touching live files and rejects unavailable or stale plans', async () => {
    const onlyHistory = { settings: false, history: true, chats: false }
    await backups.export(incoming, onlyHistory, exported)
    const preview = backups.inspect(await readFile(exported, 'utf8'))
    await expect(backups.schedule(preview.id, selection)).rejects.toThrow('backup-invalid')
    await expect(backups.schedule('stale', onlyHistory)).rejects.toThrow('backup-invalid')
    expect(await readBackupText(join(directory, 'user', 'wow-companion-v1.json'))).toBeNull()
    await backups.schedule(preview.id, onlyHistory)
    expect((await backups.status()).pending?.scopes).toEqual(onlyHistory)
    await backups.cancel()
    expect(await backups.needsRecovery()).toBe(false)
    expect(await readdir(backups.directory)).not.toContain('restore-journal.json')
  })

  it('rejects non-files instead of replacing a directory', async () => {
    await mkdir(exported)
    await expect(backups.export(incoming, selection, exported)).rejects.toThrow('backup-file-invalid')
  })

  it('prepares a portable update checkpoint and a separate exact rollback journal without applying either', async () => {
    const raw: BrowserBackup = { preferences: [['airi-cards', '{"prompt":"Hero","apiKey":"private"}']], chats: [] }
    const portable: BrowserBackup = { preferences: raw.preferences, chats: [] }
    const prepared = await backups.prepareUpdate(raw, portable, [])
    expect(await backups.needsRecovery()).toBe(false)
    const checkpoint = await readFile(prepared.checkpoint, 'utf8')
    expect(checkpoint).not.toContain('private')
    const journal = await readFile(prepared.rollbackJournal, 'utf8')
    expect(journal).toContain('private')
    await writeFile(join(backups.directory, 'restore-journal.json'), journal)
    await backups.recover(browser)
    expect(browser.state).toEqual(raw)
    expect((await backups.status()).last?.outcome).toBe('rolled-back')
  })

  it('restores only the selected scope and checkpoints only that scope', async () => {
    const settings = join(directory, 'user', 'wow-companion-v1.json')
    const gold = join(directory, 'user', 'wow-companion-gold-v1.json')
    await mkdir(join(directory, 'user'))
    await writeFile(settings, JSON.stringify(defaultSettings))
    await writeFile(gold, '{"version":1,"accounts":[]}')
    await backups.export(incoming, selection, exported)
    const preview = backups.inspect(await readFile(exported, 'utf8'))
    const currentSettings = JSON.stringify({ ...defaultSettings, muted: true })
    await writeFile(settings, currentSettings)
    await rm(gold)
    await backups.schedule(preview.id, { settings: false, history: true, chats: false })
    await backups.recover(browser)
    expect(await readFile(settings, 'utf8')).toBe(currentSettings)
    expect(await readFile(gold, 'utf8')).toBe('{"version":1,"accounts":[]}')
    expect(browser.state.preferences).toEqual(initial.preferences)
    const result = await backups.status()
    const checkpoint: BackupArchive = JSON.parse(await readFile(join(backups.directory, result.last!.checkpoint), 'utf8'))
    expect(checkpoint.payload.browser.preferences).toEqual([])
    expect(checkpoint.manifest.every(item => item.scope === 'history')).toBe(true)
  })

  it('includes companion memory in settings-only backup and restores its validated snapshot', async () => {
    const path = join(directory, 'user', 'wow-companion-memory-v1.json')
    const memory = new CompanionMemoryRepository(path)
    await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'Exported preference.' })
    await memory.setLimit({ personaId: 'ranger', limit: 2000 })
    await memory.claimNotice({ personaId: 'ranger', kind: 'context-limited' })
    const saved = await memory.serializeBackup()
    const settingsOnly = { settings: true, history: false, chats: false }
    await backups.export(incoming, settingsOnly, exported)
    const archive: BackupArchive = JSON.parse(await readFile(exported, 'utf8'))
    const file = archive.payload.files.find(file => file.id === 'companion-memories')
    expect(file?.data).toBe(saved)
    expect(archive.manifest.find(item => item.key === 'file:companion-memories')?.scope).toBe('settings')
    expect(archive.manifest.some(item => item.scope === 'history')).toBe(false)
    const preview = backups.inspect(JSON.stringify(archive))
    await backups.schedule(preview.id, settingsOnly)
    await writeFile(path, '{ "old": "recoverable original bytes" }', 'utf8')
    await backups.recover(browser)
    expect(await readFile(path, 'utf8')).toBe(saved)
    const restored = new CompanionMemoryRepository(path)
    await restored.load()
    expect(restored.read({ personaId: 'ranger' }).capacity).toEqual({ limit: 2000, used: 1, full: false })
    expect(await restored.claimNotice({ personaId: 'ranger', kind: 'context-limited' })).toBe(false)
    expect((await backups.status()).last?.outcome).toBe('restored')
  })

  it('leaves companion memory untouched when restoring only history, even when its current file is damaged', async () => {
    const path = join(directory, 'user', 'wow-companion-memory-v1.json')
    const memory = new CompanionMemoryRepository(path)
    await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'A preference from the archive.' })
    await backups.export(incoming, selection, exported)
    const preview = backups.inspect(await readFile(exported, 'utf8'))
    const current = '{ "damaged": "keep these exact bytes"'
    await writeFile(path, current, 'utf8')
    await backups.schedule(preview.id, { settings: false, history: true, chats: false })
    await backups.recover(browser)
    expect(await readFile(path, 'utf8')).toBe(current)
    expect(browser.state.preferences).toEqual(initial.preferences)
    const result = await backups.status()
    expect(result.last?.outcome).toBe('restored')
    const checkpoint: BackupArchive = JSON.parse(await readFile(join(backups.directory, result.last!.checkpoint), 'utf8'))
    expect(checkpoint.payload.files.some(file => file.id === 'companion-memories')).toBe(false)
  })

  it('rejects an invalid memory snapshot at cold restore even when its integrity hashes were recomputed', async () => {
    const path = join(directory, 'user', 'wow-companion-memory-v1.json')
    const memory = new CompanionMemoryRepository(path)
    await memory.remember({ personaId: 'ranger', kind: 'preference', text: 'Keep the original memory.' })
    const original = await readFile(path, 'utf8')
    const settingsOnly = { settings: true, history: false, chats: false }
    await backups.export(incoming, settingsOnly, exported)
    const preview = backups.inspect(await readFile(exported, 'utf8'))
    await backups.schedule(preview.id, settingsOnly)
    const pendingPath = join(backups.directory, 'pending-restore.json')
    const pending: { archive: BackupArchive, selection: BackupSelection } = JSON.parse(await readFile(pendingPath, 'utf8'))
    const memoryFile = pending.archive.payload.files.find(file => file.id === 'companion-memories')!
    const invalid = CompanionMemoryRepository.validateBackup(JSON.parse(memoryFile.data!))
    invalid.entries[0].personaId = ''
    memoryFile.data = JSON.stringify(invalid)
    const manifest = pending.archive.manifest.find(item => item.key === 'file:companion-memories')!
    manifest.bytes = Buffer.byteLength(memoryFile.data)
    manifest.sha256 = createHash('sha256').update(memoryFile.data).digest('hex')
    checksum(pending.archive)
    await writeFile(pendingPath, JSON.stringify(pending), 'utf8')
    await expect(backups.recover(browser)).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(browser.calls).toEqual([])
    expect((await backups.status()).last).toBeNull()
  })
})
