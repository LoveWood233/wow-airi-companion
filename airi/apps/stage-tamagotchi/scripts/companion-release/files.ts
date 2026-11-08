import type { CompanionRelease } from '../../src/shared/wow-delivery'
import type { LocalUpdateManifest } from '../../src/shared/wow-local-update'

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { parse } from 'valibot'

import { companionBridgeFiles, companionReleaseSchema } from '../../src/shared/wow-delivery'
import { localUpdateManifestSchema } from '../../src/shared/wow-local-update'

/** Product releases advance independently from the upstream Electron package version. */
export const companionReleaseVersion = '2.27.1'

async function regularFile(path: string) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Release input is not a regular file: ${path}`)
  return info
}

async function digest(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path))
    hash.update(chunk)
  return hash.digest('hex')
}

async function sourceText(path: string) {
  if ((await regularFile(path)).size > 64 * 1024 * 1024)
    throw new Error(`Release source exceeds the size limit: ${path}`)
  return readFile(path, 'utf8')
}

/** Enumerates concrete payload bytes. Links and special files never enter an executable update inventory. */
async function inventory(root: string, prefix = ''): Promise<LocalUpdateManifest['files']> {
  const result: LocalUpdateManifest['files'] = []
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (path === 'wow-companion-update.json')
      continue
    const absolute = join(root, path)
    const info = await lstat(absolute)
    if (info.isSymbolicLink())
      throw new Error(`Release payload contains a link: ${path}`)
    if (info.isDirectory())
      result.push(...await inventory(root, path))
    else if (info.isFile())
      result.push({ path, bytes: info.size, sha256: await digest(absolute) })
    else
      throw new Error(`Release payload contains a special file: ${path}`)
  }
  return result
}

/** Binds each bundled addon, bridge module, and isolated Python runtime file to the release before packaging. */
export async function generateReleaseManifest(projectDirectory: string, sourceRoot: string): Promise<CompanionRelease> {
  const packageFile: unknown = JSON.parse(await sourceText(join(projectDirectory, 'package.json')))
  if (!packageFile || typeof packageFile !== 'object' || !('version' in packageFile) || typeof packageFile.version !== 'string')
    throw new Error('Application package version is missing')
  const bridge = join(sourceRoot, 'WoWCompanionBridge')
  const server = await sourceText(join(bridge, 'server.py'))
  const bridgeVersion = server.match(/^VERSION\s*=\s*["']([^"']+)["']/m)?.[1]
  const files: CompanionRelease['files'] = []
  const addons = { retail: '', forever: '' }
  for (const [game, name] of [['retail', 'WoWMapCompanion'], ['forever', 'WoWForeverCompanion']] as const) {
    const folder = join(sourceRoot, name)
    const directory = await lstat(folder)
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw new Error(`Release addon folder is invalid: ${name}`)
    const toc = await sourceText(join(folder, `${name}.toc`))
    const version = toc.match(/^## Version:\s*([^\r\n]+)/m)?.[1]?.trim()
    if (!version)
      throw new Error(`Release addon version is missing: ${name}`)
    addons[game] = version
    if (game === 'forever' && await sourceText(join(folder, `${name}_Camelot.toc`)) !== toc)
      throw new Error('Infinite addon TOC files differ')
    const modules = toc.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    if (!modules.length || modules.some(file => !/^[\w-]+\.lua$/.test(file)))
      throw new Error(`Release addon TOC references an invalid module: ${name}`)
    for (const module of modules)
      await sourceText(join(folder, module))
    for (const file of (await readdir(folder)).filter(file => /\.(?:toc|lua)$/.test(file)).sort()) {
      const path = join(folder, file)
      await sourceText(path)
      files.push({ path: `wow-companion-addons/${name}/${file}`, bytes: (await regularFile(path)).size, sha256: await digest(path) })
    }
  }
  for (const file of companionBridgeFiles) {
    const path = join(bridge, file)
    await sourceText(path)
    files.push({ path: `wow-companion-bridge/${file}`, bytes: (await regularFile(path)).size, sha256: await digest(path) })
  }
  const python = join(projectDirectory, 'resources', 'wow-companion-python')
  const pythonDirectory = await lstat(python)
  if (!pythonDirectory.isDirectory() || pythonDirectory.isSymbolicLink())
    throw new Error('Release Python directory is invalid')
  const pythonFiles = (await readdir(python)).sort()
  if (!pythonFiles.includes('python.exe') || !pythonFiles.includes('LICENSE.txt')
    || !pythonFiles.some(file => /^python3\d+\.zip$/.test(file))
    || !pythonFiles.some(file => /^python3\d+\._pth$/.test(file))) {
    throw new Error('Release Python runtime is incomplete')
  }
  for (const file of pythonFiles) {
    const path = join(python, file)
    files.push({ path: `wow-companion-python/${file}`, bytes: (await regularFile(path)).size, sha256: await digest(path) })
  }
  const manifest = parse(companionReleaseSchema, {
    format: 'wow-companion-release',
    version: 1,
    releaseVersion: companionReleaseVersion,
    appVersion: packageFile.version,
    bridgeVersion,
    addons,
    python: { minimum: '3.10', modules: [] },
    files,
  })
  await mkdir(join(projectDirectory, 'resources'), { recursive: true })
  await writeFile(join(projectDirectory, 'resources', 'wow-companion-release.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

/** Runs after Windows resource editing and signing. NSIS and ZIP both receive the final executable byte inventory. */
export async function writeUpdateManifest(appOutDirectory: string): Promise<LocalUpdateManifest> {
  const directory = resolve(appOutDirectory)
  const release = parse(companionReleaseSchema, JSON.parse(await sourceText(join(directory, 'resources', 'wow-companion-release.json'))))
  for (const file of release.files) {
    const path = join(directory, 'resources', file.path)
    if ((await regularFile(path)).size !== file.bytes || await digest(path) !== file.sha256)
      throw new Error(`Bundled resource differs from its release manifest: ${file.path}`)
  }
  const manifest = parse(localUpdateManifestSchema, {
    format: 'wow-companion-update',
    version: 1,
    product: 'wow-companion',
    platform: 'win32',
    arch: 'x64',
    releaseVersion: release.releaseVersion,
    appVersion: release.appVersion,
    entry: 'wow-companion.exe',
    files: await inventory(directory),
  })
  await writeFile(join(directory, 'wow-companion-update.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}
