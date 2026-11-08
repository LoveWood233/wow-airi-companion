import type { BridgeStatus, CompanionState, Snapshot } from '../../shared/wow-companion'

import { hasFreshCompanionObservation } from '../utils/wow-companion-observation'

/** Host eligibility covers the current character, speech configuration, and global mute. Busy work delays one interaction. */
export interface IdleEligibility {
  eligible: boolean
  busy: boolean
}

/**
 * Keeps saved and runtime intervals within the whole-minute range supported by the settings page.
 *
 * @example
 * normalizeInteractionMinutes(4.8)
 * // => 5
 */
export function normalizeInteractionMinutes(value: unknown, initial = 1): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return initial
  return Math.min(60, Math.max(1, Math.round(value)))
}

/**
 * Restores ordinary chatter to five minutes when its saved frequency falls outside the supported range.
 *
 * @example normalizeRegularInteractionMinutes(1) // => 5
 */
export function normalizeRegularInteractionMinutes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 2 && value <= 30 ? Math.round(value) : 5
}

/** Fresh, living noncombat observations permit an interaction. The host also applies character, speech, and activity eligibility. */
export function canInteract(state: CompanionState, now: number): state is CompanionState & { bridge: BridgeStatus & { snapshot: Snapshot } } {
  return hasFreshCompanionObservation(state, now) && !state.settings.muted && !state.bridge.snapshot.combat && !state.bridge.snapshot.dead
}

/**
 * One character session earns an interaction after its configured continuous interval outside combat.
 * Invalid observations reset the interval. Busy work retains one opportunity without accumulating missed interactions.
 */
export class CompanionIdlePolicy {
  private identity = ''
  private nextAt = 0
  private lastObservedAt: number | undefined
  private intervalMinutes = 1

  /** Releases the runtime interval when its desktop owner stops or loses the current character. */
  reset() {
    this.identity = ''
    this.nextAt = 0
    this.lastObservedAt = undefined
    this.intervalMinutes = 1
  }

  /** Returns only the current, fresh snapshot. The caller consumes an opportunity even when playback fails. */
  observe(state: CompanionState, now: number, { eligible, busy }: IdleEligibility, intervalMinutes = 1): Snapshot | undefined {
    if (!eligible || !canInteract(state, now)) {
      this.reset()
      return
    }

    const bridge = state.bridge
    const snapshot = bridge.snapshot
    const minutes = normalizeInteractionMinutes(intervalMinutes)
    const identity = JSON.stringify([state.game, bridge.instanceId, snapshot.account, snapshot.guid, snapshot.session, snapshot.instanceType ?? 'unknown'])
    // A suspended renderer cannot establish continuous noncombat time across sleep or a large clock change.
    const interrupted = this.lastObservedAt === undefined || now < this.lastObservedAt || now - this.lastObservedAt > 30_000
    this.lastObservedAt = now
    if (identity !== this.identity || interrupted || minutes !== this.intervalMinutes) {
      this.identity = identity
      this.intervalMinutes = minutes
      this.nextAt = now + minutes * 60_000
      return
    }
    if (now < this.nextAt || busy)
      return
    this.nextAt = now + minutes * 60_000
    return snapshot
  }
}
