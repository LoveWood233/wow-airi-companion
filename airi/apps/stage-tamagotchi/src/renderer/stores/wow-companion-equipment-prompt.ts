import type { CompanionState, GameVersion, Snapshot } from '../../shared/wow-companion'
import type { EquipmentComparison } from '../../shared/wow-companion-equipment-comparisons'
import type { EquipmentOffer } from '../../shared/wow-companion-equipment-offer'

import { assessEquipment } from '../../shared/wow-companion-equipment-comparisons'
import { hasFreshCompanionObservation } from '../utils/wow-companion-observation'

/** One desktop notice. Only a verified game offer can expose an equipment choice. */
export interface EquipmentPrompt {
  id: string
  text: string
  phase: 'speaking' | 'choosing' | 'accepted' | 'review'
  deadline: number | null
}

/** The desktop page and caption bubble share the same localized choice labels. */
export function equipmentPromptActions(prompt: EquipmentPrompt | null, translate: (key: string) => string) {
  if (prompt?.phase !== 'choosing')
    return undefined
  return {
    id: prompt.id,
    acceptLabel: translate('wow-companion.equipment-prompt.accept'),
    declineLabel: translate('wow-companion.equipment-prompt.decline'),
    hint: `${translate('wow-companion.equipment-prompt.timeout')} ${translate('wow-companion.equipment-prompt.description')}`,
  }
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
  /** Checks the latest character before each tick, including during another profile's update. */
  currentPlayer: (game: GameVersion, snapshot: Snapshot) => boolean
  sessionId: () => string | undefined
  busy: (ownedTurnId?: string) => boolean
  muted: () => boolean
  message: (offer: EquipmentOffer, comparison: EquipmentComparison) => string
  review: (comparison: EquipmentComparison) => string
  accepted: () => string
  speak: (sessionId: string, text: string) => EquipmentPromptPlayback
}

interface Candidate {
  game: GameVersion
  offer?: EquipmentOffer
  expiresAt: number
  comparison: EquipmentComparison
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
  private readonly reviewed = new Map<string, number>()
  private current: ActivePrompt | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stoppingAudio = 0

  constructor(private readonly host: EquipmentPromptHost) {}

  /** A valid waiting suggestion reserves priority over background companion speech. */
  get hasPending() {
    return !!this.current || this.waiting.size > 0
  }

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
      || bridge.equipmentOfferError || bridge.equipmentComparisonError || bridge.status !== 'live' || bridge.source !== 'screen'
      || !snapshot?.online || !this.host.currentPlayer(game, snapshot) || snapshot.combat || snapshot.dead || !offer || offer.st !== 'ready'
      || offer.s !== snapshot.session || offer.g !== snapshot.guid || offer.until * 1000 <= now) {
      return
    }
    const comparison = bridge.equipmentComparisons.find(value => value.id === offer.id && value.session === offer.s && value.guid === offer.g)
    if (!comparison || comparison.class !== snapshot.class || comparison.spec !== snapshot.spec
      || comparison.slot !== offer.slot || comparison.candidate.itemID !== offer.item || comparison.candidate.itemLevel !== offer.il
      || comparison.current?.itemID !== offer.old || comparison.current.itemLevel !== offer.ol) {
      return
    }
    const assessment = assessEquipment(comparison)
    if (assessment.verdict !== 'upgrade' && assessment.reason !== 'primary_upgrade_tradeoff')
      return
    const identity = JSON.stringify([game, offer.s, offer.g])
    return { game, offer, comparison, identity, key: JSON.stringify([game, offer.s, offer.g, offer.id]), expiresAt: offer.until * 1000, muted: state.settings.muted }
  }

  private candidates(game: GameVersion, now: number): Candidate[] {
    const offered = this.candidate(game, now)
    const candidates = offered ? [offered] : []
    const state = this.states.get(game)
    if (!state || state.game !== game || !hasFreshCompanionObservation(state, now))
      return candidates
    const { bridge } = state
    const snapshot = bridge.snapshot
    if (snapshot.combat || snapshot.dead || !this.host.currentPlayer(game, snapshot)
      || bridge.equipmentError || bridge.equipmentComparisonError) {
      return candidates
    }

    // A review is informational. It requires a recent acquisition, never a saved comparison or a manual bag rescan.
    for (const comparison of [...bridge.equipmentComparisons].sort((a, b) => b.id - a.id)) {
      if (comparison.session !== snapshot.session || comparison.guid !== snapshot.guid
        || comparison.class !== snapshot.class || comparison.spec !== snapshot.spec
        || comparison.observedAt * 1000 > now + 5000 || now - comparison.observedAt * 1000 > 180_000
        || !comparison.current || comparison.candidate.itemLevel <= comparison.current.itemLevel
        || bridge.equipmentOffer?.id === comparison.id) {
        continue
      }
      const acquired = bridge.equipment?.some(item => item.source === 'bag_added' && item.id === comparison.id
        && item.session === comparison.session && item.guid === comparison.guid
        && item.itemID === comparison.candidate.itemID && item.observedAt === comparison.observedAt)
      const assessment = assessEquipment(comparison)
      if (!acquired || assessment.verdict !== 'review' || assessment.reason === 'primary_upgrade_tradeoff')
        continue
      const identity = JSON.stringify([game, comparison.session, comparison.guid])
      if (comparison.id <= (this.seen.get(identity) ?? 0))
        continue
      candidates.push({ game, comparison, identity, key: JSON.stringify([game, comparison.session, comparison.guid, comparison.id]), expiresAt: comparison.observedAt * 1000 + 180_000, muted: state.settings.muted })
    }
    return candidates
  }

  private tick() {
    clearTimeout(this.timer)
    this.timer = undefined
    const now = Date.now()
    const current = this.current
    if (current) {
      const observed = this.candidates(current.game, now).find(candidate => candidate.key === current.key)
      const actionable = !current.offer && [...this.states.keys()].some((game) => {
        const candidate = this.candidate(game, now)
        return candidate && candidate.comparison.id > (this.seen.get(candidate.identity) ?? 0)
      })
      if (!observed || observed.key !== current.key || (current.sessionId !== undefined && this.host.sessionId() !== current.sessionId)
        || actionable || this.host.busy(current.playback?.turnId)) {
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

    const candidates = [...this.states.keys()].flatMap(game => this.candidates(game, now)).sort((first, second) => Number(!!second.offer) - Number(!!first.offer))
    const validKeys = new Set(candidates.map(candidate => candidate.key))
    for (const key of this.waiting.keys()) {
      if (!validKeys.has(key))
        this.waiting.delete(key)
    }
    if (!this.current && !this.stoppingAudio) {
      for (const candidate of candidates) {
        const seen = candidate.offer ? this.seen : this.reviewed
        if (candidate.comparison.id <= (seen.get(candidate.identity) ?? 0))
          continue
        this.waiting.add(candidate.key)
        if (candidate.expiresAt - now < 10_000) {
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
    // Informational reviews cannot consume an earlier game offer that is still crossing the pixel transport.
    const seen = candidate.offer ? this.seen : this.reviewed
    seen.set(candidate.identity, Math.max(seen.get(candidate.identity) ?? 0, candidate.comparison.id))
    this.waiting.delete(candidate.key)
  }

  private begin(candidate: Candidate, sessionId: string | undefined, now: number) {
    this.consume(candidate)
    const current: ActivePrompt = {
      ...candidate,
      sessionId,
      view: { id: candidate.key, text: candidate.offer ? this.host.message(candidate.offer, candidate.comparison) : this.host.review(candidate.comparison), phase: 'speaking', deadline: null },
      // Slow speech synthesis still leaves ten seconds for a valid in-game offer.
      speechDeadline: Math.min(now + 120_000, candidate.expiresAt - 10_000),
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
    const candidate = this.candidates(current.game, Date.now()).find(candidate => candidate.key === current.key)
    if (!candidate || candidate.key !== current.key || (current.sessionId !== undefined && this.host.sessionId() !== current.sessionId)
      || this.host.busy(current.playback?.turnId) || candidate.expiresAt - Date.now() < 10_000) {
      this.dismiss()
      return
    }
    current.playback = undefined
    current.view = { ...current.view, phase: current.offer ? 'choosing' : 'review', deadline: Date.now() + 10_000 }
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
