import type { BackupFile, BackupFileId, BackupScope, BackupSelection } from '../../../shared/wow-backup'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { array, check, finite, maxLength, maxValue, minValue, number, parse, picklist, pipe, strictObject, tuple } from 'valibot'

import { captureSchema, gameProfiles, settingsSchema } from '../../../shared/wow-companion'
import { launcherConfigSchema } from '../../../shared/wow-launcher'
import { CompanionEquipmentComparisons } from './wow-companion-equipment-comparisons'
import { CompanionEquipmentHistory } from './wow-companion-equipment-history'
import { CompanionGoldLedger } from './wow-companion-gold'
import { CompanionItemStorage } from './wow-companion-item-storage'
import { CompanionLevelHistory } from './wow-companion-level-history'
import { CompanionLoadouts } from './wow-companion-loadouts'
import { CompanionMemoryRepository } from './wow-companion-memory'

const coordinate = pipe(number(), finite(), minValue(-32768), maxValue(32768))
const calibrationSchema = strictObject({
  game: picklist(['retail', 'forever']),
  basis: tuple([coordinate, coordinate, pipe(number(), minValue(1), maxValue(12))]),
  offset: tuple([coordinate, coordinate]),
  size: tuple([pipe(number(), minValue(64), maxValue(32768)), pipe(number(), minValue(64), maxValue(32768))]),
  sample: pipe(array(pipe(number(), finite(), minValue(0), maxValue(18))), maxLength(4), check(value => value.length === 4 && value[2] >= 1 && value[3] >= 1)),
})

interface Target {
  id: BackupFileId
  path: string
  scope: Exclude<BackupScope, 'chats'>
  validate: (value: unknown) => unknown
  snapshot?: () => Promise<string | null>
  apply?: (data: string | null) => Promise<void>
}

/** Fixed destinations prevent archives from selecting paths. Normal saved-data validators also validate imported files. */
export class BackupFiles {
  private readonly targets: Target[] = []

  constructor(userData: string, bridgeDirectory: string) {
    for (const game of ['retail', 'forever'] as const) {
      const profile = gameProfiles[game]
      this.targets.push(
        { id: `${game}-settings`, path: join(userData, `${profile.settingsNamespace}-v1.json`), scope: 'settings', validate: value => parse(settingsSchema, value) },
        { id: `${game}-capture`, path: join(bridgeDirectory, profile.captureFile), scope: 'settings', validate: value => parse(captureSchema, value) },
        { id: `${game}-calibration`, path: join(bridgeDirectory, `${profile.captureFile}.calibration.json`), scope: 'settings', validate: (value) => {
          const result = parse(calibrationSchema, value)
          if (result.game !== game)
            throw new Error('backup-invalid')
          return result
        } },
        { id: `${game}-gold`, path: join(userData, profile.goldFile), scope: 'history', validate: CompanionGoldLedger.validateBackup },
        { id: `${game}-levels`, path: join(userData, profile.levelsFile), scope: 'history', validate: CompanionLevelHistory.validateBackup },
        { id: `${game}-equipment`, path: join(userData, profile.historyFile), scope: 'history', validate: CompanionEquipmentHistory.validateBackup },
        { id: `${game}-comparisons`, path: join(userData, profile.comparisonsFile), scope: 'history', validate: CompanionEquipmentComparisons.validateBackup },
        { id: `${game}-loadouts`, path: join(userData, profile.loadoutsFile), scope: 'history', validate: CompanionLoadouts.validateBackup },
      )
    }
    this.targets.push({ id: 'launcher', path: join(userData, 'wow-launcher-v1.json'), scope: 'settings', validate: value => parse(launcherConfigSchema, value) })
    this.targets.push({ id: 'companion-memories', path: join(userData, 'wow-companion-memory-v1.json'), scope: 'settings', validate: CompanionMemoryRepository.validateBackup })
    const itemPath = join(userData, 'wow-companion-items.sqlite')
    this.targets.push({
      id: 'item-storage',
      path: itemPath,
      scope: 'history',
      validate: CompanionItemStorage.validateBackup,
      snapshot: () => withItemStorage(itemPath, storage => storage.serializeBackup()),
      apply: data => withItemStorage(itemPath, storage => storage.restoreBackup(data)),
    })
  }

  scope(id: BackupFileId) {
    return this.target(id).scope
  }

  validate(file: BackupFile): BackupFile {
    const target = this.target(file.id)
    return { id: file.id, data: file.data === null ? null : JSON.stringify(target.validate(JSON.parse(file.data))) }
  }

  async snapshot(selection: BackupSelection): Promise<BackupFile[]> {
    const result: BackupFile[] = []
    for (const target of this.targets) {
      if (selection[target.scope])
        result.push({ id: target.id, data: target.snapshot ? await target.snapshot() : await readBackupText(target.path, 64 * 1024 * 1024) })
    }
    return result
  }

  async apply(files: BackupFile[]) {
    for (const file of files) {
      const target = this.target(file.id)
      if (target.apply) {
        await target.apply(file.data)
        continue
      }
      const path = target.path
      if (file.data === null) {
        if (await readBackupText(path) !== null)
          await unlink(path)
      }
      else {
        await atomicBackupText(path, file.data)
      }
    }
  }

  private target(id: BackupFileId) {
    const target = this.targets.find(item => item.id === id)
    if (!target)
      throw new Error('backup-invalid')
    return target
  }
}

/** SQLite exports logical rows through its own transaction boundary. Its binary file is never read or overwritten as UTF-8. */
async function withItemStorage<T>(path: string, action: (storage: CompanionItemStorage) => Promise<T>): Promise<T> {
  const storage = new CompanionItemStorage(path)
  try {
    await storage.load()
    return await action(storage)
  }
  finally {
    await storage.close()
  }
}

/** Reads one regular file without following a link. Missing data has an explicit null representation in a restore point. */
export async function readBackupText(path: string, limit = 768 * 1024 * 1024): Promise<string | null> {
  let stat
  try {
    stat = await lstat(path)
  }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return null
    throw error
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    throw new Error('backup-file-invalid')
  return readFile(path, 'utf8')
}

/** A file is durable before its name changes. All restore targets are fixed catalog paths or explicit file-picker destinations. */
export async function atomicBackupText(path: string, text: string) {
  const parent = dirname(resolve(path))
  await mkdir(parent, { recursive: true })
  if (Buffer.byteLength(text) > 768 * 1024 * 1024)
    throw new Error('backup-file-invalid')
  await readBackupText(path)
  const temporary = join(parent, `.backup-${randomUUID()}.tmp`)
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    }
    finally { await handle.close() }
    await rename(temporary, path)
  }
  finally {
    await unlink(temporary).catch(() => {})
  }
}
