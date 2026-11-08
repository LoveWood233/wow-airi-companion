import type { Tool } from '@xsai/shared-chat'

import { describe, expect, it } from 'vitest'

import { installStrictToolSchemaMatchers } from '../testing/strict-tool-schema'
import { wowQuestAssistantTools } from './wow-quest-assistant'

installStrictToolSchemaMatchers()

describe('quest assistant tool registration', () => {
  it('registers a strict provider schema without opening IPC or reading characters', async () => {
    const [tool] = await wowQuestAssistantTools()
    expect(tool).toSatisfyStrictToolSchema()
    expect(tool?.function.name).toBe('builtIn_wowQuestAssistant')
  })

  it.each([
    '{broken',
    '{"operation":"search","game":"classic","level":15,"faction":"Horde"}',
    '{"operation":"search","game":"forever","level":0,"faction":"Horde"}',
    '{"operation":"search","game":"forever","level":15,"faction":"Horde","path":"private"}',
    '{"operation":"detail","game":"retail","questId":0}',
  ])('rejects invalid input before constructing IPC: %s', async (request) => {
    const [tool] = await wowQuestAssistantTools()
    await expect(tool!.execute({ request }, {} as Parameters<Tool['execute']>[1])).rejects.toThrow('Invalid quest query')
  })
})
