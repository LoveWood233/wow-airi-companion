import type { CompanionState } from '../../shared/wow-companion'
import type { PlayerAddress } from './wow-companion-player-address'

import { equipmentQuestion } from './wow-companion-loadout-context'

/** Personal snapshot requests need local character data, unlike database questions about item sources or recommended builds. */
export function characterSnapshotKind(text: string) {
  const personal = /我|当前|现在|身上|这套|这身|\b(?:my|me|i|current)\b/iu.test(text)
  if (!personal && /掉落|哪里出|哪里掉|制作|图纸|配方|推荐|攻略|拍卖|\b(?:recipe|drop|recommend)\b/iu.test(text))
    return
  if (equipmentQuestion(text))
    return 'equipment'
  if (/金币余额|剩余金币|金币总数|金币开销|收支账单|\bmy gold\b/iu.test(text) || (personal && /金币|余额|开销|账单|收支|\bgold\b/iu.test(text)))
    return 'gold'
  if (/升级耗时|升级用时|当前等级|\bmy level\b/iu.test(text) || (personal && /等级|几级|多少级|升级时间|\blevel\b/iu.test(text)))
    return 'level'
  if (/背包|\binventory\b/iu.test(text))
    return 'inventory'
  if ((personal && /天赋|\btalents?\b/iu.test(text)) || /天赋快照|天赋面板/u.test(text))
    return 'talents'
  if (/任务日志|任务列表|任务进度|当前任务|\bquest log\b/iu.test(text))
    return 'quests'
}

/** A request never treats a stale, foreign, or incomplete observation as the requested current character snapshot. */
export function snapshotUnavailable(kind: ReturnType<typeof characterSnapshotKind>, states: readonly CompanionState[], current: ReturnType<PlayerAddress['current']>, now: number) {
  if (!kind || !current)
    return true
  const state = states.find(state => state.game === current.game)
  const bridge = state?.bridge
  const snapshot = bridge?.snapshot
  const observed = Date.parse(bridge?.lastSeen ?? '')
  if (!state?.settings.enabled || state.error || !bridge || bridge.error || bridge.status !== 'live' || bridge.source !== 'screen'
    || bridge.config.paused || !snapshot?.online || snapshot.account !== current.snapshot.account
    || snapshot.guid !== current.snapshot.guid || snapshot.session !== current.snapshot.session
    || bridge.ageSeconds === null || bridge.ageSeconds < 0 || bridge.ageSeconds > 5 || !Number.isFinite(observed) || Math.abs(now - observed) > 5000) {
    return true
  }
  const matches = (record: { guid: string, session: string } | null | undefined) => record?.guid === snapshot.guid && record.session === snapshot.session
  switch (kind) {
    case 'equipment': return !!bridge.equipmentLoadoutError || !matches(bridge.equipmentLoadout)
      || bridge.equipmentLoadout!.slots.some(slot => slot.state === 'unknown' || (slot.item
        && (!slot.item.infoComplete || !slot.item.statsComplete || !slot.item.tooltipComplete || slot.item.truncated)))
    case 'gold': return snapshot.copper === null
    case 'level': return snapshot.level <= 0
    case 'inventory': return !!bridge.inventoryError || !matches(bridge.inventory) || !bridge.inventory!.complete
    case 'talents': return !!bridge.talentsError || !matches(bridge.talents) || !bridge.talents!.complete || bridge.talents!.status !== 'active'
    case 'quests': return !!bridge.questsError || !matches(bridge.quests) || !bridge.quests!.log.complete || bridge.quests!.log.truncated
  }
}
