import type { WowDataCacheEvidence, WowDataCacheKey, WowDataCachePort, WowMcpMarket, WowReferenceEvidence } from '@proj-airi/stage-shared/wow-knowledge'

import type { McpCallToolPayload, McpCallToolResult, McpToolRuntime } from '../tools/mcp'

import { isWowMcpCacheableResult, isWowMcpPriceRequest, matchesWowMcpMarket, readWowCraftingPayload, readWowDataCacheEvidence, readWowMcpMarket, readWowReferenceBuild, serializeWowDataCacheKey, wowMcpCacheTtl } from '@proj-airi/stage-shared/wow-knowledge'

interface Snapshot { build: string, buildCreatedAt: string, connection: string, market?: WowMcpMarket }
interface Probe { connection: string, started?: number, promise: Promise<Snapshot | undefined> }

function sameMarket(left: WowMcpMarket | undefined, right: WowMcpMarket | undefined) {
  return left !== undefined && right !== undefined && left.collectedAt === right.collectedAt && left.realm === right.realm && left.side === right.side
}

function clean(result: McpCallToolResult): McpCallToolResult {
  const output: McpCallToolResult = {}
  if (result.content !== undefined)
    output.content = result.content
  if (result.structuredContent !== undefined)
    output.structuredContent = result.structuredContent
  if (result.toolResult !== undefined)
    output.toolResult = result.toolResult
  if (result.isError !== undefined)
    output.isError = result.isError
  return output
}

function evidence(receivedAt: string, snapshot?: Snapshot): WowReferenceEvidence {
  return { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', receivedAt, ...(snapshot ? { build: snapshot.build, buildCreatedAt: snapshot.buildCreatedAt } : {}) }
}

function hasReceipt(value: unknown, snapshot: Snapshot, cache: WowDataCacheEvidence) {
  if (!value || typeof value !== 'object' || !('wowReference' in value))
    return false
  const receipt = value.wowReference
  return receipt && typeof receipt === 'object' && 'game' in receipt && receipt.game === 'forever'
    && 'source' in receipt && receipt.source === '无限图鉴 wuxianwow.com'
    && 'sourceUrl' in receipt && receipt.sourceUrl === 'https://wuxianwow.com/'
    && 'build' in receipt && receipt.build === snapshot.build
    && 'buildCreatedAt' in receipt && receipt.buildCreatedAt === snapshot.buildCreatedAt
    && 'receivedAt' in receipt && receipt.receivedAt === cache.sourceReceivedAt
}

/**
 * Main-process adapter. Every lookup probes the current snapshot. Misses verify it again after the source query.
 * Only matching snapshots can reach the disk owner. Invalidation isolates old probes and late writes.
 */
export class WowMcpCacheRuntime implements McpToolRuntime {
  private advertised = new Set<string>()
  private epoch = 0
  private nextProbe = 0
  private probe: Probe | undefined
  private sequence = 0
  private activeProbes = 0
  private pending = new Map<string, Promise<McpCallToolResult>>()

  constructor(private readonly transport: McpToolRuntime, private readonly cache: WowDataCachePort, private readonly connection: () => string | undefined) {}

  /** Session replacement invalidates metadata and in-flight cache writes. The disk owner keeps validated snapshots available for later reuse. */
  invalidate() {
    this.reset()
    this.advertised.clear()
    this.cache.invalidate()
  }

  private reset() {
    this.epoch++
    this.nextProbe = 0
    this.probe = undefined
    this.pending.clear()
  }

  async listTools() {
    let tools: Awaited<ReturnType<McpToolRuntime['listTools']>>
    try {
      tools = await this.transport.listTools()
    }
    catch (error) {
      this.reset()
      this.advertised.clear()
      throw error
    }
    const advertised = new Set(tools.filter(tool => tool.serverName === 'wuxianwow' && tool.name === `wuxianwow::${tool.toolName}`).map(tool => tool.name))
    if (this.advertised.has('wuxianwow::stats') !== advertised.has('wuxianwow::stats'))
      this.reset()
    this.advertised = advertised
    return tools
  }

  private async source(connection: string, after = 0): Promise<Snapshot | undefined> {
    if (this.probe && this.probe.connection !== connection)
      this.reset()
    if (connection !== this.connection())
      return undefined
    if (Date.now() < this.nextProbe)
      return undefined
    if (this.probe && (this.probe.started === undefined || this.probe.started > after))
      return this.probe.promise
    if (this.activeProbes >= 4)
      return undefined
    const epoch = this.epoch
    const probe: Probe = { connection, promise: Promise.resolve(undefined) }
    // Scheduling lets queries completed in this turn share a probe that starts after every participating receipt.
    probe.promise = Promise.resolve().then(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        if (epoch !== this.epoch || connection !== this.connection() || !this.advertised.has('wuxianwow::stats'))
          return undefined
        probe.started = ++this.sequence
        this.activeProbes++
        const request = Promise.resolve().then(() => this.transport.callTool({ name: 'wuxianwow::stats', arguments: {} })).catch(() => undefined).finally(() => {
          this.activeProbes--
        })
        const result = await Promise.race([request, new Promise<undefined>((resolve) => {
          timer = setTimeout(resolve, 2000, undefined)
        })])
        const build = readWowReferenceBuild(result)
        const payload = readWowCraftingPayload(result)
        const snapshot = build?.buildCreatedAt && payload?.app === 'https://wuxianwow.com'
          ? { ...build, buildCreatedAt: build.buildCreatedAt, connection, market: readWowMcpMarket(payload.auction_house) }
          : undefined
        if (epoch !== this.epoch || connection !== this.connection())
          return undefined
        if (this.probe === probe)
          this.nextProbe = snapshot ? 0 : Date.now() + 30_000
        return snapshot
      }
      finally { clearTimeout(timer) }
    })
    this.probe = probe
    try {
      return await probe.promise
    }
    finally {
      if (this.probe === probe)
        this.probe = undefined
    }
  }

  private async fetch(payload: McpCallToolPayload, snapshot: Snapshot | undefined, key: WowDataCacheKey | undefined, ttlMs: number, generation: number, epoch: number): Promise<McpCallToolResult> {
    const result = clean(await this.transport.callTool(payload))
    if (result.isError)
      return result
    const receivedAt = new Date().toISOString()
    const receiptSequence = ++this.sequence
    const auction = isWowMcpPriceRequest(payload.name, payload.arguments ?? {})
    const cacheable = snapshot && isWowMcpCacheableResult(result, payload.name, snapshot.build, auction) && (!auction || matchesWowMcpMarket(result, payload.name, snapshot.market))
    const after = cacheable ? await this.source(snapshot.connection, receiptSequence) : undefined
    const current = epoch === this.epoch && snapshot?.connection === this.connection()
      && after?.connection === snapshot?.connection && after?.build === snapshot?.build && after?.buildCreatedAt === snapshot?.buildCreatedAt
      && (!auction || sameMarket(snapshot?.market, after?.market))
    const stamped: McpCallToolResult = { ...result, wowReference: evidence(receivedAt, current ? snapshot : undefined) }
    if (!key || !cacheable || !current)
      return stamped
    try {
      const cache = await this.cache.put(key, stamped, { ttlMs, sourceReceivedAt: receivedAt, generation })
      const verified = readWowDataCacheEvidence(cache)
      return verified ? { ...stamped, cache: verified } : stamped
    }
    catch { return stamped }
  }

  async callTool(payload: McpCallToolPayload): Promise<McpCallToolResult> {
    const args = payload.arguments ?? {}
    const ttlMs = wowMcpCacheTtl(payload.name, args)
    // The acceptance transport requests a real source call and forbids even hidden metadata probes.
    if (payload.cachePolicy === 'bypass' || ttlMs === undefined)
      return this.transport.callTool(payload)
    const connection = this.connection()
    if (!connection || !this.advertised.has(payload.name) || !this.advertised.has('wuxianwow::stats'))
      return this.transport.callTool(payload)
    const generation = this.cache.generation
    const snapshot = await this.source(connection)
    const epoch = this.epoch
    if (!snapshot)
      return this.fetch(payload, undefined, undefined, ttlMs, generation, epoch)
    const auction = isWowMcpPriceRequest(payload.name, args)
    if (auction && !snapshot.market)
      return this.fetch(payload, snapshot, undefined, ttlMs, generation, epoch)
    const key: WowDataCacheKey = {
      game: 'forever',
      source: 'wuxianwow',
      build: snapshot.build,
      // This public source serves the Chinese client dataset. The UI language never changes this cache namespace.
      locale: 'zhCN',
      snapshot: auction ? JSON.stringify([snapshot.buildCreatedAt, snapshot.market!.collectedAt, snapshot.market!.realm, snapshot.market!.side]) : snapshot.buildCreatedAt,
      connection,
      tool: payload.name,
      args,
    }
    const serialized = serializeWowDataCacheKey(key)
    if (!serialized)
      return this.fetch(payload, snapshot, undefined, ttlMs, generation, epoch)
    try {
      const cached = await this.cache.get(key)
      const cache = readWowDataCacheEvidence(cached?.cache)
      if (cache?.status === 'hit' && cached && Date.parse(cache.expiresAt) > Date.now()
        && generation === this.cache.generation && epoch === this.epoch && connection === this.connection()
        && hasReceipt(cached.data, snapshot, cache)
        && (!auction || matchesWowMcpMarket(cached.data, payload.name, snapshot.market))
        && isWowMcpCacheableResult(cached.data, payload.name, snapshot.build, auction)) {
        const data = clean(cached.data as McpCallToolResult)
        return { ...data, wowReference: evidence(cache.sourceReceivedAt, snapshot), cache }
      }
    }
    catch { /* A damaged or unavailable cache cannot prevent a source query. */ }
    const pendingKey = `${generation}:${serialized}`
    const active = this.pending.get(pendingKey)
    if (active)
      return active
    const operation = this.fetch(payload, snapshot, key, ttlMs, generation, epoch)
    if (this.pending.size < 32)
      this.pending.set(pendingKey, operation)
    try {
      return await operation
    }
    finally {
      if (this.pending.get(pendingKey) === operation)
        this.pending.delete(pendingKey)
    }
  }
}
