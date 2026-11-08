import type { InferOutput } from 'valibot'

import { boolean, check, integer, literal, maxLength, maxValue, minValue, nullable, number, optional, picklist, pipe, regex, strictObject, string } from 'valibot'

const count = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER))
const installationId = pipe(string(), regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i))

/** Production reports use HTTPS. Plain HTTP is limited to loopback development servers. */
export const statisticsEndpointSchema = pipe(string(), maxLength(2048), check((value) => {
  if (value === '')
    return true
  if (!/^https?:\/\//.test(value) || /[\\\s?#]/.test(value) || /^https?:\/\/[^/]*@/.test(value))
    return false
  try {
    const url = new URL(value)
    return !url.username && !url.password && !!url.hostname
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  }
  catch {
    return false
  }
}, 'Invalid statistics endpoint'))

/** Counts retain provider-reported coverage. Missing token values never become measured zero-token requests. */
export const statisticsCountersSchema = pipe(strictObject({
  requests: count,
  requestsWithUsage: count,
  requestsWithoutUsage: count,
  inputTokens: count,
  outputTokens: count,
  totalTokens: count,
  inputReportedRequests: count,
  outputReportedRequests: count,
  totalReportedRequests: count,
}), check(value => value.requestsWithUsage + value.requestsWithoutUsage === value.requests
  && [value.inputReportedRequests, value.outputReportedRequests, value.totalReportedRequests].every(coverage => coverage <= value.requestsWithUsage), 'Invalid usage coverage'))
export type StatisticsCounters = InferOutput<typeof statisticsCountersSchema>

export const statisticsErrorSchema = picklist(['not-configured', 'network-error', 'rejected', 'invalid-config', 'storage-error'])

/** The main process keeps installation credentials private. Renderer state contains only disclosure and reporting status. */
export const statisticsStateSchema = strictObject({
  enabled: boolean(),
  disclosed: boolean(),
  endpoint: statisticsEndpointSchema,
  intervalSeconds: literal(300),
  installationId: nullable(installationId),
  counters: statisticsCountersSchema,
  lastReportedAt: nullable(count),
  lastError: nullable(statisticsErrorSchema),
  configured: boolean(),
})
export type StatisticsState = InferOutput<typeof statisticsStateSchema>

export const statisticsConfigureSchema = strictObject({ enabled: boolean(), endpoint: statisticsEndpointSchema })
export type StatisticsConfigure = InferOutput<typeof statisticsConfigureSchema>
export const statisticsAcknowledgeSchema = strictObject({ enabled: boolean() })

/** One SDK generation contributes at most one observation. No content, model name or provider credentials cross this boundary. */
export const statisticsUsageObservationSchema = pipe(strictObject({
  id: installationId,
  source: picklist(['reported', 'unavailable']),
  inputTokens: optional(count),
  outputTokens: optional(count),
  totalTokens: optional(count),
}), check((value) => {
  const present = [value.inputTokens, value.outputTokens, value.totalTokens].some(tokens => tokens !== undefined)
  return value.source === 'reported' ? present : !present
}, 'Invalid model usage observation'))
export type StatisticsUsageObservation = InferOutput<typeof statisticsUsageObservationSchema>
