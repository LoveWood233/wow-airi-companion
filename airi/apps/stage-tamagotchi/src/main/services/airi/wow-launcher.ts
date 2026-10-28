import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, dialog } from 'electron'

import { wowLauncherGet, wowLauncherLaunch, wowLauncherPick, wowLauncherSave } from '../../../shared/eventa/wow-launcher'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { WowLauncher } from './wow-launcher-runtime'
import { WindowsLauncherPlatform } from './wow-launcher-windows'

/** Registers one launcher owner for all desktop windows. Configuration never launches the selected file. */
export function setupWowLauncher(context: ReturnType<typeof createContext>['context']) {
  const platform = new WindowsLauncherPlatform()
  const launcher = new WowLauncher(join(app.getPath('userData'), 'wow-launcher-v1.json'), platform)
  const disposers = [
    defineInvokeHandler(context, wowLauncherGet, () => launcher.read()),
    defineInvokeHandler(context, wowLauncherSave, input => launcher.save(input)),
    defineInvokeHandler(context, wowLauncherLaunch, input => launcher.launch(input)),
    defineInvokeHandler(context, wowLauncherPick, async () => {
      if (!platform.supported)
        return { path: null }
      const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '*.exe', extensions: ['exe'] }] })
      return { path: result.canceled ? null : result.filePaths[0] ?? null }
    }),
  ]
  onAppBeforeQuit(async () => {
    disposers.forEach(dispose => dispose())
    await launcher.flush()
  })
}
