import type { WowDataUpdateStatus } from '../wow-data-update'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowDataUpdateGet = defineInvokeEventa<WowDataUpdateStatus>('eventa:invoke:wow-data-update:get')
export const wowDataUpdateChooseGame = defineInvokeEventa<WowDataUpdateStatus>('eventa:invoke:wow-data-update:choose-game')
export const wowDataUpdateChooseTools = defineInvokeEventa<WowDataUpdateStatus>('eventa:invoke:wow-data-update:choose-tools')
export const wowDataUpdateCheck = defineInvokeEventa<WowDataUpdateStatus>('eventa:invoke:wow-data-update:check')
export const wowDataUpdateStart = defineInvokeEventa<WowDataUpdateStatus>('eventa:invoke:wow-data-update:start')
export const wowDataUpdateCancel = defineInvokeEventa<WowDataUpdateStatus>('eventa:invoke:wow-data-update:cancel')
export const wowDataUpdateActivate = defineInvokeEventa<WowDataUpdateStatus, { id: string }>('eventa:invoke:wow-data-update:activate')
