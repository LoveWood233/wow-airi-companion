import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { WowDataUpdateCheck, WowDataUpdateError } from '../../../shared/wow-data-update'
import type { RetailRuntimePaths } from './wow-retail-database-runtime'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import { retailDatabaseResultSchema } from '@proj-airi/stage-shared/wow-knowledge'
import { literal, parse, record, strictObject, string } from 'valibot'

import { CompanionBridgeRuntime } from './wow-companion-runtime'

export class DataUpdateFailure extends Error {
  constructor(readonly code: WowDataUpdateError) { super(code) }
}

/** Owns direct subprocess handles. Cancellation waits for close before callers remove partial files. */
export class WowDataUpdateProcess {
  async run(command: string, args: string[], cwd: string, signal: AbortSignal, line?: (value: string) => void): Promise<string> {
    signal.throwIfAborted()
    const child: ChildProcessWithoutNullStreams = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: 'true', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1', MSBUILDDISABLENODEREUSE: '1' },
    })
    child.stdin.on('error', () => {})
    child.stdin.end()
    let output = ''
    let pending = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (value: string) => {
      output = (output + value).slice(-512 * 1024)
      pending += value
      const lines = pending.split(/\r?\n/)
      pending = lines.pop()!.slice(-4096)
      for (const entry of lines)
        line?.(entry)
    })
    child.stderr.resume()
    const stop = () => child.kill()
    signal.addEventListener('abort', stop, { once: true })
    // Abort can occur between the first check and listener registration.
    if (signal.aborted)
      stop()
    try {
      const code = await new Promise<number | null>((resolveClose, reject) => {
        child.once('error', reject)
        child.once('close', resolveClose)
      })
      signal.throwIfAborted()
      if (code !== 0)
        throw new Error('process-failed')
      if (pending)
        line?.(pending)
      return output
    }
    finally { signal.removeEventListener('abort', stop) }
  }
}

export const offlineToolFiles = [
  'DB2Export/Program.cs',
  'DB2Export/DB2Export.csproj',
  'DB2Export/build_sqlite.py',
  'DB2Export/verify_export.py',
  'CascLib/CascLib/CASCHandlerBase.cs',
  'CascLib/CascLib/IndexHandlerBase.cs',
  'CascLib/CascLib/CASCConfig.cs',
  'DB2Export/bin/Release/net8.0/DB2Export.dll',
  'DB2Export/bin/Release/net8.0/DB2Export.deps.json',
  'DB2Export/bin/Release/net8.0/DB2Export.runtimeconfig.json',
  'DB2Export/bin/Release/net8.0/CascLib.dll',
  'DB2Export/bin/Release/net8.0/DBCD.dll',
  'DB2Export/bin/Release/net8.0/DBCD.IO.dll',
  'DB2Export/bin/Release/net8.0/DBDefsLib.dll',
  'DB2Export/bin/Release/net8.0/MimeKitLite.dll',
] as const

const stampSchema = strictObject({ format: literal('wow-companion-offline-exporter'), version: literal(1), createdAt: string(), files: record(string(), string()) })

/** Hashes one regular file without following links. Large game archives are never accepted as tool metadata. */
export async function hashUpdateFile(path: string, signal?: AbortSignal, maximumBytes = 128 * 1024 * 1024) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximumBytes)
    throw new DataUpdateFailure('tools-root-invalid')
  const digest = createHash('sha256')
  for await (const block of createReadStream(path, { signal }))
    digest.update(block)
  return digest.digest('hex')
}

/** Reads exactly one active Retail row. Its fingerprint binds every export phase to this discovery. */
export async function readActiveRetailBuild(gameRoot: string) {
  const path = join(gameRoot, '.build.info')
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
    throw new DataUpdateFailure('build-info-invalid')
  const bytes = await readFile(path)
  const lines = bytes.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#'))
  const headers = lines.shift()?.split('|').map(value => value.split('!')[0])
  if (!headers || ['Product', 'Active', 'Version'].some(key => !headers.includes(key)))
    throw new DataUpdateFailure('build-info-invalid')
  const rows = lines.map(line => line.split('|')).filter(fields => fields[headers.indexOf('Product')] === 'wow' && fields[headers.indexOf('Active')] === '1')
  if (rows.length !== 1)
    throw new DataUpdateFailure('build-ambiguous')
  const build = rows[0]![headers.indexOf('Version')]
  if (!build || !/^\d+\.\d+\.\d+\.\d+$/.test(build) || build.length > 40)
    throw new DataUpdateFailure('build-info-invalid')
  return { build, hash: createHash('sha256').update(bytes).digest('hex') }
}

/** Verifies the offline preparation stamp and hashes the local definitions as one generation. */
export async function fingerprintUpdateTools(root: string, signal?: AbortSignal) {
  const stampPath = join(root, 'DB2Export', 'offline-build.json')
  const stampInfo = await lstat(stampPath).catch(() => {
    throw new DataUpdateFailure('offline-build-required')
  })
  if (!stampInfo.isFile() || stampInfo.isSymbolicLink() || stampInfo.size > 16_384)
    throw new DataUpdateFailure('offline-build-required')
  const stamp = parse(stampSchema, JSON.parse(await readFile(stampPath, 'utf8')))
  if (Object.keys(stamp.files).length !== offlineToolFiles.length)
    throw new DataUpdateFailure('offline-build-required')
  const digest = createHash('sha256')
  for (const file of offlineToolFiles) {
    signal?.throwIfAborted()
    let parent = root
    for (const part of file.split('/').slice(0, -1)) {
      parent = join(parent, part)
      const directory = await lstat(parent).catch(() => {
        throw new DataUpdateFailure('exporter-missing')
      })
      if (!directory.isDirectory() || directory.isSymbolicLink())
        throw new DataUpdateFailure('tools-root-invalid')
    }
    const hash = await hashUpdateFile(join(root, file), signal)
    if (stamp.files[file] !== hash)
      throw new DataUpdateFailure('offline-build-required')
    digest.update(`${file}:${hash}\n`)
  }
  const guard = await readFile(join(root, 'CascLib', 'CascLib', 'IndexHandlerBase.cs'), 'utf8')
  const source = await readFile(join(root, 'DB2Export', 'Program.cs'), 'utf8')
  const streamGuard = await readFile(join(root, 'CascLib', 'CascLib', 'CASCHandlerBase.cs'), 'utf8')
  const config = await readFile(join(root, 'CascLib', 'CascLib', 'CASCConfig.cs'), 'utf8')
  if (!guard.includes('Local-only mode forbids CDN index downloads.') || !source.includes('CASCConfig.UseOnlineFallbackForMissingFiles = false')
    || !streamGuard.includes('catch when (Config.OnlineMode || CASCConfig.UseOnlineFallbackForMissingFiles)') || !config.includes('SelectActiveProduct(product)')) {
    throw new DataUpdateFailure('offline-guard-missing')
  }
  const manifest = join(root, 'WoWDBDefs', 'manifest.json')
  const definitions = await lstat(join(root, 'WoWDBDefs')).catch(() => {
    throw new DataUpdateFailure('definitions-missing')
  })
  if (!definitions.isDirectory() || definitions.isSymbolicLink())
    throw new DataUpdateFailure('definitions-missing')
  digest.update(`manifest:${await hashUpdateFile(manifest, signal)}\n`)
  const directory = join(root, 'WoWDBDefs', 'definitions')
  const definitionsDirectory = await lstat(directory).catch(() => {
    throw new DataUpdateFailure('definitions-missing')
  })
  if (!definitionsDirectory.isDirectory() || definitionsDirectory.isSymbolicLink())
    throw new DataUpdateFailure('definitions-missing')
  const entries = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.name.endsWith('.dbd')).sort((a, b) => a.name.localeCompare(b.name))
  if (!entries.length || entries.length > 10_000 || entries.some(entry => !entry.isFile() || entry.isSymbolicLink() || !/^[\w-]+\.dbd$/.test(entry.name)))
    throw new DataUpdateFailure('definitions-missing')
  for (const entry of entries) {
    signal?.throwIfAborted()
    digest.update(`${entry.name}:${await hashUpdateFile(join(directory, entry.name), signal)}\n`)
  }
  return digest.digest('hex')
}

/** Binds the export to unchanged local configuration, indexes and archive file generations, without hashing huge archives. */
export async function fingerprintRetailSource(root: string, signal?: AbortSignal) {
  const digest = createHash('sha256')
  digest.update((await readActiveRetailBuild(root)).hash)
  let files = 0
  const scan = async (directory: string, depth: number, hashContents: boolean) => {
    signal?.throwIfAborted()
    if (depth > 8)
      throw new DataUpdateFailure('game-root-invalid')
    const info = await lstat(directory).catch((error) => {
      if (error.code === 'ENOENT')
        return null
      throw error
    })
    if (!info)
      return
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new DataUpdateFailure('game-root-invalid')
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink())
        throw new DataUpdateFailure('game-root-invalid')
      if (entry.isDirectory()) {
        await scan(path, depth + 1, hashContents)
        continue
      }
      if (++files > 50_000 || !entry.isFile())
        throw new DataUpdateFailure('game-root-invalid')
      const metadata = await lstat(path, { bigint: true })
      digest.update(`${relative(root, path)}:${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}\n`)
      if (hashContents || /\.(?:idx|index)$/i.test(entry.name))
        digest.update(await hashUpdateFile(path, signal))
    }
  }
  const data = await lstat(join(root, 'Data')).catch((error) => {
    if (error.code === 'ENOENT')
      return null
    throw error
  })
  if (data && (!data.isDirectory() || data.isSymbolicLink()))
    throw new DataUpdateFailure('game-root-invalid')
  for (const directory of ['config', 'data', 'indices'])
    await scan(join(root, 'Data', directory), 0, directory === 'config')
  return digest.digest('hex')
}

export interface DataUpdateEnvironment {
  python: string
  dotnet: string
  bridgeRoot: string
  fingerprint: string
}

/** Resolves installed runtimes without downloads, then runs the three explicit offline phases. */
export class WowDataUpdateRuntime {
  constructor(private readonly paths: RetailRuntimePaths, readonly processRunner = new WowDataUpdateProcess()) {}

  async inspect(root: string, signal: AbortSignal, check: (value: WowDataUpdateCheck) => void): Promise<DataUpdateEnvironment> {
    if (this.paths.platform !== 'win32')
      throw new DataUpdateFailure('unsupported-platform')
    const prerequisite = new CompanionBridgeRuntime(this.paths)
    let python: string
    try {
      const environment = await prerequisite.inspectEnvironment()
      if (!environment.pythonPath) {
        check({ id: 'python', status: 'missing' })
        throw new DataUpdateFailure('python-missing')
      }
      python = environment.pythonPath
      check({ id: 'python', status: 'ready' })
    }
    finally { await prerequisite.dispose() }
    signal.throwIfAborted()
    try {
      const runtimes = await this.processRunner.run('dotnet', ['--list-runtimes'], root, signal)
      if (!/^Microsoft\.NETCore\.App 8\./m.test(runtimes))
        throw new Error('missing')
      check({ id: 'dotnet', status: 'ready' })
    }
    catch {
      signal.throwIfAborted()
      check({ id: 'dotnet', status: 'missing' })
      throw new DataUpdateFailure('dotnet-missing')
    }
    let fingerprint: string
    try {
      fingerprint = await fingerprintUpdateTools(root, signal)
      for (const id of ['exporter', 'definitions', 'offline-guard'] as const)
        check({ id, status: 'ready' })
    }
    catch (error) {
      signal.throwIfAborted()
      check({ id: 'offline-guard', status: 'invalid' })
      if (error instanceof DataUpdateFailure)
        throw error
      throw new DataUpdateFailure('exporter-missing')
    }
    const bundled = join(this.paths.resourcesPath, 'wow-companion-bridge')
    const source = resolve(this.paths.appPath, '..', '..', '..', 'WOWAddons', 'WoWCompanionBridge')
    const bridgeRoot = await stat(join(bundled, 'retail_query.py')).then(value => value.isFile() ? bundled : source, () => source)
    if (!await stat(join(bridgeRoot, 'retail_query.py')).then(value => value.isFile(), () => false))
      throw new DataUpdateFailure('verification-failed')
    return { python, dotnet: 'dotnet', bridgeRoot, fingerprint }
  }

  async source(environment: DataUpdateEnvironment, database: string, signal: AbortSignal) {
    const script = [
      'import json,sys',
      'from pathlib import Path',
      'from retail_query import RetailDatabase',
      'result=RetailDatabase(Path(sys.argv[1])).execute({"operation":"stats"})',
      'print(json.dumps(result,ensure_ascii=True))',
    ].join('\n')
    const result = parse(retailDatabaseResultSchema, JSON.parse(await this.processRunner.run(environment.python, ['-B', '-c', script, database], environment.bridgeRoot, signal)))
    if (result.outcome !== 'ok' || !result.source || !result.stats)
      throw new DataUpdateFailure('verification-failed')
    return result.source
  }
}
