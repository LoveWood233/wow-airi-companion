import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import type { RetailDatabaseQuery } from '@proj-airi/stage-shared/wow-knowledge'

import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { retailDatabaseResultSchema } from '@proj-airi/stage-shared/wow-knowledge'
import { array, literal, looseObject, parse, picklist, string } from 'valibot'

import { CompanionBridgeRuntime } from './wow-companion-runtime'

export interface RetailRuntimePaths {
  appPath: string
  resourcesPath: string
  userDataPath: string
  platform: NodeJS.Platform
}

const healthSchema = looseObject({
  ok: literal(true),
  service: literal('wow-companion-bridge'),
  mode: literal('query-only'),
  game: literal('retail'),
  protocol: literal('WCP1'),
  version: string(),
  capabilities: array(picklist(['retail-db2'])),
  instanceId: string(),
})

/** Owns a query-only Python child. It never attaches to or stops a game capture process. */
export class WowRetailDatabaseRuntime {
  private child: ChildProcessWithoutNullStreams | undefined
  private exited: Promise<void> | undefined
  private starting: Promise<void> | undefined
  private readonly controller = new AbortController()
  private readonly instance = randomUUID()
  private readonly token = randomBytes(32).toString('hex')
  private readonly url = 'http://127.0.0.1:18767'
  private readonly environment: CompanionBridgeRuntime

  constructor(private readonly paths: RetailRuntimePaths, private readonly database: string) {
    this.environment = new CompanionBridgeRuntime(paths)
  }

  private async script() {
    const bundled = join(this.paths.resourcesPath, 'wow-companion-bridge', 'server.py')
    if (await stat(bundled).then(value => value.isFile(), () => false))
      return bundled
    const source = resolve(this.paths.appPath, '..', '..', '..', 'WOWAddons', 'WoWCompanionBridge', 'server.py')
    if (await stat(source).then(value => value.isFile(), () => false))
      return source
    throw new Error('bridge-unavailable')
  }

  private async start() {
    this.controller.signal.throwIfAborted()
    const environment = await this.environment.inspectEnvironment()
    this.controller.signal.throwIfAborted()
    if (!environment.pythonPath)
      throw new Error('bridge-unavailable')
    const script = await this.script()
    this.controller.signal.throwIfAborted()
    const child = spawn(environment.pythonPath, ['-B', '-X', 'utf8', script, '--query-only', '--game', 'retail', '--port', '18767', '--database', this.database, '--managed-stdin', '--query-token', this.token, '--query-instance', this.instance], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    let finished = false
    this.exited = new Promise<void>((resolveExit) => {
      child.once('error', () => {
        finished = true
        resolveExit()
      })
      child.once('close', () => {
        finished = true
        resolveExit()
      })
    })
    // Output is drained without logging paths, query tokens, or database diagnostics.
    child.stdout.resume()
    child.stderr.resume()
    child.stdin.on('error', () => {})
    const deadline = Date.now() + 12_000
    while (Date.now() < deadline) {
      if (finished)
        break
      this.controller.signal.throwIfAborted()
      try {
        const response = await fetch(`${this.url}/health`, { headers: { 'X-Wow-Query-Token': this.token }, redirect: 'error', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(1000)]) })
        const health = parse(healthSchema, await response.json())
        if (response.ok && health.instanceId === this.instance && health.capabilities.includes('retail-db2'))
          return
      }
      catch {
        this.controller.signal.throwIfAborted()
      }
      await delay(100, undefined, { signal: this.controller.signal })
    }
    throw new Error('bridge-unavailable')
  }

  async query(query: RetailDatabaseQuery) {
    this.controller.signal.throwIfAborted()
    this.starting ??= this.start()
    try {
      await this.starting
      const response = await fetch(`${this.url}/api/retail/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Wow-Query-Token': this.token },
        body: JSON.stringify(query),
        redirect: 'error',
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(8000)]),
      })
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 1024 * 1024)
        throw new Error('bridge-unavailable')
      if (!response.body)
        throw new Error('bridge-unavailable')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let raw = ''
      let bytes = 0
      try {
        while (true) {
          const part = await reader.read()
          if (part.done)
            break
          bytes += part.value.byteLength
          if (bytes > 1024 * 1024) {
            await reader.cancel()
            throw new Error('bridge-unavailable')
          }
          raw += decoder.decode(part.value, { stream: true })
        }
        raw += decoder.decode()
      }
      finally { reader.releaseLock() }
      const value: unknown = JSON.parse(raw)
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('bridge-unavailable')
      // Receipt time describes this response, independently of the source export timestamp.
      return parse(retailDatabaseResultSchema, { ...value, receivedAt: new Date().toISOString() })
    }
    catch (error) {
      if (this.controller.signal.aborted)
        throw error
      await this.dispose()
      throw new Error('bridge-unavailable')
    }
  }

  async dispose() {
    this.controller.abort()
    const child = this.child
    this.child = undefined
    child?.stdin.end()
    if (child && this.exited) {
      await Promise.race([this.exited, delay(1500)])
      if (child.exitCode === null && child.signalCode === null)
        child.kill()
      await Promise.race([this.exited, delay(1500)])
    }
    await this.environment.dispose()
  }
}
