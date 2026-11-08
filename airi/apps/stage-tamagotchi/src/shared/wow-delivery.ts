import type { InferOutput } from 'valibot'

import { array, check, integer, literal, maxLength, maxValue, minLength, minValue, number, pipe, regex, strictObject, string } from 'valibot'

/** One resource catalog feeds packaging, integrity checks, and Python prerequisite inspection. */
export const companionBridgeFiles = ['server.py', 'capture.py', 'geometry.py', 'connection.py', 'window.py', 'protocol.py', 'state.py', 'item_storage.py', 'macro_import.py', 'macro_native.py', 'retail_query.py', 'index.html'] as const

const version = pipe(string(), minLength(1), maxLength(80), regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/))
const resourcePath = pipe(string(), regex(/^wow-companion-(?:bridge\/[\w-]+\.(?:py|html)|addons\/(?:WoWMapCompanion|WoWForeverCompanion)\/[\w-]+\.(?:toc|lua)|python\/[\w.-]+\.(?:exe|dll|pyd|zip|_pth|pth|txt|cat|json))$/))

/** Packaged companion resources share this version and integrity contract with the release generator. */
export const companionReleaseSchema = strictObject({
  format: literal('wow-companion-release'),
  version: literal(1),
  releaseVersion: version,
  appVersion: version,
  bridgeVersion: version,
  addons: strictObject({ retail: version, forever: version }),
  python: strictObject({ minimum: literal('3.10'), modules: pipe(array(string()), maxLength(0)) }),
  files: pipe(array(strictObject({
    path: resourcePath,
    bytes: pipe(number(), integer(), minValue(0), maxValue(64 * 1024 * 1024)),
    sha256: pipe(string(), regex(/^[a-f\d]{64}$/)),
  })), minLength(1), maxLength(200), check(files => new Set(files.map(file => file.path.toLowerCase())).size === files.length)),
})
export type CompanionRelease = InferOutput<typeof companionReleaseSchema>

export type DeliveryStatus = 'passed' | 'failed' | 'unavailable'
export interface DeliveryCheck { status: DeliveryStatus, code: string, actual?: string, expected?: string }

/** Diagnostics are fresh read-only evidence. A stopped bridge never counts as an observed version match. */
export interface DeliveryReport {
  checkedAt: number
  release: string | null
  app: DeliveryCheck
  resources: DeliveryCheck & { checked: number, total: number }
  bundledBridge: DeliveryCheck
  addons: { retail: DeliveryCheck, forever: DeliveryCheck }
  python: DeliveryCheck & { executable?: string }
  runningBridges: { retail: DeliveryCheck, forever: DeliveryCheck }
}
