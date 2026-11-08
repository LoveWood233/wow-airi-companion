import type { McpCallToolResult, McpToolDescriptor } from '@proj-airi/stage-ui/tools/mcp'

import { describe, expect, it, vi } from 'vitest'

import { WowMcpEvidence } from './wow-mcp-evidence'

const url = 'https://wuxianwow.com/item/12359'
const answer = `瑟银锭。来源：无限图鉴 wuxianwow.com [物品](${url})`
const descriptor = (name: string): McpToolDescriptor => ({ name, serverName: name.split('::')[0], toolName: name.split('::')[1], inputSchema: { type: 'object' } })

function setup() {
  const control = new AbortController()
  const runtime = {
    listTools: vi.fn(async () => ['wuxianwow::search', 'wuxianwow::fetch', 'wuxianwow::report_issue', 'other::search'].map(descriptor)),
    callTool: vi.fn(async (): Promise<McpCallToolResult> => ({ content: [{ type: 'text', text: JSON.stringify({ results: [{ url }] }) }], isError: false })),
  }
  return { control, runtime, evidence: new WowMcpEvidence(runtime, control.signal) }
}

describe('mCP acceptance receipts', () => {
  it('exposes only permitted queries and rejects write calls before transport', async () => {
    const { evidence, runtime } = setup()
    expect((await evidence.listTools()).map(tool => tool.name)).toEqual(['wuxianwow::search', 'wuxianwow::fetch'])
    await expect(evidence.callTool({ name: 'wuxianwow::report_issue' })).rejects.toThrow('acceptance-tool-not-allowed')
    expect(runtime.callTool).not.toHaveBeenCalled()
  })

  it('requires an actual successful search and matching returned citation', async () => {
    const { evidence, runtime } = setup()
    await evidence.listTools()
    expect(evidence.assess(answer).searched).toBe(false)
    await evidence.callTool({ name: 'wuxianwow::search', arguments: { query: '瑟银锭' } })
    expect(runtime.callTool).toHaveBeenCalledWith({ name: 'wuxianwow::search', arguments: { query: '瑟银锭' }, cachePolicy: 'bypass' })
    expect(evidence.assess(answer)).toEqual({ searched: true, citations: true, sources: [url] })
    expect(evidence.assess(answer.replace('12359', '99999')).citations).toBe(false)
    expect(evidence.assess(url).citations).toBe(false)
    expect(evidence.assess(`${answer} https://wuxianwow.com/item/99999`).citations).toBe(false)
  })

  it('rejects a tool error even when its text contains a source link', async () => {
    const { evidence, runtime } = setup()
    await evidence.listTools()
    runtime.callTool.mockResolvedValue({ content: [{ type: 'text', text: url }], isError: true })
    await evidence.callTool({ name: 'wuxianwow::search' })
    expect(evidence.assess(answer).searched).toBe(false)
    expect(evidence.receipts).toEqual([])
  })

  it('releases cancellation immediately and discards a late transport result', async () => {
    const { evidence, runtime, control } = setup()
    await evidence.listTools()
    const request = Promise.withResolvers<Awaited<ReturnType<typeof runtime.callTool>>>()
    runtime.callTool.mockReturnValue(request.promise)
    const pending = evidence.callTool({ name: 'wuxianwow::search' })
    const rejected = expect(pending).rejects.toThrow('cancelled')
    control.abort(new Error('cancelled'))
    await rejected
    request.resolve({ content: [{ type: 'text', text: url }], isError: false })
    await Promise.resolve()
    expect(evidence.receipts).toEqual([])
  })

  it('stops repeated calls after the task budget', async () => {
    const { evidence, runtime } = setup()
    await evidence.listTools()
    for (let i = 0; i < 6; i++)
      await evidence.callTool({ name: 'wuxianwow::search' })
    await expect(evidence.callTool({ name: 'wuxianwow::search' })).rejects.toThrow('acceptance-tool-not-allowed')
    expect(runtime.callTool).toHaveBeenCalledTimes(6)
  })

  it('does not count a cached result as an actual chain acceptance', async () => {
    const { evidence, runtime } = setup()
    await evidence.listTools()
    runtime.callTool.mockResolvedValue({ content: [{ type: 'text', text: url }], cache: { status: 'hit', sourceReceivedAt: '2026-11-01T00:00:00Z', storedAt: '2026-11-01T00:00:00Z', servedAt: '2026-11-01T01:00:00Z', expiresAt: '2026-11-02T00:00:00Z' } })
    await expect(evidence.callTool({ name: 'wuxianwow::search' })).rejects.toThrow('acceptance-cached-result')
    expect(evidence.receipts).toEqual([])
    expect(evidence.assess(answer).searched).toBe(false)
  })
})
