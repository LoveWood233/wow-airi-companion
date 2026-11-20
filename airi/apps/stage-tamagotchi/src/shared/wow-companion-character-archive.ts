import type { InferOutput } from 'valibot'

import { array, boolean, check, integer, literal, maxLength, maxValue, minLength, minValue, number, object, optional, pipe, regex, string } from 'valibot'

import { calendarBatchSchema } from './wow-companion-calendar'

const count = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER))
const id = pipe(count, minValue(1), maxValue(2147483647))
const observedAt = pipe(count, minValue(1), maxValue(4102444800))
const signed = pipe(number(), integer(), minValue(-2147483648), maxValue(2147483647))
const rank = pipe(count, maxValue(65535))
const label = pipe(string(), minLength(1), maxLength(192))
const identity = (size: number) => pipe(string(), maxLength(size), regex(/^[\w-]+$/))
const copper = pipe(string(), regex(/^(?:0|[1-9]\d{0,15})$/), check(value => Number.isSafeInteger(Number(value))))

const header = {
  v: literal(1),
  session: identity(40),
  guid: identity(48),
  id,
  observedAt,
}

const professionSchema = pipe(object({
  id,
  name: label,
  rank,
  maxRank: rank,
  recipes: optional(pipe(array(id), maxLength(18000))),
  recipesObservedAt: optional(observedAt),
}), check(value => (value.recipes === undefined) === (value.recipesObservedAt === undefined)))

/** Bounds each section before Electron accepts the bridge poll or opens a saved character archive. */
export const characterArchiveSchema = object({
  progress: optional(object({
    ...header,
    section: literal('progress'),
    data: object({
      level: optional(pipe(count, minValue(1), maxValue(255))),
      xp: optional(count),
      xpMax: optional(count),
      copper: optional(copper),
      earned: optional(copper),
      spent: optional(copper),
      moneyEpoch: optional(identity(40)),
      levelSeconds: optional(count),
    }),
  })),
  reputation: optional(object({
    ...header,
    section: literal('reputation'),
    data: object({
      complete: boolean(),
      entries: pipe(array(object({ id, name: label, rank: optional(rank), value: optional(signed), min: optional(signed), max: optional(signed) })), maxLength(2048)),
    }),
  })),
  lockouts: optional(object({
    ...header,
    section: literal('lockouts'),
    data: object({
      complete: boolean(),
      entries: pipe(array(object({ id, name: label, difficulty: optional(rank), resetAt: observedAt, locked: boolean(), extended: boolean() })), maxLength(256)),
    }),
  })),
  schedule: optional(object({ ...header, section: literal('schedule'), data: calendarBatchSchema })),
  professions: optional(object({
    ...header,
    section: literal('professions'),
    data: object({ entries: pipe(array(professionSchema), maxLength(32)) }),
  })),
  achievements: optional(object({
    ...header,
    section: literal('achievements'),
    data: object({ earnedIds: pipe(array(id), maxLength(18000)), complete: boolean() }),
  })),
  exploration: optional(object({
    ...header,
    section: literal('exploration'),
    data: object({
      maps: pipe(array(object({ mapId: id, name: label, areaIds: pipe(array(id), maxLength(512)), overlayCount: optional(rank) })), maxLength(1500)),
    }),
  })),
})

export type CharacterArchive = InferOutput<typeof characterArchiveSchema>

export function matchingArchiveRecord<T extends { session: string, guid: string, observedAt: number }>(record: T | null | undefined, player: { session: string, guid: string }, now = Date.now()): T | undefined {
  if (record?.session === player.session && record.guid === player.guid && record.observedAt > 0 && record.observedAt * 1000 - now <= 5000)
    return record
}
