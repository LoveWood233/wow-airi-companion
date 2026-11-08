import process from 'node:process'

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Arch, build, Platform } from 'electron-builder'

import { generateReleaseManifest } from './companion-release/files'

/**
 * Produces the dedicated Windows installer and a portable ZIP without publishing.
 *
 * Call stack:
 * companion-release CLI
 *   -> electron-builder
 *     -> beforePack: resource manifest
 *     -> afterSign: executable inventory
 *     -> NSIS and ZIP
 */
async function main() {
  const project = resolve(import.meta.dirname, '..')
  if (process.argv.includes('--manifest-only')) {
    await generateReleaseManifest(project, resolve(project, '..', '..', '..', 'WOWAddons'))
    process.stdout.write('Companion resource manifest generated.\n')
    return
  }
  if (process.platform !== 'win32')
    throw new Error('Companion Windows delivery must be built on Windows')
  const { default: config } = await import('../electron-builder.config')
  const artifacts = await build({
    projectDir: project,
    // Use the installed, dependency-matched runtime instead of downloading another Electron archive.
    config: { ...config, extends: null, electronDist: resolve(project, 'node_modules', 'electron', 'dist') },
    targets: Platform.WINDOWS.createTarget(['nsis', 'zip'], Arch.x64),
    publish: 'never',
  })
  for (const artifact of artifacts)
    process.stdout.write(`${artifact}\n`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await main()
