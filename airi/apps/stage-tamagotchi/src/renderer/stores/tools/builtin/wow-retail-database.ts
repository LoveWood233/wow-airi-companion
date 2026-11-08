import type { Tool } from '@xsai/shared-chat'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { retailDatabaseQuerySchema, retailDatabaseResultSchema, retailDatabaseToolArgumentsSchema, WOW_RETAIL_QUERY_TOOL_NAME } from '@proj-airi/stage-shared/wow-knowledge'
import { rawTool } from '@xsai/tool'
import { parse } from 'valibot'

import { wowRetailDatabaseQuery } from '../../../../shared/eventa/wow-retail-database'

/** Registers a lazy query tool. Discovery never opens a database or launches a Python process. */
export async function wowRetailDatabaseTools(): Promise<Tool[]> {
  let invoke: ReturnType<typeof createInvoker> | undefined
  function createInvoker() {
    const { context } = createContext(window.electron.ipcRenderer)
    return defineInvoke(context, wowRetailDatabaseQuery)
  }
  return [rawTool({
    name: WOW_RETAIL_QUERY_TOOL_NAME,
    description: [
      'Query the configured local World of Warcraft Retail DB2 snapshot. Use it first for Retail items, maps, areas, spells, and dungeon encounters.',
      'For WoW Forever use wuxianwow instead. Read the returned game, build, locale, export time, table limits, and notices before explaining facts.',
      'The request is a JSON object encoded as a string: {"operation":"stats"}; {"operation":"search","kind":"item","query":"瑟银锭","limit":20,"offset":0}; or {"operation":"fetch","id":"map:0"}.',
      'Kinds are item, map (underlying map), uimap (player world map), area, spell, and encounter (dungeon boss). These IDs are different namespaces.',
      'Search results can be partial. Fetch the chosen typed identity before explaining details. The snapshot contains client facts, not verified live server mechanics or player progress.',
      'Cite 正式服本地 DB2 with its build and source tables. Never invent an external webpage, current hotfix, missing quest text, or field meaning.',
      'If database-unconfigured is returned, ask the user to select the exported SQLite file in Settings → Retail database. Never request SQL or a file path from the model.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: { request: { type: 'string', description: 'JSON-encoded search, fetch, or stats request. No SQL, table names, or filesystem paths.' } },
      required: ['request'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const raw = parse(retailDatabaseToolArgumentsSchema, input)
      const request = parse(retailDatabaseQuerySchema, JSON.parse(raw.request) as unknown)
      invoke ??= createInvoker()
      return JSON.stringify(parse(retailDatabaseResultSchema, await invoke(request)))
    },
  })]
}
