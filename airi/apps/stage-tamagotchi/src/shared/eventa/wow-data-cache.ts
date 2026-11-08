import type { WowDataCacheStatus } from '../wow-data-cache'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowDataCacheStatus = defineInvokeEventa<WowDataCacheStatus>('eventa:invoke:wow-data-cache:status')
export const wowDataCacheClear = defineInvokeEventa<WowDataCacheStatus>('eventa:invoke:wow-data-cache:clear')
