import type { InferOutput } from 'valibot'

import { array, check, integer, literal, maxLength, maxValue, minValue, number, pipe, regex, strictObject, string } from 'valibot'

/** Relative inventory paths never contain Windows device names, alternate streams, or parent traversal. */
const pathSchema = pipe(string(), maxLength(1024), check(path => path.split('/').every(part => !!part && part !== '.' && part !== '..'
  && !/[\\:<>"|?*\p{Cc}]/u.test(part) && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))))

export const localUpdateManifestSchema = strictObject({
  format: literal('wow-companion-update'),
  version: literal(1),
  product: literal('wow-companion'),
  platform: literal('win32'),
  arch: literal('x64'),
  releaseVersion: pipe(string(), regex(/^\d+\.\d+\.\d+$/)),
  appVersion: pipe(string(), maxLength(80)),
  entry: literal('wow-companion.exe'),
  files: pipe(array(strictObject({ path: pathSchema, bytes: pipe(number(), integer(), minValue(0), maxValue(8 * 1024 ** 3)), sha256: pipe(string(), regex(/^[a-f\d]{64}$/)) })), maxLength(30_000), check(files => new Set(files.map(file => file.path.toLowerCase())).size === files.length), check(files => ['wow-companion.exe', 'resources/app.asar', 'resources/wow-companion-release.json'].every(path => files.some(file => file.path === path))), check(files => files.reduce((size, file) => size + file.bytes, 0) <= 16 * 1024 ** 3)),
})
export type LocalUpdateManifest = InferOutput<typeof localUpdateManifestSchema>

export interface LocalUpdatePreview {
  id: string
  directory: string
  releaseVersion: string
  appVersion: string
  files: number
  bytes: number
}
export interface LocalUpdateStatus {
  supported: boolean
  last: { outcome: 'updated' | 'rolled-back' | 'recovery-required', checkpoint: string, at: number } | null
}
