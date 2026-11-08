import type { WowReferenceEvidence } from '@proj-airi/stage-shared/wow-knowledge'

import type { McpCallToolPayload, McpCallToolResult, McpToolRuntime } from '../tools/mcp'

import { isWowReferenceCall, readWowDataCacheEvidence, readWowReferenceBuild } from '@proj-airi/stage-shared/wow-knowledge'

type BuildEvidence = ReturnType<typeof readWowReferenceBuild>
type ReferenceResult = McpCallToolResult & { wowReference?: WowReferenceEvidence }

function withoutEvidence(result: McpCallToolResult): McpCallToolResult {
  if (result.cache === undefined && result.wowReference === undefined)
    return result
  const clean = { ...result }
  delete clean.cache
  delete clean.wowReference
  return clean
}

function hasTrustedReceipt(result: McpCallToolResult) {
  const reference = result.wowReference
  if (!reference || reference.game !== 'forever' || reference.source !== '无限图鉴 wuxianwow.com' || reference.sourceUrl !== 'https://wuxianwow.com/'
    || !/^\d{4}-\d{2}-\d{2}T/.test(reference.receivedAt) || !Number.isFinite(Date.parse(reference.receivedAt))) {
    return false
  }
  const cache = readWowDataCacheEvidence(result.cache)
  return result.cache === undefined || (cache !== undefined && cache.sourceReceivedAt === reference.receivedAt)
}

/** Adds source evidence without rewriting records. Only an advertised read-only stats tool supplies cached build metadata. */
export class WowReferenceRuntime implements McpToolRuntime {
  private statsAvailable = false
  private statsGeneration = 0
  private cachedBuild: BuildEvidence
  private nextProbe = 0
  private pending: Promise<BuildEvidence> | undefined

  constructor(private readonly transport: McpToolRuntime) {}

  async listTools() {
    const tools = await this.transport.listTools()
    const statsAvailable = tools.some(tool => tool.serverName === 'wuxianwow' && tool.name === 'wuxianwow::stats' && tool.toolName === 'stats')
    if (statsAvailable !== this.statsAvailable) {
      this.statsGeneration++
      this.cachedBuild = undefined
      this.nextProbe = 0
      this.pending = undefined
    }
    this.statsAvailable = statsAvailable
    return tools
  }

  private async build(): Promise<BuildEvidence> {
    if (!this.statsAvailable)
      return undefined
    if (Date.now() < this.nextProbe)
      return this.cachedBuild
    if (this.pending)
      return this.pending
    const generation = this.statsGeneration
    const operation = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const metadata = this.transport.callTool({ name: 'wuxianwow::stats', arguments: {} }).then(readWowReferenceBuild).catch(() => undefined)
        const value = await Promise.race([metadata, new Promise<undefined>((resolve) => {
          timer = setTimeout(resolve, 2000, undefined)
        })])
        if (generation !== this.statsGeneration || !this.statsAvailable)
          return undefined
        this.cachedBuild = value
        // Successful build metadata lasts five minutes. A failed probe has a short backoff and never hides a returned record.
        this.nextProbe = Date.now() + (value ? 300_000 : 30_000)
        return value
      }
      finally { clearTimeout(timer) }
    })()
    this.pending = operation
    try {
      return await operation
    }
    finally {
      if (this.pending === operation)
        this.pending = undefined
    }
  }

  async callTool(payload: McpCallToolPayload): Promise<ReferenceResult> {
    const response = await this.transport.callTool(payload)
    const result = this.transport.trustedWowEvidence ? response : withoutEvidence(response)
    if (this.transport.trustedWowEvidence && hasTrustedReceipt(result))
      return result
    if (this.transport.trustedWowEvidence && result.cache !== undefined)
      return withoutEvidence(result)
    const buildReference = payload.name === 'wuxianwow::talents' || payload.name === 'wuxianwow::spellbook'
    if ((!buildReference && !isWowReferenceCall(JSON.stringify({ name: payload.name, arguments: JSON.stringify(payload.arguments ?? {}) }))) || result.isError)
      return result
    const receivedAt = new Date().toISOString()
    if (this.transport.trustedWowEvidence)
      return { ...withoutEvidence(result), wowReference: { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', receivedAt } }
    const build = await this.build()
    return { ...result, wowReference: { game: 'forever', source: '无限图鉴 wuxianwow.com', sourceUrl: 'https://wuxianwow.com/', receivedAt, ...build } }
  }
}
