import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import process from 'node:process'

import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { integer, literal, looseObject, minLength, minValue, number, pipe, safeParse, string } from 'valibot'

const execFileAsync = promisify(execFile)
const healthSchema = looseObject({
  ok: literal(true),
  service: literal('wow-companion-bridge'),
  protocol: literal('WCP1'),
  version: string(),
  instanceId: pipe(string(), minLength(1)),
})
const pythonSchema = looseObject({
  executable: pipe(string(), minLength(1)),
  major: literal(3),
  minor: pipe(number(), integer(), minValue(10)),
})

/** Electron supplies these paths. No renderer input can select an executable or service address. */
interface RuntimeOptions {
  appPath: string
  resourcesPath: string
  userDataPath: string
  platform: NodeJS.Platform
}

interface OwnedProcess {
  child: ChildProcessWithoutNullStreams
  exited: Promise<void>
  done: boolean
  stderr: string
}

/**
 * Reuses a compatible external bridge or owns one hidden Python child.
 * An abort generation isolates starts from stop/dispose. Only the owned child is stopped.
 * Errors delay new attempts for 30 seconds. Closing stdin also stops the child after an AIRI crash.
 */
export class CompanionBridgeRuntime {
  private status: 'stopped' | 'starting' | 'running' | 'external' | 'error' = 'stopped'
  private error: string | null = null
  private retryAt = 0
  private disposed = false
  private generation = 0
  private active: Promise<void> | undefined
  private stopping: Promise<void> | undefined
  private abort: AbortController | undefined
  private owned: OwnedProcess | undefined

  /** The loopback address is fixed in AIRI. Tests use an isolated local HTTP server. */
  constructor(private readonly options: RuntimeOptions, private readonly baseUrl = 'http://127.0.0.1:18765') {
    const address = new URL(baseUrl)
    if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || address.username || address.password)
      throw new Error('The WoW bridge must use a local HTTP address.')
  }

  /** Returns lifecycle diagnostics, not a live game observation. */
  read() {
    return { status: this.status, error: this.error }
  }

  /** Starts at most one helper and waits until its health endpoint is ready. */
  async ensureReady() {
    const generation = this.generation
    await this.stopping
    if (this.disposed)
      throw new Error('The WoW bridge runtime has stopped.')
    if (generation !== this.generation)
      throw new Error('The WoW bridge start was cancelled.')
    if (this.active)
      return this.active
    if (Date.now() < this.retryAt)
      throw new Error(this.error ?? 'The WoW bridge will retry after 30 seconds.')
    const controller = new AbortController()
    this.abort = controller
    const operation = this.connect(controller.signal)
    this.active = operation
    try {
      await operation
    }
    finally {
      if (this.active === operation)
        this.active = undefined
      if (this.abort === controller)
        this.abort = undefined
    }
  }

  /** Cancels a pending start and releases the owned helper. Later calls can start again. */
  stop() {
    this.generation++
    this.abort?.abort()
    if (this.stopping)
      return this.stopping
    const active = this.active
    const operation = (async () => {
      await active?.catch(() => {})
      await this.releaseOwned()
      this.status = 'stopped'
      this.error = null
      this.retryAt = 0
    })()
    this.stopping = operation
    void operation.finally(() => {
      if (this.stopping === operation)
        this.stopping = undefined
    }).catch(() => {})
    return operation
  }

  /** Permanently rejects starts and waits for owned process cleanup. */
  dispose() {
    this.disposed = true
    return this.stop()
  }

  private async connect(signal: AbortSignal) {
    try {
      if (await this.healthy(signal)) {
        signal.throwIfAborted()
        this.status = this.owned ? 'running' : 'external'
        this.error = null
        return
      }
      if (this.owned)
        await this.releaseOwned()
      signal.throwIfAborted()
      this.status = 'starting'
      this.error = null
      if (this.options.platform !== 'win32')
        throw new Error('Automatic WoW capture requires Windows. The local bridge cannot start on this system.')
      const resources = await this.findResources()
      signal.throwIfAborted()
      const python = await this.findPython(signal)
      signal.throwIfAborted()
      const child = spawn(python, [resources.script, '--port', new URL(this.baseUrl).port || '80', '--config', resources.config, '--managed-stdin'], {
        cwd: dirname(resources.script),
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
      })
      const owned: OwnedProcess = { child, done: false, stderr: '', exited: Promise.resolve() }
      owned.exited = new Promise<void>((resolveExit) => {
        const finish = () => {
          owned.done = true
          if (this.owned === owned && this.status === 'running') {
            this.owned = undefined
            this.fail('The WoW bridge exited. AIRI will retry after 30 seconds.')
          }
          resolveExit()
        }
        child.once('error', (error) => {
          owned.stderr = errorMessageFrom(error) ?? 'Unable to start Python.'
          finish()
        })
        child.once('exit', finish)
      })
      // Drain output so a full pipe cannot freeze capture. Retain only bounded startup diagnostics.
      child.stdout.resume()
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        owned.stderr = (owned.stderr + chunk).slice(-4096)
      })
      child.stdin.on('error', () => {})
      this.owned = owned
      const deadline = Date.now() + 10_000
      do {
        await delay(200, undefined, { signal })
        signal.throwIfAborted()
        if (owned.done)
          throw new Error(`The WoW bridge could not start. Check its files and capture settings. ${owned.stderr.trim()}`)
        if (await this.healthy(signal)) {
          signal.throwIfAborted()
          if (owned.done)
            throw new Error('The WoW bridge exited during startup. Check whether its port is occupied.')
          this.status = 'running'
          this.error = null
          return
        }
      } while (Date.now() < deadline)
      throw new Error('The WoW bridge did not become ready within 10 seconds. Check Python and the local capture settings.')
    }
    catch (error) {
      await this.releaseOwned()
      if (!signal.aborted)
        this.fail(`${errorMessageFrom(error) ?? 'The WoW bridge could not start.'} AIRI will retry after 30 seconds.`)
      throw signal.aborted ? new Error('The WoW bridge start was cancelled.') : new Error(this.error ?? 'The WoW bridge could not start.')
    }
  }

  private fail(message: string) {
    this.status = 'error'
    this.error = message
    this.retryAt = Date.now() + 30_000
  }

  private async healthy(signal: AbortSignal) {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/health`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]) })
    }
    catch (error) {
      signal.throwIfAborted()
      // Only connection refusal means that AIRI can try to start a listener.
      if (error instanceof Error && 'cause' in error && typeof error.cause === 'object' && error.cause !== null
        && 'code' in error.cause && error.cause.code === 'ECONNREFUSED') {
        return false
      }
      throw new Error('The local WoW bridge port did not respond. Check port 18765 before retrying.')
    }
    let value: unknown
    try {
      value = await response.json()
    }
    catch {
      throw new Error('Port 18765 is occupied by an incompatible service. Close that service or update the WoW bridge.')
    }
    const result = safeParse(healthSchema, value)
    const version = result.success && /^2\.(\d+)\.\d+$/.exec(result.output.version)
    if (!response.ok || !result.success || !version || Number(version[1]) < 1)
      throw new Error('Port 18765 is occupied by an incompatible service. Close that service or update the WoW bridge to 2.1 or newer.')
    return true
  }

  private async findResources() {
    const source = resolve(this.options.appPath, '..', '..', '..', 'WOWAddons', 'WoWCompanionBridge')
    const bundled = join(this.options.resourcesPath, 'wow-companion-bridge')
    if (await this.isFile(join(bundled, 'server.py'))) {
      const directory = join(this.options.userDataPath, 'wow-companion-bridge')
      await mkdir(directory, { recursive: true })
      const config = join(directory, 'bridge-config.json')
      if (!await this.isFile(config) && await this.isFile(join(source, 'bridge-config.json'))) {
        try {
          await copyFile(join(source, 'bridge-config.json'), config, constants.COPYFILE_EXCL)
        }
        catch (error) {
          if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'EEXIST')
            throw error
        }
      }
      return { script: join(bundled, 'server.py'), config }
    }
    if (await this.isFile(join(source, 'server.py')))
      return { script: join(source, 'server.py'), config: join(source, 'bridge-config.json') }
    throw new Error('WoW bridge files are missing. Restore WOWAddons beside the AIRI source, or reinstall the companion desktop package.')
  }

  private async findPython(signal: AbortSignal) {
    const directories = (process.env.PATH ?? '').split(delimiter).map(path => path.replace(/^"|"$/g, '')).filter(Boolean)
    // Resolve PATH entries before execution. WindowsApps aliases can open the Store instead of running Python.
    for (const program of ['python.exe', 'py.exe']) {
      for (const directory of directories) {
        signal.throwIfAborted()
        if (/[\\/]WindowsApps(?:[\\/]|$)/i.test(directory))
          continue
        const executable = join(directory, program)
        if (!await this.isFile(executable))
          continue
        try {
          const args = program === 'py.exe' ? ['-3'] : []
          args.push('-c', 'import json,sys; print(json.dumps({"executable":sys.executable,"major":sys.version_info.major,"minor":sys.version_info.minor}))')
          const result = await execFileAsync(executable, args, { windowsHide: true, timeout: 3500, maxBuffer: 8192, encoding: 'utf8', signal })
          const python = safeParse(pythonSchema, JSON.parse(result.stdout))
          if (python.success && !/[\\/]WindowsApps(?:[\\/]|$)/i.test(python.output.executable) && await this.isFile(python.output.executable))
            return python.output.executable
        }
        catch {
          signal.throwIfAborted()
          // A different installed Python on PATH can satisfy the required version.
        }
      }
    }
    throw new Error('Python 3.10 or newer was not found. Install Python with PATH enabled, then restart AIRI.')
  }

  private async isFile(path: string) {
    try {
      return (await stat(path)).isFile()
    }
    catch {
      return false
    }
  }

  private async releaseOwned() {
    const owned = this.owned
    if (!owned)
      return
    this.owned = undefined
    if (owned.done)
      return
    owned.child.stdin.end()
    await Promise.race([owned.exited, delay(3500, undefined, { ref: false })])
    if (!owned.done) {
      owned.child.kill()
      await Promise.race([owned.exited, delay(1500, undefined, { ref: false })])
    }
  }
}
