import type { GameVersion } from '../wow-companion'
import type { SetupEnvironment, SetupInspection } from '../wow-setup'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowSetupPick = defineInvokeEventa<string | null>('eventa:invoke:wow-setup:pick')
export const wowSetupInspect = defineInvokeEventa<SetupInspection, { game: GameVersion, directory: string }>('eventa:invoke:wow-setup:inspect')
export const wowSetupInstall = defineInvokeEventa<{ inspection: SetupInspection, backup?: string }, { game: GameVersion, directory: string }>('eventa:invoke:wow-setup:install')
export const wowSetupEnvironment = defineInvokeEventa<SetupEnvironment, { game: GameVersion }>('eventa:invoke:wow-setup:environment')
