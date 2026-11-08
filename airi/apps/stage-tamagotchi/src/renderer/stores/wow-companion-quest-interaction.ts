import type { EquipmentPromptPlayback } from './wow-companion-equipment-prompt'
import type { QuestReminder } from './wow-companion-quest-policy'

/** Captures the persona and chat selection authorized for one reminder, so later settings cannot alter queued speech. */
export interface QuestInteraction {
  reminder: QuestReminder
  sessionId: string
  characterId: string
  chat: { provider: string, model: string }
  persona: string
  language: string
}

/**
 * Owns one model response and its audio turn. Loss of eligibility, sleep, stop, or timeout discards late output.
 * The host reserves cooldown and model budget before their respective side effects.
 */
export class QuestInteractionController {
  private operation: { request: QuestInteraction, control: AbortController, observedAt: number, deadline: number, playback?: EquipmentPromptPlayback } | undefined
  private stopping = 0

  constructor(private readonly platform: {
    current: (request: QuestInteraction, ownedTurnId?: string) => boolean
    generate: (request: QuestInteraction, signal: AbortSignal) => Promise<string>
    speak: (sessionId: string, text: string) => EquipmentPromptPlayback
    report: (status: 'responding' | 'submitted' | 'idle' | 'error', request: QuestInteraction) => void
  }) {}

  get request() { return this.operation?.request }
  get busy() { return !!this.operation || this.stopping > 0 }

  update(now = Date.now()) {
    const operation = this.operation
    if (!operation)
      return
    if (!this.platform.current(operation.request, operation.playback?.turnId)
      || now >= operation.deadline || now < operation.observedAt || now - operation.observedAt > 30_000) {
      this.stop()
      return
    }
    operation.observedAt = now
  }

  stop() {
    const operation = this.operation
    this.operation = undefined
    if (!operation)
      return
    operation.control.abort(new DOMException('Quest reminder stopped', 'AbortError'))
    this.platform.report('idle', operation.request)
    if (operation.playback) {
      this.stopping++
      void operation.playback.stop().catch(() => this.platform.report('error', operation.request)).finally(() => this.stopping--)
    }
  }

  async run(request: QuestInteraction) {
    if (this.busy || !this.platform.current(request))
      return
    const now = Date.now()
    const operation = { request, control: new AbortController(), observedAt: now, deadline: now + 120_000, playback: undefined as EquipmentPromptPlayback | undefined }
    this.operation = operation
    const timeout = setTimeout(() => {
      if (this.operation === operation)
        this.stop()
    }, 120_000)
    this.platform.report('responding', request)
    const generation = new AbortController()
    const generationTimeout = setTimeout(() => generation.abort(new DOMException('Quest generation timed out', 'TimeoutError')), 45_000)
    const signal = AbortSignal.any([operation.control.signal, generation.signal])
    try {
      const text = (await this.platform.generate(request, signal)).trim().slice(0, 600)
      if (this.operation !== operation || signal.aborted || !this.platform.current(request))
        return
      if (!text)
        throw new Error('Quest reminder returned no text')
      operation.playback = this.platform.speak(request.sessionId, text)
      const result = await operation.playback.done
      if (this.operation === operation && result === 'finished')
        this.platform.report('submitted', request)
    }
    catch {
      if (this.operation === operation && !operation.control.signal.aborted)
        this.platform.report('error', request)
    }
    finally {
      clearTimeout(timeout)
      clearTimeout(generationTimeout)
      if (this.operation === operation) {
        this.operation = undefined
        this.platform.report('idle', request)
      }
    }
  }
}
