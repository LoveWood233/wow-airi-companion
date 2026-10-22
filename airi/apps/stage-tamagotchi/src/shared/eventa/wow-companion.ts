import type { CaptureSettings, CompanionSettings, CompanionState, DemoRequest } from '../wow-companion'
import type { AccountNameRequest } from '../wow-companion-gold'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowCompanionGet = defineInvokeEventa<CompanionState>('eventa:invoke:wow-companion:get')
export const wowCompanionSetSettings = defineInvokeEventa<CompanionState, CompanionSettings>('eventa:invoke:wow-companion:settings')
export const wowCompanionSetCapture = defineInvokeEventa<CompanionState, CaptureSettings>('eventa:invoke:wow-companion:capture')
export const wowCompanionDemo = defineInvokeEventa<CompanionState, DemoRequest>('eventa:invoke:wow-companion:demo')
export const wowCompanionSetAccountName = defineInvokeEventa<CompanionState, AccountNameRequest>('eventa:invoke:wow-companion:account-name')
