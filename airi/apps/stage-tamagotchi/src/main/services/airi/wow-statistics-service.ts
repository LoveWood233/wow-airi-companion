import type { InferOutput } from 'valibot'

import type { StatisticsCounters, StatisticsState, StatisticsUsageObservation } from '../../../shared/wow-statistics'

import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

import { array, boolean, integer, literal, maxLength, maxValue, minValue, nullable, number, parse, pipe, regex, strictObject, string } from 'valibot'

import { statisticsConfigureSchema, statisticsCountersSchema, statisticsEndpointSchema, statisticsUsageObservationSchema } from '../../../shared/wow-statistics'

const intervalMs = 300_000
const count = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER))
const uuid = pipe(string(), regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i))
const savedSchema = strictObject({
  version: literal(1),
  installationId: uuid,
  installationSecret: pipe(string(), regex(/^[\w-]{43}$/)),
  disclosed: boolean(),
  enabled: boolean(),
  endpoint: statisticsEndpointSchema,
  registeredEndpoint: nullable(statisticsEndpointSchema),
  registeredVersion: nullable(pipe(string(), maxLength(64))),
  sequence: count,
  counters: statisticsCountersSchema,
  seen: pipe(array(uuid), maxLength(8192)),
  lastReportedAt: nullable(count),
})

function emptyCounters(): StatisticsCounters {
  return { requests: 0, requestsWithUsage: 0, requestsWithoutUsage: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, inputReportedRequests: 0, outputReportedRequests: 0, totalReportedRequests: 0 }
}

class ReportError extends Error {}

/**
 * One main-process owner persists anonymous installation counters and sends cumulative checkpoints every five minutes.
 * Disclosure gates collection and transmission. Renderer windows never receive the installation secret.
 */
export class CompanionStatistics {
  private data: InferOutput<typeof savedSchema> | undefined
  private loading: Promise<void> | undefined
  private queue = Promise.resolve()
  private timer: ReturnType<typeof setInterval> | undefined
  private controller: AbortController | undefined
  private stopped = false
  private reporting = false
  private generation = 0
  private blocked = false
  private lastError: StatisticsState['lastError'] = null

  constructor(private readonly filePath: string, private readonly options: { endpoint: string, clientVersion: string, platform: string, fetch?: typeof fetch }) {}

  async start() {
    await this.load()
    if (this.stopped || this.timer)
      return
    this.timer = setInterval(() => void this.report().catch(() => {}), intervalMs)
    this.timer.unref?.()
    void this.report(true).catch(() => {})
  }

  load() {
    this.loading ??= this.loadFile()
    return this.loading
  }

  read(): StatisticsState {
    const data = this.data
    const enabled = !!data?.enabled && !this.blocked
    return {
      enabled,
      disclosed: data?.disclosed ?? false,
      endpoint: data?.endpoint ?? '',
      intervalSeconds: 300,
      installationId: data?.installationId ?? null,
      counters: data ? { ...data.counters } : emptyCounters(),
      lastReportedAt: data?.lastReportedAt ?? null,
      lastError: this.lastError ?? (enabled && !data?.endpoint ? 'not-configured' : null),
      configured: !!data?.endpoint,
    }
  }

  async acknowledge(enabled: boolean) {
    this.invalidate()
    await this.enqueue(async () => {
      await this.load()
      const data = this.current()
      await this.save({ ...data, disclosed: true, enabled })
      this.lastError = null
    })
    void this.report(true).catch(() => {})
    return this.read()
  }

  async configure(input: { enabled: boolean, endpoint: string }) {
    const request = parse(statisticsConfigureSchema, input)
    this.invalidate()
    await this.enqueue(async () => {
      await this.load()
      const data = this.current()
      if (request.enabled && !data.disclosed)
        throw new ReportError('Disclosure required')
      const endpoint = request.endpoint.replace(/\/+$/, '')
      const changed = endpoint !== data.endpoint
      await this.save({ ...data, enabled: request.enabled, endpoint, registeredEndpoint: changed ? null : data.registeredEndpoint, registeredVersion: changed ? null : data.registeredVersion, lastReportedAt: changed ? null : data.lastReportedAt })
      this.lastError = null
    })
    void this.report(true).catch(() => {})
    return this.read()
  }

  record(input: StatisticsUsageObservation) {
    const observation = parse(statisticsUsageObservationSchema, input)
    return this.enqueue(async () => {
      await this.load()
      const data = this.current()
      if (!data.disclosed || !data.enabled || data.seen.includes(observation.id))
        return
      const counters = { ...data.counters }
      counters.requests++
      if (observation.source === 'reported') {
        counters.requestsWithUsage++
        if (observation.inputTokens !== undefined) {
          counters.inputTokens += observation.inputTokens
          counters.inputReportedRequests++
        }
        if (observation.outputTokens !== undefined) {
          counters.outputTokens += observation.outputTokens
          counters.outputReportedRequests++
        }
        if (observation.totalTokens !== undefined) {
          counters.totalTokens += observation.totalTokens
          counters.totalReportedRequests++
        }
      }
      else {
        counters.requestsWithoutUsage++
      }
      parse(statisticsCountersSchema, counters)
      await this.save({ ...data, counters, seen: [...data.seen, observation.id].slice(-8192) })
    })
  }

  /** Registration follows disclosure. Periodic reports send cumulative counters, including unchanged checkpoints as heartbeats. */
  async report(registrationOnly = false) {
    if (this.reporting || this.stopped)
      return
    this.reporting = true
    const generation = this.generation
    try {
      await this.enqueue(async () => {
        await this.load()
        const data = this.current()
        if (!data.disclosed || !data.enabled || !data.endpoint || this.stopped || generation !== this.generation)
          return
        if (!['win32', 'darwin', 'linux'].includes(this.options.platform)) {
          this.lastError = 'invalid-config'
          return
        }
        const controller = new AbortController()
        this.controller = controller
        if (data.registeredEndpoint !== data.endpoint || data.registeredVersion !== this.options.clientVersion) {
          await this.post(data.endpoint, '/api/v1/installations', {
            protocol: 1,
            installationId: data.installationId,
            installationSecret: data.installationSecret,
            clientVersion: this.options.clientVersion,
            platform: this.options.platform,
          }, controller.signal)
          if (generation !== this.generation || this.stopped)
            return
          await this.save({ ...this.current(), registeredEndpoint: data.endpoint, registeredVersion: this.options.clientVersion })
          this.lastError = null
        }
        if (registrationOnly)
          return
        const latest = this.current()
        const sequence = latest.sequence + 1
        parse(count, sequence)
        // Persist the checkpoint sequence before networking. Lost replies cannot cause a counter reset or duplicate deltas.
        await this.save({ ...latest, sequence })
        await this.post(latest.endpoint, '/api/v1/usage', { protocol: 1, sequence, counters: latest.counters }, controller.signal, `${latest.installationId}.${latest.installationSecret}`)
        if (generation !== this.generation || this.stopped)
          return
        await this.save({ ...this.current(), lastReportedAt: Date.now() })
        this.lastError = null
      })
    }
    catch (error) {
      if (generation === this.generation && !this.stopped && !this.blocked) {
        this.lastError = error instanceof ReportError ? 'rejected' : 'network-error'
        if (error instanceof ReportError && this.data?.registeredEndpoint)
          await this.enqueue(() => this.save({ ...this.current(), registeredEndpoint: null, registeredVersion: null })).catch(() => {})
      }
    }
    finally {
      this.controller = undefined
      this.reporting = false
    }
  }

  async stop() {
    this.stopped = true
    this.invalidate()
    clearInterval(this.timer)
    this.timer = undefined
    await this.queue.catch(() => {})
  }

  private invalidate() {
    this.generation++
    this.controller?.abort()
  }

  private current() {
    if (!this.data || this.blocked || this.stopped)
      throw new ReportError('Statistics storage unavailable')
    return this.data
  }

  private async loadFile() {
    try {
      try {
        const contents = await readFile(this.filePath)
        if (contents.byteLength > 1024 * 1024)
          throw new Error('Statistics file too large')
        this.data = parse(savedSchema, JSON.parse(contents.toString('utf8')))
      }
      catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
          throw error
        let endpoint = ''
        try {
          endpoint = parse(statisticsEndpointSchema, this.options.endpoint).replace(/\/+$/, '')
        }
        catch {
          this.lastError = 'invalid-config'
        }
        await this.save({ version: 1, installationId: randomUUID(), installationSecret: randomBytes(32).toString('base64url'), enabled: false, disclosed: false, endpoint, registeredEndpoint: null, registeredVersion: null, sequence: 0, counters: emptyCounters(), seen: [], lastReportedAt: null })
      }
    }
    catch {
      this.blocked = true
      this.lastError = 'storage-error'
    }
  }

  private async save(data: NonNullable<CompanionStatistics['data']>) {
    const parsed = parse(savedSchema, data)
    const temporary = `${this.filePath}.${randomUUID()}.tmp`
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      const handle = await open(temporary, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify(parsed), 'utf8')
        await handle.sync()
      }
      finally { await handle.close() }
      await rename(temporary, this.filePath)
      this.data = parsed
    }
    catch {
      this.blocked = true
      this.lastError = 'storage-error'
      throw new ReportError('Statistics could not be saved')
    }
    finally { await unlink(temporary).catch(() => {}) }
  }

  private async post(endpoint: string, route: string, body: object, signal: AbortSignal, authorization?: string) {
    const response = await (this.options.fetch ?? fetch)(endpoint + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new ReportError('Statistics report rejected')
    }
    const reader = response.body?.getReader()
    let contents = ''
    let length = 0
    const decoder = new TextDecoder()
    if (!reader)
      throw new ReportError('Empty statistics reply')
    try {
      while (true) {
        const part = await reader.read()
        if (part.done)
          break
        length += part.value.byteLength
        if (length > 8192)
          throw new ReportError('Statistics reply too large')
        contents += decoder.decode(part.value, { stream: true })
      }
      contents += decoder.decode()
    }
    finally { await reader.cancel().catch(() => {}) }
    let result: unknown
    try {
      result = JSON.parse(contents)
    }
    catch {
      throw new ReportError('Invalid statistics reply')
    }
    if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true)
      throw new ReportError('Statistics request was not acknowledged')
  }

  private enqueue(operation: () => Promise<void>) {
    const next = this.queue.then(operation)
    this.queue = next.catch(() => {})
    return next
  }
}
