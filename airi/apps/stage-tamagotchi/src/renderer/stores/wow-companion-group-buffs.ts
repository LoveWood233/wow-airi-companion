import type { CompanionState } from '../../shared/wow-companion'

import { canInteract } from './wow-companion-idle'

const spells: Readonly<Record<string, number>> = { WARRIOR: 6673, MAGE: 1459, PRIEST: 21562, DRUID: 1126, SHAMAN: 462854, EVOKER: 364342 }

/** Correlates a current instance observation with the player's class. One receipt covers one buff per entry, including retries and renderer restarts. */
export function groupBuffReminder(state: CompanionState, seen: readonly string[], now: number) {
  if (!canInteract(state, now))
    return
  const { snapshot, groupBuff: buff } = state.bridge
  if (!buff || buff.st !== 'ready' || buff.s !== snapshot.session || buff.g !== snapshot.guid
    || buff.spell !== spells[snapshot.class] || buff.missing < 1
    || buff.instanceType !== snapshot.instanceType || buff.instanceID !== snapshot.instanceID) {
    return
  }
  const key = JSON.stringify([state.game, snapshot.account, snapshot.guid, snapshot.session, buff.e, buff.spell])
  if (seen.includes(key))
    return
  return { key, buff }
}
