import type { DshPetConfigure, DshPetLibraryState } from '../dsh-pet-library'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export const dshPetGet = defineInvokeEventa<DshPetLibraryState, void>('eventa:invoke:dsh-pet:get')
export const dshPetConfigure = defineInvokeEventa<DshPetLibraryState, DshPetConfigure>('eventa:invoke:dsh-pet:configure')
export const dshPetImport = defineInvokeEventa<DshPetLibraryState | null, void>('eventa:invoke:dsh-pet:import')
export const dshPetChanged = defineEventa<DshPetLibraryState>('eventa:event:dsh-pet:changed')
