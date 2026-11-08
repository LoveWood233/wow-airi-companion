import type { BrowserBackup } from '../wow-backup'
import type { LocalUpdatePreview, LocalUpdateStatus } from '../wow-local-update'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowLocalUpdateStatus = defineInvokeEventa<LocalUpdateStatus>('eventa:invoke:wow-local-update:status')
export const wowLocalUpdatePick = defineInvokeEventa<LocalUpdatePreview | null>('eventa:invoke:wow-local-update:pick')
export const wowLocalUpdateLaunch = defineInvokeEventa<void, { id: string, browser: BrowserBackup, portable: BrowserBackup }>('eventa:invoke:wow-local-update:launch')
export const wowLocalUpdateRendererReady = defineInvokeEventa<boolean>('eventa:invoke:wow-local-update:renderer-ready')
