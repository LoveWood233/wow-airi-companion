// Reference only. Inputs are normalized by the desktop host, times share one
// monotonic clock, and no caller-provided ordering can override the JSON index.
function current(request, state) {
  return request.eligible === true
    && typeof request.requestId === 'string' && request.requestId.length > 0
    && typeof state.sessionId === 'string' && state.sessionId.length > 0
    && request.sessionId === state.sessionId
    && Number.isFinite(state.now) && Number.isFinite(request.observedAt)
    && Number.isFinite(request.receivedAt) && request.observedAt <= request.receivedAt
    && request.receivedAt <= state.now
    && (request.expiresAt === null
      || (Number.isFinite(request.expiresAt) && state.now < request.expiresAt))
}

function sameCharacter(request, state) {
  return state.online === true && typeof state.characterId === 'string'
    && state.characterId.length > 0 && request.characterId === state.characterId
}

function resolveRoute(index, request) {
  if (Object.hasOwn(request, 'priority') || Object.hasOwn(request, 'normalOrderKey')) return null
  const action = index.actions.find(row => row.id === request.id)
  if (!action) return null
  const route = request.route ?? action.route
  const menu = index.policy.menu_confirm
  if (route === action.secondary_route || (route === action.route && route.startsWith('menu.'))) {
    return request.origin === menu.origin && request.event === menu.event ? menu : null
  }
  if (route === action.route) {
    const reply = index.policy.proactive_reply
    if (action.id === reply.id && request.origin === reply.origin) {
      return request.event === reply.event ? reply : null
    }
    const origin = action.priority === 'proactive' ? reply.origin : action.entry
    if (request.origin !== origin || request.event !== (action.bridge_event ?? action.route)) return null
    return { priority: action.priority, origin, normal_order_key: action.bridge_event }
  }
  return index.cross_routes.find(rule => rule.id === action.id && rule.key === route
    && rule.origin === request.origin && rule.event === request.event) ?? null
}

function validLowHealth(request, state, recheckAfterRelease = false) {
  if (!sameCharacter(request, state) || state.alive !== true || state.inCombat !== true
    || typeof state.combatId !== 'string' || !state.combatId || request.combatId !== state.combatId
    || !Number.isFinite(request.healthPercent) || request.healthPercent < 0 || request.healthPercent >= 20
    || state.now - request.observedAt >= 10_000) return false
  // A verified recovery newer than the source event can arrive before (or after)
  // the late alert packet. Normal bridge snapshots need not contain any HP.
  const hp = state.latestHealth
  const hasReading = hp?.verified === true && hp.sessionId === state.sessionId
    && hp.characterId === state.characterId && hp.combatId === state.combatId
    && Number.isFinite(hp.at) && hp.at >= request.observedAt && hp.at <= state.now
    && Number.isFinite(hp.percent) && hp.percent >= 0 && hp.percent <= 100
  if (recheckAfterRelease && Number.isFinite(state.lastDragReleaseAt)
    && request.observedAt < state.lastDragReleaseAt) {
    return hasReading && hp.at >= state.lastDragReleaseAt && hp.percent < 20
  }
  return !hasReading || hp.percent < 20
}

function currentCombatDelivery(state) {
  const ledger = state.lowHealthLedger
  if (ledger && ledger.sessionId === state.sessionId && ledger.characterId === state.characterId
    && ledger.combatId === state.combatId) return ledger
  return {}
}

/** Pick one input request, or null to keep the current picture. */
export function chooseVisual(index, state, candidates) {
  if (state.paused || state.dragging) return null
  const { priority_order: priorities, normal_game_order: gameOrder } = index.policy
  const choices = []
  for (const request of candidates) {
    if (!current(request, state) || state.shownRequestIds?.has(request.requestId)) continue
    const rule = resolveRoute(index, request)
    if (!rule) continue
    const rank = priorities.indexOf(rule.priority)
    if (rank < 0) continue
    const age = state.now - request.observedAt
    if (rule.max_age_ms && (!Number.isFinite(request.expiresAt) || age >= rule.max_age_ms)) continue
    if (rule.origin === 'game' && !sameCharacter(request, state)) continue
    if (rule.priority === 'death' && state.alive !== false) continue
    if (rule.priority === 'low_health' && (!validLowHealth(request, state, true)
      || currentCombatDelivery(state).visualDelivered === true)) continue
    const urgent = rule.priority === 'death' || rule.priority === 'low_health'
    if (!urgent && !state.atBoundary) continue

    let subrank = 0
    if (rule.priority === 'normal') {
      if (state.alive !== true || state.inCombat !== false
        || !Number.isFinite(state.safeSince) || state.now - state.safeSince < 10_000 || age >= 30_000) continue
      subrank = gameOrder.indexOf(rule.normal_order_key)
      if (subrank < 0) continue
    }
    choices.push({ request, rank, subrank })
  }
  choices.sort((a, b) => a.rank - b.rank || a.subrank - b.subrank
    || b.request.observedAt - a.request.observedAt || b.request.receivedAt - a.request.receivedAt
    || compareIds(a.request.requestId, b.request.requestId))
  return choices[0]?.request ?? null
}

function compareIds(left, right) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** Persist the returned audioDisposition in the combat ledger before async I/O.
 * A suppressed or reserved warning can never start a late second utterance. */
export function lowHealthDelivery(index, state, request) {
  const ledger = currentCombatDelivery(state)
  const previous = ledger.audioDisposition ?? 'pending'
  const noDelivery = { audio: false, caption: false, audioDisposition: previous }
  if (state.paused || !current(request, state) || resolveRoute(index, request)?.priority !== 'low_health'
    || !validLowHealth(request, state)) return noDelivery

  const caption = state.allowAlertCaption === true && ledger.captionDelivered !== true
  if (previous !== 'pending') return { audio: false, caption, audioDisposition: previous }
  const audio = state.allowAlertAudio === true && !state.muted && !state.playerSpeaking && !state.listeningToAnswer
  return { audio, caption, audioDisposition: audio ? 'reserved' : 'suppressed' }
}

function copper(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null
  return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null
}

/** Return a stable A-number, or null when an amount/goal is unknown or inapplicable. */
export function walletAction(index, query) {
  if (query.requested !== true || query.verified !== true
    || !query.characterId || query.characterId !== query.activeCharacterId) return null
  const amount = copper(query.balanceCopper)
  const target = copper(query.targetCopper)
  if (amount === null || target === null || target === 0n) return null
  const scaled = amount * 100n
  const match = index.wallet_bands.find(band => {
    if (band.zero_only) return amount === 0n
    if (band.min_pct_inclusive !== undefined && scaled < target * BigInt(band.min_pct_inclusive)) return false
    if (band.min_pct_exclusive !== undefined && scaled <= target * BigInt(band.min_pct_exclusive)) return false
    return band.max_pct_exclusive === undefined || scaled < target * BigInt(band.max_pct_exclusive)
  })
  return match?.id ?? null
}
