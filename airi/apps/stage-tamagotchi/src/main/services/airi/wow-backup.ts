import type { createContext as CreateContext } from '@moeru/eventa/adapters/electron/main'

import type { BackupBrowserPort, BackupFile, BackupSelection } from '../../../shared/wow-backup'

import process from 'node:process'

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { object, parse, string } from 'valibot'

import { wowBackupCancel, wowBackupColdApply, wowBackupColdRead, wowBackupColdReady, wowBackupExport, wowBackupOpenFolder, wowBackupPick, wowBackupRestart, wowBackupSchedule, wowBackupStatus } from '../../../shared/eventa/wow-backup'
import { backupSelectionSchema, browserBackupSchema } from '../../../shared/wow-backup'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { baseUrl, getElectronMainDirname, load } from '../../libs/electron/location'
import { protectPrivilegedWindowNavigation } from '../../windows/shared/window'
import { BackupFiles, readBackupText } from './wow-backup-files'
import { BackupRepository } from './wow-backup-repository'

/** Both normal dialogs and startup recovery resolve the same fixed files, including the development bridge directory. */
function repository() {
  const userData = app.getPath('userData')
  const bridge = existsSync(join(process.resourcesPath, 'wow-companion-bridge', 'server.py'))
    ? join(userData, 'wow-companion-bridge')
    : resolve(app.getAppPath(), '..', '..', '..', 'WOWAddons', 'WoWCompanionBridge')
  return new BackupRepository(join(userData, 'companion-backups'), new BackupFiles(userData, bridge), app.getVersion())
}

/** A dedicated renderer opens only while application owners do not exist. Its RPC is restricted to that window. */
export async function recoverWowBackup(title: string) {
  const backups = repository()
  if (!await backups.needsRecovery())
    return
  const window = new BrowserWindow({ width: 520, height: 220, title, show: true, resizable: false, closable: false, webPreferences: { preload: join(dirname(fileURLToPath(import.meta.url)), '../preload/index.mjs'), sandbox: false } })
  protectPrivilegedWindowNavigation(window)
  const { context } = createContext(ipcMain, window, { onlySameWindow: true })
  const ready = Promise.withResolvers<void>()
  const disposeReady = defineInvokeHandler(context, wowBackupColdReady, () => ready.resolve())
  const read = defineInvoke(context, wowBackupColdRead)
  const apply = defineInvoke(context, wowBackupColdApply)
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const source = baseUrl(resolve(getElectronMainDirname(), '..', 'renderer'), 'index.html')
    if ('url' in source && source.url) {
      const url = new URL(source.url)
      url.searchParams.set('wow-backup', '1')
      await load(window, url.toString())
    }
    else if ('file' in source && source.file) {
      await load(window, { file: source.file, options: { query: { 'wow-backup': '1' } } })
    }
    await Promise.race([ready.promise, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('backup-renderer-timeout')), 20_000)
    })])
    const browser: BackupBrowserPort = {
      read: (includeChats, portable, includeSettings) => read({ includeChats, portable, includeSettings }),
      apply: (data, selection, rollback) => apply({ operation: 'apply', data, selection, rollback }),
    }
    await backups.recover(browser)
  }
  finally {
    clearTimeout(timeout)
    disposeReady()
    window.destroy()
  }
}

/** Dialogs return only previews and plan IDs. Renderer requests cannot select restore paths or executable commands. */
export function setupWowBackup(context: ReturnType<typeof CreateContext>['context'], translate: (key: string) => string, flushGame: (selection: BackupSelection) => Promise<BackupFile[]>) {
  const backups = repository()
  let active: Promise<unknown> | undefined
  async function run<T>(operation: () => Promise<T>) {
    if (active)
      throw new Error('backup-busy')
    const task = operation()
    active = task
    try {
      return await task
    }
    finally { active = undefined }
  }
  const dispose = [
    defineInvokeHandler(context, wowBackupStatus, () => backups.status()),
    defineInvokeHandler(context, wowBackupExport, input => run(async () => {
      const request = parse(object({ browser: browserBackupSchema, selection: backupSelectionSchema }), input)
      if (!Object.values(request.selection).some(Boolean))
        throw new Error('backup-invalid')
      const result = await dialog.showSaveDialog({ title: translate('wow-companion.backup.export'), defaultPath: `wow-companion-${Date.now()}.wowbackup.json`, filters: [{ name: translate('wow-companion.backup.file-type'), extensions: ['json'] }] })
      if (result.canceled || !result.filePath)
        return null
      const live = await flushGame(request.selection)
      const preview = await backups.export(request.browser, request.selection, result.filePath, live)
      return { path: result.filePath, preview }
    })),
    defineInvokeHandler(context, wowBackupPick, () => run(async () => {
      const result = await dialog.showOpenDialog({ title: translate('wow-companion.backup.pick'), properties: ['openFile'], filters: [{ name: translate('wow-companion.backup.file-type'), extensions: ['json'] }] })
      if (result.canceled || !result.filePaths[0])
        return null
      const text = await readBackupText(result.filePaths[0], 256 * 1024 * 1024)
      if (text === null)
        throw new Error('backup-invalid')
      return backups.inspect(text)
    })),
    defineInvokeHandler(context, wowBackupSchedule, input => run(async () => {
      const request = parse(object({ id: string(), selection: backupSelectionSchema }), input)
      await backups.schedule(request.id, request.selection)
      return backups.status()
    })),
    defineInvokeHandler(context, wowBackupCancel, () => run(async () => {
      await backups.cancel()
      return backups.status()
    })),
    defineInvokeHandler(context, wowBackupRestart, async () => {
      if (active || !(await backups.status()).pending)
        throw new Error('backup-invalid')
      app.relaunch()
      app.quit()
    }),
    defineInvokeHandler(context, wowBackupOpenFolder, async () => {
      await mkdir(backups.directory, { recursive: true })
      await shell.openPath(backups.directory)
    }),
  ]
  onAppBeforeQuit(async () => {
    dispose.forEach(fn => fn())
    await active
  })
  return { prepareUpdate: (browser: Parameters<BackupRepository['prepareUpdate']>[0], portable: Parameters<BackupRepository['prepareUpdate']>[1]) => run(async () => backups.prepareUpdate(browser, portable, await flushGame({ settings: true, history: true, chats: true }))) }
}
