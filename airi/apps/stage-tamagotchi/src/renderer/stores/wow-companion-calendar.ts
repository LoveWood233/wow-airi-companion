import type { CompanionState } from '../../shared/wow-companion'

import { canInteract } from './wow-companion-idle'

/** One low-frequency calendar batch can notify during a login. A reload keeps the game login receipt. */
export function calendarLoginReceipts(state: CompanionState, now: number) {
  if (!canInteract(state, now) || !state.bridge.calendar || (!state.bridge.lowFrequency && !state.bridge.archive?.schedule))
    return
  const player = state.bridge.snapshot
  const identity = ['calendar-login', state.game, player.account, player.guid]
  const sessions = player.loginId ? [player.loginId, player.session] : [player.session]
  return sessions.map(session => JSON.stringify([...identity, session]))
}

/** Official events share receipts across characters. Appointments and lockouts belong to the current character. */
export function calendarReminder(state: CompanionState, seen: readonly string[], now: number) {
  if (!canInteract(state, now) || !state.bridge.calendar)
    return
  if (calendarLoginReceipts(state, now)?.some(key => seen.includes(key)))
    return
  const { calendar, snapshot } = state.bridge
  const identity = [state.game, snapshot.account, snapshot.realm, calendar.day]
  const oldDailyReceipt = JSON.stringify(identity)
  const keys: string[] = []
  const items = calendar.items.filter((item) => {
    const personal = item.action !== 'start' && item.action !== 'end'
    const key = JSON.stringify([...identity, personal ? snapshot.guid : '', item.action, item.when, item.title])
    if (seen.includes(key) || (!personal && seen.includes(oldDailyReceipt)))
      return false
    keys.push(key)
    return true
  })
  if (!items.length)
    return
  return { keys, calendar: { ...calendar, items } }
}
