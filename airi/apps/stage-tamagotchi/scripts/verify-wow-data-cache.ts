import type { WowDataCachePort } from '@proj-airi/stage-shared/wow-knowledge'
import type { McpCallToolResult, McpToolRuntime } from '@proj-airi/stage-ui/tools/mcp'

import assert from 'node:assert/strict'
import process from 'node:process'

import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { isWowMcpCacheableResult, readWowCraftingPayload, readWowReferenceBuild, serializeWowDataCacheKey } from '@proj-airi/stage-shared/wow-knowledge'
import { WowMcpCacheRuntime } from '@proj-airi/stage-ui/libs/wow-mcp-cache-runtime'

import { WowDataCache } from '../src/main/services/airi/wow-data-cache'

/**
 * Verifies read-only MCP caching in a disposable directory without model or voice requests.
 *
 * Call stack:
 *
 * verify-wow-data-cache
 *   -> {@link WowMcpCacheRuntime}
 *     -> MCP Client
 *     -> {@link WowDataCache}
 */
const endpoint = 'https://wuxianwow.com/mcp'
const client = new Client({ name: 'wow-companion-read-only-cache-check', version: '1.0.0' })
const directory = await mkdtemp(join(tmpdir(), 'wow-live-cache-check-'))
const cache = new WowDataCache(join(directory, 'cache'))
const counts = new Map<string, number>()
const diagnostic = process.argv.includes('--diagnostic')
function trace(value: object) {
  if (diagnostic)
    process.stdout.write(`${JSON.stringify(value)}\n`)
}

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
  const transport: McpToolRuntime = {
    listTools: async () => (await client.listTools()).tools.map(tool => ({ name: `wuxianwow::${tool.name}`, toolName: tool.name, serverName: 'wuxianwow', inputSchema: tool.inputSchema })),
    callTool: async (payload) => {
      const name = payload.name.slice('wuxianwow::'.length)
      counts.set(name, (counts.get(name) ?? 0) + 1)
      const startedAt = Date.now()
      const result = await client.callTool({ name, arguments: payload.arguments })
      const response: McpCallToolResult = {}
      if (Array.isArray(result.content))
        response.content = result.content as Array<Record<string, unknown>>
      if (result.structuredContent && typeof result.structuredContent === 'object' && !Array.isArray(result.structuredContent))
        response.structuredContent = result.structuredContent as Record<string, unknown>
      if (typeof result.isError === 'boolean')
        response.isError = result.isError
      const data = readWowCraftingPayload(response)
      trace({ phase: 'source', name, elapsedMs: Date.now() - startedAt, outcome: data?.outcome, id: data?.id, build: data?.build, builtAt: data?.built_at, product: data?.product, app: data?.app, decodedBuild: readWowReferenceBuild(response), textParts: response.content?.length, structuredKeys: response.structuredContent ? Object.keys(response.structuredContent) : undefined, cacheable: isWowMcpCacheableResult(response, payload.name, '1.60.1.70707') })
      return response
    },
  }
  const port: WowDataCachePort = {
    get generation() { return cache.generation },
    get: async (key) => {
      const value = await cache.get(key)
      trace({ phase: 'cache-get', keyValid: serializeWowDataCacheKey(key) !== undefined, snapshot: key.snapshot, hit: value?.cache.status })
      return value
    },
    put: async (key, data, options) => {
      const value = await cache.put(key, data, options)
      trace({ phase: 'cache-put', keyValid: serializeWowDataCacheKey(key) !== undefined, snapshot: key.snapshot, sourceReceivedAt: options.sourceReceivedAt, generation: options.generation, actualGeneration: cache.generation, status: value?.status })
      return value
    },
    invalidate: () => cache.invalidate(),
    clear: () => cache.clear(),
  }
  const runtime = new WowMcpCacheRuntime(transport, port, () => createHash('sha256').update(endpoint).digest('hex'))
  await runtime.listTools()
  const request = { name: 'wuxianwow::fetch', arguments: { id: 'recipe:8796' } }
  const first = await runtime.callTool(request)
  const second = await runtime.callTool(request)
  assert.equal(first.cache?.status, 'miss')
  assert.equal(second.cache?.status, 'hit')
  assert.equal(counts.get('fetch'), 1)
  assert.deepEqual(second.content, first.content)
  assert.equal(second.wowReference?.receivedAt, first.wowReference?.receivedAt)
  assert.equal(second.cache?.sourceReceivedAt, first.wowReference?.receivedAt)
  const probes = counts.get('stats')
  const bypassed = await runtime.callTool({ ...request, cachePolicy: 'bypass' })
  assert.equal(counts.get('fetch'), 2)
  assert.equal(counts.get('stats'), probes)
  assert.equal(bypassed.cache, undefined)
  process.stdout.write(`${JSON.stringify({ ok: true, source: '无限图鉴 wuxianwow.com', endpoint, record: 'recipe:8796', build: first.wowReference?.build, snapshot: first.wowReference?.buildCreatedAt, first: first.cache, second: second.cache, networkCalls: Object.fromEntries(counts), bypassAddedMetadataProbe: false, disk: await cache.status() }, null, 2)}\n`)
}
finally {
  await client.close().catch(() => {})
  await cache.dispose()
  const target = await realpath(directory)
  assert.equal(dirname(target).toLowerCase(), (await realpath(tmpdir())).toLowerCase())
  assert.ok(basename(target).startsWith('wow-live-cache-check-'))
  await rm(target, { recursive: true, force: true })
}
