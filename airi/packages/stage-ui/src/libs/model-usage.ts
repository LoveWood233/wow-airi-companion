import type { LlmUsage } from '@proj-airi/core-agent'

/** Content-free provider token counts for one SDK generation, not one HTTP request. */
export interface ModelUsageObservation {
  /** Random UUIDv4 used by the desktop host to deduplicate delivery. */
  id: string
  source: 'reported' | 'unavailable'
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

type ModelUsageListener = (observation: Readonly<ModelUsageObservation>) => void | Promise<void>

const listeners = new Set<ModelUsageListener>()

function tokenCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * Subscribes within this renderer only. The host owns consent, persistence and delivery.
 * Observations contain no provider, model, endpoint, prompt, response or credentials.
 */
export function subscribeModelUsage(listener: ModelUsageListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Publishes SDK-reported counts to local listeners without blocking generation.
 * Estimates and invalid counts become unavailable; absent fields stay absent instead
 * of being inferred or replaced with zero. TTS/ASR without token usage are not counted.
 */
export function reportModelUsage(usage: LlmUsage): void {
  if (listeners.size === 0)
    return
  const inputTokens = usage.source === 'reported' ? tokenCount(usage.inputTokens) : undefined
  const outputTokens = usage.source === 'reported' ? tokenCount(usage.outputTokens) : undefined
  const totalTokens = usage.source === 'reported' ? tokenCount(usage.totalTokens) : undefined
  const observation: Readonly<ModelUsageObservation> = Object.freeze({
    id: crypto.randomUUID(),
    source: inputTokens != null || outputTokens != null || totalTokens != null ? 'reported' : 'unavailable',
    ...(inputTokens != null ? { inputTokens } : {}),
    ...(outputTokens != null ? { outputTokens } : {}),
    ...(totalTokens != null ? { totalTokens } : {}),
  })
  for (const listener of listeners) {
    try {
      void Promise.resolve(listener(observation)).catch(() => {})
    }
    catch {}
  }
}
