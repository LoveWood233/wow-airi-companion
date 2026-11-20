import type { CompanionState } from '../../shared/wow-companion'
import type { PlayerAddress } from './wow-companion-player-address'

import { matchingArchiveRecord } from '../../shared/wow-companion-character-archive'
import { hasRecentCharacterCapture, usableCharacterObservation } from '../utils/wow-companion-observation'
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
  if (/银行库存|银行快照|银行里|我的银行|\b(?:my bank|bank inventory)\b/iu.test(text))
    return 'bank'
  if (/背包|材料数量|消耗品数量|\binventory\b/iu.test(text))
    return 'inventory'
  if ((personal && /天赋|\btalents?\b/iu.test(text)) || /天赋快照|天赋面板/u.test(text))
    return 'talents'
  if (/任务日志|任务列表|任务进度|当前任务|\bquest log\b/iu.test(text))
    return 'quests'
  if (personal && /经验|\b(?:xp|experience)\b/iu.test(text))
    return 'experience'
  if (/副本锁定|副本重置|副本进度|\b(?:my lockouts?|raid resets?)\b/iu.test(text))
    return 'lockouts'
  if (/日程|日历|\b(?:my calendar|my schedule)\b/iu.test(text))
    return 'schedule'
  if (personal && /声望|\breputation\b/iu.test(text))
    return 'reputation'
  if ((personal && /专业|已学配方|学了哪些配方|\b(?:professions?|known recipes?)\b/iu.test(text)) || /专业快照/u.test(text))
    return 'professions'
  if ((personal && /成就|\bachievements?\b/iu.test(text)) || /成就快照/u.test(text))
    return 'achievements'
  if (/探索进度|探索快照|\b(?:my exploration|exploration progress)\b/iu.test(text))
    return 'exploration'
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
  const archive = bridge.archive
  const progress = matchingArchiveRecord(archive?.progress, snapshot, now)
  const loginProfile = snapshot.profileObservedAt
  const expiredProfile = loginProfile !== undefined && !hasRecentCharacterCapture(loginProfile, now)
  const expiredCapture = (record: { observedAt: number }) => loginProfile !== undefined && !hasRecentCharacterCapture(record.observedAt * 1000, now)
  switch (kind) {
    case 'equipment': return !!bridge.equipmentLoadoutError || !matches(bridge.equipmentLoadout)
      || expiredCapture(bridge.equipmentLoadout!)
      || bridge.equipmentLoadout!.slots.some(slot => slot.state === 'unknown' || (slot.item
        && (!slot.item.infoComplete || !slot.item.statsComplete || !slot.item.tooltipComplete || slot.item.truncated)))
    case 'gold': return progress?.data.copper === undefined && (expiredProfile || snapshot.copper === null)
    case 'level': return progress?.data.level === undefined && progress?.data.levelSeconds === undefined && (expiredProfile || snapshot.level <= 0)
    case 'experience': return progress?.data.xp === undefined && progress?.data.xpMax === undefined
    case 'inventory': return !!bridge.inventoryError || !matches(bridge.inventory) || (!bridge.lowFrequency && expiredCapture(bridge.inventory!))
      || !usableCharacterObservation(bridge.inventory!.observedAt, now, bridge.lowFrequency) || !bridge.inventory!.complete
    case 'talents': return !!bridge.talentsError || !matches(bridge.talents) || !bridge.talents!.complete || bridge.talents!.status !== 'active'
    case 'quests': return !!bridge.questsError || !matches(bridge.quests) || !bridge.quests!.log.complete || bridge.quests!.log.truncated
    case 'bank': return !state.itemStorage?.characters.some(character => character.account === snapshot.account && character.guid === snapshot.guid && character.bankObservedAt !== null)
    case 'schedule': return bridge.lowFrequency ? !matchingArchiveRecord(archive?.schedule, snapshot, now) : !bridge.calendar
    case 'reputation':
    case 'lockouts':
    case 'professions':
    case 'achievements':
    case 'exploration':
      return !matchingArchiveRecord(archive?.[kind], snapshot, now)
  }
}
