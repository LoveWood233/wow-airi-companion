import type { Tool } from '@xsai/shared-chat'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { rawTool } from '@xsai/tool'
import { parse } from 'valibot'

import { wowMacroImport } from '../../../../shared/eventa/wow-macro-import'
import { macroImportSchema } from '../../../../shared/wow-macro-import'

/** The model supplies macro text. The desktop owns the fixed, receipt-checked import workflow. */
export async function wowMacroImportTools(): Promise<Tool[]> {
  let invoke: ReturnType<typeof createInvoker> | undefined
  function createInvoker() {
    const { context } = createContext(window.electron.ipcRenderer)
    return defineInvoke(context, wowMacroImport)
  }
  return [rawTool({
    name: 'wow_import_macro',
    description: [
      'Create and import a World of Warcraft macro when the user asks you to write or import one.',
      'Use the observed game version, or ask if it is unknown. Never call for examples, quoted requests, or proactive game events.',
      'Provide only the macro body, without Markdown fences. Maximum 255 UTF-8 bytes.',
      'The desktop copies it to the clipboard, waits up to 90 seconds for combat to end, opens /import-marco, pastes, and submits.',
      'Requires the WoWMacroImport addon and live companion telemetry. The game window must remain visible and available.',
      'Saves the character macro WCP Import without executing it. Only ok=true and code=saved confirm success.',
      'On failure explain the returned code and provide the macro for manual import. Never retry automatically.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        game: { type: 'string', enum: ['retail', 'forever'] },
        body: { type: 'string', description: 'The complete macro text with actual line breaks.' },
      },
      required: ['game', 'body'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const request = parse(macroImportSchema, input)
      invoke ??= createInvoker()
      return JSON.stringify(await invoke(request))
    },
  })]
}
