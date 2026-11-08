import type { RetailDatabaseQuery, RetailDatabaseResult } from '@proj-airi/stage-shared/wow-knowledge'

import type { WowRetailDatabaseStatus } from '../wow-retail-database'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowRetailDatabaseStatus = defineInvokeEventa<WowRetailDatabaseStatus>('eventa:invoke:wow-retail-database:status')
export const wowRetailDatabasePick = defineInvokeEventa<WowRetailDatabaseStatus>('eventa:invoke:wow-retail-database:pick')
export const wowRetailDatabaseClear = defineInvokeEventa<WowRetailDatabaseStatus>('eventa:invoke:wow-retail-database:clear')
export const wowRetailDatabaseQuery = defineInvokeEventa<RetailDatabaseResult, RetailDatabaseQuery>('eventa:invoke:wow-retail-database:query')
