import type { Snapshot } from '../../shared/wow-companion'

import { array, finite, integer, maxLength, minValue, number, pipe, safeParse } from 'valibot'

const requestsSchema = pipe(array(pipe(number(), finite(), integer(), minValue(0))), maxLength(10_000))

/**
 * Normalizes a persisted local-clock time. Incomplete input cannot change the active schedule.
 * @example normalizeClock('25:00', '22:00') // => '22:00'
 */
export function normalizeClock(value: unknown, initial: string): string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : initial
}

/** Local wall-clock schedules include their start and exclude their end. Equal endpoints cover the whole day. */
export function isQuietTime(now: number, start: string, end: string): boolean {
  const date = new Date(now)
  if (!Number.isFinite(date.getTime()))
    return true
  const minute = date.getHours() * 60 + date.getMinutes()
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  const from = minutes(start)
  const until = minutes(end)
  return from < until ? minute >= from && minute < until : minute >= from || minute < until
}

/** Only reported instance types select scene overrides. Unknown and PvP observations use the base frequency. */
export function interactionScene(snapshot: Snapshot | null | undefined): 'outdoor' | 'instance' | 'unknown' {
  if (snapshot?.instanceType === 'none')
    return 'outdoor'
  if (snapshot?.instanceType && ['party', 'raid', 'scenario'].includes(snapshot.instanceType))
    return 'instance'
  return 'unknown'
}

/**
 * Normalizes the persisted rolling request ledger. It contains timestamps only.
 * @example normalizeRequests([1000, 2000]) // => [1000, 2000]
 */
function normalizeRequests(value: unknown): number[] {
  const result = safeParse(requestsSchema, value)
  return result.success ? result.output : []
}

/** Clock rollback retains future reservations until their original hour expires, preventing an accidental budget reset. */
function recentRequests(requests: readonly number[], now: number): number[] {
  return requests.filter(time => time > now - 3_600_000)
}

/**
 * Main Stage is the single writer. Reservations reach browser storage before generation starts.
 * Settings windows read storage on their display clock, without a writable replica of usage.
 */
export class ProactiveBudget {
  private readonly key = 'settings/wow-chatter/model-requests-v1'

  private recent(now: number) {
    const raw = localStorage.getItem(this.key)
    let requests: number[] = []
    if (raw) {
      try {
        requests = normalizeRequests(JSON.parse(raw))
      }
      catch { /* Invalid stored JSON grants no historical evidence. */ }
    }
    return recentRequests(requests, now)
  }

  usage(now: number, limit: number) {
    const recent = this.recent(now)
    return { used: recent.length, remaining: Math.max(0, limit - recent.length), nextAt: recent.length ? Math.min(...recent) + 3_600_000 : null }
  }

  /** A failed generation keeps its reservation. Disabling the cap still records usage for a later re-enable. */
  consume(now: number, limit: number | undefined) {
    if (!Number.isSafeInteger(now) || now < 0)
      return false
    const recent = this.recent(now)
    if (limit !== undefined && recent.length >= limit)
      return false
    localStorage.setItem(this.key, JSON.stringify([...recent, now].slice(-10_000)))
    return true
  }
}
