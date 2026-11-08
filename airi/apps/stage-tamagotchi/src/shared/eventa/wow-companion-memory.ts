import type { ClaimMemoryNotice, CollectEquipmentMemory, CollectMemory, CompanionMemoryState, EditMemory, ExpireSessionGoals, MemoryCapacity, MemoryEntryAction, MemoryScope, RememberMemory, SetMemoryLimit, SuppressMemory } from '../wow-companion-memory'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export const wowMemoryGet = defineInvokeEventa<CompanionMemoryState, MemoryScope>('eventa:invoke:wow-memory:get')
export const wowMemoryGetCapacity = defineInvokeEventa<MemoryCapacity, Pick<MemoryScope, 'personaId'>>('eventa:invoke:wow-memory:get-capacity')
export const wowMemorySetLimit = defineInvokeEventa<CompanionMemoryState, SetMemoryLimit>('eventa:invoke:wow-memory:set-limit')
export const wowMemoryClaimNotice = defineInvokeEventa<boolean, ClaimMemoryNotice>('eventa:invoke:wow-memory:claim-notice')
export const wowMemoryActivate = defineInvokeEventa<void, { personaId: string | null }>('eventa:invoke:wow-memory:activate')
export const wowMemoryRemember = defineInvokeEventa<CompanionMemoryState, RememberMemory>('eventa:invoke:wow-memory:remember')
export const wowMemoryEdit = defineInvokeEventa<CompanionMemoryState, EditMemory>('eventa:invoke:wow-memory:edit')
export const wowMemoryCollect = defineInvokeEventa<CompanionMemoryState, CollectMemory>('eventa:invoke:wow-memory:collect')
export const wowMemoryCollectEquipment = defineInvokeEventa<CompanionMemoryState, CollectEquipmentMemory>('eventa:invoke:wow-memory:collect-equipment')
export const wowMemorySuppress = defineInvokeEventa<CompanionMemoryState, SuppressMemory>('eventa:invoke:wow-memory:suppress')
export const wowMemoryForget = defineInvokeEventa<CompanionMemoryState, MemoryEntryAction>('eventa:invoke:wow-memory:forget')
export const wowMemoryExpireGoals = defineInvokeEventa<CompanionMemoryState, ExpireSessionGoals>('eventa:invoke:wow-memory:expire-goals')
export const wowMemoryClear = defineInvokeEventa<void>('eventa:invoke:wow-memory:clear')
export const wowMemoryCleared = defineEventa('eventa:event:wow-memory:cleared')
