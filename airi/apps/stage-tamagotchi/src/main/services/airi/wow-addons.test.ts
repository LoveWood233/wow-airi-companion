import type { AddonFile, AddonGame, AddonSettingsUpdate, AddonSummary } from '../../../shared/wow-addons'

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { crc32 } from 'node:zlib'

import { createContext, defineInvoke } from '@moeru/eventa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { wowAddonsChooseDirectory, wowAddonsFiles, wowAddonsGetSettings, wowAddonsInstall, wowAddonsInstalled, wowAddonsMetadata, wowAddonsSaveSettings, wowAddonsSearch } from '../../../shared/eventa/wow-addons'
import { emitAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { setupWowAddons } from './wow-addons'
import { CurseForgeCatalog } from './wow-addons-catalog'
import { WowAddonInstaller } from './wow-addons-install'

const electron = vi.hoisted(() => ({
  getPath: vi.fn(),
  showOpenDialog: vi.fn(),
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: electron.getPath },
  dialog: { showOpenDialog: electron.showOpenDialog },
  safeStorage: {
    isEncryptionAvailable: electron.isEncryptionAvailable,
    encryptString: electron.encryptString,
    decryptString: electron.decryptString,
  },
}))

function archive(modId: number) {
  const name = Buffer.from(`Addon${modId}/Addon${modId}.toc`)
  const contents = Buffer.from('## Interface: 120001')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034B50)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0x800, 6)
  local.writeUInt32LE(crc32(contents), 14)
  local.writeUInt32LE(contents.length, 18)
  local.writeUInt32LE(contents.length, 22)
  local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014B50)
  central.writeUInt16LE(0x314, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x800, 8)
  central.writeUInt32LE(crc32(contents), 16)
  central.writeUInt32LE(contents.length, 20)
  central.writeUInt32LE(contents.length, 24)
  central.writeUInt16LE(name.length, 28)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + name.length, 12)
  end.writeUInt32LE(local.length + name.length + contents.length, 16)
  return Buffer.concat([local, name, contents, central, name, end])
}

function addon(modId: number): AddonSummary {
  return { id: modId, name: `Addon ${modId}`, summary: '', logoUrl: null, websiteUrl: 'https://www.curseforge.com/wow/addons/example', downloadCount: 0, dateModified: '2026-10-27T00:00:00Z', authors: [], categories: [], allowDistribution: true }
}

function file(modId: number, dependencies: number[] = []): AddonFile {
  return {
    id: modId * 100,
    modId,
    displayName: '1.0',
    fileName: `Addon${modId}.zip`,
    fileLength: archive(modId).length,
    releaseType: 1,
    fileDate: '2026-10-27T00:00:00Z',
    gameVersions: ['12.0.1'],
    gameVersionTypeIds: [901],
    downloadUrl: 'https://edge.forgecdn.net/files/1/1/addon.zip',
    dependencies: dependencies.map(modId => ({ modId, required: true })),
  }
}

describe('wow addons IPC orchestration', () => {
  let directory: string
  let context: ReturnType<typeof createContext>
  let clients: AddonSettingsUpdate['clients']
  let files: Map<number, AddonFile[]>
  let addons: Map<number, AddonSummary>
  const releases: (() => void)[] = []

  beforeEach(async () => {
    directory = await mkdtemp(join(await realpath(tmpdir()), 'airi-addon-rpc-'))
    clients = {
      retail: { directory: join(directory, '_retail_'), gameVersionTypeId: 901 },
      classic: { directory: join(directory, '_classic_'), gameVersionTypeId: 902 },
      forever: { directory: join(directory, '_forever_'), gameVersionTypeId: 903 },
    }
    for (const game of ['retail', 'classic', 'forever'] as const) {
      await mkdir(join(clients[game].directory, 'Interface', 'AddOns'), { recursive: true })
      await writeFile(join(clients[game].directory, 'Wow.exe'), '')
    }
    electron.getPath.mockReturnValue(join(directory, 'userdata'))
    electron.isEncryptionAvailable.mockReturnValue(true)
    electron.encryptString.mockReturnValue(Buffer.from('encrypted-fixture'))
    electron.decryptString.mockReturnValue('private-fixture-key')
    electron.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    files = new Map([[1, [file(1)]]])
    addons = new Map()
    vi.spyOn(CurseForgeCatalog.prototype, 'getMetadata').mockResolvedValue({ categories: [], versionTypes: [
      { id: 901, name: 'Retail', slug: 'retail', group: 'retail' },
      { id: 902, name: 'Classic', slug: 'classic', group: 'classic' },
      { id: 903, name: 'Forever', slug: 'forever', group: 'forever' },
    ] })
    vi.spyOn(CurseForgeCatalog.prototype, 'getMod').mockImplementation(async id => addons.get(id) ?? addon(id))
    vi.spyOn(CurseForgeCatalog.prototype, 'getFile').mockImplementation(async (modId, fileId) => {
      const candidate = files.get(modId)?.find(file => file.id === fileId)
      if (!candidate)
        throw new Error('curseforge-not-found')
      return structuredClone(candidate)
    })
    vi.spyOn(CurseForgeCatalog.prototype, 'getFiles').mockImplementation(async modId => structuredClone(files.get(modId) ?? []))
    vi.spyOn(CurseForgeCatalog.prototype, 'download').mockImplementation(async file => archive(file.modId))
    vi.spyOn(CurseForgeCatalog.prototype, 'search').mockResolvedValue({ addons: [], index: 0, pageSize: 20, totalCount: 0 })
    vi.spyOn(CurseForgeCatalog.prototype, 'dispose')
    context = createContext()
    setupWowAddons(context as never)
  })

  afterEach(async () => {
    for (const release of releases.splice(0))
      release()
    await emitAppBeforeQuit()
    const difference = relative(await realpath(tmpdir()), resolve(directory))
    if (isAbsolute(difference) || difference.startsWith(`..${sep}`) || !difference.startsWith('airi-addon-rpc-'))
      throw new Error('Refusing cleanup outside the addon RPC test prefix')
    await rm(directory, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  async function configure() {
    const saved = await defineInvoke(context, wowAddonsSaveSettings)({ clients, apiKey: 'private-fixture-key' })
    expect(saved.ok).toBe(true)
  }

  async function installed(game: AddonGame = 'retail') {
    const response = await defineInvoke(context, wowAddonsInstalled)({ game })
    if (!response.ok)
      throw new Error(response.error)
    return response.data
  }

  it('does not contact CurseForge before a key is saved', async () => {
    const metadata = await defineInvoke(context, wowAddonsMetadata)()
    const search = await defineInvoke(context, wowAddonsSearch)({ game: 'retail', gameVersionTypeId: 901, search: '', index: 0, sort: 'popular' })

    expect(metadata).toEqual({ ok: false, error: 'curseforge-api-key-required' })
    expect(search).toEqual({ ok: false, error: 'wow-addons-version-required' })
    expect(CurseForgeCatalog.prototype.getMetadata).not.toHaveBeenCalled()
    expect(CurseForgeCatalog.prototype.search).not.toHaveBeenCalled()
  })

  it('persists client folders and the encrypted key without returning the key over IPC', async () => {
    await configure()
    const settings = await defineInvoke(context, wowAddonsGetSettings)()
    const stored = await readFile(join(directory, 'userdata', 'wow-addons-v1.json'), 'utf8')

    expect(settings).toEqual({ ok: true, data: { hasApiKey: true, clients } })
    expect(JSON.stringify(settings)).not.toContain('private-fixture-key')
    expect(stored).not.toContain('private-fixture-key')
    expect(electron.encryptString).toHaveBeenCalledExactlyOnceWith('private-fixture-key')
    await emitAppBeforeQuit()
    context = createContext()
    setupWowAddons(context as never)
    expect(await defineInvoke(context, wowAddonsGetSettings)()).toEqual(settings)
    expect((await defineInvoke(context, wowAddonsMetadata)()).ok).toBe(true)
    expect(electron.decryptString).toHaveBeenCalled()
  })

  it('rejects cross-game folders and duplicate client ownership before saving settings', async () => {
    const save = defineInvoke(context, wowAddonsSaveSettings)
    const crossed = structuredClone(clients)
    crossed.forever.directory = clients.retail.directory
    expect(await save({ clients: crossed, apiKey: 'private-fixture-key' })).toEqual({ ok: false, error: 'wow-addons-invalid-directory' })
    const generic = join(directory, 'custom-client')
    await mkdir(generic)
    await writeFile(join(generic, 'Wow.exe'), '')
    const duplicate = structuredClone(clients)
    duplicate.retail.directory = generic
    duplicate.forever.directory = generic
    expect(await save({ clients: duplicate, apiKey: 'private-fixture-key' })).toEqual({ ok: false, error: 'wow-addons-directory-conflict' })
    expect(await defineInvoke(context, wowAddonsGetSettings)()).toMatchObject({ ok: true, data: { hasApiKey: false } })
    expect(electron.encryptString).not.toHaveBeenCalled()
  })

  it('rejects type IDs from another profile before listing files or searching', async () => {
    await configure()
    const list = defineInvoke(context, wowAddonsFiles)
    expect(await list({ game: 'retail', modId: 1, gameVersionTypeId: 902 })).toEqual({ ok: false, error: 'curseforge-incompatible-version' })
    clients.forever.gameVersionTypeId = 901
    expect((await defineInvoke(context, wowAddonsSaveSettings)({ clients })).ok).toBe(true)
    expect(await list({ game: 'forever', modId: 1, gameVersionTypeId: 901 })).toEqual({ ok: false, error: 'curseforge-incompatible-version' })
    expect(await defineInvoke(context, wowAddonsSearch)({ game: 'forever', gameVersionTypeId: 901, search: '', index: 0, sort: 'popular' })).toEqual({ ok: false, error: 'curseforge-incompatible-version' })
    expect(CurseForgeCatalog.prototype.getFiles).not.toHaveBeenCalled()
    expect(CurseForgeCatalog.prototype.search).not.toHaveBeenCalled()
  })

  it('commits a real archive and its receipt before returning installation success', async () => {
    await configure()
    const response = await defineInvoke(context, wowAddonsInstall)({ game: 'retail', modId: 1, fileId: 100 })
    const records = await installed()
    const stored = JSON.parse(await readFile(join(directory, 'userdata', 'wow-addons-v1.json'), 'utf8'))

    expect(response.ok).toBe(true)
    expect(records).toHaveLength(1)
    expect(stored.installed).toEqual(records)
    expect(records[0]).toMatchObject({ game: 'retail', modId: 1, fileId: 100, gameVersionTypeId: 901, clientDirectory: clients.retail.directory, folders: ['Addon1'] })
    expect(CurseForgeCatalog.prototype.download).toHaveBeenCalledWith(expect.objectContaining({ id: 100, modId: 1 }), 901)
    expect(await readFile(join(clients.retail.directory, 'Interface', 'AddOns', 'Addon1', 'Addon1.toc'), 'utf8')).toBe('## Interface: 120001')
    expect(await installed('forever')).toEqual([])
    const alternate = join(directory, '_retail_alt_')
    await mkdir(alternate)
    await writeFile(join(alternate, 'Wow.exe'), '')
    clients.retail.directory = alternate
    expect((await defineInvoke(context, wowAddonsSaveSettings)({ clients })).ok).toBe(true)
    expect(await installed()).toEqual([])
    expect(stored.installed).toHaveLength(1)
  })

  it('installs required dependencies first, prefers releases, and leaves optional dependencies untouched', async () => {
    await configure()
    files.set(1, [{ ...file(1, [2]), dependencies: [{ modId: 2, required: true }, { modId: 3, required: false }] }])
    files.set(2, [{ ...file(2), id: 201, releaseType: 2 }, file(2)])
    const response = await defineInvoke(context, wowAddonsInstall)({ game: 'retail', modId: 1, fileId: 100 })

    expect(response.ok).toBe(true)
    expect(vi.mocked(CurseForgeCatalog.prototype.download).mock.calls.map(([file]) => file.id)).toEqual([200, 100])
    expect((await installed()).map(record => record.modId)).toEqual([2, 1])
    expect(await readdir(join(clients.retail.directory, 'Interface', 'AddOns'))).toEqual(['Addon1', 'Addon2'])
    expect(CurseForgeCatalog.prototype.getMod).not.toHaveBeenCalledWith(3)
  })

  it('rejects dependency cycles before downloading or writing files', async () => {
    await configure()
    files.set(1, [file(1, [2])])
    files.set(2, [file(2, [1])])

    expect(await defineInvoke(context, wowAddonsInstall)({ game: 'retail', modId: 1, fileId: 100 })).toEqual({ ok: false, error: 'wow-addons-dependency-limit' })
    expect(CurseForgeCatalog.prototype.download).not.toHaveBeenCalled()
    expect(await installed()).toEqual([])
    expect(await readdir(join(clients.retail.directory, 'Interface', 'AddOns'))).toEqual([])
  })

  it('limits the complete dependency plan to twenty projects before downloads start', async () => {
    await configure()
    const dependencies = Array.from({ length: 20 }, (_, index) => index + 2)
    files.set(1, [file(1, dependencies)])
    for (const dependency of dependencies)
      files.set(dependency, [file(dependency)])

    expect(await defineInvoke(context, wowAddonsInstall)({ game: 'retail', modId: 1, fileId: 100 })).toEqual({ ok: false, error: 'wow-addons-dependency-limit' })
    expect(CurseForgeCatalog.prototype.download).not.toHaveBeenCalled()
    expect(await installed()).toEqual([])
  })

  it('accepts a dependency plan containing exactly twenty projects', async () => {
    await configure()
    const dependencies = Array.from({ length: 19 }, (_, index) => index + 2)
    files.set(1, [file(1, dependencies)])
    for (const dependency of dependencies)
      files.set(dependency, [file(dependency)])

    expect((await defineInvoke(context, wowAddonsInstall)({ game: 'retail', modId: 1, fileId: 100 })).ok).toBe(true)
    expect(CurseForgeCatalog.prototype.download).toHaveBeenCalledTimes(20)
    expect(await installed()).toHaveLength(20)
  })

  it('stops the entire plan when a required dependency forbids distribution', async () => {
    await configure()
    files.set(1, [file(1, [2])])
    addons.set(2, { ...addon(2), allowDistribution: false })

    expect(await defineInvoke(context, wowAddonsInstall)({ game: 'retail', modId: 1, fileId: 100 })).toEqual({ ok: false, error: 'curseforge-distribution-disabled' })
    expect(CurseForgeCatalog.prototype.download).not.toHaveBeenCalled()
    expect(await installed()).toEqual([])
  })

  it('rejects settings changes and another installation while a download is active', async () => {
    await configure()
    const gate = Promise.withResolvers<Buffer>()
    releases.push(() => gate.resolve(archive(1)))
    vi.mocked(CurseForgeCatalog.prototype.download).mockReturnValueOnce(gate.promise)
    const install = defineInvoke(context, wowAddonsInstall)
    const pending = install({ game: 'retail', modId: 1, fileId: 100 })
    await expect.poll(() => vi.mocked(CurseForgeCatalog.prototype.download).mock.calls.length).toBe(1)

    expect(await defineInvoke(context, wowAddonsSaveSettings)({ clients, clearApiKey: true })).toEqual({ ok: false, error: 'wow-addons-busy' })
    expect(await install({ game: 'retail', modId: 1, fileId: 100 })).toEqual({ ok: false, error: 'wow-addons-busy' })
    gate.resolve(archive(1))
    expect((await pending).ok).toBe(true)
    expect(await defineInvoke(context, wowAddonsGetSettings)()).toMatchObject({ ok: true, data: { hasApiKey: true } })
  })

  it('disposes the catalog and waits for the active filesystem commit before quit completes', async () => {
    await configure()
    const entered = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    releases.push(() => gate.resolve())
    const installArchive = WowAddonInstaller.prototype.installArchive
    vi.spyOn(WowAddonInstaller.prototype, 'installArchive').mockImplementation(function (this: WowAddonInstaller, directory, bytes, details, previous, commit) {
      return installArchive.call(this, directory, bytes, details, previous, async (record) => {
        entered.resolve()
        await gate.promise
        await commit?.(record)
      })
    })
    const pending = defineInvoke(context, wowAddonsInstall)({ game: 'retail', modId: 1, fileId: 100 })
    await entered.promise
    const activeCatalog = vi.mocked(CurseForgeCatalog.prototype.getMetadata).mock.contexts.at(-1)
    const quit = emitAppBeforeQuit()
    let quitFinished = false
    void quit.then(() => {
      quitFinished = true
    })
    expect(activeCatalog).toBeDefined()
    await expect.poll(() => vi.mocked(CurseForgeCatalog.prototype.dispose).mock.contexts.includes(activeCatalog)).toBe(true)

    expect(quitFinished).toBe(false)
    const before = JSON.parse(await readFile(join(directory, 'userdata', 'wow-addons-v1.json'), 'utf8'))
    expect(before.installed).toEqual([])
    gate.resolve()
    expect((await pending).ok).toBe(true)
    await quit
    const stored = JSON.parse(await readFile(join(directory, 'userdata', 'wow-addons-v1.json'), 'utf8'))
    expect(stored.installed).toHaveLength(1)
    expect(quitFinished).toBe(true)
  })

  it('returns a stable error instead of provider details or a credential', async () => {
    await configure()
    vi.mocked(CurseForgeCatalog.prototype.getMod).mockRejectedValueOnce(new Error('Provider response: private-fixture-key'))

    expect(await defineInvoke(context, wowAddonsInstall)({ game: 'retail', modId: 1, fileId: 100 })).toEqual({ ok: false, error: 'wow-addons-request-failed' })
    expect(CurseForgeCatalog.prototype.download).not.toHaveBeenCalled()
  })

  it('returns canceled selections and rejects a selected directory from another game', async () => {
    const choose = defineInvoke(context, wowAddonsChooseDirectory)
    expect(await choose({ game: 'retail' })).toEqual({ ok: true, data: null })
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [clients.retail.directory] })
    expect(await choose({ game: 'forever' })).toEqual({ ok: false, error: 'wow-addons-invalid-directory' })
    expect(electron.showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'], defaultPath: undefined })
  })
})
