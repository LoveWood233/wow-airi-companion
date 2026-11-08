import type { InferOutput } from 'valibot'

import { array, boolean, check, literal, maxLength, maxValue, minLength, minValue, number, optional, pipe, record, regex, strictObject, string, union } from 'valibot'

/** Imported media stays inside its pack. URLs are assigned by the native library after validation. */
export const dshPetFileSchema = pipe(string(), minLength(1), maxLength(512), check(value => value.endsWith('.webm')
  && !value.startsWith('/') && !/[\\%:?#\u0000-\u001F]/.test(value)
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && part.length <= 255), 'Invalid animation file'))
const animationName = pipe(string(), minLength(1), maxLength(507), check(value => !value.endsWith('.webm')
  && !value.startsWith('/') && !/[\\%:?#\u0000-\u001F]/.test(value)
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && part.length <= 250), 'Invalid animation name'))
const names = pipe(array(animationName), maxLength(512))
const requiredNames = pipe(array(animationName), minLength(1), maxLength(512))
const weight = pipe(number(), minValue(0), maxValue(100))

/** DSH animation names refer to media without the .webm extension. Sleep sequences retain their matching three stages. */
export const dshPetAnimationsSchema = strictObject({
  idle: requiredNames,
  turn: names,
  drag: names,
  clicks: names,
  categories: pipe(array(strictObject({ id: pipe(string(), minLength(1), maxLength(80)), weight, noMirror: optional(boolean()), actions: requiredNames })), maxLength(100)),
  sleep: optional(pipe(array(strictObject({ start: requiredNames, loop: requiredNames, end: requiredNames })), maxLength(20))),
  events: optional(record(pipe(string(), minLength(1), maxLength(80)), pipe(array(union([animationName, requiredNames])), maxLength(100)))),
  moves: optional(strictObject({ default: record(string(), number()), actions: pipe(array(strictObject({ name: animationName, params: optional(record(string(), number())) })), maxLength(100)) })),
  baifan: optional(names),
})

const manifestEntries = {
  version: literal(1),
  id: pipe(string(), minLength(1), maxLength(80), regex(/^[\w-]+$/)),
  name: pipe(string(), minLength(1), maxLength(80)),
  files: pipe(array(dshPetFileSchema), minLength(1), maxLength(512), check(files => new Set(files.map(file => file.toLowerCase())).size === files.length, 'Duplicate animation files')),
  animations: dshPetAnimationsSchema,
  animationWeights: optional(strictObject({ idle: weight, turn: weight, move: weight })),
}

function referencedFiles(value: { animations: InferOutput<typeof dshPetAnimationsSchema>, files: string[] }) {
  const animations = value.animations
  const names = [...animations.idle, ...animations.turn, ...animations.drag, ...animations.clicks, ...animations.categories.flatMap(category => category.actions), ...(animations.sleep?.flatMap(set => [...set.start, ...set.loop, ...set.end]) ?? []), ...Object.values(animations.events ?? {}).flatMap(slots => slots.flat()), ...(animations.moves?.actions.map(action => action.name) ?? []), ...(animations.baifan ?? [])]
  return names.every(name => value.files.includes(`${name}.webm`))
}

/** A pack manifest contains media configuration. It cannot carry chat settings, scripts, credentials or network endpoints. */
export const dshPetManifestSchema = pipe(strictObject(manifestEntries), check(value => referencedFiles(value), 'Missing referenced animation file'))
export type DshPetManifest = InferOutput<typeof dshPetManifestSchema>

/** Runtime roots are either bundled resources or the native library's controlled media protocol. */
export const dshPetBaseUrlSchema = pipe(string(), check(value => ['../dsh-pet/builtin', './dsh-pet/builtin', '/dsh-pet/builtin'].includes(value.replace(/\/$/, ''))
  || /^dsh-pet:\/\/packs\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/?$/i.test(value), 'Invalid pet resource root'))
export const dshPetPackSchema = pipe(strictObject({ ...manifestEntries, baseUrl: dshPetBaseUrlSchema }), check(value => referencedFiles(value), 'Missing referenced animation file'))
export type DshPetPack = InferOutput<typeof dshPetPackSchema>

/** Animation pools use the same metadata on the main stage and the settings preview. */
export type DshPetAnimations = InferOutput<typeof dshPetAnimationsSchema>
