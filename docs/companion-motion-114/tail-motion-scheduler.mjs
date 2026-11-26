// Reference for one stage and one session. The caller owns media and audio I/O.
// Inputs use the stage's monotonic millisecond clock. The first pose must already
// be visible when the scheduler is constructed. It is the visual baseline.
export class TailMotionScheduler {
  #sessionId
  #epoch
  #windowMs
  #limit
  #window = 0
  #used = 0
  #lastTime
  #active
  #initialPlaybackId
  #lastCycle = 0
  #heldTail = false
  #sequence = 0
  #pending = null
  #seenMotions = new Set()
  #seenSpeech = new Set()
  #speech = []
  #allowSpeech = true
  #settlementState = new Map()
  #pendingSettlements = []
  #readySettlements = []

  constructor({ sessionId, startedAt, initialPlaybackId, looping = false, windowMs = 60000, limit = 2 }) {
    if (!sessionId || !initialPlaybackId || !Number.isSafeInteger(startedAt)
      || !Number.isSafeInteger(windowMs) || windowMs < 1 || !Number.isSafeInteger(limit) || limit < 0) {
      throw new TypeError('Expected session, initial playback ID, clock origin and valid window limits')
    }
    this.#sessionId = sessionId
    this.#epoch = this.#lastTime = startedAt
    this.#windowMs = windowMs
    this.#limit = limit
    this.#initialPlaybackId = initialPlaybackId
    this.#active = { playbackId: initialPlaybackId, looping }
  }

  #advance(at) {
    if (!Number.isSafeInteger(at) || at < this.#lastTime) {
      throw new RangeError('Process events at their monotonic handling/presentation time')
    }
    this.#lastTime = at
    const window = Math.floor((at - this.#epoch) / this.#windowMs)
    if (window !== this.#window) {
      this.#window = window
      this.#used = 0
      this.#pending = null
    }
    if (this.#pending && at >= this.#pending.expiresAt) this.#pending = null
  }

  // One granted utterance may accompany several visual candidates. FIFO order is
  // acceptance order; key by response/segment ID, independently of animation IDs.
  #enqueueSpeech(voice) {
    if (!voice || voice.approved !== true || !voice.id || !voice.text) return 'none'
    if (this.#seenSpeech.has(voice.id)) return 'duplicate'
    this.#seenSpeech.add(voice.id)
    if (!this.#allowSpeech) return 'suppressed-by-preference'
    if (this.#settlementState.get(voice.afterSettlement) === 'rejected') return 'rejected-settlement'
    this.#speech.push({ id: voice.id, text: voice.text, afterSettlement: voice.afterSettlement })
    return 'queued'
  }

  #enqueueMotion(at, visual) {
    if (!visual?.id || !visual.clipKey || visual.eligible !== true) return 'ineligible'
    if (this.#seenMotions.has(visual.id)) return 'duplicate'
    this.#seenMotions.add(visual.id)
    const expiresAt = visual.expiresAt ?? Infinity
    if (!(expiresAt > at)) return 'expired'
    if (visual.observedAt !== undefined && (!Number.isSafeInteger(visual.observedAt)
      || visual.observedAt > at || Math.floor((visual.observedAt - this.#epoch) / this.#windowMs) !== this.#window)) {
      return 'outside-current-window'
    }
    if (this.#used >= this.#limit) return 'window-full'

    // The host resolves semantic priority from the interaction index, not from
    // the player. Higher rank wins; the most recent equal-ranked input replaces
    // the previous one. One pending slot bounds the backlog.
    const rank = visual.rank ?? 0
    if (!Number.isFinite(rank)) return 'invalid-rank'
    if (this.#pending && this.#pending.rank > rank) return 'lower-priority'
    this.#pending = { id: visual.id, clipKey: visual.clipKey, rank, expiresAt,
      looping: visual.looping === true, prepared: false }
    return 'pending'
  }

  #registerSettlement(intent) {
    if (!intent?.id || intent.approved !== true) return 'none'
    if (this.#settlementState.has(intent.id)) return 'duplicate'
    this.#settlementState.set(intent.id, 'pending')
    this.#pendingSettlements.push({ id: intent.id, payload: intent.payload })
    return 'pending-tail'
  }

  #releaseSettlements(at) {
    for (const intent of this.#pendingSettlements) {
      this.#settlementState.set(intent.id, 'ready')
      this.#readySettlements.push({ ...intent, sessionId: this.#sessionId, releasedAt: at })
    }
    this.#pendingSettlements.length = 0
  }

  // Separate from choosing a clip. The host takes a released intent once, and
  // persists its business effect with (sessionId,id) as its idempotency key.
  // The host owns durable storage and recovery; this class holds session memory.
  takeSettlement() {
    const intent = this.#readySettlements.shift()
    if (!intent) return null
    this.#settlementState.set(intent.id, 'submitted')
    return intent
  }

  confirmSettlement({ sessionId, id, committed }) {
    if (sessionId !== this.#sessionId || typeof committed !== 'boolean'
      || this.#settlementState.get(id) !== 'submitted') return false
    this.#settlementState.set(id, committed ? 'committed' : 'rejected')
    // The host may enqueue an approved failure response under a new segment ID.
    if (!committed) this.#speech = this.#speech.filter(utterance => utterance.afterSettlement !== id)
    return true
  }

  accept(at, { sessionId, visual, voice, settlement }) {
    if (sessionId !== this.#sessionId) return { voice: 'stale-session', visual: 'stale-session', settlement: 'stale-session' }
    this.#advance(at)
    const speechResult = this.#enqueueSpeech(voice)
    const motionResult = visual ? this.#enqueueMotion(at, visual) : 'none'
    return { voice: speechResult, visual: motionResult, settlement: this.#registerSettlement(settlement) }
  }

  // Explicit mute/quiet discards queued utterances and suppresses new ones.
  // The audio host separately stops any utterance it has already taken.
  setSpeechEnabled(enabled) {
    this.#allowSpeech = enabled === true
    if (!this.#allowSpeech) this.#speech.length = 0
  }

  // Returning an item is a queue handoff, not a TTS-start or audible receipt.
  takeSpeech() {
    // Preserve arrival order among ready utterances. Waiting result text keeps
    // its original position without delaying unrelated replies or reminders.
    const firstReady = this.#speech.findIndex(utterance =>
      !utterance.afterSettlement || this.#settlementState.get(utterance.afterSettlement) === 'committed')
    if (firstReady === -1) return null
    const [utterance] = this.#speech.splice(firstReady, 1)
    return { id: utterance.id, text: utterance.text }
  }

  // A decoder can report preparation or failure for a request. Neither is a
  // playback boundary. Stale reports cannot mark a newer request ready.
  preparation(at, { sessionId, requestId, ready }) {
    if (sessionId !== this.#sessionId || at < this.#lastTime) return false
    this.#advance(at)
    if (!this.#pending || this.#pending.id !== requestId) return false
    if (ready === true) this.#pending.prepared = true
    else this.#pending = null
    return true
  }

  // This callback is a *trusted renderer receipt*: the last frame of this
  // playback cycle was displayed through the end of its presentation interval.
  // Do not forward a timeout, media 'ended' alone, the last frame being
  // submitted, decode completion or an off-screen preload. For loops the
  // renderer must expose each completed cycle, numbered 1, 2, ... . finishedAt
  // identifies the actual rendering tick: a delayed loop callback must not splice
  // media into the middle of a later cycle.
  //
  // present(next, at) runs synchronously on the presentation boundary. Return
  // true only if the prepared next first frame becomes visible at that timestamp.
  // At that tick the host must recheck the request's source facts, identity and
  // permission. If e.g. health recovered or consent was withdrawn during
  // preloading, leave the current picture in place and return false.
  // No asynchronous or optimistic confirmation. The host keeps the old frame if
  // it returns false. An async media loader must finish before marking ready.
  completeTail(at, { sessionId, playbackId, cycle, lastFrameFinished, finishedAt }, present) {
    if (sessionId !== this.#sessionId || playbackId !== this.#active.playbackId
      || lastFrameFinished !== true || finishedAt !== at || at < this.#lastTime || !Number.isSafeInteger(cycle) || cycle <= this.#lastCycle
      || (!this.#active.looping && cycle !== 1)) return null
    this.#advance(at)
    this.#lastCycle = cycle
    this.#heldTail = !this.#active.looping
    this.#releaseSettlements(at)
    return this.#presentPending(at, present)
  }

  // A one-shot clip can hold its completed last frame while the new video loads.
  // Invoke on the real display tick at which the first frame can become visible.
  // A looping clip that missed the last handoff must finish another full cycle.
  presentOnHeldTail(at, { sessionId, playbackId }, present) {
    if (!this.#heldTail || sessionId !== this.#sessionId || playbackId !== this.#active.playbackId
      || at < this.#lastTime) return null
    this.#advance(at)
    this.#releaseSettlements(at)
    return this.#presentPending(at, present)
  }

  #presentPending(at, present) {
    const request = this.#pending
    if (!request?.prepared || this.#used >= this.#limit) return null
    let playbackId
    do {
      playbackId = String(this.#sessionId) + '/motion/' + (++this.#sequence)
    } while (playbackId === this.#initialPlaybackId)
    const next = { playbackId, requestId: request.id, clipKey: request.clipKey, looping: request.looping }
    // A failed candidate is discarded without spending the budget. A fresh
    // request can retry the same clip after the host fixes its decoder.
    this.#pending = null
    if (present(next, at) !== true) return null
    this.#used++
    this.#active = { playbackId, looping: request.looping }
    this.#heldTail = false
    this.#lastCycle = 0
    return { ...next, presentedAt: at, window: this.#window, count: this.#used }
  }
}
