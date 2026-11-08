import type { ItemStorageQuery, ItemStorageQueryResult } from '../wow-companion-item-storage'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowItemStorageQuery = defineInvokeEventa<ItemStorageQueryResult, ItemStorageQuery>('eventa:invoke:wow-item-storage:query')
export const wowItemStorageClear = defineInvokeEventa<void>('eventa:invoke:wow-item-storage:clear')
