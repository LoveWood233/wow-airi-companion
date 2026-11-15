import type { InferOutput } from 'valibot'

import { array, check, integer, literal, maxLength, maxValue, minLength, minValue, number, object, picklist, pipe, regex, string } from 'valibot'

const encoder = new TextEncoder()
const identifier = pipe(number(), integer(), minValue(1), maxValue(2147483647))
const rank = pipe(number(), integer(), minValue(0), maxValue(65535))
const bonus = pipe(number(), integer(), minValue(-65535), maxValue(65535))

function publicText(maximum: number) {
  return pipe(string(), minLength(1), check(value => encoder.encode(value).length <= maximum), check(value => [...value].every((character) => {
    const point = character.codePointAt(0)!
    return point >= 32 && (point < 127 || point > 159) && (point < 0xD800 || point > 0xDFFF)
  })))
}

const weaponSkillSchema = pipe(object({
  skillLineID: identifier,
  name: publicText(64),
  rank,
  maxRank: rank,
  modifier: bonus,
  temporary: bonus,
}), check(skill => skill.rank <= skill.maxRank, 'Weapon skill rank exceeds the observed maximum.'))

/** Complete weapon proficiency observations belong to one character and transport session. Bonuses remain separate from the reported rank. */
export const weaponSkillsSnapshotSchema = pipe(object({
  v: literal(1),
  id: identifier,
  session: pipe(string(), regex(/^[\w-]{1,40}$/)),
  guid: publicText(48),
  observedAt: identifier,
  status: picklist(['available', 'unsupported', 'unavailable']),
  entries: pipe(array(weaponSkillSchema), maxLength(32)),
}), check(record => record.status === 'available' || record.entries.length === 0, 'Unavailable weapon skills cannot contain ranks.'), check(record => new Set(record.entries.map(skill => skill.skillLineID)).size === record.entries.length, 'Weapon skill identifiers must be unique.'))

export type WeaponSkillsSnapshot = InferOutput<typeof weaponSkillsSnapshotSchema>
