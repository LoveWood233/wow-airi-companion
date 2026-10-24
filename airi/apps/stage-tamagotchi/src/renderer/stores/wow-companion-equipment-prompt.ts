import type { CompanionState, GameVersion } from '../../shared/wow-companion'
import type { EquipmentOffer } from '../../shared/wow-companion-equipment-offer'

/** One desktop suggestion. Acceptance only explains the required confirmation inside the game. */
export interface EquipmentPrompt {
  id: string
  text: string
  phase: 'speaking' | 'choosing' | 'accepted'
  deadline: number | null
}

/** The voice host owns audio. Stop resolves after this specific turn becomes silent. */
export interface EquipmentPromptPlayback {
  turnId: string
  done: Promise<unknown>
  stop: () => Promise<unknown>
}

/** Platform speech, chat activity, localization, and presentation belong to the mounted desktop host. */
export interface EquipmentPromptHost {
  publish: (prompt: EquipmentPrompt | null) => void
  sessionId: () => string | undefined
  busy: (ownedTurnId?: string) => boolean
  muted: () => boolean
  message: (offer: EquipmentOffer) => string
  accepted: () => string
  speak: (sessionId: string, text: string) => EquipmentPromptPlayback
}

interface Candidate {
  game: GameVersion
  offer: EquipmentOffer
  key: string
  identity: string
  muted: boolean
}

interface ActivePrompt extends Candidate {
  sessionId: string | undefined
  view: EquipmentPrompt
  playback?: EquipmentPromptPlayback
  speechDeadline: number
  stopping: boolean
  acceptedUntil?: number
}

/**
 * One mounted desktop owns suggestions across both games. Observations never send commands to the game.
 * Each character session retains an offered-ID watermark. Consumed suggestions cannot replay.
 */
export class EquipmentPromptController {
  private readonly states = new Map<GameVersion, CompanionState>()
  private readonly waiting = new Set<string>()
  private readonly seen = new Map<string, number>()
  private current: ActivePrompt | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stoppingAudio = 0

  constructor(private readonly host: EquipmentPromptHost) {}

  /** The owner supplies fresh bridge state. Missing or invalid observations cancel their pending suggestions. */
  observe(game: GameVersion, state: CompanionState) {
    this.states.set(game, state)
    this.tick()
  }

  unavailable(game: GameVersion) {
    this.states.delete(game)
    this.tick()
  }

  /** A choice addresses only the currently visible suggestion. Acceptance never equips an item. */
  choose(id: string, choice: 'accept' | 'decline') {
    this.tick()
    const current = this.current
    if (!current || current.key !== id || current.view.phase !== 'choosing')
      return
    if (choice === 'decline') {
      this.dismiss()
      return
    }
    current.acceptedUntil = Date.now() + 10_000
    current.view = { id, text: this.host.accepted(), phase: 'accepted', deadline: null }
    this.host.publish(current.view)
  }

  /** Stop releases observations and owned audio. Remembered IDs survive a later restart of the same host. */
  stop() {
    this.states.clear()
    this.waiting.clear()
    clearTimeout(this.timer)
    this.timer = undefined
    this.dismiss()
  }

  private candidate(game: GameVersion, now: number): Candidate | undefined {
    const state = this.states.get(game)
    const bridge = state?.bridge
    const snapshot = bridge?.snapshot
    const offer = bridge?.equipmentOffer
    if (!state || state.game !== game || !state.settings.enabled || state.error || !bridge || bridge.error
      || bridge.equipmentOfferError || bridge.status !== 'live' || bridge.source !== 'screen'
      || !snapshot?.online || snapshot.combat || snapshot.dead || !offer || offer.st !== 'ready'
      || offer.s !== snapshot.session || offer.g !== snapshot.guid || offer.until * 1000 <= now) {
      return
    }
    const identity = JSON.stringify([game, offer.s, offer.g])
    return { game, offer, identity, key: JSON.stringify([game, offer.s, offer.g, offer.id]), muted: state.settings.muted }
  }

  private tick() {
    clearTimeout(this.timer)
    this.timer = undefined
    const now = Date.now()
    const current = this.current
    if (current) {
      const observed = this.candidate(current.game, now)
      if (!observed || observed.key !== current.key || (current.sessionId !== undefined && this.host.sessionId() !== current.sessionId)
        || this.host.busy(current.playback?.turnId)) {
        this.dismiss()
      }
      else if (current.view.phase === 'speaking' && !current.stopping
        && (now >= current.speechDeadline || observed.muted || this.host.muted())) {
        this.finishSilently(current)
      }
      else if (current.stopping && now >= current.speechDeadline + 5000) {
        this.dismiss()
      }
      else if ((current.view.deadline !== null && now >= current.view.deadline)
        || (current.acceptedUntil !== undefined && now >= current.acceptedUntil)) {
        this.dismiss()
      }
    }

    const candidates = [...this.states.keys()].map(game => this.candidate(game, now)).filter((value): value is Candidate => !!value)
    const validKeys = new Set(candidates.map(candidate => candidate.key))
    for (const key of this.waiting.keys()) {
      if (!validKeys.has(key))
        this.waiting.delete(key)
    }
    if (!this.current && !this.stoppingAudio) {
      for (const candidate of candidates) {
        if (candidate.offer.id <= (this.seen.get(candidate.identity) ?? 0))
          continue
        this.waiting.add(candidate.key)
        if (candidate.offer.until * 1000 - now < 10_000) {
          this.consume(candidate)
          continue
        }
        const sessionId = this.host.sessionId()
        if (this.host.busy())
          continue
        this.begin(candidate, sessionId, now)
        break
      }
    }
    if (this.current || this.waiting.size)
      this.timer = setTimeout(() => this.tick(), 100)
  }

  private consume(candidate: Candidate) {
    this.seen.set(candidate.identity, Math.max(this.seen.get(candidate.identity) ?? 0, candidate.offer.id))
    this.waiting.delete(candidate.key)
  }

  private begin(candidate: Candidate, sessionId: string | undefined, now: number) {
    this.consume(candidate)
    const current: ActivePrompt = {
      ...candidate,
      sessionId,
      view: { id: candidate.key, text: this.host.message(candidate.offer), phase: 'speaking', deadline: null },
      speechDeadline: Math.min(now + 30_000, candidate.offer.until * 1000 - 10_000),
      stopping: false,
    }
    this.current = current
    this.host.publish(current.view)
    if (!sessionId || candidate.muted || this.host.muted()) {
      this.chooseAfterSpeech(current)
      return
    }
    try {
      current.playback = this.host.speak(sessionId, current.view.text)
      void current.playback.done.then(() => this.chooseAfterSpeech(current), () => this.finishSilently(current))
    }
    catch {
      // Optional speech cannot block the visible suggestion or its manual confirmation inside the game.
      this.chooseAfterSpeech(current)
    }
  }

  private chooseAfterSpeech(current: ActivePrompt) {
    if (this.current !== current || current.stopping || current.view.phase !== 'speaking')
      return
    const candidate = this.candidate(current.game, Date.now())
    if (!candidate || candidate.key !== current.key || (current.sessionId !== undefined && this.host.sessionId() !== current.sessionId)
      || this.host.busy(current.playback?.turnId) || candidate.offer.until * 1000 - Date.now() < 10_000) {
      this.dismiss()
      return
    }
    current.playback = undefined
    current.view = { ...current.view, phase: 'choosing', deadline: Date.now() + 10_000 }
    this.host.publish(current.view)
  }

  private finishSilently(current: ActivePrompt) {
    if (this.current !== current || current.stopping || current.view.phase !== 'speaking')
      return
    current.stopping = true
    if (!current.playback) {
      current.stopping = false
      this.chooseAfterSpeech(current)
      return
    }
    // A failed synthesis or deadline first stops owned audio. Buttons appear only after the silence receipt.
    this.stoppingAudio++
    const playback = current.playback
    void Promise.resolve().then(() => playback.stop()).then(() => {
      current.stopping = false
      this.chooseAfterSpeech(current)
    }, () => {
      if (this.current === current)
        this.dismiss()
    }).finally(() => {
      this.stoppingAudio--
      this.tick()
    })
  }

  private dismiss() {
    const current = this.current
    this.current = undefined
    if (!current)
      return
    this.host.publish(null)
    if (current.playback && !current.stopping) {
      this.stoppingAudio++
      const playback = current.playback
      void Promise.resolve().then(() => playback.stop()).catch(() => {}).finally(() => {
        this.stoppingAudio--
        this.tick()
      })
    }
  }
}
