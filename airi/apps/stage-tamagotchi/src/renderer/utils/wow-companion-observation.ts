import type { BridgeStatus, CompanionState, Snapshot } from '../../shared/wow-companion'

/** Measures the character data itself. A current compact heartbeat does not extend this interval. */
export function hasRecentCharacterCapture(observedAt: number, now: number): boolean {
  return observedAt > 0 && Math.abs(now - observedAt) <= 5000
}

/** Changed-only observations keep their original capture time while the matched game connection stays live. */
export function usableCharacterObservation(observedAt: number, now: number, lowFrequency?: true, maximumAge = 180_000, futureTolerance = 5000): boolean {
  const age = now - observedAt * 1000
  return Number.isSafeInteger(observedAt) && observedAt > 0 && age >= -futureTolerance && (lowFrequency === true || age <= maximumAge)
}

/**
 * Keeps current observation validity separate from speech eligibility. Manual reads remain available during combat or death.
 * @example hasFreshCompanionObservation(state, Date.now()) // => false when the bridge is disconnected
 */
export function hasFreshCompanionObservation(state: CompanionState, now: number): state is CompanionState & { bridge: BridgeStatus & { snapshot: Snapshot } } {
  const bridge = state.bridge
  const snapshot = bridge?.snapshot
  const observedAt = Date.parse(bridge?.lastSeen ?? '')
  return Number.isFinite(now) && state.settings.enabled && !state.error
    && !!bridge && !bridge.error && bridge.status === 'live' && bridge.source === 'screen' && !bridge.config.paused
    && !!snapshot?.online && bridge.ageSeconds !== null
    && Number.isFinite(bridge.ageSeconds) && bridge.ageSeconds >= 0 && bridge.ageSeconds <= 5
    && Number.isFinite(observedAt) && now - observedAt <= 5000 && observedAt - now <= 5000
}

/**
 * Returns a current player's observations without requiring a quest, talent, or equipment packet.
 * @example readCurrentCompanionPlayer(undefined) // => undefined
 */
export function readCurrentCompanionPlayer(state: CompanionState | undefined, nowMs = Date.now()): Snapshot | undefined {
  return state && hasFreshCompanionObservation(state, nowMs) ? state.bridge.snapshot : undefined
}
