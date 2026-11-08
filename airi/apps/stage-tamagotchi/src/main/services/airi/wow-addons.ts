import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { AddonFile, AddonGame, AddonInstallRequest, AddonResult, AddonSettingsUpdate, AddonSummary, InstalledAddon } from '../../../shared/wow-addons'

import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { app, dialog, safeStorage } from 'electron'
import { integer, maxLength, maxValue, minValue, number, object, optional, parse, picklist, pipe, string } from 'valibot'

import { wowAddonsChooseDirectory, wowAddonsFiles, wowAddonsGetSettings, wowAddonsInstall, wowAddonsInstalled, wowAddonsMetadata, wowAddonsSaveSettings, wowAddonsSearch } from '../../../shared/eventa/wow-addons'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { CurseForgeCatalog } from './wow-addons-catalog'
import { validateClientDirectory, WowAddonInstaller } from './wow-addons-install'
import { addonGameSchema, addonIdSchema, addonSettingsUpdateSchema, WowAddonSettings } from './wow-addons-settings'

const gameRequest = object({ game: addonGameSchema })
const filesRequest = object({ game: addonGameSchema, modId: addonIdSchema, gameVersionTypeId: addonIdSchema })
const installRequest = object({ game: addonGameSchema, modId: addonIdSchema, fileId: addonIdSchema })
const searchRequest = object({
  game: addonGameSchema,
  gameVersionTypeId: addonIdSchema,
  categoryId: optional(addonIdSchema),
  search: pipe(string(), maxLength(128)),
  index: pipe(number(), integer(), minValue(0), maxValue(9980)),
  sort: picklist(['popular', 'updated', 'downloads']),
})

/** Returns stable errors without provider bodies, credential values, or arbitrary filesystem exception messages. */
async function result<T>(operation: () => Promise<T> | T): Promise<AddonResult<T>> {
  try {
    return { ok: true, data: await operation() }
  }
  catch (error) {
    const message = errorMessageFrom(error)
    return { ok: false, error: message && /^(?:curseforge|wow-addons)-[a-z-]+$/.test(message) ? message : 'wow-addons-request-failed' }
  }
}

/** Main owns the key, trusted API client, filesystem receipts, and a single installation lock across all game profiles. */
export function setupWowAddons(context: ReturnType<typeof createContext>['context']) {
  const settings = new WowAddonSettings(join(app.getPath('userData'), 'wow-addons-v1.json'), safeStorage)
  const installer = new WowAddonInstaller(join(app.getPath('userData'), 'wow-addons-backups'))
  let catalog: CurseForgeCatalog | undefined
  let mutationActive = false
  let mutationFinished: Promise<void> | undefined
  let stopped = false

  function client() {
    if (stopped)
      throw new Error('wow-addons-stopped')
    catalog ??= new CurseForgeCatalog(settings.apiKey())
    return catalog
  }

  async function mutate<T>(operation: () => Promise<T> | T): Promise<T> {
    if (stopped)
      throw new Error('wow-addons-stopped')
    if (mutationActive)
      throw new Error('wow-addons-busy')
    mutationActive = true
    let finish: (() => void) | undefined
    mutationFinished = new Promise<void>((resolve) => {
      finish = resolve
    })
    try {
      return await operation()
    }
    finally {
      mutationActive = false
      finish?.()
      mutationFinished = undefined
    }
  }

  async function requireVersion(game: AddonGame, typeId: number) {
    const saved = settings.read().clients[game]
    if (!saved.gameVersionTypeId)
      throw new Error('wow-addons-version-required')
    if (saved.gameVersionTypeId !== typeId)
      throw new Error('curseforge-incompatible-version')
    const metadata = await client().getMetadata()
    if (!metadata.versionTypes.some(type => type.id === typeId && type.group === game))
      throw new Error('curseforge-incompatible-version')
    return saved
  }

  async function saveSettings(input: AddonSettingsUpdate) {
    const update = parse(addonSettingsUpdateSchema, input)
    const directories = new Set<string>()
    for (const game of ['retail', 'classic', 'forever'] as const) {
      const saved = update.clients[game]
      saved.directory = saved.directory.trim()
      if (!saved.directory)
        continue
      saved.directory = await validateClientDirectory(saved.directory, game)
      const identity = saved.directory.toLowerCase()
      if (directories.has(identity))
        throw new Error('wow-addons-directory-conflict')
      directories.add(identity)
    }
    const value = settings.save(update)
    // A key change creates a fresh catalog cache. In-flight reads retain only their original trusted host and cannot mutate local files.
    catalog?.dispose()
    catalog = undefined
    return value
  }

  async function install(input: AddonInstallRequest): Promise<InstalledAddon> {
    const request = parse(installRequest, input)
    const saved = settings.read().clients[request.game]
    if (!saved.directory)
      throw new Error('wow-addons-directory-required')
    if (!saved.gameVersionTypeId)
      throw new Error('wow-addons-version-required')
    await requireVersion(request.game, saved.gameVersionTypeId)
    const directory = await validateClientDirectory(saved.directory, request.game)
    const api = client()
    const prior = settings.installed(request.game).filter(item => item.clientDirectory === directory)
    const plan: { file: AddonFile, addon: AddonSummary }[] = []
    const visiting = new Set<number>()
    const planned = new Set<number>()

    async function visit(modId: number, fileId?: number, depth = 0): Promise<void> {
      if (planned.has(modId))
        return
      if (visiting.has(modId) || visiting.size > 10 || depth > 10 || planned.size + visiting.size >= 20)
        throw new Error('wow-addons-dependency-limit')
      visiting.add(modId)
      const addon = await api.getMod(modId)
      if (!addon.allowDistribution)
        throw new Error('curseforge-distribution-disabled')
      const files = fileId ? [await api.getFile(modId, fileId)] : await api.getFiles(modId, saved.gameVersionTypeId!)
      // Dependencies prefer an approved release. A beta is used only when the API lists no compatible release.
      const file = fileId ? files[0] : files.find(candidate => candidate.releaseType === 1) ?? files.find(candidate => candidate.releaseType === 2)
      if (!file || !file.gameVersionTypeIds.includes(saved.gameVersionTypeId!))
        throw new Error('curseforge-incompatible-version')
      for (const dependency of file.dependencies.filter(item => item.required)) {
        const receipt = prior.find(item => item.modId === dependency.modId && item.gameVersionTypeId === saved.gameVersionTypeId)
        const foldersPresent = receipt && receipt.folders.length > 0 && (await Promise.all(receipt.folders.map(async (folder) => {
          try {
            const entry = await lstat(join(directory, 'Interface', 'AddOns', folder))
            return entry.isDirectory() && !entry.isSymbolicLink()
          }
          catch {
            return false
          }
        }))).every(Boolean)
        if (foldersPresent)
          continue
        await visit(dependency.modId, undefined, depth + 1)
      }
      visiting.delete(modId)
      planned.add(modId)
      plan.push({ addon, file })
    }

    await visit(request.modId, request.fileId)
    let installed: InstalledAddon | undefined
    for (const item of plan) {
      if (stopped)
        throw new Error('wow-addons-stopped')
      const archive = await api.download(item.file, saved.gameVersionTypeId)
      if (stopped)
        throw new Error('wow-addons-stopped')
      installed = await installer.installArchive(directory, archive, {
        game: request.game,
        modId: item.addon.id,
        fileId: item.file.id,
        name: item.addon.name,
        version: item.file.displayName,
        gameVersionTypeId: saved.gameVersionTypeId,
      }, settings.installed(request.game), record => settings.recordInstallation(record))
    }
    if (!installed)
      throw new Error('wow-addons-install-failed')
    return installed
  }

  const disposers = [
    defineInvokeHandler(context, wowAddonsGetSettings, () => result(() => settings.read())),
    defineInvokeHandler(context, wowAddonsSaveSettings, input => result(() => mutate(() => saveSettings(input)))),
    defineInvokeHandler(context, wowAddonsMetadata, () => result(() => client().getMetadata())),
    defineInvokeHandler(context, wowAddonsSearch, input => result(async () => {
      const request = parse(searchRequest, input)
      await requireVersion(request.game, request.gameVersionTypeId)
      return client().search(request)
    })),
    defineInvokeHandler(context, wowAddonsFiles, input => result(async () => {
      const request = parse(filesRequest, input)
      await requireVersion(request.game, request.gameVersionTypeId)
      return client().getFiles(request.modId, request.gameVersionTypeId)
    })),
    defineInvokeHandler(context, wowAddonsInstalled, input => result(() => {
      const { game } = parse(gameRequest, input)
      const directory = settings.read().clients[game].directory
      return settings.installed(game).filter(item => item.clientDirectory === directory)
    })),
    defineInvokeHandler(context, wowAddonsInstall, input => result(() => mutate(() => install(input)))),
    defineInvokeHandler(context, wowAddonsChooseDirectory, input => result(async () => {
      const { game } = parse(gameRequest, input)
      const selection = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath: settings.read().clients[game].directory || undefined,
      })
      if (selection.canceled || selection.filePaths.length === 0)
        return null
      return validateClientDirectory(selection.filePaths[0], game)
    })),
  ]
  onAppBeforeQuit(async () => {
    stopped = true
    catalog?.dispose()
    for (const dispose of disposers)
      dispose()
    // Network waits abort immediately. A filesystem transaction already in progress finishes or rolls back before Electron exits.
    await mutationFinished
  })
}
