import type { Tool } from '@xsai/shared-chat'

import { readWowQuestToolRequest, WOW_QUEST_ASSISTANT_TOOL_DESCRIPTION, WOW_QUEST_ASSISTANT_TOOL_NAME } from '@proj-airi/stage-shared/wow-knowledge'
import { rawTool } from '@xsai/tool'

/** Registers without reading a game or opening IPC. Each executor owns a stateless query client independent of the settings form. */
export async function wowQuestAssistantTools(): Promise<Tool[]> {
  let client: import('../../../utils/wow-quest-client').WowQuestClient | undefined
  return [rawTool({
    name: WOW_QUEST_ASSISTANT_TOOL_NAME,
    description: WOW_QUEST_ASSISTANT_TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: { request: { type: 'string', description: 'JSON-encoded search or detail request. Specify game. No SQL, file paths or actions.' } },
      required: ['request'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const request = readWowQuestToolRequest(input)
      if (!request)
        throw new Error('Invalid quest query')
      if (!client) {
        const [{ createWowQuestClient }, { useWowCompanionStore }] = await Promise.all([import('../../../utils/wow-quest-client'), import('../../wow-companion')])
        const companion = useWowCompanionStore()
        client = createWowQuestClient(game => companion.profiles[game].error ? undefined : companion.profiles[game].state)
      }
      return JSON.stringify(await client.query(request))
    },
  })]
}
