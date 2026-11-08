import type { WowBuildQuery } from '@proj-airi/stage-shared/wow-knowledge'
import type { McpCallToolResult, McpToolRuntime } from '@proj-airi/stage-ui/tools/mcp'

import assert from 'node:assert/strict'
import process from 'node:process'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readWowBuildAnswer } from '@proj-airi/stage-shared/wow-knowledge'
import { WowBuildSource } from '@proj-airi/stage-ui/libs/wow-build-source'

/**
 * Verifies four explicit public reference queries without a model, game, character data, or personal configuration access.
 *
 * Call stack:
 *
 * verify-wow-build-assistant
 *   -> {@link WowBuildSource}
 *     -> WowReferenceRuntime
 *       -> MCP Client
 */
const client = new Client({ name: 'wow-companion-read-only-build-check', version: '1.0.0' })
const calls = new Map<string, number>()
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('https://wuxianwow.com/mcp')))
  const transport: McpToolRuntime = {
    listTools: async () => (await client.listTools()).tools.map(tool => ({ name: `wuxianwow::${tool.name}`, serverName: 'wuxianwow', toolName: tool.name, inputSchema: tool.inputSchema })),
    callTool: async (payload) => {
      const name = payload.name.slice('wuxianwow::'.length)
      calls.set(name, (calls.get(name) ?? 0) + 1)
      const result = await client.callTool({ name, arguments: payload.arguments })
      const response: McpCallToolResult = {}
      if (Array.isArray(result.content))
        response.content = result.content as Array<Record<string, unknown>>
      if (result.structuredContent && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent))
        response.structuredContent = result.structuredContent as Record<string, unknown>
      if (typeof result.isError === 'boolean')
        response.isError = result.isError
      return response
    },
  }
  const source = new WowBuildSource(transport)
  const queries: WowBuildQuery[] = [
    { operation: 'talents', game: 'forever', classId: 1, level: 15, nodeId: 105958 },
    { operation: 'compare-talents', game: 'forever', classId: 1, level: 15, build: 'https://wuxianwow.com/talents/1?t=3--' },
    { operation: 'spell', game: 'forever', classId: 1, spellId: 12282 },
    { operation: 'compare-item', game: 'forever', slot: 16, itemId: 19019 },
  ]
  const summaries: object[] = []
  for (const query of queries) {
    const result = await source.query(query)
    assert.equal(result.outcome, 'ok')
    assert(readWowBuildAnswer([{ type: 'text', text: JSON.stringify(result) }], JSON.stringify({ request: JSON.stringify(query) })))
    assert(result.nodes.every(node => node.currentRank === undefined && node.delta === undefined))
    summaries.push({ operation: result.operation, nodes: result.nodes.length, referenceUrl: result.referenceUrl, plannedFirst: result.nodes.find(node => node.plannedRank !== undefined)?.plannedRank, spellId: result.spell?.spellId, spellUrl: result.spell?.url, itemId: result.item?.candidate.itemId, itemUrl: result.item?.candidate.url, effects: result.item?.candidate.effects.length, baseline: result.item?.baselineState, sources: result.sources })
  }
  assert.equal(calls.get('talents'), 2)
  assert.equal(calls.get('spellbook'), 1)
  assert.equal(calls.get('item_usage'), 1)
  assert([...calls.keys()].every(name => ['talents', 'spellbook', 'item_usage', 'stats'].includes(name)))
  process.stdout.write(`${JSON.stringify({ ok: true, source: '无限图鉴 wuxianwow.com', observationsSupplied: false, summaries, calls: Object.fromEntries(calls), writes: false, personalModelCalls: false }, null, 2)}\n`)
}
finally { await client.close() }
