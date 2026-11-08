import type { BackupColdTask, BackupPreview, BackupSelection, BackupStatus, BrowserBackup } from '../wow-backup'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowBackupStatus = defineInvokeEventa<BackupStatus>('eventa:invoke:wow-backup:status')
export const wowBackupExport = defineInvokeEventa<{ path: string, preview: BackupPreview } | null, { browser: BrowserBackup, selection: BackupSelection }>('eventa:invoke:wow-backup:export')
export const wowBackupPick = defineInvokeEventa<BackupPreview | null>('eventa:invoke:wow-backup:pick')
export const wowBackupSchedule = defineInvokeEventa<BackupStatus, { id: string, selection: BackupSelection }>('eventa:invoke:wow-backup:schedule')
export const wowBackupCancel = defineInvokeEventa<BackupStatus>('eventa:invoke:wow-backup:cancel')
export const wowBackupRestart = defineInvokeEventa<void>('eventa:invoke:wow-backup:restart')
export const wowBackupOpenFolder = defineInvokeEventa<void>('eventa:invoke:wow-backup:folder')
export const wowBackupColdReady = defineInvokeEventa<void>('eventa:invoke:wow-backup:cold-ready')
export const wowBackupColdRead = defineInvokeEventa<BrowserBackup, { includeChats: boolean, portable: boolean, includeSettings: boolean }>('eventa:invoke:wow-backup:cold-read')
export const wowBackupColdApply = defineInvokeEventa<void, BackupColdTask>('eventa:invoke:wow-backup:cold-apply')
