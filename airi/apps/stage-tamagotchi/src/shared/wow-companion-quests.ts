import type { InferOutput } from 'valibot'

import { array, boolean, check, integer, literal, maxLength, maxValue, minValue, nullable, number, optional, picklist, pipe, regex, strictObject, string } from 'valibot'

const identifier = pipe(number(), integer(), minValue(1), maxValue(2147483647))
const count = pipe(number(), integer(), minValue(0), maxValue(2147483647))
const time = pipe(number(), integer(), minValue(1), maxValue(4102444800))
const identity = (maximum: number) => pipe(string(), regex(/^[\w-]+$/), maxLength(maximum))
const text = (maximum: number) => nullable(pipe(string(), maxLength(maximum), check(value => !/[\u0000-\u001F\u007F-\u009F]/u.test(value))))
const sorted = (values: number[]) => values.every((value, index) => index === 0 || values[index - 1]! < value)

const candidateSchema = pipe(strictObject({
  kind: picklist(['ready', 'turned-in', 'level-risk', 'leveling']),
  questID: identifier,
  eventAt: nullable(time),
}), check(value => (value.kind === 'turned-in' || value.kind === 'leveling') === (value.eventAt !== null)))
const adviceSchema = pipe(strictObject({
  v: literal(1),
  playerLevel: nullable(pipe(number(), integer(), minValue(1), maxValue(255))),
  candidates: pipe(array(candidateSchema), maxLength(83)),
}), check(value => (value.playerLevel !== null || value.candidates.length === 0)
  && new Set(value.candidates.map(candidate => JSON.stringify([candidate.kind, candidate.questID, candidate.eventAt]))).size === value.candidates.length))

/** The addon selects game rules. The desktop only correlates and schedules these observed candidates. */
export type QuestAdviceCandidate = InferOutput<typeof candidateSchema>

/** Coverage flags describe what was read, never whether objectives or the world's quests are completed. */
export const questSnapshotSchema = pipe(strictObject({
  v: literal(1),
  id: identifier,
  session: identity(40),
  guid: identity(48),
  observedAt: time,
  source: literal('quest-log'),
  advice: optional(adviceSchema),
  log: strictObject({
    complete: boolean(),
    truncated: boolean(),
    total: nullable(count),
    entries: pipe(array(strictObject({
      questID: identifier,
      title: text(128),
      level: nullable(pipe(number(), integer(), minValue(0), maxValue(255))),
      header: text(128),
      readyForTurnIn: nullable(boolean()),
      failed: nullable(boolean()),
      objectivesComplete: boolean(),
      objectives: pipe(array(strictObject({ index: pipe(number(), integer(), minValue(1), maxValue(8)), text: text(256), type: text(40), fulfilled: nullable(count), required: nullable(count), finished: nullable(boolean()) })), maxLength(8)),
    })), maxLength(50)),
  }),
  completion: strictObject({
    source: picklist(['completed-api', 'session-events', 'unknown']),
    scope: literal('unknown'),
    complete: boolean(),
    truncated: boolean(),
    total: nullable(count),
    ids: pipe(array(identifier), maxLength(512)),
    turnIns: pipe(array(strictObject({ questID: identifier, observedAt: time })), maxLength(32)),
  }),
}), check(value => sorted(value.log.entries.map(entry => entry.questID))
  && value.log.entries.every(entry => sorted(entry.objectives.map(objective => objective.index)))
  && sorted(value.completion.ids)
  && (!value.log.complete || (!value.log.truncated && value.log.total === value.log.entries.length))
  && (!value.completion.complete || (value.completion.source === 'completed-api' && !value.completion.truncated && value.completion.total === value.completion.ids.length))
  && (value.completion.source === 'completed-api' || (value.completion.ids.length === 0 && value.completion.total === null))
  && value.completion.turnIns.every(entry => entry.observedAt <= value.observedAt)
  && new Set(value.completion.turnIns.map(entry => entry.questID)).size === value.completion.turnIns.length
  && (!value.advice || value.advice.candidates.every(candidate => candidate.kind === 'turned-in'
    ? value.completion.turnIns.some(event => event.questID === candidate.questID && event.observedAt === candidate.eventAt)
    : value.log.entries.some(quest => quest.questID === candidate.questID)))
  && (!value.advice || value.advice.candidates.every(candidate => candidate.eventAt === null || candidate.eventAt <= value.observedAt))
  && new TextEncoder().encode(JSON.stringify(value)).length <= 32768, 'Invalid quest coverage, ordering, evidence, or size'))

export type QuestSnapshot = InferOutput<typeof questSnapshotSchema>
