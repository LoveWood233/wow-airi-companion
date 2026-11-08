import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { WowSetupFiles } from './wow-setup-files'

describe('companion setup file inspection and explicit installation', () => {
  let root: string
  let source: string
  let client: string
  let files: WowSetupFiles
  const name = 'WoWMapCompanion'
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wow-setup-'))
    source = join(root, 'source')
    client = join(root, 'game', '_retail_')
    await mkdir(client, { recursive: true })
    await mkdir(join(source, name), { recursive: true })
    await writeFile(join(client, 'WoW.exe'), 'fixture executable, never launched')
    await writeFile(join(client, '.flavor.info'), 'wow')
    await writeFile(join(root, 'game', '.build.info'), 'Product!STRING:0|Version!STRING:0\nwow|12.1.5.70575\n')
    await writeFile(join(source, name, `${name}.toc`), '## Version: 2.15.0\nMain.lua\n')
    await writeFile(join(source, name, 'Main.lua'), '-- bundled fixture')
    files = new WowSetupFiles(source, join(root, 'bundled'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads version and missing addon without creating an Interface folder', async () => {
    const result = await files.inspect('retail', client)
    expect(result.client.status).toBe('passed')
    expect(result.clientVersion).toBe('12.1.5.70575')
    expect(result.addon.code).toBe('addon-missing')
    expect(await readdir(client)).not.toContain('Interface')
  })
  it('keeps an empty selection unconfigured and rejects a mismatched game', async () => {
    expect((await files.inspect('retail', '')).client.status).toBe('unconfigured')
    expect((await files.inspect('forever', client)).client.status).toBe('failed')
  })
  it('detects incomplete Lua files even when the version matches', async () => {
    const addon = join(client, 'Interface', 'AddOns', name)
    await mkdir(addon, { recursive: true })
    await writeFile(join(addon, `${name}.toc`), '## Version: 2.15.0\nMissing.lua\n')
    expect((await files.inspect('retail', client)).addon.code).toBe('addon-missing')
  })
  it('installs only after an explicit call and preserves the old addon in a backup', async () => {
    const addon = join(client, 'Interface', 'AddOns', name)
    await mkdir(addon, { recursive: true })
    await writeFile(join(addon, `${name}.toc`), '## Version: 1.0.0\nMain.lua\n')
    await writeFile(join(addon, 'Main.lua'), '-- original')
    expect((await files.inspect('retail', client)).addon.code).toBe('addon-version')
    const result = await files.install('retail', client)
    expect(result.inspection.addon.status).toBe('passed')
    expect(await readFile(join(addon, 'Main.lua'), 'utf8')).toBe('-- bundled fixture')
    expect(result.backup).toBeDefined()
    expect(await readFile(join(result.backup!, 'Main.lua'), 'utf8')).toBe('-- original')
    expect(await readdir(join(client, 'Interface', 'AddOns'))).toEqual([name])
  })
  it('rejects incomplete bundled files without replacing the old addon', async () => {
    await files.install('retail', client)
    await rm(join(source, name, 'Main.lua'))
    await expect(files.install('retail', client)).rejects.toThrow('resources-missing')
    expect(await readFile(join(client, 'Interface', 'AddOns', name, 'Main.lua'), 'utf8')).toBe('-- bundled fixture')
  })
  it('rejects path traversal in addon manifests without writing outside AddOns', async () => {
    await writeFile(join(source, name, `${name}.toc`), '## Version: 2.15.0\n../outside.lua\n')
    const report = await files.inspect('retail', client)
    expect(report.sourceAvailable).toBe(false)
    await expect(files.install('retail', client)).rejects.toThrow('resources-missing')
    expect(await readdir(client)).not.toContain('Interface')
  })
  it('requires both Forever manifests and does not confuse its build with Retail', async () => {
    const forever = join(root, 'game', '_forever_')
    const folder = join(source, 'WoWForeverCompanion')
    await mkdir(forever)
    await mkdir(folder)
    await writeFile(join(forever, 'WoW.exe'), 'fixture, never launched')
    await writeFile(join(forever, '.flavor.info'), 'wowf')
    await writeFile(join(root, 'game', '.build.info'), 'Product!STRING:0|Version!STRING:0\nwow|12.1.5.70575\nwowf|1.60.1.70707\n')
    const toc = '## Version: 1.13.0\nMain.lua\n'
    await writeFile(join(folder, 'WoWForeverCompanion.toc'), toc)
    await writeFile(join(folder, 'WoWForeverCompanion_Camelot.toc'), toc)
    await writeFile(join(folder, 'Main.lua'), '-- Forever fixture')
    const result = await files.install('forever', forever)
    expect(result.inspection.clientVersion).toBe('1.60.1.70707')
    expect(result.inspection.addon.status).toBe('passed')
    await rm(join(forever, 'Interface', 'AddOns', 'WoWForeverCompanion', 'WoWForeverCompanion_Camelot.toc'))
    expect((await files.inspect('forever', forever)).addon.code).toBe('addon-missing')
  })
})
