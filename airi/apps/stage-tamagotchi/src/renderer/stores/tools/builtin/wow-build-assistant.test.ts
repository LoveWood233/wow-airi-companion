import type { Tool } from '@xsai/shared-chat'

import { describe, expect, it } from 'vitest'

import { installStrictToolSchemaMatchers } from '../testing/strict-tool-schema'
import { wowBuildAssistantTools } from './wow-build-assistant'

installStrictToolSchemaMatchers()

describe('build assistant tool registration', () => {
  it('registers a strict schema without opening the bridge, database, or model provider', async () => {
    const [tool] = await wowBuildAssistantTools()
    expect(tool).toSatisfyStrictToolSchema()
    expect(tool?.function.name).toBe('builtIn_wowBuildAssistant')
  })

  it.each([
    '{broken',
    '{"operation":"talents","game":"classic","classId":1,"level":15}',
    '{"operation":"compare-item","game":"forever","slot":0,"itemId":25}',
    '{"operation":"compare-item","game":"forever","slot":16,"itemId":25,"equip":true}',
    '{"operation":"spell","game":"retail","spellId":12282,"path":"private"}',
  ])('rejects invalid input before creating a client: %s', async (request) => {
    const [tool] = await wowBuildAssistantTools()
    await expect(tool!.execute({ request }, {} as Parameters<Tool['execute']>[1])).rejects.toThrow('Invalid build query')
  })
})
