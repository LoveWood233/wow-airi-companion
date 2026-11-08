import type { CompanionState, GameVersion, Snapshot } from '../../shared/wow-companion'

import { array, integer, maxLength, maxValue, minLength, minValue, number, object, pipe, safeParse, string } from 'valibot'

import { gameVersionSchema } from '../../shared/wow-companion'
import { hasFreshCompanionObservation } from '../utils/wow-companion-observation'
import { canInteract, normalizeRegularInteractionMinutes } from './wow-companion-idle'

const checkpointSchema = object({
  game: gameVersionSchema,
  account: pipe(string(), minLength(1), maxLength(128)),
  guid: pipe(string(), minLength(1), maxLength(128)),
  loginId: pipe(string(), minLength(1), maxLength(40)),
  consumed: pipe(number(), integer(), minValue(0), maxValue(2147483647)),
  lastInteractionAt: pipe(number(), integer(), minValue(0), maxValue(8_640_000_000_000_000)),
})
const checkpointsSchema = pipe(array(checkpointSchema), maxLength(200))

interface CombatCheckpoint {
  game: GameVersion
  account: string
  guid: string
  loginId: string
  consumed: number
  lastInteractionAt: number
}

/** The current login's public addon counter gates ordinary proactive conversations. */
export interface ChatterCombatStatus {
  supported: boolean
  completed: number
  required: number
  ready: boolean
}

/**
 * Keeps the combat requirement within the whole-number range offered in settings.
 *
 * @example
 * normalizeChatterCombats(7.8) // => 8
 */
export function normalizeChatterCombats(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return 5
  const count = Math.round(value)
  return count >= 5 && count <= 30 ? count : 5
}

/**
 * Persists consumed counters independently of renderer polling and bridge sessions.
 * Only delivery consumes a gate. A failed request or an empty topic leaves progress intact.
 * The addon owns login identity and real combat transitions, so reloads and missed frames cannot manufacture credit.
 */
export class ChatterCombatGate {
  private checkpoints: CombatCheckpoint[] = []

  constructor(saved?: unknown) {
    const parsed = safeParse(checkpointsSchema, saved)
    if (parsed.success)
      this.checkpoints = parsed.output
  }

  /** Returns a detached checkpoint list suitable for the existing settings backup boundary. */
  read() {
    return this.checkpoints.map(checkpoint => ({ ...checkpoint }))
  }

  clear() {
    this.checkpoints = []
  }

  status(state: CompanionState, now: number, requirement: number): ChatterCombatStatus {
    const required = normalizeChatterCombats(requirement)
    if (!canInteract(state, now))
      return { supported: false, completed: 0, required, ready: false }
    const snapshot = state.bridge.snapshot
    const counter = this.counter(snapshot)
    if (!counter)
      return { supported: false, completed: 0, required, ready: false }
    const checkpoint = this.find(state.game, snapshot)
    const consumed = checkpoint?.loginId === counter.loginId ? checkpoint.consumed : 0
    // A regressed frame from the same login cannot refund a delivered interaction.
    const completed = Math.max(0, counter.completed - consumed)
    return { supported: true, completed, required, ready: counter.completed >= consumed && completed >= required }
  }

  /** Coalesces all earned combats when one ordinary interaction actually reaches the player. */
  consume(game: GameVersion, snapshot: Snapshot, deliveredAt = Date.now()) {
    const counter = this.counter(snapshot)
    if (!counter)
      return false
    const checkpoint = this.find(game, snapshot)
    if (checkpoint?.loginId === counter.loginId && counter.completed < checkpoint.consumed)
      return false
    const next = { game, account: snapshot.account, guid: snapshot.guid, loginId: counter.loginId, consumed: counter.completed, lastInteractionAt: deliveredAt }
    this.checkpoints = [...this.checkpoints.filter(entry => entry !== checkpoint), next].slice(-200)
    return true
  }

  lastInteractionAt(game: GameVersion, snapshot: Snapshot) {
    const checkpoint = this.find(game, snapshot)
    return checkpoint?.loginId === snapshot.loginId ? checkpoint?.lastInteractionAt : undefined
  }

  private find(game: GameVersion, snapshot: Snapshot) {
    return this.checkpoints.find(entry => entry.game === game && entry.account === snapshot.account && entry.guid === snapshot.guid)
  }

  private counter(snapshot: Snapshot) {
    if (typeof snapshot.loginId !== 'string' || !snapshot.loginId
      || typeof snapshot.combatEnds !== 'number' || !Number.isSafeInteger(snapshot.combatEnds)
      || snapshot.combatEnds < 0 || snapshot.combatEnds > 2147483647) {
      return undefined
    }
    return { loginId: snapshot.loginId, completed: snapshot.combatEnds }
  }
}

/**
 * Uses real elapsed time across combat, with ten fresh noncombat seconds before offering a topic.
 * An opportunity advances only after time and combat eligibility agree. Busy work never creates a backlog.
 */
export class RegularChatterClock {
  private identity = ''
  private nextAt = 0
  private minutes = 5
  private stableSince: number | undefined
  private lastObservedAt: number | undefined
  private lastCombatEnds: number | undefined

  reset() {
    this.identity = ''
    this.nextAt = 0
    this.stableSince = undefined
    this.lastObservedAt = undefined
    this.lastCombatEnds = undefined
  }

  observe(state: CompanionState, now: number, eligibility: {
    eligible: boolean
    busy: boolean
    combatsReady: boolean
    lastInteractionAt?: number
  }, intervalMinutes: number): Snapshot | undefined {
    if (!Number.isFinite(now) || !eligibility.eligible) {
      this.reset()
      return
    }
    if (!hasFreshCompanionObservation(state, now)) {
      this.stableSince = undefined
      return
    }
    const snapshot = state.bridge.snapshot
    const minutes = normalizeRegularInteractionMinutes(intervalMinutes)
    const identity = JSON.stringify([state.game, snapshot.account, snapshot.guid, snapshot.loginId])
    const backward = this.lastObservedAt !== undefined && now < this.lastObservedAt
    if (identity !== this.identity || minutes !== this.minutes || backward) {
      this.identity = identity
      this.minutes = minutes
      const last = eligibility.lastInteractionAt
      this.nextAt = (last !== undefined && last <= now && !backward ? last : now) + minutes * 60_000
      this.stableSince = undefined
      this.lastCombatEnds = snapshot.combatEnds
    }
    const interrupted = this.lastObservedAt !== undefined && now - this.lastObservedAt > 30_000
    this.lastObservedAt = now
    // The addon can observe a complete short battle between desktop frames.
    // Its increment starts a new quiet period even when no combat=true frame reached the desktop.
    if (this.lastCombatEnds !== undefined && snapshot.combatEnds !== undefined && snapshot.combatEnds > this.lastCombatEnds)
      this.stableSince = undefined
    this.lastCombatEnds = snapshot.combatEnds
    if (snapshot.combat || snapshot.dead) {
      this.stableSince = undefined
      return
    }
    if (interrupted || this.stableSince === undefined)
      this.stableSince = now
    if (now - this.stableSince < 10_000 || now < this.nextAt || eligibility.busy || !eligibility.combatsReady)
      return
    this.nextAt = now + minutes * 60_000
    return snapshot
  }

  /** Generation can take time. Delivery starts the next full real-time interval. */
  delivered(now: number, intervalMinutes: number) {
    this.nextAt = now + normalizeRegularInteractionMinutes(intervalMinutes) * 60_000
  }
}
