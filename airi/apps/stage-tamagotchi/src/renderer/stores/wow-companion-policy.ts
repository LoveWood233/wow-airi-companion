import type { BridgeStatus, CompanionEvent, CompanionSettings, Snapshot } from '../../shared/wow-companion'

/** A recent alert can use the combat flag until the separate progress observation arrives. */
export function isSameObservedCombat(current: Snapshot | null | undefined, observed: Snapshot | null | undefined) {
  return current?.combat === true && !current.dead && !!observed
    && (current.combatEnds === undefined || observed.combatEnds === undefined || current.combatEnds === observed.combatEnds)
}

function priority(type: CompanionEvent['type']) {
  if (type === 'death')
    return 4
  if (type === 'low_health')
    return 3
  if (type === 'revive')
    return 2
  return type === 'level_up' ? 1 : 0
}

function eventLifetime(type: CompanionEvent['type']) {
  return type === 'low_health' ? 10_000 : 30_000
}

/**
 * Tracks one bridge cursor and one character session. New sessions establish a baseline.
 * Muting discards events. Combat and cooldown retain at most one recent event.
 */
export class CompanionPolicy {
  private identity = ''
  private cursor = -1
  private lastSpokenAt = -Infinity
  private pending?: CompanionEvent
  private deathHandled = false

  reset() {
    this.identity = ''
    this.cursor = -1
    this.pending = undefined
    this.lastSpokenAt = -Infinity
    this.deathHandled = false
  }

  /** Returns at most one notification. Call with the current wall-clock time in milliseconds. */
  accept(bridge: BridgeStatus | null, settings: CompanionSettings, now: number): CompanionEvent | undefined {
    if (!bridge || !settings.enabled || !['live', 'demo'].includes(bridge.status) || !bridge.snapshot?.online) {
      this.reset()
      return
    }
    const identity = `${bridge.instanceId}:${bridge.source}:${bridge.snapshot.guid}:${bridge.snapshot.session}`
    if (identity !== this.identity || bridge.eventCursor < this.cursor) {
      this.reset()
      this.identity = identity
      this.cursor = bridge.eventCursor
      this.deathHandled = bridge.snapshot.dead
      return
    }

    if (!bridge.snapshot.dead) {
      this.deathHandled = false
      if (this.pending?.type === 'death')
        this.pending = undefined
    }
    else if (this.pending?.type === 'revive') {
      this.pending = undefined
    }

    const newEvents = bridge.events.filter(event => event.id > this.cursor)
    this.cursor = bridge.eventCursor
    if (settings.muted || (bridge.source === 'demo' && !settings.allowDemo)) {
      this.pending = undefined
      this.deathHandled ||= bridge.snapshot.dead
      return
    }

    for (const event of newEvents) {
      const matchesSession = event.snapshot?.guid === bridge.snapshot.guid && event.snapshot.session === bridge.snapshot.session
      const age = now - Date.parse(event.timestamp)
      const fresh = Number.isFinite(age) && age >= -5000 && age <= eventLifetime(event.type)
      if (!matchesSession || !fresh)
        continue
      if (event.type === 'low_health' && !isSameObservedCombat(bridge.snapshot, event.snapshot))
        continue
      if (event.type === 'death') {
        if (this.deathHandled || !bridge.snapshot.dead)
          continue
        this.deathHandled = true
      }
      if (!this.isEnabled(event, settings))
        continue
      // Death takes priority over incidental observations. Only a new living observation permits another death response.
      if (!this.pending || priority(event.type) >= priority(this.pending.type))
        this.pending = event
    }
    if (this.pending && (!this.isEnabled(this.pending, settings) || now - Date.parse(this.pending.timestamp) > eventLifetime(this.pending.type)))
      this.pending = undefined
    const next = this.pending
    if (next?.type !== 'low_health' && ((settings.quietInCombat && bridge.snapshot.combat && !bridge.snapshot.dead)
      || now - this.lastSpokenAt < settings.cooldownSeconds * 1000)) {
      return
    }
    this.pending = undefined
    // An urgent health alert neither waits for nor extends the ordinary event cooldown.
    if (next && next.type !== 'low_health')
      this.lastSpokenAt = now
    return next
  }

  private isEnabled(event: CompanionEvent, settings: CompanionSettings) {
    if (event.type === 'zone' && (!event.snapshot?.map || !event.snapshot.zone || event.snapshot.zone === '当前位置暂不可用'))
      return false
    return (event.type === 'level_up' && settings.levelUp)
      || (event.type === 'zone' && settings.zone)
      || (event.type === 'death' && settings.death)
      || (event.type === 'revive' && settings.revive)
      || event.type === 'low_health'
      || event.type === 'loot'
  }
}
