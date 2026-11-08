function bounded(value: unknown, budget: { nodes: number, characters: number }, maximum: number, depth = 0): boolean {
  if (++budget.nodes > 20_000 || depth > 14)
    return false
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined)
    return true
  if (typeof value === 'string') {
    budget.characters += value.length
    return value.length <= 4096 && budget.characters <= maximum
  }
  if (!value || typeof value !== 'object')
    return false
  if (Array.isArray(value)) {
    if (value.length > 20_000 - budget.nodes)
      return false
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index) || !bounded(value[index], budget, maximum, depth + 1))
        return false
    }
    return true
  }
  const keys = Object.keys(value)
  return keys.length <= 20_000 - budget.nodes && keys.every(key => key.length <= 128 && bounded((value as Record<string, unknown>)[key], budget, maximum, depth + 1))
}

function json(value: unknown, maximum: number): unknown {
  if (typeof value !== 'string')
    return value
  if (value.length > maximum)
    return undefined
  try {
    return JSON.parse(value) as unknown
  }
  catch { return undefined }
}

/**
 * Recorded text parts contain one domain result. Prose and ambiguous multiple JSON records never supply facts.
 * @example readRecordedWowToolPayload([{ type: 'text', text: '{"outcome":"ok"}' }]) // => { outcome: 'ok' }
 */
export function readRecordedWowToolPayload(raw: unknown, maximum = 1_048_576): unknown {
  let value = json(raw, maximum)
  if (Array.isArray(value)) {
    if (value.length > 8)
      return undefined
    let record: unknown
    for (const part of value) {
      if (!part || typeof part !== 'object' || !('type' in part) || part.type !== 'text' || !('text' in part) || typeof part.text !== 'string')
        continue
      const candidate = json(part.text, maximum)
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        if (record !== undefined)
          return undefined
        record = candidate
      }
    }
    value = record
  }
  return bounded(value, { nodes: 0, characters: 0 }, maximum) ? value : undefined
}
