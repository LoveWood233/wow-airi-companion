import type { DshPetManifest } from '../../../shared/dsh-pet'

import { mkdir, mkdtemp, readdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse } from 'valibot'
import { afterEach, describe, expect, it } from 'vitest'

import { dshPetPackSchema } from '../../../shared/dsh-pet'
import { DshPetLibrary } from './dsh-pet-library'

const temporaryDirectories: string[] = []
const manifest: DshPetManifest = { version: 1, id: 'sample', name: 'Sample pet', files: ['idle.webm'], animations: { idle: ['idle'], turn: [], drag: [], clicks: [], categories: [] } }
const builtin = parse(dshPetPackSchema, { ...manifest, id: 'builtin', baseUrl: './dsh-pet/builtin' })

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pet-library-'))
  temporaryDirectories.push(root)
  const source = join(root, 'source')
  const destination = join(root, 'library')
  await mkdir(source)
  await writeFile(join(source, 'pack.json'), JSON.stringify(manifest))
  await writeFile(join(source, 'idle.webm'), new Uint8Array([0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0]))
  return { source, destination, library: new DshPetLibrary(destination, builtin) }
}

describe('native DSH animation library', () => {
  it('uses the bundled pack before any settings file exists', async () => {
    const { library } = await fixture()
    expect(await library.read()).toMatchObject({ selectedId: 'builtin', scale: 1, packs: [builtin] })
  })

  it('copies only listed media, assigns a native identity, and restores selection after restart', async () => {
    const { library, source, destination } = await fixture()
    await writeFile(join(source, 'unrelated-private-config.json'), '{"example":"not copied"}')
    const state = await library.importPack(source)
    expect(state.selectedId).not.toBe('sample')
    expect(state.selectedId).toMatch(/^[\da-f-]{36}$/)
    expect(state.packs).toHaveLength(2)
    expect(state.packs[1].baseUrl).toBe(`dsh-pet://packs/${state.selectedId}`)
    expect((await readdir(join(destination, 'packs', state.selectedId))).sort()).toEqual(['idle.webm', 'pack.json'])
    await library.configure({ selectedId: state.selectedId, scale: 1.5 })
    const restored = new DshPetLibrary(destination, builtin)
    expect(await restored.read()).toMatchObject({ selectedId: state.selectedId, scale: 1.5 })
  })

  it('resolves allowlisted media only and rejects arbitrary pack IDs', async () => {
    const { library, source, destination } = await fixture()
    const state = await library.importPack(source)
    expect(await library.resolveAsset(state.selectedId, 'idle.webm')).toBe(join(destination, 'packs', state.selectedId, 'idle.webm'))
    await expect(library.resolveAsset(state.selectedId, '../settings.json')).rejects.toThrow('Unknown animation file')
    await expect(library.resolveAsset('builtin', 'idle.webm')).rejects.toThrow('Unknown animation pack')
  })

  it('rejects path traversal and extra configuration keys in manifests', async () => {
    const { library, source } = await fixture()
    await writeFile(join(source, 'pack.json'), JSON.stringify({ ...manifest, files: ['../idle.webm'] }))
    await expect(library.importPack(source)).rejects.toThrow()
    await writeFile(join(source, 'pack.json'), JSON.stringify({ ...manifest, providerKey: 'synthetic' }))
    await expect(library.importPack(source)).rejects.toThrow()
    expect((await library.read()).packs).toEqual([builtin])
  })

  it('rejects invalid media and removes partial staging copies', async () => {
    const { library, source, destination } = await fixture()
    await writeFile(join(source, 'idle.webm'), 'not a video')
    await expect(library.importPack(source)).rejects.toThrow('Invalid WebM')
    expect(await readdir(join(destination, 'packs'))).toEqual([])
    expect((await library.read()).selectedId).toBe('builtin')
  })

  it('rejects oversized media before copying it', async () => {
    const { library, source, destination } = await fixture()
    await truncate(join(source, 'idle.webm'), 33 * 1024 * 1024)
    await expect(library.importPack(source)).rejects.toThrow('file size')
    expect(await readdir(join(destination, 'packs'))).toEqual([])
  })

  it('rejects a linked source directory', async () => {
    const { library, source } = await fixture()
    const link = join(source, '..', 'linked-source')
    await symlink(source, link, 'junction')
    await expect(library.importPack(link)).rejects.toThrow('links')
  })

  it('serializes concurrent selection and import mutations', async () => {
    const { library, source } = await fixture()
    const [imported] = await Promise.all([library.importPack(source), library.configure({ selectedId: 'builtin', scale: 0.8 })])
    expect(imported.packs).toHaveLength(2)
    expect(await library.read()).toMatchObject({ selectedId: 'builtin', scale: 0.8 })
  })

  it('preserves corrupt selection storage instead of overwriting it', async () => {
    const { library, destination } = await fixture()
    await mkdir(destination)
    await writeFile(join(destination, 'settings.json'), '{broken')
    await expect(library.read()).rejects.toThrow()
    await expect(library.configure({ selectedId: 'builtin', scale: 1 })).rejects.toThrow()
    expect(await readFile(join(destination, 'settings.json'), 'utf8')).toBe('{broken')
  })
})
