import type { createContext } from '@moeru/eventa/adapters/electron/main'

import process from 'node:process'

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, dialog } from 'electron'
import { maxLength, object, parse, pipe, safeParse, string } from 'valibot'

import { wowSetupInspect, wowSetupInstall, wowSetupPick } from '../../../shared/eventa/wow-setup'
import { gameVersionSchema } from '../../../shared/wow-companion'
import { launcherConfigSchema } from '../../../shared/wow-launcher'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { WowSetupFiles } from './wow-setup-files'

const requestSchema = object({ game: gameVersionSchema, directory: pipe(string(), maxLength(4096)) })

/** Registers read-only inspection and a separate explicit bundled-addon installation action. */
export function setupWowSetup(context: ReturnType<typeof createContext>['context']) {
  const files = new WowSetupFiles(resolve(app.getAppPath(), '..', '..', '..', 'WOWAddons'), join(process.resourcesPath, 'wow-companion-addons'))
  let closing = false
  let pending: ReturnType<WowSetupFiles['install']> | undefined
  const disposers = [defineInvokeHandler(context, wowSetupPick, async () => {
    const picked = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return picked.canceled ? null : picked.filePaths[0] ?? null
  }), defineInvokeHandler(context, wowSetupInspect, async (input) => {
    const request = parse(requestSchema, input)
    if (!request.directory) {
      try {
        const saved = safeParse(launcherConfigSchema, JSON.parse(await readFile(join(app.getPath('userData'), 'wow-launcher-v1.json'), 'utf8')))
        if (saved.success && saved.output.paths[request.game])
          request.directory = dirname(saved.output.paths[request.game])
      }
      catch { /* No saved launcher path leaves selection to the user. */ }
    }
    return files.inspect(request.game, request.directory)
  }), defineInvokeHandler(context, wowSetupInstall, async (input) => {
    if (closing || pending)
      throw new Error('installation-busy')
    const request = parse(requestSchema, input)
    const operation = files.install(request.game, request.directory)
    pending = operation
    try {
      return await operation
    }
    finally {
      if (pending === operation)
        pending = undefined
    }
  })]
  onAppBeforeQuit(async () => {
    closing = true
    disposers.forEach(dispose => dispose())
    await pending?.catch(() => {})
  })
}
