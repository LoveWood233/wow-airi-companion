import type { McpCallToolPayload, McpToolDescriptor, McpToolRuntime } from '@proj-airi/stage-ui/tools/mcp'

const allowedNames = new Set(['wuxianwow::search', 'wuxianwow::fetch'])

function sourceLinks(value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const links = new Set<string>()
  for (const match of text?.matchAll(/https:\/\/wuxianwow\.com\/[^\s"<>\\)\]}，。]+/g) ?? []) {
    try {
      const url = new URL(match[0])
      if (url.hostname === 'wuxianwow.com' && !url.port && !url.username && !url.password && url.pathname !== '/')
        links.add(url.href)
    }
    catch { /* An incomplete URL is not citation evidence. */ }
  }
  return [...links]
}

/** One acceptance run owns these receipts. Only successful model-triggered calls supply citation evidence. */
export class WowMcpEvidence implements McpToolRuntime {
  private catalog: McpToolDescriptor[] = []
  private calls = 0
  readonly receipts: Array<{ name: string, links: string[] }> = []
  failed = false

  constructor(private readonly runtime: McpToolRuntime, private readonly signal: AbortSignal) {}

  private async wait<T>(request: Promise<T>): Promise<T> {
    this.signal.throwIfAborted()
    const cancellation = Promise.withResolvers<never>()
    const abort = () => cancellation.reject(this.signal.reason)
    this.signal.addEventListener('abort', abort, { once: true })
    try {
      return await Promise.race([request, cancellation.promise])
    }
    finally { this.signal.removeEventListener('abort', abort) }
  }

  async listTools() {
    this.signal.throwIfAborted()
    const tools = await this.wait(this.runtime.listTools())
    this.signal.throwIfAborted()
    this.catalog = tools.filter(tool => tool.serverName === 'wuxianwow' && allowedNames.has(tool.name))
    if (!this.catalog.some(tool => tool.name === 'wuxianwow::search'))
      throw new Error('wuxianwow-search-unavailable')
    return this.catalog
  }

  async callTool(payload: McpCallToolPayload) {
    this.signal.throwIfAborted()
    if (++this.calls > 6 || !this.catalog.some(tool => tool.name === payload.name)) {
      this.failed = true
      throw new Error('acceptance-tool-not-allowed')
    }
    try {
      const result = await this.wait(this.runtime.callTool({ ...payload, cachePolicy: 'bypass' }))
      this.signal.throwIfAborted()
      if (result.cache?.status === 'hit')
        throw new Error('acceptance-cached-result')
      if (result.isError) {
        this.failed = true
        return result
      }
      this.receipts.push({ name: payload.name, links: sourceLinks(result) })
      return result
    }
    catch (error) {
      this.failed = true
      throw error
    }
  }

  assess(answer: string) {
    const searched = this.receipts.some(receipt => receipt.name === 'wuxianwow::search') && !this.failed
    const returned = new Set(this.receipts.flatMap(receipt => receipt.links))
    const cited = sourceLinks(answer)
    const sources = cited.filter(link => returned.has(link))
    const citations = searched && sources.length > 0 && cited.every(link => returned.has(link))
      && answer.includes('无限图鉴') && answer.includes('wuxianwow.com')
    return { searched, citations, sources }
  }
}
