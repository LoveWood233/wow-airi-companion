import type { ExecutableTool } from '@proj-airi/stage-ui/stores/ai/chat-llm/tools'
import type { ChatToolReference } from '@proj-airi/stage-ui/types/chat'

import { WOW_BUILD_ASSISTANT_TOOL_NAME, WOW_QUEST_ASSISTANT_TOOL_NAME, WOW_RETAIL_QUERY_TOOL_NAME } from '@proj-airi/stage-shared/wow-knowledge'
import { useLlmToolsStore } from '@proj-airi/stage-ui/stores/ai/chat-llm/tools'
import { TOOL_ICONS } from '@proj-airi/stage-ui/tools/icons'
import { defineStore } from 'pinia'

import { computerUseTools } from './builtin/computer-use'
import { imageJournalTools } from './builtin/image-journal'
import { weatherTools } from './builtin/weather'
import { widgetsTools } from './builtin/widgets'
import { wowBuildAssistantTools } from './builtin/wow-build-assistant'
import { wowMacroImportTools } from './builtin/wow-macro-import'
import { wowQuestAssistantTools } from './builtin/wow-quest-assistant'
import { wowRetailDatabaseTools } from './builtin/wow-retail-database'

export const computerUseToolReferences = [
  { name: 'computer_use' },
  { name: 'computer_use_read_image' },
] satisfies ChatToolReference[]

export const widgetToolReferences = [
  { name: 'stage_widgets' },
  { name: 'get_weather' },
] satisfies ChatToolReference[]

export const artistryToolReferences = [
  { name: 'image_journal' },
  ...widgetToolReferences,
] satisfies ChatToolReference[]

export const useTamagotchiBuiltinToolsStore = defineStore('tamagotchi-builtin-tools', () => {
  const llmToolsStore = useLlmToolsStore()
  const toolIdPrefix = 'tamagotchi:'

  function registeredToolIds() {
    return llmToolsStore.tools
      .filter(tool => tool.id.startsWith(toolIdPrefix))
      .map(tool => tool.id)
  }

  async function refresh() {
    // Each module declares one icon that the chat shows on every call of its tools.
    const groups = await Promise.all([
      imageJournalTools().then(tools => ({ tools, icon: TOOL_ICONS.imageJournal })),
      widgetsTools().then(tools => ({ tools, icon: TOOL_ICONS.widgets })),
      weatherTools().then(tools => ({ tools, icon: TOOL_ICONS.weather })),
      computerUseTools().then(tools => ({ tools, icon: TOOL_ICONS.computerUse })),
      wowMacroImportTools().then(tools => ({ tools, icon: TOOL_ICONS.computerUse })),
      wowRetailDatabaseTools().then(tools => ({ tools, icon: TOOL_ICONS.mcp })),
      wowQuestAssistantTools().then(tools => ({ tools, icon: TOOL_ICONS.mcp })),
      wowBuildAssistantTools().then(tools => ({ tools, icon: TOOL_ICONS.mcp })),
    ])

    llmToolsStore.removeToolsByIds(...registeredToolIds())
    llmToolsStore.addTools(...groups.flatMap(({ tools, icon }) => tools.map(tool => ({
      ...tool,
      icon,
      defaultActive: ['wow_import_macro', WOW_RETAIL_QUERY_TOOL_NAME, WOW_QUEST_ASSISTANT_TOOL_NAME, WOW_BUILD_ASSISTANT_TOOL_NAME].includes(tool.function.name),
      requiresExplicitSelection: computerUseToolReferences.some(reference => reference.name === tool.function.name),
      id: `${toolIdPrefix}${tool.function.name}`,
    } satisfies ExecutableTool))))
  }

  return { refresh }
}, {
  synced: {
    actions: ['refresh'],
    state: false,
  },
})
