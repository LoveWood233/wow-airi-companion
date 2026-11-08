import type { RetailRuntimePaths } from './wow-retail-database-runtime'

import process from 'node:process'

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { WowDataCache } from './wow-data-cache'
import { WowRetailDatabaseRuntime } from './wow-retail-database-runtime'
import { WowRetailDatabaseService } from './wow-retail-database-service'

const run = promisify(execFile)
const python = process.env.AIRI_WOW_RUNTIME_TEST_PYTHON
const bridgeDirectory = process.env.AIRI_WOW_RETAIL_TEST_BRIDGE_DIR
const integration = it.runIf(process.platform === 'win32' && Boolean(python) && Boolean(bridgeDirectory))
const prefix = 'airi-wow-retail-integration-'
const baseUrl = 'http://127.0.0.1:18767'

describe.sequential('owned Retail query service against the real Python backend', () => {
  let directory: string
  let source: string
  let config: string
  let paths: RetailRuntimePaths
  let firstDatabase: string
  let secondDatabase: string
  let badDatabase: string
  let service: WowRetailDatabaseService
  const runtimes: WowRetailDatabaseRuntime[] = []
  const caches: WowDataCache[] = []
  let portAvailable = false

  beforeAll(async () => {
    const listener = createServer()
    portAvailable = await new Promise<boolean>((resolvePort) => {
      listener.once('error', () => resolvePort(false))
      listener.listen(18767, '127.0.0.1', () => listener.close(() => resolvePort(true)))
    })
  })

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), prefix))
    paths = {
      appPath: join(directory, 'airi', 'apps', 'stage-tamagotchi'),
      resourcesPath: join(directory, 'resources'),
      userDataPath: join(directory, 'data'),
      platform: 'win32',
    }
    source = join(directory, 'WOWAddons', 'WoWCompanionBridge')
    config = join(paths.userDataPath, 'retail-selection.json')
    firstDatabase = join(directory, 'first.sqlite3')
    secondDatabase = join(directory, 'second.sqlite3')
    badDatabase = join(directory, 'invalid.sqlite3')
    service = new WowRetailDatabaseService(config, paths)
  })

  afterEach(async () => {
    await service.dispose()
    await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()))
    await Promise.all(caches.splice(0).map(cache => cache.dispose()))
    vi.unstubAllEnvs()
    // Recursive cleanup only accepts a direct child of the system temp directory with this generated prefix.
    const target = await realpath(directory)
    const temporaryRoot = await realpath(tmpdir())
    const child = relative(temporaryRoot, target)
    if (dirname(target).toLowerCase() !== temporaryRoot.toLowerCase() || child.includes('/') || child.includes('\\') || !basename(target).startsWith(prefix))
      throw new Error('Refusing Retail integration cleanup outside its temporary prefix')
    await rm(target, { recursive: true, force: true })
  })

  async function prepare() {
    if (!python || !bridgeDirectory)
      throw new Error('Set the installed Python and real bridge directory for integration tests')
    vi.stubEnv('PATH', dirname(python))
    await mkdir(source, { recursive: true })
    const files = ['server.py', 'retail_query.py', 'protocol.py', 'state.py', 'capture.py', 'geometry.py', 'connection.py', 'window.py', 'macro_import.py', 'macro_native.py', 'index.html', 'test_retail_query.py']
    await Promise.all(files.map(file => copyFile(join(bridgeDirectory, file), join(source, file))))
    await run(python, ['-B', '-c', [
      'import sys,json,sqlite3',
      'from pathlib import Path',
      'from test_retail_query import create_database',
      'create_database(Path(sys.argv[1]))',
      'create_database(Path(sys.argv[2]))',
      'with sqlite3.connect(sys.argv[2]) as db:',
      ' db.execute("UPDATE ItemSparse SET Display_lang=? WHERE ID=1", ("Second snapshot",))',
      ' db.execute("UPDATE _export_metadata SET value=? WHERE key=\\\'build\\\'", (json.dumps("12.1.5.70576"),))',
      'db.close()',
    ].join('\n'), firstDatabase, secondDatabase], { cwd: source, windowsHide: true })
    await writeFile(badDatabase, 'This file is not a DB2 SQLite export', 'utf8')
  }

  async function digest(path: string) {
    const bytes = await readFile(path)
    return createHash('sha256').update(bytes).digest('hex')
  }

  it('status and invalid or unconfigured queries do not start a child or create configuration', async () => {
    expect(await service.status()).toEqual({ configured: false, revision: 0 })
    expect((await service.query({ operation: 'stats' })).errorCode).toBe('database-unconfigured')
    expect((await service.query({ operation: 'stats', path: firstDatabase })).errorCode).toBe('query-invalid')
    expect((await service.query({ operation: 'fetch', id: 'recipe:1' })).errorCode).toBe('query-invalid')
    await expect(stat(config)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(source)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  integration('selects a real export and queries all six kinds with token ownership and precise metadata', async (context) => {
    if (!portAvailable)
      context.skip('Fixed port 18767 already has a listener. No foreign process is stopped.')
    await prepare()
    const selected = await service.select(firstDatabase)
    expect(selected.configured).toBe(true)
    expect(selected.path).toBe(await realpath(firstDatabase))
    expect(selected.errorCode).toBeUndefined()
    expect(JSON.parse(await readFile(config, 'utf8'))).toEqual({ path: await realpath(firstDatabase) })
    expect((await fetch(`${baseUrl}/health`)).status).toBe(403)
    for (const id of ['item:1', 'map:0', 'uimap:0', 'area:3', 'spell:133', 'encounter:7']) {
      const result = await service.query({ operation: 'fetch', id })
      expect(result.outcome).toBe('ok')
      expect(result.entries[0]?.id).toBe(id)
      expect(result.source?.name).toBe('正式服本地 DB2')
      expect(result.source?.exportedAt).toBe('2026-10-30T15:32:33.5754384+00:00')
      expect(JSON.stringify(result)).not.toContain(directory)
      expect(JSON.stringify(result)).not.toContain('PRIVATE_GAME_PATH')
    }
    const search = await service.query({ operation: 'search', kind: 'item', query: '测试材料', limit: 1 })
    expect(search.entries[0]?.id).toBe('item:1')
    expect(search.hasMore).toBe(true)
    const stats = await service.query({ operation: 'stats' })
    expect(stats.stats?.counts.item).toBe(5)
    await expect(stat(join(source, 'bridge-config.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)

  integration('a rejected database selection preserves the previous durable source and its bytes', async (context) => {
    if (!portAvailable)
      context.skip('Fixed port 18767 already has a listener. No foreign process is stopped.')
    await prepare()
    const before = await digest(firstDatabase)
    await service.select(firstDatabase)
    const original = await readFile(config, 'utf8')
    const invalid = await service.select(badDatabase)
    expect(invalid.configured).toBe(true)
    expect(invalid.errorCode).toBe('database-invalid')
    expect(await readFile(config, 'utf8')).toBe(original)
    const result = await service.query({ operation: 'fetch', id: 'item:1' })
    expect(result.outcome).toBe('ok')
    expect(result.source?.build).toBe('12.1.5.70575')
    expect(await digest(firstDatabase)).toBe(before)
  }, 30_000)

  integration('clears the selection and shuts down only its owned query child without changing the export', async (context) => {
    if (!portAvailable)
      context.skip('Fixed port 18767 already has a listener. No foreign process is stopped.')
    await prepare()
    const before = await digest(firstDatabase)
    const modifiedAt = (await stat(firstDatabase)).mtimeMs
    await service.select(firstDatabase)
    expect((await fetch(`${baseUrl}/health`)).status).toBe(403)
    const cleared = await service.select(null)
    expect(cleared.configured).toBe(false)
    expect(JSON.parse(await readFile(config, 'utf8'))).toEqual({ path: null })
    expect((await service.query({ operation: 'stats' })).errorCode).toBe('database-unconfigured')
    await expect(fetch(`${baseUrl}/health`)).rejects.toThrow()
    expect(await digest(firstDatabase)).toBe(before)
    expect((await stat(firstDatabase)).mtimeMs).toBe(modifiedAt)
  }, 30_000)

  integration('a later adjacent selection wins and queries cannot return the discarded candidate snapshot', async (context) => {
    if (!portAvailable)
      context.skip('Fixed port 18767 already has a listener. No foreign process is stopped.')
    await prepare()
    const first = service.select(firstDatabase)
    const stale = service.query({ operation: 'fetch', id: 'item:1' })
    const second = service.select(secondDatabase)
    const [discarded, selected] = await Promise.all([stale, second, first]).then(results => [results[0], results[1]] as const)
    expect(discarded.errorCode).toBe('database-changed')
    expect(discarded.entries).toEqual([])
    expect(selected.path).toBe(await realpath(secondDatabase))
    const result = await service.query({ operation: 'fetch', id: 'item:1' })
    expect(result.entries[0]?.title).toBe('Second snapshot')
    expect(result.source?.build).toBe('12.1.5.70576')
    expect(JSON.parse(await readFile(config, 'utf8'))).toEqual({ path: await realpath(secondDatabase) })
  }, 30_000)

  integration('runtime disposal closes the real parent pipe and releases the fixed query port', async (context) => {
    if (!portAvailable)
      context.skip('Fixed port 18767 already has a listener. No foreign process is stopped.')
    await prepare()
    const runtime = new WowRetailDatabaseRuntime(paths, firstDatabase)
    runtimes.push(runtime)
    expect((await runtime.query({ operation: 'stats' })).outcome).toBe('ok')
    await runtime.dispose()
    await expect(fetch(`${baseUrl}/health`)).rejects.toThrow()
    await expect(runtime.query({ operation: 'stats' })).rejects.toThrow()
    expect(await digest(firstDatabase)).toMatch(/^[a-f0-9]{64}$/)
  }, 30_000)

  integration('a query already awaiting the real backend cannot publish its source after selection changes', async (context) => {
    if (!portAvailable)
      context.skip('Fixed port 18767 already has a listener. No foreign process is stopped.')
    await prepare()
    await run(python!, ['-B', '-c', [
      'import sqlite3,sys',
      'db=sqlite3.connect(sys.argv[1])',
      'db.executemany("INSERT INTO SpellName(ID,Name_lang) VALUES (?,?)", ((i,"Slow fixture "+str(i)) for i in range(1000000,1100000)))',
      'db.execute("UPDATE _export_tables SET rows=(SELECT COUNT(*) FROM SpellName) WHERE name=\\\'SpellName\\\'")',
      'db.commit()',
      'db.close()',
    ].join('\n'), firstDatabase], { cwd: source, windowsHide: true })
    await service.select(firstDatabase)
    const pending = service.query({ operation: 'search', kind: 'spell', query: 'No matching fixture name', limit: 1 })
    await new Promise<void>(resolveTurn => setImmediate(resolveTurn))
    const selection = service.select(secondDatabase)
    const [discarded, selected] = await Promise.all([pending, selection])
    expect(discarded.errorCode).toBe('database-changed')
    expect(discarded.source).toBeNull()
    expect(discarded.entries).toEqual([])
    expect(selected.path).toBe(await realpath(secondDatabase))
    expect((await service.query({ operation: 'fetch', id: 'item:1' })).entries[0]?.title).toBe('Second snapshot')
  }, 30_000)

  integration('query cache preserves SQL receipts and cannot cross selected snapshot identities', async (context) => {
    if (!portAvailable)
      context.skip('Fixed port 18767 already has a listener. No foreign process is stopped.')
    await prepare()
    await service.dispose()
    const cacheRoot = join(directory, 'query-cache')
    const cache = new WowDataCache(cacheRoot)
    caches.push(cache)
    service = new WowRetailDatabaseService(config, paths, cache)
    await service.select(firstDatabase)
    const first = await service.query({ operation: 'fetch', id: 'item:1' })
    expect(first.cache?.status).toBe('miss')
    const cached = await service.query({ operation: 'fetch', id: 'item:1' })
    expect(cached.cache?.status).toBe('hit')
    expect(cached.receivedAt).toBe(first.receivedAt)
    expect(cached.cache?.sourceReceivedAt).toBe(first.receivedAt)
    expect(Date.parse(cached.cache!.servedAt)).toBeGreaterThanOrEqual(Date.parse(first.receivedAt))
    await service.select(secondDatabase)
    const next = await service.query({ operation: 'fetch', id: 'item:1' })
    expect(next.cache?.status).toBe('miss')
    expect(next.entries[0]?.title).toBe('Second snapshot')
    expect(next.source?.build).toBe('12.1.5.70576')
    expect(next.source?.datasetId).not.toBe(first.source?.datasetId)
    for (const file of await readdir(cacheRoot)) {
      const text = await readFile(join(cacheRoot, file), 'utf8')
      expect(text).not.toContain(directory.replaceAll('\\', '\\\\'))
    }
  }, 30_000)

  integration('clearing query cache forces a new SQL result while preserving the selected source', async (context) => {
    if (!portAvailable)
      context.skip('Fixed port 18767 already has a listener. No foreign process is stopped.')
    await prepare()
    await service.dispose()
    const cache = new WowDataCache(join(directory, 'query-cache'))
    caches.push(cache)
    service = new WowRetailDatabaseService(config, paths, cache)
    await service.select(firstDatabase)
    const before = await digest(firstDatabase)
    const first = await service.query({ operation: 'search', kind: 'item', query: 'Test', limit: 20 })
    expect(first.cache?.status).toBe('miss')
    expect((await service.query({ operation: 'search', kind: 'item', query: 'Test', limit: 20 })).cache?.status).toBe('hit')
    await cache.clear()
    const refreshed = await service.query({ operation: 'search', kind: 'item', query: 'Test', limit: 20 })
    expect(refreshed.cache?.status).toBe('miss')
    expect(refreshed.source?.datasetId).toBe(first.source?.datasetId)
    expect((await service.status()).path).toBe(await realpath(firstDatabase))
    expect(await digest(firstDatabase)).toBe(before)
  }, 30_000)

  integration('snapshot cleanup holds a selection lease and never cleans the newly selected directory', async (context) => {
    if (!portAvailable)
      context.skip('Fixed port 18767 already has a listener. No foreign process is stopped.')
    await prepare()
    const snapshot = join(directory, 'managed-snapshot')
    await mkdir(snapshot)
    const candidate = join(snapshot, 'retail.sqlite3')
    await copyFile(secondDatabase, candidate)
    await service.select(firstDatabase)
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolveStarted) => {
      entered = resolveStarted
    })
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const lease = service.withUnselectedSnapshot(snapshot, async () => {
      entered()
      await gate
      expect((await service.status()).path).toBe(await realpath(firstDatabase))
    })
    await started
    let selected = false
    const selection = service.select(candidate).then((value) => {
      selected = true
      return value
    })
    try {
      await new Promise(resolveWait => setTimeout(resolveWait, 50))
      expect(selected).toBe(false)
    }
    finally { release() }
    expect(await lease).toBe(true)
    expect((await selection).path).toBe(await realpath(candidate))
    let removed = false
    expect(await service.withUnselectedSnapshot(snapshot, async () => {
      removed = true
    })).toBe(false)
    expect(removed).toBe(false)
    expect((await service.query({ operation: 'fetch', id: 'map:0' })).outcome).toBe('ok')
  }, 30_000)

  integration('an unrelated listener is neither reused nor stopped when owned startup cannot bind', async (context) => {
    if (!portAvailable)
      context.skip('Fixed port 18767 already has a listener. No foreign process is stopped.')
    await prepare()
    const external = createHttpServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: true, service: 'wow-companion-bridge', mode: 'query-only', game: 'retail', protocol: 'WCP1', version: '2.17.0', capabilities: ['retail-db2'], instanceId: 'another-owned-instance' }))
    })
    await new Promise<void>(resolveListening => external.listen(18767, '127.0.0.1', resolveListening))
    try {
      const runtime = new WowRetailDatabaseRuntime(paths, firstDatabase)
      runtimes.push(runtime)
      await expect(runtime.query({ operation: 'stats' })).rejects.toThrow('bridge-unavailable')
      await runtime.dispose()
      expect((await (await fetch(`${baseUrl}/health`)).json()).instanceId).toBe('another-owned-instance')
    }
    finally {
      external.closeAllConnections()
      await new Promise<void>((resolveClose, reject) => external.close(error => error ? reject(error) : resolveClose()))
    }
  }, 30_000)
})
