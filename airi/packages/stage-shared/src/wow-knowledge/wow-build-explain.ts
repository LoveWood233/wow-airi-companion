import type { WowBuildCatalogItem, WowBuildContext, WowBuildItemComparison, WowBuildQuery, WowBuildTalentNode, WowTalentPlan } from './wow-build-assistant'

function committed(context: WowBuildContext | undefined, game: 'retail' | 'forever', classId: number) {
  const observed = context?.talents
  return observed && context.game === game && context.guid === observed.guid && context.session === observed.session && observed.classID === classId && observed.status === 'active' && observed.hasStagedChanges === false ? observed : undefined
}

/** Selected-node coverage never makes absent nodes zero. Only explicit stable zero observations can establish rank zero. */
export function explainWowTalentNodes(catalog: readonly WowBuildTalentNode[], query: Extract<WowBuildQuery, { operation: 'talents' | 'compare-talents' }>, context?: WowBuildContext, sourceBuild?: string, plan?: WowTalentPlan): WowBuildTalentNode[] {
  const observed = committed(context, query.game, query.classId)
  const sameBuild = !!observed?.clientBuild && observed.clientBuild === sourceBuild
  const explicit = plan?.kind === 'nodes' ? plan.nodes : []
  const ids = new Set(explicit.map(node => node.nodeId))
  for (const node of observed?.nodes ?? [])
    ids.add(node.nodeID)
  for (const node of catalog)
    ids.add(node.nodeId)
  if (query.operation === 'talents' && query.nodeId !== undefined) {
    ids.clear()
    ids.add(query.nodeId)
  }
  return [...ids].slice(0, 180).map((nodeId) => {
    const reference = catalog.find(node => node.nodeId === nodeId)
    const actual = observed?.nodes.find(node => node.nodeID === nodeId)
    const zero = observed?.knownZeroNodes.some(node => node.nodeID === nodeId)
    const mapped = query.game === 'retail' || sameBuild
    const currentRank = mapped ? actual?.activeRank ?? (zero ? 0 : undefined) : undefined
    const purchasedRank = mapped ? actual?.ranksPurchased ?? (zero ? 0 : undefined) : undefined
    const plannedRank = query.operation === 'compare-talents' ? plan?.kind === 'nodes' ? explicit.find(node => node.nodeId === nodeId)?.rank : reference?.plannedRank : undefined
    const maxRank = reference?.maxRank ?? (mapped ? actual?.maxRanks ?? undefined : undefined)
    const notices = [...(reference?.notices ?? [])]
    if (!observed)
      notices.push('committed-talents-unavailable')
    if (!mapped)
      notices.push('build-mapping-unverified')
    if (currentRank === undefined)
      notices.push('current-rank-unknown')
    if (!reference && query.game === 'forever')
      notices.push('node-reference-unavailable')
    const invalidRank = plannedRank !== undefined && maxRank !== undefined && plannedRank > maxRank
    if (invalidRank)
      notices.push('plan-rank-exceeds-node')
    if (mapped && actual?.activeRank === 0 && (actual.ranksPurchased ?? 0) > 0)
      notices.push('purchased-node-inactive')
    const activeSpellIds = mapped && actual && (actual.activeRank ?? 0) > 0 ? [...new Set(actual.entries.filter(entry => entry.isActive === true && entry.spellID !== null).map(entry => entry.spellID!))] : []
    return {
      nodeId,
      name: reference?.name,
      group: reference?.group,
      maxRank,
      currentRank,
      purchasedRank,
      plannedRank,
      delta: purchasedRank !== undefined && plannedRank !== undefined && !invalidRank ? plannedRank - purchasedRank : undefined,
      mapping: query.game === 'retail' ? 'observation-only' : sameBuild ? 'same-build' : 'unverified',
      ranks: reference?.ranks ?? [],
      prerequisites: reference?.prerequisites ?? [],
      gate: reference?.gate,
      activeSpellIds,
      conditions: actual && mapped ? actual.conditions.map(condition => ({ conditionId: condition.conditionID, isMet: condition.isMet ?? undefined, playerLevel: condition.playerLevel ?? undefined, spentAmountRequired: condition.spentAmountRequired ?? undefined })) : [],
      notices: [...new Set(notices)],
    }
  })
}

const fixedSlots: Record<string, readonly number[]> = {
  INVTYPE_HEAD: [1],
  INVTYPE_NECK: [2],
  INVTYPE_SHOULDER: [3],
  INVTYPE_BODY: [4],
  INVTYPE_CHEST: [5],
  INVTYPE_ROBE: [5],
  INVTYPE_WAIST: [6],
  INVTYPE_LEGS: [7],
  INVTYPE_FEET: [8],
  INVTYPE_WRIST: [9],
  INVTYPE_HAND: [10],
  INVTYPE_FINGER: [11, 12],
  INVTYPE_TRINKET: [13, 14],
  INVTYPE_CLOAK: [15],
  INVTYPE_WEAPON: [16, 17],
  INVTYPE_2HWEAPON: [16],
  INVTYPE_WEAPONMAINHAND: [16],
  INVTYPE_WEAPONOFFHAND: [17],
  INVTYPE_SHIELD: [17],
  INVTYPE_HOLDABLE: [17],
  INVTYPE_RANGED: [18],
  INVTYPE_RANGEDRIGHT: [18],
  INVTYPE_THROWN: [18],
  INVTYPE_RELIC: [18],
  INVTYPE_TABARD: [19],
}
const sourceSlots: Record<string, readonly number[]> = { 头部: [1], 颈部: [2], 肩部: [3], 衬衣: [4], 胸甲: [5], 腰带: [6], 腿部: [7], 脚: [8], 护腕: [9], 手套: [10], 戒指: [11, 12], 饰品: [13, 14], 披风: [15], 单手: [16, 17], 双手: [16], 主手: [16], 副手: [17], 副手盾: [17], 远程: [18], 战袍: [19] }

/** One explicit slot is compared in isolation. Weapon pairs and two-hand changes never silently remove or sum another slot. */
export function compareWowBuildItem(candidate: WowBuildCatalogItem, query: Extract<WowBuildQuery, { operation: 'compare-item' }>, context?: WowBuildContext): WowBuildItemComparison {
  const loadout = context?.loadout
  const valid = loadout && context.game === query.game && context.guid === loadout.guid && context.session === loadout.session
  const slot = valid ? loadout.slots.find(slot => slot.slot === query.slot) : undefined
  const baseline = slot?.state === 'equipped' ? slot.item ?? undefined : undefined
  const allowed = candidate.equipLoc ? fixedSlots[candidate.equipLoc] : candidate.slot ? sourceSlots[candidate.slot] : undefined
  const compatibility = allowed ? allowed.includes(query.slot) ? 'compatible' : 'incompatible' : 'unknown'
  const notices = ['base-item-not-instance', 'no-performance-score', 'other-slots-not-summed']
  if (!valid)
    notices.push('equipment-observation-unavailable')
  if (slot?.state === 'unknown' || !slot)
    notices.push('baseline-slot-unknown')
  if (compatibility === 'unknown')
    notices.push('slot-compatibility-unknown')
  if (compatibility === 'incompatible')
    notices.push('slot-incompatible')
  if ((query.slot === 16 || query.slot === 17))
    notices.push('weapon-pair-requires-review')
  if (candidate.equipLoc === 'INVTYPE_2HWEAPON' || candidate.slot === '双手')
    notices.push('two-hand-requires-review')
  if (baseline && (!baseline.statsComplete || baseline.truncated))
    notices.push('baseline-stats-partial')
  if (!candidate.statsComplete)
    notices.push('candidate-stats-partial')
  const keys = new Set([...(baseline?.stats.map(stat => stat.key) ?? []), ...candidate.stats.map(stat => stat.key)])
  const differences = [...keys].slice(0, 64).map((key) => {
    // Catalog omission is not zero. Only the actual complete baseline can establish a missing stat as zero.
    const canonicalKey = key.startsWith('ITEM_MOD_') || /^RESISTANCE\d_NAME$/.test(key)
    const current = slot?.state === 'empty' ? 0 : baseline?.stats.find(stat => stat.key === key)?.value ?? (canonicalKey && baseline?.statsComplete && !baseline.truncated ? 0 : undefined)
    const proposed = candidate.stats.find(stat => stat.key === key)?.value
    return { key, current, candidate: proposed, delta: compatibility === 'compatible' && current !== undefined && proposed !== undefined ? proposed - current : undefined }
  })
  return { slot: query.slot, baselineState: slot?.state ?? 'unknown', baseline, candidate, compatibility, basis: query.game === 'forever' ? 'base-reference' : 'unresolved', differences, notices }
}
