import type { Tool } from '@xsai/shared-chat'

import { afterEach, describe, expect, it, vi } from 'vitest'

import stats from '../../../../../../../packages/stage-shared/src/wow-knowledge/fixtures/retail-database-stats.json'

import { installStrictToolSchemaMatchers } from '../testing/strict-tool-schema'
import { wowRetailDatabaseTools } from './wow-retail-database'

installStrictToolSchemaMatchers()

const rpc = vi.hoisted(() => ({ query: vi.fn(), create: vi.fn() }))
vi.mock('@moeru/eventa/adapters/electron/renderer', () => ({
  createContext: () => {
    rpc.create()
    return { context: {} }
  },
}))
vi.mock('@moeru/eventa', async (original) => {
  const actual = await original<typeof import('@moeru/eventa')>()
  return { ...actual, defineInvoke: () => rpc.query }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function tool() {
  const [value] = await wowRetailDatabaseTools()
  if (!value)
    throw new Error('Missing tool')
  return value
}

describe('native Retail database model tool', () => {
  it('registers a strict provider schema without opening IPC or a database', async () => {
    const value = await tool()
    expect(value).toSatisfyStrictToolSchema()
    expect(value.function.name).toBe('builtIn_wowRetailQuery')
    expect(rpc.create).not.toHaveBeenCalled()
    expect(rpc.query).not.toHaveBeenCalled()
  })

  it('forwards only validated query DTOs and returns source evidence', async () => {
    vi.stubGlobal('window', { electron: { ipcRenderer: {} } })
    rpc.query.mockResolvedValue(stats)
    const value = await tool()
    const result = await value.execute({ request: '{"operation":"stats"}' }, {} as Parameters<Tool['execute']>[1])
    expect(rpc.query).toHaveBeenCalledWith({ operation: 'stats' })
    expect(JSON.parse(String(result))).toEqual(stats)
    expect(String(result)).not.toContain('gameRoot')
  })

  it.each([
    '{broken',
    '{"operation":"stats","path":"C:/private.db"}',
    '{"operation":"search","kind":"item","query":"x","sql":"DROP TABLE Item"}',
    '{"operation":"fetch","id":"map:00"}',
    '{"operation":"fetch","id":"map:2147483648"}',
  ])('rejects malformed or extra parameters before IPC: %s', async (request) => {
    const value = await tool()
    await expect(value.execute({ request }, {} as Parameters<Tool['execute']>[1])).rejects.toThrow()
    expect(rpc.query).not.toHaveBeenCalled()
  })
})
