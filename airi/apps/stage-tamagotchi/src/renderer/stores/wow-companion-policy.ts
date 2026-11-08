import type { BridgeStatus, CompanionEvent, CompanionSettings } from '../../shared/wow-companion'

function priority(type: CompanionEvent['type']) {
  if (type === 'death')
    return 3
  if (type === 'revive')
    return 2
  return type === 'level_up' ? 1 : 0
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
      const fresh = Number.isFinite(age) && age >= -5000 && age <= 30_000
      if (!matchesSession || !fresh)
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
    if (this.pending && (!this.isEnabled(this.pending, settings) || now - Date.parse(this.pending.timestamp) > 30_000))
      this.pending = undefined
    if ((settings.quietInCombat && bridge.snapshot.combat && !bridge.snapshot.dead) || now - this.lastSpokenAt < settings.cooldownSeconds * 1000)
      return
    const next = this.pending
    this.pending = undefined
    if (next)
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
  }
}
