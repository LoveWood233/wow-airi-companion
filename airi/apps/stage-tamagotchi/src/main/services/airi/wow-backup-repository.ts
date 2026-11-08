import type { InferOutput } from 'valibot'

import type { BackupArchive, BackupBrowserPort, BackupFile, BackupPayload, BackupPreview, BackupSelection, BackupStatus, BrowserBackup } from '../../../shared/wow-backup'
import type { BackupFiles } from './wow-backup-files'

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { number, object, parse, picklist, pipe, regex, strictObject, string } from 'valibot'

import { backupArchiveSchema, backupPayloadSchema, backupSelectionSchema, browserBackupSchema, scrubBackupPreference } from '../../../shared/wow-backup'
import { atomicBackupText, readBackupText } from './wow-backup-files'

const pendingSchema = strictObject({ archive: backupArchiveSchema, selection: backupSelectionSchema })
const checkpointSchema = pipe(string(), regex(/^before-restore-\d+-[\da-f-]{36}\.wowbackup\.json$/))
const journalSchema = strictObject({
  phase: picklist(['applying', 'committed']),
  previous: backupPayloadSchema,
  selection: backupSelectionSchema,
  checkpoint: checkpointSchema,
})

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

/** Owns portable archives and the durable cold-restore journal. Archives never select filesystem paths. */
export class BackupRepository {
  private plan: { id: string, archive: BackupArchive } | undefined
  private readonly pendingPath: string
  private readonly journalPath: string
  private readonly resultPath: string

  constructor(readonly directory: string, private readonly files: BackupFiles, private readonly version: string) {
    this.pendingPath = join(directory, 'pending-restore.json')
    this.journalPath = join(directory, 'restore-journal.json')
    this.resultPath = join(directory, 'last-result.json')
  }

  private manifest(payload: BackupPayload): BackupArchive['manifest'] {
    const manifest: BackupArchive['manifest'] = []
    for (const file of payload.files)
      manifest.push({ scope: this.files.scope(file.id), key: `file:${file.id}`, bytes: Buffer.byteLength(file.data ?? ''), sha256: digest(file.data ?? 'null') })
    for (const [key, value] of payload.browser.preferences)
      manifest.push({ scope: 'settings', key: `preference:${key}`, bytes: Buffer.byteLength(value), sha256: digest(value) })
    for (const [key, value] of payload.browser.chats ?? [])
      manifest.push({ scope: 'chats', key, bytes: Buffer.byteLength(value), sha256: digest(value) })
    return manifest.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  }

  private pack(payload: BackupPayload): BackupArchive {
    const body = { format: 'wow-companion-backup' as const, version: 1 as const, appVersion: this.version, createdAt: Date.now(), payload, manifest: this.manifest(payload) }
    const result = parse(backupArchiveSchema, { ...body, sha256: '' })
    const { sha256: _hash, ...normalized } = result
    result.sha256 = digest(JSON.stringify(normalized))
    if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024 * 1024)
      throw new Error('backup-too-large')
    return result
  }

  private unpack(raw: string): BackupArchive {
    if (Buffer.byteLength(raw) > 256 * 1024 * 1024)
      throw new Error('backup-too-large')
    const archive = parse(backupArchiveSchema, JSON.parse(raw))
    const { sha256, ...body } = archive
    if (digest(JSON.stringify(body)) !== sha256 || JSON.stringify(this.manifest(archive.payload)) !== JSON.stringify(archive.manifest))
      throw new Error('backup-checksum')
    archive.payload.files.forEach(file => this.files.validate(file))
    return archive
  }

  private preview(archive: BackupArchive, id: string): BackupPreview {
    return { id, appVersion: archive.appVersion, createdAt: archive.createdAt, sha256: archive.sha256, manifest: archive.manifest, scopes: { settings: archive.manifest.some(item => item.scope === 'settings'), history: archive.manifest.some(item => item.scope === 'history'), chats: archive.payload.browser.chats !== null } }
  }

  /** Export snapshots only saved data. Runtime drafts, providers, credentials, and model files are outside this scope. */
  async export(browser: BrowserBackup, selection: BackupSelection, destination: string, liveSettings: BackupFile[] = []) {
    parse(browserBackupSchema, browser)
    const files = (await this.files.snapshot(selection)).map(file => this.files.validate(liveSettings.find(live => live.id === file.id) ?? file))
    const payload: BackupPayload = {
      browser: { preferences: selection.settings ? browser.preferences.map(([key, value]) => [key, scrubBackupPreference(value)]) : [], chats: selection.chats ? browser.chats : null },
      files,
    }
    const archive = this.pack(payload)
    await atomicBackupText(destination, JSON.stringify(archive))
    return this.preview(archive, '')
  }

  inspect(raw: string) {
    const archive = this.unpack(raw)
    const id = randomUUID()
    this.plan = { id, archive }
    return this.preview(archive, id)
  }

  async schedule(id: string, selection: BackupSelection) {
    parse(backupSelectionSchema, selection)
    const plan = this.plan
    if (!plan || plan.id !== id || !Object.values(selection).some(Boolean))
      throw new Error('backup-invalid')
    const available = this.preview(plan.archive, id).scopes
    if (Object.entries(selection).some(([scope, selected]) => selected && !available[scope as keyof BackupSelection]))
      throw new Error('backup-invalid')
    await atomicBackupText(this.pendingPath, JSON.stringify({ archive: plan.archive, selection }))
    this.plan = undefined
  }

  async cancel() {
    if (await readBackupText(this.journalPath))
      throw new Error('backup-busy')
    await unlink(this.pendingPath).catch((error) => {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
        throw error
    })
  }

  async status(): Promise<BackupStatus> {
    const pendingText = await readBackupText(this.pendingPath)
    const pending = pendingText ? parse(pendingSchema, JSON.parse(pendingText)) : null
    const lastText = await readBackupText(this.resultPath)
    const last = lastText ? parse(object({ at: number(), outcome: picklist(['restored', 'rolled-back']), checkpoint: checkpointSchema }), JSON.parse(lastText)) : null
    return { pending: pending ? { ...this.preview(pending.archive, ''), scopes: pending.selection } : null, last }
  }

  async needsRecovery() {
    return await readBackupText(this.pendingPath) !== null || await readBackupText(this.journalPath) !== null
  }

  /** Update rollback retains exact saved keys. Its private journal is activated only if the new application fails startup. */
  async prepareUpdate(browser: BrowserBackup, portable: BrowserBackup, liveSettings: BackupFile[]) {
    if (await this.needsRecovery())
      throw new Error('backup-busy')
    parse(browserBackupSchema, browser)
    const selection = { settings: true, history: true, chats: true }
    if (browser.chats === null || portable.chats === null)
      throw new Error('backup-invalid')
    const checkpoint = `before-restore-${Date.now()}-${randomUUID()}.wowbackup.json`
    await this.export(portable, selection, join(this.directory, checkpoint), liveSettings)
    const previous: BackupPayload = { browser, files: (await this.files.snapshot(selection)).map(file => liveSettings.find(live => live.id === file.id) ?? file) }
    const journal = parse(journalSchema, { phase: 'applying', previous, selection, checkpoint })
    const path = join(this.directory, `update-rollback-${randomUUID()}.json`)
    await atomicBackupText(path, JSON.stringify(journal))
    return { checkpoint: join(this.directory, checkpoint), rollbackJournal: path }
  }

  /** Called before application owners exist. A process interruption always rolls back an uncommitted journal on the next startup. */
  async recover(browser: BackupBrowserPort) {
    const previousJournal = await readBackupText(this.journalPath)
    if (previousJournal) {
      const journal = parse(journalSchema, JSON.parse(previousJournal))
      if (journal.phase === 'applying')
        await this.rollback(journal, browser)
      else
        await this.finish('restored', journal.checkpoint)
      return
    }
    const pendingText = await readBackupText(this.pendingPath)
    if (!pendingText)
      return
    const pending = parse(pendingSchema, JSON.parse(pendingText))
    const archive = this.unpack(JSON.stringify(pending.archive))
    const selection = pending.selection
    const previous: BackupPayload = { browser: await browser.read(selection.chats, false, selection.settings), files: await this.files.snapshot(selection) }
    if (!selection.settings)
      previous.browser.preferences = []
    const checkpoint = `before-restore-${Date.now()}-${randomUUID()}.wowbackup.json`
    const portablePrevious = { ...previous, browser: await browser.read(selection.chats, true, selection.settings) }
    if (!selection.settings)
      portablePrevious.browser.preferences = []
    await atomicBackupText(join(this.directory, checkpoint), JSON.stringify(this.pack(portablePrevious)))
    const journal = { phase: 'applying' as const, previous, selection, checkpoint }
    await atomicBackupText(this.journalPath, JSON.stringify(journal))
    try {
      await this.files.apply(archive.payload.files.filter(file => selection[this.files.scope(file.id)]).map(file => this.files.validate(file)))
      await browser.apply(archive.payload.browser, selection, false)
      await atomicBackupText(this.journalPath, JSON.stringify({ ...journal, phase: 'committed' }))
    }
    catch {
      await this.rollback(journal, browser)
      return
    }
    await this.finish('restored', checkpoint)
  }

  private async rollback(journal: InferOutput<typeof journalSchema>, browser: BackupBrowserPort) {
    await this.files.apply(journal.previous.files)
    await browser.apply(journal.previous.browser, journal.selection, true)
    await this.finish('rolled-back', journal.checkpoint)
  }

  private async finish(outcome: 'restored' | 'rolled-back', checkpoint: string) {
    await atomicBackupText(this.resultPath, JSON.stringify({ at: Date.now(), outcome, checkpoint }))
    await unlink(this.pendingPath).catch((error) => {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
        throw error
    })
    await unlink(this.journalPath)
  }
}
