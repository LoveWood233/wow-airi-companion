import type { VisionInferenceInput } from '@proj-airi/stage-ui/composables/vision/use-vision-inference'
import type { ChatRequestContextInput } from '@proj-airi/stage-ui/stores/chat/request-context'

import type { WowScreenCaptureErrorCode, WowScreenCaptureRequest, WowScreenCaptureResult, WowScreenGame } from '../../shared/wow-screen-assist'

import { createScreenAssistContext, createScreenAssistVisionPrompt, detectScreenAssistIntent } from './wow-screen-assist-policy'

export type ScreenAssistError = WowScreenCaptureErrorCode | 'vision-not-configured' | 'vision-failed' | 'no-description'
export type ScreenAssistStatus = 'idle' | 'capturing' | 'analyzing' | 'ready' | 'error'

/** Current settings are captured at the start of one request, never read from another chat turn. */
export interface ScreenAssistSettings {
  enabled: boolean
  game: WowScreenGame | 'auto'
  selection: { provider: string, model: string }
}

function waitForRead<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/**
 * Owns one capture and visual read at a time. Raw pixels stay in the current call and never enter chat storage.
 * Cancellation releases the caller and discards late IPC or provider results.
 */
export class WowScreenAssistController {
  private operation: AbortController | undefined

  constructor(private readonly platform: {
    capture: (request: WowScreenCaptureRequest) => Promise<WowScreenCaptureResult>
    read: (input: VisionInferenceInput) => Promise<string>
    report: (status: ScreenAssistStatus, error?: ScreenAssistError) => void
  }) {}

  stop() {
    this.operation?.abort(new DOMException('Screen assistance stopped', 'AbortError'))
    this.operation = undefined
    this.platform.report('idle')
  }

  async assist(input: ChatRequestContextInput, settings: ScreenAssistSettings): Promise<string | undefined> {
    input.signal.throwIfAborted()
    if (!settings.enabled)
      return undefined
    const intent = detectScreenAssistIntent(input.text)
    if (!intent)
      return undefined
    if (this.operation)
      return this.failure('busy')
    if (!settings.selection.provider || !settings.selection.model) {
      this.platform.report('error', 'vision-not-configured')
      return this.failure('vision-not-configured')
    }

    const operation = new AbortController()
    this.operation = operation
    const signal = AbortSignal.any([input.signal, operation.signal])
    let phase: ScreenAssistStatus = 'capturing'
    this.platform.report(phase)
    try {
      const result = await waitForRead(this.platform.capture(settings.game === 'auto' ? {} : { game: settings.game }), signal)
      signal.throwIfAborted()
      if (!result.ok) {
        this.platform.report('error', result.code)
        return this.failure(result.code)
      }
      const { image } = result
      // A capture receipt must describe a new frame. Never interpret a cached or implausibly dated receipt.
      if (image.capturedAt > Date.now() + 1000 || Date.now() - image.capturedAt > 15_000) {
        this.platform.report('error', 'capture-timeout')
        return this.failure('capture-timeout')
      }
      phase = 'analyzing'
      this.platform.report(phase)
      const observations = await waitForRead(this.platform.read({
        imageDataUrl: image.dataUrl,
        workloadId: 'screen:understand',
        promptOverride: createScreenAssistVisionPrompt(input.text, intent),
        abortSignal: signal,
        selection: settings.selection,
      }), signal)
      signal.throwIfAborted()
      if (!observations.trim()) {
        this.platform.report('error', 'no-description')
        return this.failure('no-description')
      }
      this.platform.report('ready')
      return createScreenAssistContext({ question: input.text, intent, observations, capturedAt: image.capturedAt, gameVersion: image.game })
    }
    catch {
      // A stopped feature leaves the ordinary reply usable, but never implies that a frame was seen.
      input.signal.throwIfAborted()
      if (operation.signal.aborted)
        return undefined
      const code = phase === 'capturing' ? 'capture-failed' : 'vision-failed'
      this.platform.report('error', code)
      return this.failure(code)
    }
    finally {
      if (this.operation === operation) {
        this.operation = undefined
        if (signal.aborted)
          this.platform.report('idle')
      }
    }
  }

  private failure(code: ScreenAssistError) {
    return `World of Warcraft screen assistance failed for this user request (${code}). No screenshot observations are available. `
      + 'Explicitly tell the user that you could not inspect their game view. Explain the reason and the next setup or capture step. '
      + 'You can give general guidance, clearly labeled as unverified. Never invent visible terrain, coordinates, NPCs, or quest progress. '
      + 'Do not control the game or request a desktop screenshot from another app.'
  }
}
