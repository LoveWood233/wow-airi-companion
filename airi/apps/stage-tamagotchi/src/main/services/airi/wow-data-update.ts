import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { WowRetailDatabaseService } from './wow-retail-database-service'

import process from 'node:process'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, dialog } from 'electron'

import { wowDataUpdateActivate, wowDataUpdateCancel, wowDataUpdateCheck, wowDataUpdateChooseGame, wowDataUpdateChooseTools, wowDataUpdateGet, wowDataUpdateStart } from '../../../shared/eventa/wow-data-update'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { WowDataUpdateService } from './wow-data-update-service'

/** The optional data tool starts monitoring on its first request. Companion startup only registers its IPC handlers. */
export function setupWowDataUpdate(context: ReturnType<typeof createContext>['context'], database: WowRetailDatabaseService) {
  let service: WowDataUpdateService | undefined
  let stopped = false
  function owner() {
    if (stopped)
      throw new Error('Data update tool stopped')
    if (!service) {
      service = new WowDataUpdateService({ appPath: app.getAppPath(), resourcesPath: process.resourcesPath, userDataPath: app.getPath('userData'), platform: process.platform }, database)
      service.startMonitoring()
    }
    return service
  }
  // Native pickers select source folders. Renderer requests cannot supply commands or output paths.
  const choose = async (key: 'gameRoot' | 'toolsRoot') => {
    const current = owner()
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (stopped)
      throw new Error('Data update tool stopped')
    return result.canceled || !result.filePaths[0] ? current.status() : current.configure(key, result.filePaths[0])
  }
  const disposers = [
    defineInvokeHandler(context, wowDataUpdateGet, () => owner().status()),
    defineInvokeHandler(context, wowDataUpdateChooseGame, () => choose('gameRoot')),
    defineInvokeHandler(context, wowDataUpdateChooseTools, () => choose('toolsRoot')),
    defineInvokeHandler(context, wowDataUpdateCheck, () => owner().check()),
    defineInvokeHandler(context, wowDataUpdateStart, () => owner().start()),
    defineInvokeHandler(context, wowDataUpdateCancel, () => owner().cancel()),
    defineInvokeHandler(context, wowDataUpdateActivate, input => owner().activate(typeof input?.id === 'string' ? input.id : '')),
  ]
  onAppBeforeQuit(async () => {
    stopped = true
    disposers.forEach(dispose => dispose())
    await service?.dispose()
  })
}
