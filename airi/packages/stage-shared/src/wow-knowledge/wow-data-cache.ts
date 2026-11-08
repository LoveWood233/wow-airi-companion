import type { InferOutput } from 'valibot'

import { check, maxLength, minLength, picklist, pipe, record, safeParse, strictObject, string, unknown } from 'valibot'

export const WOW_STATIC_CACHE_TTL_MS = 86_400_000
export const WOW_AUCTION_CACHE_TTL_MS = 900_000

function timestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    return false
  const day = value.slice(0, 10)
  return Number(value.slice(11, 13)) < 24 && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day)
}

const date = pipe(string(), maxLength(40), check(timestamp))
const identity = pipe(string(), minLength(1), maxLength(256))

/** Receipt times describe the original successful source query and the current cache read independently. */
export const wowDataCacheEvidenceSchema = pipe(strictObject({
  status: picklist(['hit', 'miss']),
  sourceReceivedAt: date,
  servedAt: date,
  storedAt: date,
  expiresAt: date,
}), check(value => Date.parse(value.sourceReceivedAt) <= Date.parse(value.storedAt)
  && Date.parse(value.servedAt) >= Date.parse(value.storedAt)
  && Date.parse(value.expiresAt) > Date.parse(value.storedAt)
  && Date.parse(value.expiresAt) - Date.parse(value.storedAt) <= WOW_STATIC_CACHE_TTL_MS))
export type WowDataCacheEvidence = InferOutput<typeof wowDataCacheEvidenceSchema>

/** The main process owns connection identities. Only a validated source snapshot can create a cache scope. */
export const wowDataCacheKeySchema = pipe(strictObject({
  game: picklist(['retail', 'forever']),
  source: picklist(['retail-db2', 'wuxianwow']),
  build: pipe(identity, check(value => /^\d+\.\d+\.\d+\.\d+$/.test(value))),
  locale: pipe(string(), minLength(1), maxLength(40)),
  snapshot: identity,
  connection: identity,
  tool: pipe(string(), minLength(1), maxLength(128)),
  args: pipe(unknown(), check(value => value !== null && typeof value === 'object' && !Array.isArray(value)), record(string(), unknown())),
}), check(value => (value.game === 'retail' && value.source === 'retail-db2') || (value.game === 'forever' && value.source === 'wuxianwow')))
export type WowDataCacheKey = InferOutput<typeof wowDataCacheKeySchema>

export const wowDataCacheRecordSchema = pipe(strictObject({ data: unknown(), cache: wowDataCacheEvidenceSchema }), check(value => value.data !== undefined))
export type WowDataCacheRecord = InferOutput<typeof wowDataCacheRecordSchema>

/** One main-process owner enforces disk capacity and generations. Callers capture generation before starting a source request. */
export interface WowDataCachePort {
  readonly generation: number
  get: (key: WowDataCacheKey) => Promise<WowDataCacheRecord | undefined>
  put: (key: WowDataCacheKey, data: unknown, options: { ttlMs: number, sourceReceivedAt: string, generation: number }) => Promise<WowDataCacheEvidence | undefined>
  invalidate: () => void
  clear: () => Promise<void>
}

function canonical(value: unknown, ancestors: Set<object>, budget: { nodes: number, characters: number }, depth: number): unknown {
  if (++budget.nodes > 10_000 || depth > 12)
    throw new Error('cache-key-limit')
  if (value === null || typeof value === 'boolean')
    return value
  if (typeof value === 'string') {
    budget.characters += value.length
    if (value.length > 16_384 || budget.characters > 32_768)
      throw new Error('cache-key-limit')
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0))
      throw new Error('cache-key-invalid')
    return value
  }
  if (!value || typeof value !== 'object' || ancestors.has(value))
    throw new Error('cache-key-invalid')
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    throw new Error('cache-key-invalid')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > 10_000 - budget.nodes)
        throw new Error('cache-key-limit')
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index))
          throw new Error('cache-key-invalid')
      }
      const items: unknown[] = value
      return items.map(item => canonical(item, ancestors, budget, depth + 1))
    }
    const keys = Object.keys(value)
    if (keys.length > 10_000 - budget.nodes)
      throw new Error('cache-key-limit')
    return Object.fromEntries(keys.sort().map((key) => {
      budget.characters += key.length
      if (key.length > 1024 || budget.characters > 32_768)
        throw new Error('cache-key-limit')
      return [key, canonical((value as Record<string, unknown>)[key], ancestors, budget, depth + 1)]
    }))
  }
  finally { ancestors.delete(value) }
}

/**
 * Sorts object keys without changing array order or dropping unsupported values. The disk owner hashes this bounded string.
 * @example serializeWowDataCacheKey({ ...scope, tool: 'search', args: { b: 2, a: 1 } }) === serializeWowDataCacheKey({ ...scope, tool: 'search', args: { a: 1, b: 2 } }) // => true
 */
export function serializeWowDataCacheKey(value: unknown): string | undefined {
  try {
    // Validation libraries can filter reserved object keys. Hash the validated original so distinct wire arguments cannot collide.
    const text = JSON.stringify(canonical(value, new Set(), { nodes: 0, characters: 0 }, 0))
    if (new TextEncoder().encode(text).length > 32_768)
      return undefined
    // The bounded traversal precedes schema cloning, so oversized IPC objects cannot force an unbounded validation copy.
    return safeParse(wowDataCacheKeySchema, value).success ? text : undefined
  }
  catch { return undefined }
}

/**
 * Validates transport-owned cache evidence before it affects source timestamps.
 * @example readWowDataCacheEvidence({ status: 'hit' }) // => undefined
 */
export function readWowDataCacheEvidence(value: unknown): WowDataCacheEvidence | undefined {
  const result = safeParse(wowDataCacheEvidenceSchema, value)
  return result.success ? result.output : undefined
}
