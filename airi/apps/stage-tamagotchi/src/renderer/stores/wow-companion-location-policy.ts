import type { CompanionState, Snapshot } from '../../shared/wow-companion'
import type { IdleEligibility } from './wow-companion-idle'

import { canInteract } from './wow-companion-idle'

type Location = Pick<Snapshot, 'map' | 'instanceType' | 'instanceID'>

function locationKey(snapshot: Location) {
  if (snapshot.instanceType && snapshot.instanceType !== 'none' && snapshot.instanceType !== 'unknown'
    && snapshot.instanceID && snapshot.instanceID > 0) {
    return `instance:${snapshot.instanceType}:${snapshot.instanceID}`
  }
  // A map remains usable without instance metadata. Unknown data cannot prove that the player entered an instance.
  return `map:${snapshot.map}`
}

/** Compares observed destinations. A known instance ID keeps its floors within one arrival. */
export function isSameLocation(first: Location, second: Location): boolean {
  if (first.map <= 0 || second.map <= 0)
    return false
  const firstType = first.instanceType === 'unknown' ? undefined : first.instanceType
  const secondType = second.instanceType === 'unknown' ? undefined : second.instanceType
  if (firstType && secondType && firstType !== secondType)
    return false
  if (firstType && firstType !== 'none' && secondType && secondType !== 'none' && first.instanceID && second.instanceID)
    return first.instanceID === second.instanceID
  // Partial instance observations do not turn metadata discovery into an arrival on the same map.
  return first.map === second.map
}

/**
 * Each live character starts with a baseline. Changes settle before one arrival can run.
 * Runtime cooldowns and destination history stay with this owner. Brief loading gaps retain a baseline but discard pending work.
 */
export class LocationPolicy {
  private identity = ''
  private destination?: Location
  private pending?: { destination: Location, changedAt: number, stableSince: number | undefined }
  private lastObservedAt: number | undefined
  private lastSpokenAt = -Infinity
  private readonly spoken = new Map<string, number>()

  /** The host delays background chatter while one current destination awaits its arrival message. */
  get hasPending() {
    return this.pending !== undefined
  }

  /** Releases all runtime history when the owner stops, authorization changes, or observation continuity expires. */
  reset() {
    this.identity = ''
    this.destination = undefined
    this.pending = undefined
    this.lastObservedAt = undefined
    this.lastSpokenAt = -Infinity
    this.spoken.clear()
  }

  /** Combat delays a recent arrival. Busy work retains one destination, with no backlog of earlier locations. */
  observe(state: CompanionState, now: number, { eligible, busy }: IdleEligibility): Snapshot | undefined {
    const bridge = state.bridge
    const snapshot = bridge?.snapshot
    const observedAt = Date.parse(bridge?.lastSeen ?? '')
    if (!eligible || !Number.isFinite(now) || !state.settings.enabled || state.settings.muted || !state.settings.zone) {
      this.reset()
      return
    }

    const identity = bridge && snapshot ? JSON.stringify([state.game, bridge.instanceId, snapshot.account, snapshot.guid, snapshot.session]) : undefined
    if ((identity && this.identity && identity !== this.identity)
      || (this.lastObservedAt !== undefined && (now < this.lastObservedAt || now - this.lastObservedAt > 120_000))) {
      this.reset()
    }
    if (state.error || !bridge || bridge.error || bridge.status !== 'live' || bridge.source !== 'screen'
      || bridge.config.paused || !snapshot?.online || bridge.ageSeconds === null
      || !Number.isFinite(bridge.ageSeconds) || bridge.ageSeconds < 0 || bridge.ageSeconds > 5
      || !Number.isFinite(observedAt) || Math.abs(now - observedAt) > 5000) {
      // World transfers briefly stop telemetry. They retain the last destination for at most two minutes, never a queued speech.
      this.pending = undefined
      return
    }

    if (identity !== this.identity) {
      this.reset()
      this.identity = identity!
    }
    this.lastObservedAt = now
    for (const [destination, spokenAt] of this.spoken) {
      if (now - spokenAt >= 600_000)
        this.spoken.delete(destination)
    }

    if (this.pending && now - this.pending.changedAt >= 120_000)
      this.pending = undefined
    const destination = Number.isSafeInteger(snapshot.map) && snapshot.map > 0
      ? { map: snapshot.map, instanceType: snapshot.instanceType, instanceID: snapshot.instanceID }
      : undefined
    // Loading screens can briefly remove the map. They neither establish a destination nor consume a pending arrival.
    if (destination === undefined) {
      if (this.pending)
        this.pending.stableSince = undefined
      return
    }
    if (!this.destination) {
      this.destination = destination
      return
    }
    if (!isSameLocation(destination, this.destination)) {
      this.destination = destination
      this.pending = this.spoken.has(locationKey(destination)) ? undefined : { destination, changedAt: now, stableSince: now }
    }
    else {
      this.destination = destination
      if (this.pending)
        this.pending.destination = destination
    }
    const pending = this.pending
    if (pending && pending.stableSince === undefined)
      pending.stableSince = now
    if (!pending || !isSameLocation(pending.destination, destination) || now - pending.stableSince! < 3000
      || now - this.lastSpokenAt < 60_000 || busy || !canInteract(state, now)) {
      return
    }
    this.pending = undefined
    this.lastSpokenAt = now
    this.spoken.set(locationKey(destination), now)
    return snapshot
  }
}
