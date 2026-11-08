import type { LocalUpdateManifest } from '../../../shared/wow-local-update'

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LocalUpdateFiles } from './wow-local-update-files'

describe('local update directory verification', () => {
  let directory: string
  let target: string
  let updates: LocalUpdateFiles
  let manifest: LocalUpdateManifest

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'wow-local-update-'))
    target = join(directory, 'next release')
    updates = new LocalUpdateFiles(join(directory, 'current'), '2.21.0')
    const payload: Record<string, string> = { 'wow-companion.exe': 'executable fixture', 'resources/app.asar': 'archive fixture', 'resources/wow-companion-release.json': JSON.stringify({ releaseVersion: '2.22.0', appVersion: '0.12.0-beta.5' }) }
    manifest = { format: 'wow-companion-update', version: 1, product: 'wow-companion', platform: 'win32', arch: 'x64', releaseVersion: '2.22.0', appVersion: '0.12.0-beta.5', entry: 'wow-companion.exe', files: Object.entries(payload).map(([path, text]) => ({ path, bytes: text.length, sha256: createHash('sha256').update(text).digest('hex') })) }
    for (const [path, text] of Object.entries(payload)) {
      await mkdir(dirname(join(target, path)), { recursive: true })
      await writeFile(join(target, path), text)
    }
    await saveManifest()
  })
  afterEach(async () => {
    expect(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}wow-local-update-`)).toBe(true)
    await rm(directory, { recursive: true, force: true })
  })
  async function saveManifest() {
    await writeFile(join(target, 'wow-companion-update.json'), JSON.stringify(manifest))
  }

  it('previews all verified files and confirms only its opaque plan once', async () => {
    const preview = await updates.inspect(target)
    expect(preview.releaseVersion).toBe('2.22.0')
    expect(preview.files).toBe(3)
    expect(await updates.confirm(preview.id)).toBe(join(target, 'wow-companion.exe'))
    await expect(updates.confirm(preview.id)).rejects.toThrow('update-invalid')
  })
  it('rejects stale plans and rechecks changed bytes before confirmation', async () => {
    const preview = await updates.inspect(target)
    await writeFile(join(target, 'wow-companion.exe'), 'changed fixture!!!')
    await expect(updates.confirm(preview.id)).rejects.toThrow('update-checksum')
    await expect(updates.confirm('unselected')).rejects.toThrow('update-invalid')
  })
  it('rejects downgrade, same-directory updates, and unsupported architecture', async () => {
    manifest.releaseVersion = '2.21.0'
    await saveManifest()
    await expect(updates.inspect(target)).rejects.toThrow('update-version')
    const sameDirectory = new LocalUpdateFiles(target, '2.20.0')
    await expect(sameDirectory.inspect(target)).rejects.toThrow('update-invalid')
    await writeFile(join(target, 'wow-companion-update.json'), JSON.stringify({ ...manifest, arch: 'arm64' }))
    await expect(updates.inspect(target)).rejects.toThrow()
  })
  it('rejects extra, missing, duplicated and escaping inventory entries', async () => {
    await writeFile(join(target, 'extra.dll'), 'extra')
    await expect(updates.inspect(target)).rejects.toThrow('update-checksum')
    await rm(join(target, 'extra.dll'))
    const original = await readFile(join(target, 'resources', 'app.asar'))
    await rm(join(target, 'resources', 'app.asar'))
    await expect(updates.inspect(target)).rejects.toThrow('update-checksum')
    await writeFile(join(target, 'resources', 'app.asar'), original)
    manifest.files.push({ ...manifest.files[0] })
    await saveManifest()
    await expect(updates.inspect(target)).rejects.toThrow()
    manifest.files.at(-1)!.path = '../outside.exe'
    await saveManifest()
    await expect(updates.inspect(target)).rejects.toThrow()
  })
  it('rejects metadata mismatch even when its own file checksum matches', async () => {
    manifest.appVersion = 'unexpected'
    await saveManifest()
    await expect(updates.inspect(target)).rejects.toThrow('update-version')
  })
})
