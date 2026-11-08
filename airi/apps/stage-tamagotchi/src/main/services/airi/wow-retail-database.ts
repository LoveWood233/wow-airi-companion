import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { WowDataCachePort } from '@proj-airi/stage-shared/wow-knowledge'

import process from 'node:process'

import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, dialog } from 'electron'

import { wowRetailDatabaseClear, wowRetailDatabasePick, wowRetailDatabaseQuery, wowRetailDatabaseStatus } from '../../../shared/eventa/wow-retail-database'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { WowRetailDatabaseService } from './wow-retail-database-service'

/** All windows use one owner. Renderer requests cannot choose a database path or process argument. */
export function setupWowRetailDatabase(context: ReturnType<typeof createContext>['context'], cache?: WowDataCachePort) {
  const service = new WowRetailDatabaseService(join(app.getPath('userData'), 'wow-retail-database-v1.json'), {
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
    platform: process.platform,
  }, cache)
  const disposers = [
    defineInvokeHandler(context, wowRetailDatabaseStatus, () => service.status()),
    defineInvokeHandler(context, wowRetailDatabaseQuery, input => service.query(input)),
    defineInvokeHandler(context, wowRetailDatabaseClear, () => service.select(null)),
    defineInvokeHandler(context, wowRetailDatabasePick, async () => {
      const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'SQLite', extensions: ['sqlite3', 'sqlite', 'db'] }] })
      return result.canceled || !result.filePaths[0] ? service.status() : service.select(result.filePaths[0])
    }),
  ]
  onAppBeforeQuit(async () => {
    disposers.forEach(dispose => dispose())
    await service.dispose()
  })
  return service
}
