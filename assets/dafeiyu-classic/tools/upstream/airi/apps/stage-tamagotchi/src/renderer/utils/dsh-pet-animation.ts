import type { DshPetPack } from '../../shared/dsh-pet'

/** Uses the source DSH pool rule: avoid consecutive repeats unless a pool contains only one animation. */
export function pickPetAnimation(pool: readonly string[], current = '', roll = Math.random()): string | undefined {
  const alternatives = pool.filter(name => name !== current)
  const choices = alternatives.length ? alternatives : pool
  return choices[Math.min(choices.length - 1, Math.max(0, Math.floor(roll * choices.length)))]
}

/** Imported pack files resolve only under the validated resource root, including nested animation folders. */
export function petAnimationUrl(pack: DshPetPack, name: string, documentBase: string): string {
  if (!pack.files.includes(`${name}.webm`))
    throw new Error('Animation is not part of this pet pack')
  const relative = `${name}.webm`.split('/').map(segment => encodeURIComponent(segment)).join('/')
  return new URL(relative, new URL(`${pack.baseUrl.replace(/\/$/, '')}/`, documentBase)).href
}

/** Fixed desktop pets retain DSH idle, turn and weighted action pools. Walking clips remain available for explicit playback. */
export function nextPetAnimation(pack: DshPetPack, current: string, facing: 'left' | 'right', roll = Math.random()): { name: string, turn: boolean } {
  const idleWeight = pack.animationWeights?.idle ?? 10
  const turnWeight = pack.animations.turn.length ? (pack.animationWeights?.turn ?? 5) : 0
  const choice = roll * 100
  if (choice < idleWeight)
    return { name: pickPetAnimation(pack.animations.idle, current)!, turn: false }
  if (choice < idleWeight + turnWeight)
    return { name: pickPetAnimation(pack.animations.turn, current)!, turn: true }
  const categories = pack.animations.categories.filter(category => category.weight > 0 && (!category.noMirror || facing !== 'right'))
  const weight = categories.reduce((sum, category) => sum + category.weight, 0)
  if (weight === 0)
    return { name: pickPetAnimation(pack.animations.idle, current)!, turn: false }
  const actionRoll = (choice - idleWeight - turnWeight) / Math.max(1, 100 - idleWeight - turnWeight)
  let remaining = Math.max(0, actionRoll) * weight
  for (const category of categories) {
    remaining -= category.weight
    if (remaining < 0)
      return { name: pickPetAnimation(category.actions, current)!, turn: false }
  }
  return { name: pickPetAnimation(categories.at(-1)!.actions, current)!, turn: false }
}

/** Working and talking states use the pack's event pools. Missing event media uses a declared idle clip. */
export function petStatusAnimation(pack: DshPetPack, status: 'thinking' | 'speaking', current = ''): string {
  const events = pack.animations.events
  const slot = status === 'thinking' ? events?.workStatus?.[0] : events?.whisper
  const pool = slot === undefined ? pack.animations.idle : typeof slot === 'string' ? [slot] : slot.flat()
  return pickPetAnimation(pool, current) ?? pack.animations.idle[0]!
}
