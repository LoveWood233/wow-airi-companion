import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { statisticsConfigureSchema, statisticsCountersSchema, statisticsEndpointSchema, statisticsUsageObservationSchema } from './wow-statistics'

const id = '02aff7fe-4548-4a32-9b61-44b94c231ae7'

describe('statistics IPC validation', () => {
  it.each(['', 'https://statistics.example.com', 'https://example.com/api', 'http://localhost:8080', 'http://127.0.0.1:8080/api', 'http://[::1]:8080'])('accepts a supported endpoint: %s', (value) => {
    expect(safeParse(statisticsEndpointSchema, value).success).toBe(true)
  })

  it.each(['http://example.com', 'https://user:password@example.com', 'https://@example.com', 'https://example.com?key=x', 'https://example.com#fragment', 'https://example.com?', 'https://example.com/#', 'https://example.com\\path', ' https://example.com', 'file:///tmp/stats', 'http://localhost.example.com', 'http://127.0.0.2', 'http://[::2]', 'https://'])('rejects an unsafe or invalid endpoint: %s', (value) => {
    expect(safeParse(statisticsEndpointSchema, value).success).toBe(false)
  })

  it('keeps missing usage distinct from measured zero', () => {
    expect(safeParse(statisticsUsageObservationSchema, { id, source: 'unavailable' }).success).toBe(true)
    expect(safeParse(statisticsUsageObservationSchema, { id, source: 'reported', totalTokens: 0 }).success).toBe(true)
    expect(safeParse(statisticsUsageObservationSchema, { id, source: 'unavailable', totalTokens: 0 }).success).toBe(false)
    expect(safeParse(statisticsUsageObservationSchema, { id, source: 'reported' }).success).toBe(false)
  })

  it('accepts partial provider usage without creating absent fields', () => {
    const result = safeParse(statisticsUsageObservationSchema, { id, source: 'reported', inputTokens: 21 })
    expect(result.success).toBe(true)
    expect(result.output).toEqual({ id, source: 'reported', inputTokens: 21 })
  })

  it.each([-1, 0.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid token counts: %s', (totalTokens) => {
    expect(safeParse(statisticsUsageObservationSchema, { id, source: 'reported', totalTokens }).success).toBe(false)
  })

  it('rejects private content and extra configuration fields', () => {
    expect(safeParse(statisticsUsageObservationSchema, { id, source: 'reported', totalTokens: 3, model: 'private-model' }).success).toBe(false)
    expect(safeParse(statisticsUsageObservationSchema, { id, source: 'unavailable', content: 'private chat' }).success).toBe(false)
    expect(safeParse(statisticsConfigureSchema, { enabled: true, endpoint: '', intervalSeconds: 1 }).success).toBe(false)
    expect(safeParse(statisticsUsageObservationSchema, { id: 'character-name', source: 'unavailable' }).success).toBe(false)
  })

  it('checks record totals and each reported coverage count', () => {
    const counters = { requests: 3, requestsWithUsage: 2, requestsWithoutUsage: 1, inputTokens: 7, outputTokens: 1, totalTokens: 8, inputReportedRequests: 2, outputReportedRequests: 1, totalReportedRequests: 1 }
    expect(safeParse(statisticsCountersSchema, counters).success).toBe(true)
    expect(safeParse(statisticsCountersSchema, { ...counters, requests: 4 }).success).toBe(false)
    expect(safeParse(statisticsCountersSchema, { ...counters, inputReportedRequests: 3 }).success).toBe(false)
    expect(safeParse(statisticsCountersSchema, { ...counters, outputTokens: -1 }).success).toBe(false)
  })
})
