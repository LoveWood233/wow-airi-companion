import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import type { BrowserBackup } from '../../../shared/wow-backup'
import type { LocalUpdateStatus } from '../../../shared/wow-local-update'

import process from 'node:process'

import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { createContext as createWindowContext } from '@moeru/eventa/adapters/electron/main'
import { app, dialog, ipcMain } from 'electron'
import { number, object, parse, picklist, string } from 'valibot'

import { wowLocalUpdateLaunch, wowLocalUpdatePick, wowLocalUpdateRendererReady, wowLocalUpdateStatus } from '../../../shared/eventa/wow-local-update'
import { browserBackupSchema } from '../../../shared/wow-backup'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { atomicBackupText, readBackupText } from './wow-backup-files'
import { LocalUpdateFiles } from './wow-local-update-files'

/** Startup acknowledgement is tied to the helper's job and the exact new executable, never an unrelated running copy. */
export async function markLocalUpdateReady(window: BrowserWindow) {
  const rollback = !!process.env.APP_COMPANION_ROLLBACK_ID
  const id = rollback ? process.env.APP_COMPANION_ROLLBACK_ID : process.env.APP_COMPANION_UPDATE_ID
  if (!id || !/^[a-f\d-]{36}$/.test(id) || !app.isPackaged)
    return
  const directory = join(app.getPath('userData'), 'companion-updates')
  const raw = await readBackupText(join(directory, `job-${id}.json`), 64 * 1024)
  if (!raw)
    return
  const job = parse(object({ id: string(), newExecutable: string(), oldExecutable: string() }), JSON.parse(raw))
  const executable = rollback ? job.oldExecutable : job.newExecutable
  if (job.id !== id || resolve(executable).toLowerCase() !== resolve(process.execPath).toLowerCase())
    return
  const { context, dispose } = createWindowContext(ipcMain, window, { onlySameWindow: true })
  const ready = defineInvoke(context, wowLocalUpdateRendererReady)
  try {
    const deadline = Date.now() + 80_000
    while (Date.now() < deadline && !window.isDestroyed() && !window.webContents.isCrashed()) {
      try {
        if (await ready(undefined, { signal: AbortSignal.timeout(500) })) {
          await atomicBackupText(join(directory, `${rollback ? 'rollback-ack' : 'ack'}-${id}.json`), JSON.stringify({ id }))
          return
        }
      }
      catch {
        // A renderer that has not imported or mounted its entry cannot acknowledge yet.
      }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  finally { dispose() }
}

/** Local updates only start after a verified preview and a saved recovery point. No download or current-install overwrite occurs. */
export function setupWowLocalUpdate(context: ReturnType<typeof createContext>['context'], prepareBackup: (browser: BrowserBackup, portable: BrowserBackup) => Promise<{ checkpoint: string, rollbackJournal: string }>) {
  const userData = app.getPath('userData')
  const directory = join(userData, 'companion-updates')
  let files: LocalUpdateFiles | undefined
  let operation: Promise<unknown> | undefined
  let closing = false
  async function run<T>(callback: () => Promise<T>) {
    if (closing || operation)
      throw new Error('update-busy')
    const task = callback()
    operation = task
    try {
      return await task
    }
    finally { operation = undefined }
  }
  const initialize = async () => {
    if (process.platform !== 'win32' || process.arch !== 'x64' || !app.isPackaged || basename(process.execPath).toLowerCase() !== 'wow-companion.exe')
      return false
    const raw = await readBackupText(join(process.resourcesPath, 'wow-companion-release.json'), 4 * 1024 * 1024)
    if (!raw)
      return false
    const release = parse(object({ releaseVersion: string() }), JSON.parse(raw))
    files ??= new LocalUpdateFiles(dirname(process.execPath), release.releaseVersion)
    return true
  }
  const disposers = [
    defineInvokeHandler(context, wowLocalUpdateStatus, async (): Promise<LocalUpdateStatus> => {
      const raw = await readBackupText(join(directory, 'result.json'), 64 * 1024)
      const last = raw ? parse(object({ outcome: picklist(['updated', 'rolled-back', 'recovery-required']), checkpoint: string(), at: number() }), JSON.parse(raw)) : null
      return { supported: await initialize(), last }
    }),
    defineInvokeHandler(context, wowLocalUpdatePick, () => run(async () => {
      if (!await initialize() || !files)
        throw new Error('update-unsupported')
      const picked = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      return picked.canceled || !picked.filePaths[0] ? null : files.inspect(picked.filePaths[0])
    })),
    defineInvokeHandler(context, wowLocalUpdateLaunch, input => run(async () => {
      const request = parse(object({ id: string(), browser: browserBackupSchema, portable: browserBackupSchema }), input)
      if (!files || !await initialize())
        throw new Error('update-unsupported')
      const backup = await prepareBackup(request.browser, request.portable)
      const newExecutable = await files.confirm(request.id)
      const id = randomUUID()
      const helper = join(directory, `helper-${id}.ps1`)
      await atomicBackupText(helper, await readFile(join(app.getAppPath(), 'resources', 'wow-local-update.ps1'), 'utf8'))
      const jobPath = join(directory, `job-${id}.json`)
      await atomicBackupText(jobPath, JSON.stringify({ id, parentPid: process.pid, oldExecutable: process.execPath, newExecutable, userData, ...backup }))
      // Validation uses the same helper rules before the current application agrees to close.
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-JobPath', jobPath, '-ValidateOnly'], { windowsHide: true, timeout: 30_000 })
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-JobPath', jobPath], { detached: true, windowsHide: true, stdio: 'ignore' })
      await new Promise<void>((resolve, reject) => {
        child.once('error', reject)
        child.once('spawn', resolve)
      })
      child.unref()
      closing = true
      // Let the RPC resolve before quit hooks wait on this operation.
      setTimeout(() => app.quit(), 100)
    })),
  ]
  onAppBeforeQuit(async () => {
    closing = true
    disposers.forEach(dispose => dispose())
    await operation
  })
}
