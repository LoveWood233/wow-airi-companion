import type { RetailRuntimePaths } from './wow-retail-database-runtime'

import process from 'node:process'

import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { offlineToolFiles, readActiveRetailBuild, WowDataUpdateProcess, WowDataUpdateRuntime } from './wow-data-update-runtime'
import { WowDataUpdateService } from './wow-data-update-service'
import { WowRetailDatabaseService } from './wow-retail-database-service'

const configFlushGate = vi.hoisted(() => ({ prefix: undefined as string | undefined, entered: undefined as (() => void) | undefined, release: undefined as Promise<void> | undefined, releaseNow: undefined as (() => void) | undefined }))

// Defer one real fsync after its temporary file contains the old root, reproducing the dangerous commit window.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async open(...args: Parameters<typeof actual.open>) {
      const handle = await actual.open(...args)
      if (configFlushGate.prefix && String(args[0]).startsWith(configFlushGate.prefix)) {
        configFlushGate.prefix = undefined
        const sync = handle.sync.bind(handle)
        const release = configFlushGate.release
        handle.sync = async () => {
          await sync()
          configFlushGate.entered?.()
          await release
        }
      }
      return handle
    },
  }
})

const python = process.env.AIRI_WOW_RUNTIME_TEST_PYTHON
const bridge = process.env.AIRI_WOW_RETAIL_TEST_BRIDGE_DIR
const tools = process.env.AIRI_WOW_UPDATE_TEST_TOOLS_DIR
const integration = it.runIf(process.platform === 'win32' && Boolean(python && bridge && tools))
const prefix = 'airi-wow-update-integration-'
const buildInfo = (build = '12.1.5.70575') => `Product!STRING:0|Active!DEC:1|Version!STRING:0\nwow|0|12.0.0.1\nwow_classic|1|1.15.1.1\nwow|1|${build}\n`

/** Replaces only the game's CASC export boundary. All prerequisite, CSV import, hash, SQLite and query validation is real. */
class FixtureProcesses extends WowDataUpdateProcess {
  exports = 0
  exportFolder: string | undefined
  afterExport?: () => Promise<void>
  beforeVerify?: (folder: string) => Promise<void>

  constructor(readonly script: string) { super() }

  override async run(command: string, args: string[], cwd: string, signal: AbortSignal, line?: (value: string) => void) {
    if (args[1]?.endsWith('verify_export.py'))
      await this.beforeVerify?.(args[2]!)
    if (args[0]?.endsWith('DB2Export.dll')) {
      this.exports++
      this.exportFolder = args[3]
      const output = await super.run(python!, ['-B', this.script, ...args.slice(1)], cwd, signal, line)
      await this.afterExport?.()
      return output
    }
    return super.run(command, args, cwd, signal, line)
  }
}

describe.sequential('offline data update runner with real files and owned subprocesses', () => {
  let directory: string
  let gameRoot: string
  let toolsRoot: string
  let paths: RetailRuntimePaths
  let processRunner: FixtureProcesses
  let service: WowDataUpdateService
  let database: WowRetailDatabaseService
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
    gameRoot = join(directory, 'game')
    toolsRoot = join(directory, 'tools')
    paths = { appPath: join(directory, 'airi', 'apps', 'stage-tamagotchi'), resourcesPath: join(directory, 'resources'), userDataPath: join(directory, 'user'), platform: 'win32' }
    await mkdir(gameRoot)
    await writeFile(join(gameRoot, '.build.info'), buildInfo())
    processRunner = new FixtureProcesses(join(toolsRoot, 'fixture-export.py'))
    database = new WowRetailDatabaseService(join(paths.userDataPath, 'selection.json'), paths)
    service = new WowDataUpdateService(paths, database, new WowDataUpdateRuntime(paths, processRunner))
  })

  afterEach(async () => {
    configFlushGate.releaseNow?.()
    configFlushGate.prefix = undefined
    configFlushGate.entered = undefined
    configFlushGate.release = undefined
    configFlushGate.releaseNow = undefined
    await service.dispose()
    await database.dispose()
    const target = await realpath(directory)
    const root = await realpath(tmpdir())
    const child = relative(root, target)
    if (dirname(target).toLowerCase() !== root.toLowerCase() || child.includes('/') || child.includes('\\') || !basename(target).startsWith(prefix))
      throw new Error('Refusing update-test cleanup outside its generated temp prefix')
    await rm(target, { recursive: true, force: true })
  })

  async function prepare() {
    if (!python || !bridge || !tools)
      throw new Error('Installed runtimes and prepared tool/bridge directories are required')
    for (const file of [...offlineToolFiles, 'DB2Export/offline-build.json']) {
      const destination = join(toolsRoot, file)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(join(tools, file), destination)
    }
    await mkdir(join(toolsRoot, 'WoWDBDefs', 'definitions'), { recursive: true })
    await writeFile(join(toolsRoot, 'WoWDBDefs', 'manifest.json'), '[]')
    await writeFile(join(toolsRoot, 'WoWDBDefs', 'definitions', 'Item.dbd'), 'COLUMNS\nint ID\n')
    const bridgeTarget = join(paths.resourcesPath, 'wow-companion-bridge')
    await mkdir(bridgeTarget, { recursive: true })
    for (const file of (await readdir(bridge)).filter(file => file.endsWith('.py')))
      await copyFile(join(bridge, file), join(bridgeTarget, file))
    await writeFile(processRunner.script, [
      'import sys,json,csv,sqlite3,hashlib,time',
      'from pathlib import Path',
      `sys.path.insert(0,${JSON.stringify(bridgeTarget)})`,
      'from test_retail_query import create_database',
      'from retail_query import TABLE_COLUMNS',
      'game,defs,out=map(Path,sys.argv[1:4])',
      'print("fixture-started",flush=True)',
      'if (defs.parent / "wait").exists(): time.sleep(60)',
      'if (defs.parent / "fail").exists(): sys.exit(12)',
      'create_database(out / ".fixture.sqlite3")',
      'db=sqlite3.connect(out / ".fixture.sqlite3")',
      'db.execute("UPDATE ItemSparse SET Display_lang=? WHERE ID=1",("瑟银锭",))',
      'db.execute("UPDATE UiMap SET Name_lang=? WHERE ID=0",("希尔斯布莱德丘陵",))',
      '(out / "csv").mkdir(); (out / "raw").mkdir()',
      'tables=[]',
      'for name,cols in TABLE_COLUMNS.items():',
      ' rows=list(db.execute(f\'SELECT * FROM "{name}"\'))',
      ' with (out / "csv" / (name+".csv")).open("w",encoding="utf-8-sig",newline="") as stream:',
      '  writer=csv.writer(stream); writer.writerow(cols); writer.writerows(rows)',
      ' raw=("fixture-"+name).encode(); (out / "raw" / (name+".db2")).write_bytes(raw)',
      ' tables.append({"Table":name,"Status":"decoded","Rows":len(rows),"Columns":list(cols),"Sha256":hashlib.sha256(raw).hexdigest(),"Error":None})',
      'db.close(); (out / ".fixture.sqlite3").unlink()',
      'build=(game / ".build.info").read_text().strip().splitlines()[-1].split("|")[-1]',
      'manifest={"build":build,"locale":"zhCN","product":"wow","gameRoot":str(game),"localOnly":True,"hotfixesApplied":False,"updatedAt":"2026-11-01T12:00:00+00:00","tables":tables}',
      '(out / "export-manifest.json").write_text(json.dumps(manifest,ensure_ascii=False),encoding="utf-8")',
      'print("8/8 DungeonEncounter: decoded",flush=True)',
    ].join('\n'))
    expect((await service.configure('gameRoot', gameRoot)).errorCode).toBeUndefined()
    expect((await service.configure('toolsRoot', toolsRoot)).errorCode).toBeUndefined()
  }

  async function finish() {
    const deadline = Date.now() + 25_000
    while (Date.now() < deadline) {
      const status = await service.status()
      if (status.job && ['ready', 'failed', 'cancelled'].includes(status.job.phase)) {
        // Wait for the worker's retention/configuration tail before starting another mutation.
        await service.cancel()
        return service.status()
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 25))
    }
    throw new Error('Update worker did not settle')
  }

  it('status and startup build monitoring never create folders, spawn helpers or export', async () => {
    const status = await service.status()
    expect(status.activeSelection).toBe('none')
    expect(status.job).toBeNull()
    service.startMonitoring()
    await service.checkBuild()
    expect(processRunner.exports).toBe(0)
    await expect(stat(paths.userDataPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('selects exactly one active wow row and rejects ambiguous or missing builds', async () => {
    expect((await readActiveRetailBuild(gameRoot)).build).toBe('12.1.5.70575')
    await writeFile(join(gameRoot, '.build.info'), `${buildInfo()}wow|1|12.1.5.70576\n`)
    await expect(readActiveRetailBuild(gameRoot)).rejects.toMatchObject({ code: 'build-ambiguous' })
    await writeFile(join(gameRoot, '.build.info'), 'Product|Active|Version\nwow|0|12.1.5.70575\n')
    await expect(readActiveRetailBuild(gameRoot)).rejects.toMatchObject({ code: 'build-ambiguous' })
  })

  it('waits for the old build check to commit before changing roots and serializes later checks', async () => {
    const folder = join(paths.userDataPath, 'wow-data-updates')
    const settings = join(folder, 'settings-v1.json')
    const nextRoot = join(directory, 'next-game')
    await mkdir(folder, { recursive: true })
    await mkdir(nextRoot)
    await writeFile(join(nextRoot, '.build.info'), buildInfo('12.1.5.70576'))
    await writeFile(settings, JSON.stringify({ version: 1, gameRoot, toolsRoot: null, lastBuild: null }))
    let entered!: () => void
    const paused = new Promise<void>((resolvePaused) => {
      entered = resolvePaused
    })
    configFlushGate.release = new Promise<void>((resolveReleased) => {
      configFlushGate.releaseNow = resolveReleased
    })
    configFlushGate.prefix = `${settings}.`
    configFlushGate.entered = entered
    const oldCheck = service.checkBuild()
    await paused
    let changed = false
    const selection = service.configure('gameRoot', nextRoot).then((value) => {
      changed = true
      return value
    })
    const laterCheck = service.checkBuild()
    try {
      await new Promise(resolveWait => setTimeout(resolveWait, 30))
      expect(changed).toBe(false)
      expect((await service.status()).config.gameRoot).toBe(gameRoot)
    }
    finally { configFlushGate.releaseNow?.() }
    await oldCheck
    await laterCheck
    const result = await selection
    expect(result.errorCode).toBeUndefined()
    expect(result.config.gameRoot).toBe(await realpath(nextRoot))
    expect(result.discovery).toMatchObject({ build: '12.1.5.70576', previousBuild: '12.1.5.70576', changed: false })
    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual({ version: 1, gameRoot: await realpath(nextRoot), toolsRoot: null, lastBuild: '12.1.5.70576' })
    expect(processRunner.exports).toBe(0)
  })

  integration('runs real import, hash and 8-table SQLite verification; activation remains explicit', async (context) => {
    if (!portAvailable)
      context.skip('Port 18767 belongs to another listener; it is never stopped')
    await prepare()
    const originalBuild = await readFile(join(gameRoot, '.build.info'))
    const started = await service.start()
    expect(started.job?.phase).toBe('checking')
    const ready = await finish()
    expect(ready.job?.phase, JSON.stringify(ready)).toBe('ready')
    expect(ready.snapshots).toHaveLength(1)
    expect(ready.snapshots[0].source.tables).toHaveLength(8)
    expect(ready.activeSelection).toBe('none')
    const selected = await service.activate(ready.snapshots[0].id)
    expect(selected.activeSnapshotId).toBe(ready.snapshots[0].id)
    expect((await database.query({ operation: 'fetch', id: 'map:0' })).entries[0].id).toBe('map:0')
    expect(await readFile(join(gameRoot, '.build.info'))).toEqual(originalBuild)
    expect((await readdir(gameRoot))).toEqual(['.build.info'])
    await writeFile(join(gameRoot, '.build.info'), buildInfo('12.1.5.70576'))
    await service.checkBuild()
    const outdated = await service.status()
    expect(outdated.discovery.previousBuild).toBe('12.1.5.70575')
    expect(outdated.discovery.changed).toBe(true)
    await service.start()
    const next = await finish()
    expect(next.job?.phase).toBe('ready')
    expect(next.discovery.changed).toBe(true)
    expect(next.activeSource?.build).toBe('12.1.5.70575')
    const newest = next.snapshots.find(snapshot => snapshot.build === '12.1.5.70576')!
    const activated = await service.activate(newest.id)
    expect(activated.discovery.previousBuild).toBe('12.1.5.70576')
    expect(activated.discovery.changed).toBe(false)
  }, 40_000)

  integration('cancel waits for its exporter to exit before deleting its partial folder', async () => {
    await prepare()
    await writeFile(join(toolsRoot, 'wait'), 'wait')
    await service.start()
    const deadline = Date.now() + 15_000
    while (processRunner.exports === 0 && Date.now() < deadline)
      await new Promise(resolveWait => setTimeout(resolveWait, 25))
    expect(processRunner.exports).toBe(1)
    expect((await service.start()).errorCode).toBe('busy')
    expect((await service.configure('gameRoot', toolsRoot)).config.gameRoot).toBe(await realpath(gameRoot))
    const cancelled = await service.cancel()
    expect(cancelled.job?.phase).toBe('cancelled')
    expect(cancelled.snapshots).toEqual([])
    expect(await readdir(join(paths.userDataPath, 'wow-data-updates', 'snapshots'))).toEqual([])
    expect((await database.status()).configured).toBe(false)
  }, 30_000)

  integration('never moves or deletes a staging database selected while export verification is paused', async (context) => {
    if (!portAvailable)
      context.skip('Port 18767 belongs to another listener; it is never stopped')
    await prepare()
    for (const action of ['finish', 'cancel'] as const) {
      let entered!: (folder: string) => void
      let release!: () => void
      const paused = new Promise<string>((resolvePaused) => {
        entered = resolvePaused
      })
      const gate = new Promise<void>((resolveGate) => {
        release = resolveGate
      })
      processRunner.beforeVerify = async (folder) => {
        entered(folder)
        await gate
      }
      await service.start()
      const folder = await paused
      try {
        const path = join(folder, 'retail.sqlite3')
        expect((await database.select(path)).errorCode).toBeUndefined()
        const original = createHash('sha256').update(await readFile(path)).digest('hex')
        let result
        if (action === 'cancel') {
          const cancellation = service.cancel()
          release()
          result = await cancellation
          expect(result.job?.phase).toBe('cancelled')
        }
        else {
          release()
          result = await finish()
          expect(result.job?.phase).toBe('failed')
          expect(result.job?.errorCode).toBe('busy')
        }
        expect(result.snapshots).toEqual([])
        expect((await database.status()).path).toBe(await realpath(path))
        expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(original)
        expect((await database.query({ operation: 'fetch', id: 'map:0' })).outcome).toBe('ok')
        expect((await readdir(join(paths.userDataPath, 'wow-data-updates', 'snapshots'))).every(name => name.startsWith('staging-'))).toBe(true)
      }
      finally {
        release()
        await service.cancel()
      }
    }
  }, 40_000)

  integration('a changed build or definitions rejects the candidate and preserves the selected source', async () => {
    await prepare()
    processRunner.afterExport = () => writeFile(join(gameRoot, '.build.info'), buildInfo('12.1.5.70576'))
    await service.start()
    const changed = await finish()
    expect(changed.job?.errorCode).toBe('source-changed')
    expect(changed.snapshots).toEqual([])
    expect(changed.activeSelection).toBe('none')
    processRunner.afterExport = () => writeFile(join(toolsRoot, 'WoWDBDefs', 'definitions', 'Item.dbd'), 'changed definitions')
    await service.start()
    const definitions = await finish()
    expect(definitions.job?.errorCode).toBe('source-changed')
    expect(definitions.snapshots).toEqual([])
    await mkdir(join(gameRoot, 'Data', 'data'), { recursive: true })
    await writeFile(join(gameRoot, 'Data', 'data', 'data.000'), 'old archive')
    processRunner.afterExport = () => writeFile(join(gameRoot, 'Data', 'data', 'data.000'), 'concurrent archive write')
    await service.start()
    expect((await finish()).job?.errorCode).toBe('source-changed')
  }, 55_000)

  integration('rejects a raw hash mismatch and an otherwise verified export missing a required query table', async () => {
    await prepare()
    processRunner.afterExport = () => writeFile(join(processRunner.exportFolder!, 'raw', 'Item.db2'), 'corrupt raw bytes')
    await service.start()
    expect((await finish()).job?.errorCode).toBe('verification-failed')
    processRunner.afterExport = async () => {
      const path = join(processRunner.exportFolder!, 'export-manifest.json')
      const manifest = JSON.parse(await readFile(path, 'utf8'))
      manifest.tables = manifest.tables.filter((table: { Table: string }) => table.Table !== 'SpellName')
      await writeFile(path, JSON.stringify(manifest))
    }
    await service.start()
    const incomplete = await finish()
    expect(incomplete.job?.errorCode).toBe('verification-failed')
    expect(incomplete.snapshots).toEqual([])
    expect((await database.status()).configured).toBe(false)
  }, 40_000)

  integration('retains two owned snapshots including the selection; failed export still permits rollback', async (context) => {
    if (!portAvailable)
      context.skip('Port 18767 belongs to another listener; it is never stopped')
    await prepare()
    await service.start()
    const first = await finish()
    const firstId = first.snapshots[0].id
    expect((await service.activate(firstId)).errorCode).toBeUndefined()
    const selectedPath = (await database.status()).path!
    const originalHash = createHash('sha256').update(await readFile(selectedPath)).digest('hex')
    await service.start()
    await finish()
    await service.start()
    const third = await finish()
    expect(third.snapshots).toHaveLength(2)
    expect(third.snapshots.some(value => value.id === firstId)).toBe(true)
    const root = join(paths.userDataPath, 'wow-data-updates', 'snapshots')
    await mkdir(join(root, 'external-user-export'))
    await writeFile(join(root, 'external-user-export', 'keep.txt'), 'never delete')
    await writeFile(join(toolsRoot, 'fail'), 'fail')
    await service.start()
    expect((await finish()).job?.errorCode).toBe('export-failed')
    const other = third.snapshots.find(value => value.id !== firstId)!
    expect((await service.activate(other.id)).activeSnapshotId).toBe(other.id)
    expect((await service.activate(firstId)).activeSnapshotId).toBe(firstId)
    expect(createHash('sha256').update(await readFile(selectedPath)).digest('hex')).toBe(originalHash)
    expect(await readFile(join(root, 'external-user-export', 'keep.txt'), 'utf8')).toBe('never delete')
  }, 80_000)

  integration('rejects missing offline stamps and snapshot junctions without touching their targets', async () => {
    await prepare()
    await rm(join(toolsRoot, 'DB2Export', 'offline-build.json'))
    await service.start()
    expect((await finish()).job?.errorCode).toBe('offline-build-required')
    expect(processRunner.exports).toBe(0)
    const root = join(paths.userDataPath, 'wow-data-updates', 'snapshots')
    await mkdir(root, { recursive: true })
    const id = '76c6a1e6-61b6-413c-8a0b-444c12f4b88c'
    const junction = join(root, `snapshot-${id}`)
    await symlink(gameRoot, junction, 'junction')
    expect((await service.activate(id)).errorCode).toBe('snapshot-invalid')
    expect(await readFile(join(gameRoot, '.build.info'), 'utf8')).toBe(buildInfo())
    // Remove only the owned junction itself; recursive cleanup never follows its target.
    await rm(junction)
  }, 30_000)

  integration('rejects a linked managed parent before writing or pruning its target', async () => {
    await prepare()
    const folder = join(paths.userDataPath, 'wow-data-updates')
    const displaced = join(directory, 'external-data')
    await rename(folder, displaced)
    const settings = await readFile(join(displaced, 'settings-v1.json'), 'utf8')
    await symlink(displaced, folder, 'junction')
    try {
      await service.start()
      const result = await finish()
      expect(result.job?.errorCode).toBe('snapshot-invalid')
      expect(result.snapshots).toEqual([])
      expect(await readFile(join(displaced, 'settings-v1.json'), 'utf8')).toBe(settings)
      expect(await readdir(displaced)).toEqual(['settings-v1.json'])
    }
    finally {
      await rm(folder)
      await rename(displaced, folder)
    }
  }, 30_000)
})
