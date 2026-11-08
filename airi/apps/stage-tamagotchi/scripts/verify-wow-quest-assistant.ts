import type { WowQuestQuery } from '@proj-airi/stage-shared/wow-knowledge'
import type { McpCallToolResult, McpToolRuntime } from '@proj-airi/stage-ui/tools/mcp'

import assert from 'node:assert/strict'
import process from 'node:process'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readWowQuestAnswer } from '@proj-airi/stage-shared/wow-knowledge'
import { WowQuestSource } from '@proj-airi/stage-ui/libs/wow-quest-source'

/**
 * Verifies the public read-only quest boundary without game, model, voice, or personal configuration access.
 *
 * Call stack:
 *
 * verify-wow-quest-assistant
 *   -> {@link WowQuestSource}
 *     -> WowReferenceRuntime
 *       -> MCP Client
 */
const client = new Client({ name: 'wow-companion-read-only-quest-check', version: '1.0.0' })
const calls = new Map<string, number>()
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('https://wuxianwow.com/mcp')))
  const transport: McpToolRuntime = {
    listTools: async () => (await client.listTools()).tools.map(tool => ({ name: `wuxianwow::${tool.name}`, toolName: tool.name, serverName: 'wuxianwow', inputSchema: tool.inputSchema })),
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
  const source = new WowQuestSource(transport)
  const search: WowQuestQuery = { operation: 'search', game: 'forever', level: 15, faction: 'Horde', zone: '贫瘠之地', limit: 3 }
  const listed = await source.query(search)
  assert.equal(listed.outcome, 'ok')
  assert.equal(listed.entries.length, 3)
  assert(readWowQuestAnswer(listed, JSON.stringify({ request: JSON.stringify(search) })))
  const first = listed.entries[0]!
  const request: WowQuestQuery = { operation: 'detail', game: 'forever', questId: first.questId, level: search.level, faction: search.faction }
  const selected = await source.query(request)
  assert.equal(selected.outcome, 'ok')
  assert.equal(selected.entries[0]?.questId, first.questId)
  assert(readWowQuestAnswer([{ type: 'text', text: JSON.stringify(selected) }], JSON.stringify({ request: JSON.stringify(request) })))
  assert.equal(calls.get('quests'), 2)
  assert([...calls.keys()].every(name => name === 'quests' || name === 'stats'))
  process.stdout.write(`${JSON.stringify({ ok: true, source: '无限图鉴 wuxianwow.com', listed: listed.entries.map(entry => ({ id: entry.id, title: entry.title, level: entry.level, url: entry.url })), detail: { id: first.id, chainCount: selected.entries[0]?.chain.length, startCount: selected.entries[0]?.starts.length, locationCount: selected.entries[0]?.locations.length, progress: selected.entries[0]?.progress.status }, evidence: selected.sources, calls: Object.fromEntries(calls), noRecursiveChainRequests: true }, null, 2)}\n`)
}
finally { await client.close() }
