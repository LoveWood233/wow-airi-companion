import type { CaptureSettings, CompanionSettings, CompanionState, DemoRequest, GameVersion } from '../wow-companion'
import type { AccountNameRequest } from '../wow-companion-gold'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowCompanionGet = defineInvokeEventa<CompanionState, { game: GameVersion }>('eventa:invoke:wow-companion:get')
export const wowCompanionSetSettings = defineInvokeEventa<CompanionState, { game: GameVersion, settings: CompanionSettings }>('eventa:invoke:wow-companion:settings')
export const wowCompanionSetCapture = defineInvokeEventa<CompanionState, { game: GameVersion, capture: CaptureSettings }>('eventa:invoke:wow-companion:capture')
export const wowCompanionDemo = defineInvokeEventa<CompanionState, { game: GameVersion, request: DemoRequest }>('eventa:invoke:wow-companion:demo')
export const wowCompanionSetAccountName = defineInvokeEventa<CompanionState, { game: GameVersion, request: AccountNameRequest }>('eventa:invoke:wow-companion:account-name')
