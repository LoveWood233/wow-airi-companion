import type { InferOutput } from 'valibot'

import { array, maxValue, minValue, number, pipe, strictObject, string } from 'valibot'

import { dshPetPackSchema } from './dsh-pet'

/** One native library supplies the selected pack and display scale to every desktop window. */
export const dshPetLibraryStateSchema = strictObject({
  selectedId: string(),
  scale: pipe(number(), minValue(0.5), maxValue(2)),
  packs: array(dshPetPackSchema),
})
export type DshPetLibraryState = InferOutput<typeof dshPetLibraryStateSchema>

export const dshPetConfigureSchema = strictObject({
  selectedId: string(),
  scale: pipe(number(), minValue(0.5), maxValue(2)),
})
export type DshPetConfigure = InferOutput<typeof dshPetConfigureSchema>
