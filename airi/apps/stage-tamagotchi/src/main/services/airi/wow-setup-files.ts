import type { GameVersion } from '../../../shared/wow-companion'
import type { SetupInspection } from '../../../shared/wow-setup'

import { randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { validateClientDirectory } from './wow-addons-install'

async function safeTree(path: string) {
  const info = await lstat(path)
  if (info.isSymbolicLink())
    throw new Error('unsafe-path')
  if (info.isDirectory()) {
    for (const entry of await readdir(path))
      await safeTree(join(path, entry))
  }
  else if (!info.isFile()) {
    throw new Error('unsafe-path')
  }
}

async function text(path: string) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
    throw new Error('invalid-file')
  return readFile(path, 'utf8')
}

function moduleFiles(toc: string) {
  return toc.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map((line) => {
    if (!/^[\w-]+\.lua$/.test(line))
      throw new Error('invalid-addon-manifest')
    return line
  })
}

/** Owns local addon evidence and explicit installs. Only the selected game's bundled addon can be written. */
export class WowSetupFiles {
  private installing = false
  constructor(private readonly sourceRoot: string, private readonly bundledRoot: string) {}

  private name(game: GameVersion) {
    return game === 'retail' ? 'WoWMapCompanion' : 'WoWForeverCompanion'
  }

  private async source(game: GameVersion) {
    const name = this.name(game)
    for (const root of [this.bundledRoot, this.sourceRoot]) {
      const folder = join(root, name)
      try {
        const toc = await text(join(folder, `${name}.toc`))
        if (game === 'forever' && await text(join(folder, `${name}_Camelot.toc`)) !== toc)
          throw new Error('inconsistent-addon-manifests')
        const files = moduleFiles(toc)
        if (!files.length)
          continue
        await safeTree(folder)
        for (const file of files)
          await text(join(folder, file))
        return { folder, toc, files }
      }
      catch { /* A source checkout and packaged resources are supported delivery locations. */ }
    }
    return undefined
  }

  async inspect(game: GameVersion, directory: string): Promise<SetupInspection> {
    const source = await this.source(game)
    const result: SetupInspection = {
      game,
      directory,
      inspectedAt: Date.now(),
      sourceAvailable: !!source,
      client: { status: 'unconfigured', code: 'choose-client' },
      addon: { status: 'untested', code: 'choose-client' },
      expectedAddonVersion: source?.toc.match(/^## Version:([^\r\n]+)$/m)?.[1]?.trim(),
    }
    if (!directory.trim())
      return result
    try {
      result.directory = await validateClientDirectory(directory, game)
      const flavor = await text(join(result.directory, '.flavor.info'))
      const flavorGame = /wowf|forever|camelot/i.test(flavor) ? 'forever' : /\bwow\b|retail/i.test(flavor) ? 'retail' : undefined
      if (flavorGame && flavorGame !== game)
        throw new Error('wrong-game')
      const build = await text(join(dirname(result.directory), '.build.info'))
      const lines = build.trim().split(/\r?\n/)
      const columns = lines[0]!.split('|').map(column => column.split('!')[0])
      const productIndex = columns.indexOf('Product')
      const versionIndex = columns.indexOf('Version')
      const row = lines.slice(1).map(line => line.split('|')).find(fields => fields[productIndex] === (game === 'retail' ? 'wow' : 'wowf'))
      const version = row?.[versionIndex]
      if (!version || !/^\d+\.\d+\.\d+\.\d+$/.test(version))
        throw new Error('version-unavailable')
      result.clientVersion = version
      if (game === 'forever' && !version.startsWith('1.60.'))
        throw new Error('unsupported-client')
      result.client = { status: 'passed', code: 'client-found' }
    }
    catch {
      result.client = { status: 'failed', code: 'client-invalid' }
      return result
    }
    try {
      const name = this.name(game)
      const folder = join(result.directory, 'Interface', 'AddOns', name)
      const toc = await text(join(folder, `${name}.toc`))
      if (game === 'forever' && await text(join(folder, `${name}_Camelot.toc`)) !== toc)
        throw new Error('inconsistent-addon-manifests')
      await safeTree(folder)
      const files = moduleFiles(toc)
      if (!files.length)
        throw new Error('empty-manifest')
      for (const file of files)
        await text(join(folder, file))
      result.addonVersion = toc.match(/^## Version:([^\r\n]+)$/m)?.[1]?.trim()
      result.addon = result.expectedAddonVersion && result.addonVersion === result.expectedAddonVersion
        ? { status: 'passed', code: 'addon-found' }
        : { status: 'failed', code: 'addon-version' }
    }
    catch {
      result.addon = { status: 'failed', code: 'addon-missing' }
    }
    return result
  }

  async install(game: GameVersion, directory: string) {
    if (this.installing)
      throw new Error('installation-busy')
    this.installing = true
    let stage: string | undefined
    let destination: string | undefined
    let backup: string | undefined
    let moved = false
    try {
      const inspection = await this.inspect(game, directory)
      if (inspection.client.status !== 'passed')
        throw new Error('client-invalid')
      const source = await this.source(game)
      if (!source)
        throw new Error('resources-missing')
      const name = this.name(game)
      const addons = join(inspection.directory, 'Interface', 'AddOns')
      await mkdir(addons, { recursive: true })
      destination = join(addons, name)
      stage = join(addons, `.companion-stage-${randomUUID()}`)
      await mkdir(stage)
      for (const file of [`${name}.toc`, ...source.files])
        await cp(join(source.folder, file), join(stage, file), { errorOnExist: true, force: false })
      if (game === 'forever')
        await cp(join(source.folder, `${name}_Camelot.toc`), join(stage, `${name}_Camelot.toc`))
      try {
        await lstat(destination)
        await safeTree(destination)
        const backups = join(inspection.directory, 'Interface', 'CompanionBackups')
        try {
          const stat = await lstat(backups)
          if (!stat.isDirectory() || stat.isSymbolicLink())
            throw new Error('unsafe-path')
        }
        catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
            throw error
          await mkdir(backups)
        }
        backup = join(backups, `${name}-${Date.now()}-${randomUUID()}`)
        await rename(destination, backup)
        moved = true
      }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
          throw error
      }
      await rename(stage, destination)
      stage = undefined
      return { inspection: await this.inspect(game, inspection.directory), backup }
    }
    catch (error) {
      if (moved && backup && destination)
        await rename(backup, destination)
      throw error
    }
    finally {
      // Stage is a generated child of AddOns. Never remove an installed addon as cleanup.
      if (stage && basename(stage).startsWith('.companion-stage-')) {
        const difference = relative(resolve(directory), stage)
        if (!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`))
          await rm(stage, { recursive: true, force: true })
      }
      this.installing = false
    }
  }
}
