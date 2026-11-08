import type { LlmUsage } from '@proj-airi/core-agent'

import type { ModelUsageObservation } from './model-usage'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { reportModelUsage, subscribeModelUsage } from './model-usage'

const unsubscribes: Array<() => void> = []

afterEach(() => {
  unsubscribes.splice(0).forEach(unsubscribe => unsubscribe())
})

function collect() {
  const observations: Readonly<ModelUsageObservation>[] = []
  unsubscribes.push(subscribeModelUsage((observation) => {
    observations.push(observation)
  }))
  return observations
}

describe('model usage observations', () => {
  it('emits only immutable count fields with a fresh UUID for each generation', () => {
    const observations = collect()
    const usage = { source: 'reported', inputTokens: 12, outputTokens: 8, totalTokens: 20, model: 'private', text: 'private', endpoint: 'private' } satisfies LlmUsage & { model: string, text: string, endpoint: string }
    reportModelUsage(usage)
    reportModelUsage(usage)

    expect(observations[0]).toEqual({ id: expect.any(String), source: 'reported', inputTokens: 12, outputTokens: 8, totalTokens: 20 })
    expect(observations[0].id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
    expect(observations[0].id).not.toBe(observations[1].id)
    expect(Object.isFrozen(observations[0])).toBe(true)
  })

  it('preserves actual zero and partial counts without deriving absent totals', () => {
    const observations = collect()
    reportModelUsage({ source: 'reported', inputTokens: 0 })
    reportModelUsage({ source: 'reported', inputTokens: 2, outputTokens: 3 })

    expect(observations).toEqual([
      { id: expect.any(String), source: 'reported', inputTokens: 0 },
      { id: expect.any(String), source: 'reported', inputTokens: 2, outputTokens: 3 },
    ])
  })

  it.each(['estimated', 'unavailable'] as const)('never publishes %s token values as real usage', (source) => {
    const observations = collect()
    reportModelUsage({ source, inputTokens: 50, outputTokens: 20, totalTokens: 70 })
    expect(observations).toEqual([{ id: expect.any(String), source: 'unavailable' }])
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('drops invalid token counts: %s', (value) => {
    const observations = collect()
    reportModelUsage({ source: 'reported', inputTokens: value, outputTokens: 3, totalTokens: value })
    expect(observations).toEqual([{ id: expect.any(String), source: 'reported', outputTokens: 3 }])
  })

  it('marks an empty reported object unavailable', () => {
    const observations = collect()
    reportModelUsage({ source: 'reported' })
    expect(observations).toEqual([{ id: expect.any(String), source: 'unavailable' }])
  })

  it('isolates synchronous and asynchronous observer failures and supports unsubscription', async () => {
    const broken = vi.fn(() => {
      throw new Error('observer failed')
    })
    unsubscribes.push(subscribeModelUsage(broken))
    unsubscribes.push(subscribeModelUsage(async () => {
      throw new Error('async observer failed')
    }))
    const healthy = vi.fn()
    const unsubscribe = subscribeModelUsage(healthy)
    reportModelUsage({ source: 'reported', totalTokens: 1 })
    unsubscribe()
    reportModelUsage({ source: 'unavailable' })
    await Promise.resolve()

    expect(broken).toHaveBeenCalledTimes(2)
    expect(healthy).toHaveBeenCalledOnce()
  })
})
