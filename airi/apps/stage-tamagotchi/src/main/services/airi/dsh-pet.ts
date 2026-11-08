import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { DshPetLibraryState } from '../../../shared/dsh-pet-library'

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createWindowContext } from '@moeru/eventa/adapters/electron/main'
import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import { parse } from 'valibot'

import builtinManifest from '../../../renderer/public/dsh-pet/builtin/pack.json'

import { dshPetPackSchema } from '../../../shared/dsh-pet'
import { dshPetChanged, dshPetConfigure, dshPetGet, dshPetImport } from '../../../shared/eventa/dsh-pet'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { DshPetLibrary } from './dsh-pet-library'

/** The main process owns pack imports and serves only copied, manifest-listed animation media. */
export function setupDshPet(context: ReturnType<typeof createContext>['context']) {
  const builtin = parse(dshPetPackSchema, { ...builtinManifest, baseUrl: './dsh-pet/builtin' })
  const library = new DshPetLibrary(join(app.getPath('userData'), 'dsh-pet-packs'), builtin)
  const contexts = new WeakMap<BrowserWindow, ReturnType<typeof createWindowContext>>()
  function publish(state: DshPetLibraryState) {
    for (const window of BrowserWindow.getAllWindows()) {
      let target = contexts.get(window)
      if (!target) {
        target = createWindowContext(ipcMain, window, { onlySameWindow: true })
        contexts.set(window, target)
      }
      void target.context.emit(dshPetChanged, state).catch(() => {})
    }
    return state
  }
  const disposers = [
    defineInvokeHandler(context, dshPetGet, () => library.read()),
    defineInvokeHandler(context, dshPetConfigure, async request => publish(await library.configure(request))),
    defineInvokeHandler(context, dshPetImport, async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'dontAddToRecent'] })
      if (result.canceled || !result.filePaths[0])
        return null
      return publish(await library.importPack(result.filePaths[0]))
    }),
  ]
  protocol.handle('dsh-pet', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== 'packs' || url.username || url.password || url.search || url.hash || !['GET', 'HEAD'].includes(request.method))
        return new Response('Not Found', { status: 404 })
      const [id, ...parts] = url.pathname.slice(1).split('/')
      const file = parts.map(part => decodeURIComponent(part)).join('/')
      const path = await library.resolveAsset(id, file)
      const response = await net.fetch(pathToFileURL(path).href, { method: request.method, signal: request.signal })
      return new Response(response.body, { status: response.status, headers: {
        'Content-Type': 'video/webm',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      } })
    }
    catch {
      return new Response('Not Found', { status: 404 })
    }
  })
  onAppBeforeQuit(() => {
    disposers.forEach(dispose => dispose())
    protocol.unhandle('dsh-pet')
  })
}
