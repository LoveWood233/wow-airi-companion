import type { Tool } from '@xsai/shared-chat'

import { readWowBuildToolRequest, WOW_BUILD_ASSISTANT_TOOL_DESCRIPTION, WOW_BUILD_ASSISTANT_TOOL_NAME } from '@proj-airi/stage-shared/wow-knowledge'
import { rawTool } from '@xsai/tool'

/** Discovers without reading a character or database. The executor owns a client that cannot modify the settings form. */
export async function wowBuildAssistantTools(): Promise<Tool[]> {
  let client: import('../../../utils/wow-build-client').WowBuildClient | undefined
  return [rawTool({
    name: WOW_BUILD_ASSISTANT_TOOL_NAME,
    description: WOW_BUILD_ASSISTANT_TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: { request: { type: 'string', description: 'JSON-encoded talents, compare-talents, spell, or compare-item request. Specify game. No SQL, paths or actions.' } },
      required: ['request'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const request = readWowBuildToolRequest(input)
      if (!request)
        throw new Error('Invalid build query')
      if (!client) {
        const [{ createWowBuildClient }, { useWowCompanionStore }] = await Promise.all([import('../../../utils/wow-build-client'), import('../../wow-companion')])
        const companion = useWowCompanionStore()
        client = createWowBuildClient(game => companion.profiles[game].error ? undefined : companion.profiles[game].state)
      }
      return JSON.stringify(await client.query(request))
    },
  })]
}
