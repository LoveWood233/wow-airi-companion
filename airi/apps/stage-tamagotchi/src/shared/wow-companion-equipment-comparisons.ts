import type { InferOutput } from 'valibot'

import { array, boolean, check, finite, integer, literal, maxLength, maxValue, minLength, minValue, nullable, number, picklist, pipe, strictObject, string, variant } from 'valibot'

const encoder = new TextEncoder()
const count = pipe(number(), integer(), minValue(0), maxValue(Number.MAX_SAFE_INTEGER))
const itemId = pipe(number(), integer(), minValue(0), maxValue(2147483647))
function text(bytes: number) {
  return pipe(string(), check(value => encoder.encode(value).length <= bytes && [...value].every((character) => {
    const point = character.codePointAt(0)!
    return point >= 32 && (point < 127 || point > 159) && (point < 0xD800 || point > 0xDFFF)
  }), 'Invalid comparison text'))
}
const identity = pipe(text(48), minLength(1), check(value => /^[\w-]+$/.test(value), 'Invalid comparison identity'))
const statSchema = strictObject({ key: pipe(text(64), minLength(1)), value: pipe(number(), finite(), minValue(-1e12), maxValue(1e12)) })
const itemSchema = pipe(strictObject({
  itemID: itemId,
  name: text(128),
  itemLevel: pipe(number(), finite(), minValue(-1), maxValue(100000)),
  equipLoc: text(128),
  type: text(128),
  subtype: text(128),
  stats: pipe(array(statSchema), maxLength(32)),
  complex: boolean(),
  complete: boolean(),
}), check(item => new Set(item.stats.map(stat => stat.key)).size === item.stats.length
  && (item.itemID === 0 ? item.itemLevel === -1 && item.stats.length === 0 : item.itemLevel >= 0)
  && (!item.complete || item.itemID === 0 || [item.name, item.equipLoc, item.type, item.subtype].every(value => value.length > 0)), 'Invalid comparison item'))

const fields = {
  id: pipe(itemId, minValue(1)),
  session: pipe(identity, maxLength(40)),
  guid: identity,
  class: pipe(text(32), check(value => /^[A-Z_]{1,32}$/.test(value), 'Invalid comparison class')),
  spec: count,
  primary: picklist([0, 1, 2, 4]),
  observedAt: pipe(count, maxValue(4102444800)),
  slot: pipe(count, maxValue(19)),
  usable: boolean(),
  specMatch: nullable(boolean()),
  current: nullable(itemSchema),
  candidate: itemSchema,
}

const assessmentVerdicts = {
  empty_slot: 'upgrade',
  stats_upgrade: 'upgrade',
  unusable: 'not_upgrade',
  wrong_spec: 'not_upgrade',
  weaker_stats: 'not_upgrade',
  equivalent: 'not_upgrade',
  incomplete: 'review',
  unknown_spec: 'review',
  weapon_change: 'review',
  complex_item: 'review',
  stat_tradeoff: 'review',
  primary_upgrade_tradeoff: 'review',
  no_target: 'review',
} as const
const assessmentSchema = pipe(strictObject({
  verdict: picklist(['upgrade', 'not_upgrade', 'review']),
  reason: picklist(Object.keys(assessmentVerdicts) as (keyof typeof assessmentVerdicts)[]),
}), check(value => assessmentVerdicts[value.reason] === value.verdict, 'Invalid assessment reason'))
/** The addon owns this conclusion. Consumers do not infer item quality from the observed facts. */
export type EquipmentAssessment = InferOutput<typeof assessmentSchema>
const deltaSchema = strictObject({ key: pipe(text(64), minLength(1)), before: pipe(number(), finite(), minValue(-1e12), maxValue(1e12)), after: pipe(number(), finite(), minValue(-1e12), maxValue(1e12)) })
const archivedV1 = strictObject({ v: literal(1), ...fields })
const liveV2 = strictObject({ v: literal(2), ...fields, assessment: assessmentSchema, deltas: pipe(array(deltaSchema), maxLength(64)) })

function validTarget(value: Omit<InferOutput<typeof archivedV1>, 'v'>) {
  return value.candidate.itemID > 0 && value.candidate.name.length > 0 && ((value.slot === 0) === (value.current === null))
}
function validDifferences(value: InferOutput<typeof liveV2>) {
  const before = new Map(value.current?.stats.map(stat => [stat.key, stat.value]))
  const after = new Map(value.candidate.stats.map(stat => [stat.key, stat.value]))
  return new Set(value.deltas.map(delta => delta.key)).size === value.deltas.length
    && value.deltas.every(delta => (before.has(delta.key) || after.has(delta.key)) && delta.before === (before.get(delta.key) ?? 0) && delta.after === (after.get(delta.key) ?? 0))
}
/** Live comparisons require the producer conclusion. Correlation and freshness remain the receiving owner's responsibility. */
export const liveEquipmentComparisonSchema = pipe(liveV2, check(value => validTarget(value), 'Invalid comparison slot'), check(value => validDifferences(value), 'Comparison differences do not match evidence'))
export type LiveEquipmentComparison = InferOutput<typeof liveEquipmentComparisonSchema>
/** V1 is a supported archive input. Its missing producer conclusion cannot create live equipment suggestions. */
export const equipmentComparisonSchema = pipe(variant('v', [archivedV1, liveV2]), check(value => validTarget(value), 'Invalid comparison slot'), check(value => value.v === 1 || validDifferences(value), 'Invalid comparison differences'))
export type EquipmentComparison = InferOutput<typeof equipmentComparisonSchema>

/** Reads the producer conclusion. Historical v1 facts remain manual-review records without a recreated desktop decision. */
export function assessEquipment(comparison: EquipmentComparison): EquipmentAssessment {
  return comparison.v === 2 ? comparison.assessment : { verdict: 'review', reason: 'incomplete' }
}

/** Each fixed game profile retains ten acquisition comparisons independently of its existing item history. */
export interface EquipmentComparisonsState {
  entries: { account: string, name: string, realm: string, receivedAt: number, comparison: EquipmentComparison }[]
  storageError: string | null
}
