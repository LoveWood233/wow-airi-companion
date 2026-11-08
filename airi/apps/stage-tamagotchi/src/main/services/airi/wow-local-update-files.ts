import type { LocalUpdateManifest, LocalUpdatePreview } from '../../../shared/wow-local-update'

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import { gt, valid } from 'semver'
import { object, parse, string } from 'valibot'

import { localUpdateManifestSchema } from '../../../shared/wow-local-update'
import { readBackupText } from './wow-backup-files'

/** Verifies an extracted update in place. The previous installation is never overwritten or removed. */
export class LocalUpdateFiles {
  private plan: { preview: LocalUpdatePreview, manifest: LocalUpdateManifest } | undefined
  constructor(private readonly currentDirectory: string, private readonly currentVersion: string) {}

  private async verify(directory: string) {
    const root = resolve(directory)
    if (root.toLowerCase() === resolve(this.currentDirectory).toLowerCase() || !valid(this.currentVersion))
      throw new Error('update-invalid')
    const raw = await readBackupText(join(root, 'wow-companion-update.json'), 16 * 1024 * 1024)
    if (!raw)
      throw new Error('update-invalid')
    const manifest = parse(localUpdateManifestSchema, JSON.parse(raw))
    if (!gt(manifest.releaseVersion, this.currentVersion))
      throw new Error('update-version')
    const actual = new Set<string>()
    let entries = 0
    async function walk(path: string, depth = 0) {
      if (++entries > 50_000 || depth > 64)
        throw new Error('update-invalid')
      const stat = await lstat(path)
      if (stat.isSymbolicLink())
        throw new Error('update-invalid')
      if (stat.isDirectory()) {
        for (const entry of await readdir(path))
          await walk(join(path, entry), depth + 1)
      }
      else if (stat.isFile()) {
        actual.add(path.slice(root.length + 1).split(sep).join('/'))
        if (actual.size > 30_001)
          throw new Error('update-invalid')
      }
      else {
        throw new Error('update-invalid')
      }
    }
    const resourceRoot = (await realpath(root)).toLowerCase()
    await walk(root)
    actual.delete('wow-companion-update.json')
    if (actual.size !== manifest.files.length)
      throw new Error('update-checksum')
    for (const file of manifest.files) {
      if (!actual.has(file.path))
        throw new Error('update-checksum')
      const path = join(root, ...file.path.split('/'))
      if (!(await realpath(path)).toLowerCase().startsWith(`${resourceRoot}${sep}`) || (await lstat(path)).size !== file.bytes)
        throw new Error('update-checksum')
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path))
        hash.update(chunk)
      if (hash.digest('hex') !== file.sha256)
        throw new Error('update-checksum')
    }
    const release = parse(object({ releaseVersion: string(), appVersion: string() }), JSON.parse((await readBackupText(join(root, 'resources', 'wow-companion-release.json'))) ?? 'null'))
    if (release.releaseVersion !== manifest.releaseVersion || release.appVersion !== manifest.appVersion)
      throw new Error('update-version')
    return manifest
  }

  async inspect(directory: string): Promise<LocalUpdatePreview> {
    this.plan = undefined
    const manifest = await this.verify(directory)
    const preview: LocalUpdatePreview = { id: randomUUID(), directory: resolve(directory), releaseVersion: manifest.releaseVersion, appVersion: manifest.appVersion, files: manifest.files.length, bytes: manifest.files.reduce((size, file) => size + file.bytes, 0) }
    this.plan = { preview, manifest }
    return preview
  }

  /** Rechecks bytes immediately before launch. A preview ID cannot choose an executable or change its directory. */
  async confirm(id: string) {
    const plan = this.plan
    this.plan = undefined
    if (!plan || plan.preview.id !== id)
      throw new Error('update-invalid')
    const current = await this.verify(plan.preview.directory)
    if (JSON.stringify(current) !== JSON.stringify(plan.manifest))
      throw new Error('update-checksum')
    return join(plan.preview.directory, current.entry)
  }
}
