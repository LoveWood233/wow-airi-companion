import type { MacroImportRequest, MacroImportResult } from '../wow-macro-import'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowMacroImport = defineInvokeEventa<MacroImportResult, MacroImportRequest>('eventa:invoke:wow-macro-import')
