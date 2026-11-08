import type { BridgeStatus, GameVersion } from '../../../shared/wow-companion'
import type { ItemStoragePage } from '../../../shared/wow-companion-item-storage'

import { errorMessageFrom } from '@moeru/std'
import { parse } from 'valibot'

import { bridgeSchema, gameProfiles } from '../../../shared/wow-companion'
import { companionError } from '../../../shared/wow-companion-errors'
import { itemStoragePageSchema } from '../../../shared/wow-companion-item-storage'

/**
 * Owns the decoder cache and request ordering.
 * Writes suspend new reads. A response from an older generation cannot replace newer state.
 */
export class CompanionBridgeClient {
  private bridge: BridgeStatus | null = null
  private error: string | null = null
  private updatedAt = 0
  private generation = 0
  private mutations = 0
  private pendingRead = false
  private stopped = false
  private readonly baseUrl: string

  /** The address is fixed in production. Tests use an isolated loopback HTTP server. */
  constructor(baseUrl: string | undefined = undefined, private readonly game: GameVersion = 'retail') {
    this.baseUrl = baseUrl ?? `http://127.0.0.1:${gameProfiles[game].port}`
  }

  read() {
    return structuredClone({ bridge: this.bridge, error: this.error, updatedAt: this.updatedAt })
  }

  /** Container pages have their own cursor and size budget. They never replace the frequent character status. */
  async readItemStorage(after: number): Promise<ItemStoragePage> {
    if (this.stopped || !Number.isSafeInteger(after) || after < 0 || after > 2147483647)
      throw new Error(companionError('bridge-stopped'))
    const generation = this.generation
    const instanceId = this.bridge?.instanceId
    const response = await fetch(`${this.baseUrl}/api/item-storage?after=${after}`, {
      signal: AbortSignal.timeout(4000),
      redirect: 'error',
    })
    if (!response.ok)
      throw new Error(companionError('bridge-http', { status: response.status }))
    const maximum = 2 * 1024 * 1024 + 4096
    if (!response.body || Number(response.headers.get('content-length') ?? 0) > maximum)
      throw new Error('Item storage response exceeds its size limit')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        const result = await reader.read()
        if (result.done)
          break
        bytes += result.value.byteLength
        if (bytes > maximum) {
          await reader.cancel()
          throw new Error('Item storage response exceeds its size limit')
        }
        chunks.push(result.value)
      }
    }
    finally {
      reader.releaseLock()
    }
    const content = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      content.set(chunk, offset)
      offset += chunk.byteLength
    }
    const page = parse(itemStoragePageSchema, JSON.parse(new TextDecoder().decode(content)))
    if (this.stopped || generation !== this.generation || page.instanceId !== instanceId || this.bridge?.instanceId !== instanceId)
      throw new Error(companionError('connection-changed'))
    return page
  }

  /** Invalidates both the cached observation and requests started before a settings change. */
  invalidate() {
    this.generation++
    this.bridge = null
    this.error = null
  }

  dispose() {
    this.stopped = true
    this.invalidate()
  }

  async refresh() {
    if (this.stopped || this.pendingRead || this.mutations > 0)
      return
    this.pendingRead = true
    const generation = this.generation
    try {
      const bridge = await this.request('/api/status')
      this.apply(bridge, generation)
    }
    catch (error) {
      if (!this.stopped && generation === this.generation) {
        this.error = errorMessageFrom(error) ?? companionError('bridge-unavailable')
        this.bridge = null
        this.updatedAt = Date.now()
      }
    }
    finally {
      this.pendingRead = false
    }
  }

  /** Applies a calibration or demo command without allowing an older HTTP response to replace its result. */
  async update(path: '/api/config' | '/api/demo' | '/api/reconnect', body: object) {
    if (this.stopped)
      throw new Error(companionError('bridge-stopped'))
    const generation = ++this.generation
    this.mutations++
    try {
      this.apply(await this.request(path, body), generation)
    }
    finally {
      this.mutations--
    }
  }

  private apply(bridge: BridgeStatus, generation: number) {
    if (this.stopped || generation !== this.generation)
      return
    this.bridge = bridge
    this.error = null
    this.updatedAt = Date.now()
  }

  private async request(path: '/api/status' | '/api/config' | '/api/demo' | '/api/reconnect', body?: object) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(2000),
      redirect: 'error',
    })
    if (!response.ok)
      throw new Error(companionError('bridge-http', { status: response.status }))
    const bridge = parse(bridgeSchema, await response.json())
    // Retail 2.2 has no identity fields in status. Its health protocol remains WCP1.
    if ((bridge.game !== undefined && bridge.game !== this.game)
      || (bridge.protocol !== undefined && bridge.protocol !== gameProfiles[this.game].protocol)
      || (this.game === 'forever' && (bridge.game !== 'forever' || bridge.protocol !== 'WCF1'))) {
      throw new Error(companionError('bridge-response-profile', { game: this.game }))
    }
    return bridge
  }
}
