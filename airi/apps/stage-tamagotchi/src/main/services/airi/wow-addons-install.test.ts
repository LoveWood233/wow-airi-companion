import type { AddonGame, InstalledAddon } from '../../../shared/wow-addons'

import { Buffer } from 'node:buffer'
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'

import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { validateClientDirectory, WowAddonInstaller } from './wow-addons-install'

interface ZipFile {
  name: string
  contents?: string
  attributes?: number
  size?: number
  checksum?: number
  compressed?: boolean
}

function archive(files: ZipFile[]) {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  let centralSize = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const contents = Buffer.from(file.contents ?? '')
    const data = file.compressed ? deflateRawSync(contents) : contents
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(file.compressed ? 8 : 0, 8)
    local.writeUInt32LE(file.checksum ?? crc32(contents), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(file.size ?? contents.length, 22)
    local.writeUInt16LE(name.length, 26)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014B50)
    header.writeUInt16LE(0x314, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x800, 8)
    header.writeUInt16LE(file.compressed ? 8 : 0, 10)
    header.writeUInt32LE(file.checksum ?? crc32(contents), 16)
    header.writeUInt32LE(data.length, 20)
    header.writeUInt32LE(file.size ?? contents.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(file.attributes ?? 0, 38)
    header.writeUInt32LE(offset, 42)
    locals.push(local, name, data)
    central.push(header, name)
    offset += local.length + name.length + data.length
    centralSize += header.length + name.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...central, end])
}

const details = {
  game: 'retail' as const,
  modId: 42,
  fileId: 101,
  name: 'Example Addon',
  version: '1.0',
  gameVersionTypeId: 517,
}

describe('wow addon archive installer', () => {
  let directory: string
  let client: string
  let addons: string
  let backups: string
  let installer: WowAddonInstaller

  beforeEach(async () => {
    directory = await mkdtemp(join(await realpath(tmpdir()), 'airi-addon-test-'))
    client = join(directory, 'World of Warcraft', '_retail_')
    addons = join(client, 'Interface', 'AddOns')
    backups = join(directory, 'userdata', 'addon-backups')
    installer = new WowAddonInstaller(backups)
    await mkdir(addons, { recursive: true })
    await writeFile(join(client, 'Wow.exe'), '')
    onTestFinished(async () => {
      const difference = relative(await realpath(tmpdir()), resolve(directory))
      if (isAbsolute(difference) || difference.startsWith(`..${sep}`) || !difference.startsWith('airi-addon-test-'))
        throw new Error('Refusing cleanup outside the addon test prefix')
      await rm(directory, { recursive: true, force: true })
    })
  })

  async function owned(folders: string[], modId = 42): Promise<InstalledAddon> {
    for (const folder of folders) {
      await mkdir(join(addons, folder), { recursive: true })
      await writeFile(join(addons, folder, `${folder}.toc`), 'old version')
      await writeFile(join(addons, folder, 'settings.lua'), 'old data')
    }
    return { ...details, modId, clientDirectory: client, folders, installedAt: '2026-10-01T00:00:00.000Z' }
  }

  it.each(['', 'Interface/AddOns/', 'release/', 'release/Interface/AddOns/'])('installs TOC-bearing folders with the %s packaging prefix', async (prefix) => {
    const bytes = archive([
      { name: `${prefix}First/First.toc`, contents: '## Interface: 120001', compressed: true },
      { name: `${prefix}First/Media/icon.blp`, contents: 'image data' },
      { name: `${prefix}Second/Second_Mainline.toc`, contents: '## Interface: 120001' },
      { name: `${prefix}Second/main.lua`, contents: 'print("addon")' },
    ])
    const commit = vi.fn<(record: InstalledAddon) => Promise<void>>().mockResolvedValue()
    const record = await installer.installArchive(client, bytes, details, [], commit)
    expect(record.folders).toEqual(['First', 'Second'])
    expect(record.clientDirectory).toBe(await realpath(client))
    expect(record.backupPath).toBeUndefined()
    expect(commit).toHaveBeenCalledExactlyOnceWith(record)
    expect(await readFile(join(addons, 'First', 'Media', 'icon.blp'), 'utf8')).toBe('image data')
    expect(await readFile(join(addons, 'Second', 'main.lua'), 'utf8')).toBe('print("addon")')
    expect(await readdir(join(client, 'Interface'))).toEqual(['AddOns'])
    await expect(lstat(join(client, 'WTF'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('updates owned folders, backs up original contents, and removes folders absent from the new archive', async () => {
    const previous = await owned(['First', 'OldModule'])
    const bytes = archive([
      { name: 'First/First.toc', contents: 'new version' },
      { name: 'NewModule/NewModule.toc', contents: 'new module' },
    ])
    const record = await installer.installArchive(client, bytes, { ...details, fileId: 102 }, [previous])
    expect(record.folders).toEqual(['First', 'NewModule'])
    expect(record.backupPath).toBeDefined()
    expect(relative(backups, record.backupPath!)).not.toContain('..')
    expect(await readFile(join(record.backupPath!, 'First', 'First.toc'), 'utf8')).toBe('old version')
    expect(await readFile(join(record.backupPath!, 'OldModule', 'settings.lua'), 'utf8')).toBe('old data')
    expect(await readFile(join(addons, 'First', 'First.toc'), 'utf8')).toBe('new version')
    await expect(lstat(join(addons, 'First', 'settings.lua'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(addons, 'OldModule'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restores all directories when the atomic record commit fails', async () => {
    const previous = await owned(['First', 'OldModule'])
    const bytes = archive([
      { name: 'First/First.toc', contents: 'new version' },
      { name: 'NewModule/NewModule.toc', contents: 'new module' },
    ])
    const commit = vi.fn().mockRejectedValue(new Error('disk full'))
    await expect(installer.installArchive(client, bytes, details, [previous], commit)).rejects.toThrow('wow-addons-install-failed')
    expect(commit).toHaveBeenCalledOnce()
    expect(await readFile(join(addons, 'First', 'First.toc'), 'utf8')).toBe('old version')
    expect(await readFile(join(addons, 'OldModule', 'settings.lua'), 'utf8')).toBe('old data')
    await expect(lstat(join(addons, 'NewModule'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(client, 'Interface'))).toEqual(['AddOns'])
    const saved = await readdir(backups)
    expect(await readFile(join(backups, saved[0], 'First', 'First.toc'), 'utf8')).toBe('old version')
  })

  it.each(['unmanaged', 'different-project', 'different-client', 'different-game'])('rejects an existing folder owned by %s', async (kind) => {
    const previous = await owned(['First'])
    if (kind === 'different-project')
      previous.modId = 99
    if (kind === 'different-client')
      previous.clientDirectory = join(directory, 'another-client')
    if (kind === 'different-game')
      previous.game = 'forever'
    const records = kind === 'unmanaged' ? [] : [previous]
    await expect(installer.installArchive(client, archive([{ name: 'First/First.toc', contents: 'new' }]), details, records))
      .rejects
      .toThrow('wow-addons-folder-conflict')
    expect(await readFile(join(addons, 'First', 'First.toc'), 'utf8')).toBe('old version')
  })

  it.each([
    '../escape.toc',
    '/First/First.toc',
    'C:/First/First.toc',
    'First\\First.toc',
    'First/../escape.toc',
    'First//First.toc',
    'First/./First.toc',
    'First/evil:stream.lua',
    'First/CON.lua',
    'First/com1.lua',
    'First/name. /bad.lua',
    'First/trailing./bad.lua',
    'First/bad\u0000.lua',
    'First/SHORT~1.lua',
    'First/evil.exe',
    'First/evil.DLL',
    'First/evil.cmd',
  ])('rejects the unsafe archive path %s before replacing files', async (name) => {
    const previous = await owned(['First'])
    const bytes = archive([{ name: 'First/First.toc', contents: 'new' }, { name, contents: 'unsafe' }])
    await expect(installer.installArchive(client, bytes, details, [previous])).rejects.toThrow('wow-addons-invalid-archive')
    expect(await readFile(join(addons, 'First', 'First.toc'), 'utf8')).toBe('old version')
  })

  it.each([
    [{ name: 'First/First.toc' }, { name: 'first/other.lua' }],
    [{ name: 'First/First.toc' }, { name: 'First/First.toc' }],
    [{ name: 'First/First.toc' }, { name: 'First/Media' }, { name: 'First/Media/icon.blp' }],
    [{ name: 'First/First.toc' }, { name: 'First/media/a.blp' }, { name: 'First/Media/b.blp' }],
    [{ name: 'First/First.toc' }, { name: 'Other/not-an-addon.lua' }],
    [{ name: 'wrapper/nested/First/First.toc' }],
    [{ name: 'First/not-an-addon.lua' }],
    [{ name: 'First/First.toc' }, { name: 'readme.md' }],
    [{ name: 'First/First.toc' }, { name: 'First/link', attributes: (0o120777 << 16) >>> 0 }],
    [{ name: 'First/First.toc' }, { name: 'First/device', attributes: (0o020666 << 16) >>> 0 }],
    [{ name: 'First/First.toc' }, { name: 'First/reparse', attributes: 0x400 }],
    [{ name: 'First/First.toc' }, { name: 'First/hidden-executable.lua', contents: 'MZexecutable' }],
  ].map(files => ({ files })))('rejects ambiguous packaging, duplicate paths, and non-data entries %#', async ({ files }) => {
    await expect(installer.installArchive(client, archive(files), details, [])).rejects.toThrow('wow-addons-invalid-archive')
    expect(await readdir(addons)).toEqual([])
  })

  it('accepts explicit directory entries alongside implicit parent directories', async () => {
    const bytes = archive([
      { name: 'First/First.toc' },
      { name: 'First/', attributes: (0o040755 << 16) >>> 0 },
      { name: 'First/Media/' },
      { name: 'First/Media/icon.blp', contents: 'icon' },
    ])
    await installer.installArchive(client, bytes, details, [])
    expect(await readFile(join(addons, 'First', 'Media', 'icon.blp'), 'utf8')).toBe('icon')
  })

  it.each([false, true])('rejects CRC failures for compressed=%s without changing installed files', async (compressed) => {
    const previous = await owned(['First'])
    const bytes = archive([{ name: 'First/First.toc', contents: 'corrupt', checksum: 42, compressed }])
    await expect(installer.installArchive(client, bytes, details, [previous])).rejects.toThrow('wow-addons-invalid-archive')
    expect(await readFile(join(addons, 'First', 'First.toc'), 'utf8')).toBe('old version')
    expect(await readdir(join(client, 'Interface'))).toEqual(['AddOns'])
  })

  it('rejects download, expanded-size, and entry-count budgets', async () => {
    await expect(installer.installArchive(client, Buffer.alloc(100 * 1024 * 1024 + 1), details, []))
      .rejects
      .toThrow('wow-addons-invalid-archive')
    await expect(installer.installArchive(client, archive([{ name: 'First/First.toc', compressed: true, size: 300 * 1024 * 1024 + 1 }]), details, []))
      .rejects
      .toThrow('wow-addons-invalid-archive')
    const files = Array.from({ length: 20_001 }, (_, index) => ({ name: `First/${index}.lua` }))
    await expect(installer.installArchive(client, archive(files), details, [])).rejects.toThrow('wow-addons-invalid-archive')
    expect(await readdir(addons)).toEqual([])
  })

  it('rejects malformed ZIP data', async () => {
    await expect(installer.installArchive(client, Buffer.from('not a ZIP'), details, [])).rejects.toThrow('wow-addons-invalid-archive')
  })

  it('rejects a junction in an owned addon without modifying its target', async () => {
    const previous = await owned(['First'])
    const outside = join(directory, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'keep.lua'), 'keep')
    await symlink(outside, join(addons, 'First', 'linked'), 'junction')
    await expect(installer.installArchive(client, archive([{ name: 'First/First.toc' }]), details, [previous]))
      .rejects
      .toThrow('wow-addons-folder-conflict')
    expect(await readFile(join(outside, 'keep.lua'), 'utf8')).toBe('keep')
  })

  it('rejects a junction at the AddOns destination', async () => {
    const outside = join(directory, 'outside')
    await mkdir(outside)
    await rm(addons, { recursive: true })
    await symlink(outside, addons, 'junction')
    await expect(validateClientDirectory(client, 'retail')).rejects.toThrow('wow-addons-invalid-directory')
    expect(await readdir(outside)).toEqual([])
  })

  it('rejects a backup directory inside the game client', async () => {
    const unsafe = new WowAddonInstaller(join(client, 'WTF', 'backups'))
    await expect(unsafe.installArchive(client, archive([{ name: 'First/First.toc' }]), details, []))
      .rejects
      .toThrow('wow-addons-invalid-directory')
    await expect(lstat(join(client, 'WTF'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a junction in the backup directory before replacing files', async () => {
    const previous = await owned(['First'])
    const outside = join(directory, 'outside')
    await mkdir(outside)
    await mkdir(join(directory, 'userdata'))
    await symlink(outside, backups, 'junction')
    await expect(installer.installArchive(client, archive([{ name: 'First/First.toc', contents: 'new' }]), details, [previous]))
      .rejects
      .toThrow('wow-addons-invalid-directory')
    expect(await readFile(join(addons, 'First', 'First.toc'), 'utf8')).toBe('old version')
    expect(await readdir(outside)).toEqual([])
  })

  it('rejects relative paths, the shared game root, and client directories without a WoW executable', async () => {
    await expect(validateClientDirectory('relative', 'retail')).rejects.toThrow('wow-addons-invalid-directory')
    await expect(validateClientDirectory(join(client, '..'), 'retail')).rejects.toThrow('wow-addons-invalid-directory')
    await rm(join(client, 'Wow.exe'))
    await expect(validateClientDirectory(client, 'retail')).rejects.toThrow('wow-addons-invalid-directory')
  })

  it.each([
    ['_classic_', 'classic', 'WowClassic.exe'],
    ['_classic_era_', 'classic', 'WowClassic.exe'],
    ['_anniversary_', 'classic', 'WowClassic.exe'],
    ['_classic_titan_', 'classic', 'WowClassic.exe'],
    ['_forever_', 'forever', 'WoWF.exe'],
    ['_forever_beta_', 'forever', 'WoWF.exe'],
    ['_camelot_', 'forever', 'WoWF.exe'],
  ] as const)('accepts %s only for %s', async (name, game, executable) => {
    const root = join(directory, name)
    await mkdir(root)
    await writeFile(join(root, executable), '')
    expect(await validateClientDirectory(root, game)).toBe(await realpath(root))
    const others: AddonGame[] = ['retail', 'classic', 'forever'].filter((value): value is AddonGame => value !== game)
    for (const other of others)
      await expect(validateClientDirectory(root, other)).rejects.toThrow('wow-addons-invalid-directory')
  })
})
