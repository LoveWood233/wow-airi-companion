import type { SpeechClip, SpeechOutput, TurnRef } from '@proj-airi/core-agent'

import { turnKey } from '@proj-airi/core-agent'

interface CaptionTurn {
  key: string
  closed: boolean
  playing: Set<string>
}

/**
 * Shows the latest spoken segment until its response closes and all started audio ends, plus three seconds.
 * The scene owns this instance. Turn identity isolates completion callbacks. Each actual audio start selects its response caption.
 */
export class PlaybackCaption {
  private readonly turns = new Map<string, CaptionTurn>()
  private visible: CaptionTurn | undefined
  private text = ''
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(private readonly publish: (text: string) => void) {}

  /** Register each response before the voice store publishes its active turns. Only playback callbacks show text. */
  connectTurn(turn: TurnRef): Required<Pick<SpeechOutput, 'onPlaybackStart' | 'onPlaybackEnd'>> {
    const state: CaptionTurn = { key: turnKey(turn), closed: false, playing: new Set() }
    if (!this.disposed)
      this.turns.set(state.key, state)

    return {
      onPlaybackStart: clip => this.start(state, clip),
      onPlaybackEnd: clip => this.end(state, clip),
    }
  }

  /** Cancellation removes a turn before its audio fades. Started clips still own their completion callbacks. */
  updateActiveTurns(turns: readonly TurnRef[]) {
    if (this.disposed)
      return

    const active = new Set(turns.map(turnKey))
    for (const state of this.turns.values()) {
      if (!active.has(state.key))
        state.closed = true
      this.settle(state)
    }
  }

  /** Mark a muted response complete for captions. Started clips still determine when the hide delay begins. */
  closeTurn(turn: TurnRef) {
    const state = this.turns.get(turnKey(turn))
    if (!state)
      return
    state.closed = true
    this.settle(state)
  }

  /** Unmount clears visible text and timers. Late audio callbacks cannot publish into a replacement scene. */
  dispose() {
    this.disposed = true
    this.cancelHide()
    this.turns.clear()
    this.visible = undefined
    this.show('')
  }

  private start(state: CaptionTurn, clip: SpeechClip) {
    if (this.disposed || state.playing.has(clip.id))
      return

    this.turns.set(state.key, state)
    state.playing.add(clip.id)
    this.cancelHide()
    const text = clip.text.trim()
    if (this.visible !== state) {
      this.visible = state
      this.show(text)
    }
    else if (text) {
      // Some streaming providers omit text on later audio parts. Keep the latest caption within the same response.
      this.show(text)
    }
  }

  private end(state: CaptionTurn, clip: SpeechClip) {
    if (this.disposed || !state.playing.delete(clip.id))
      return
    this.settle(state)
  }

  private settle(state: CaptionTurn) {
    if (!state.closed || state.playing.size > 0)
      return

    if (this.visible !== state || !this.text) {
      this.turns.delete(state.key)
      if (this.visible === state)
        this.visible = undefined
      return
    }

    if (this.timer !== undefined)
      return

    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.disposed || this.visible !== state || !state.closed || state.playing.size > 0)
        return
      this.visible = undefined
      this.turns.delete(state.key)
      this.show('')
    }, 3000)
  }

  private cancelHide() {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private show(text: string) {
    if (this.text === text)
      return
    this.text = text
    this.publish(text)
  }
}
