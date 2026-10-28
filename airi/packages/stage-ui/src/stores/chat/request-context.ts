import type { Conversation } from '@proj-airi/core-agent'

/** Local user input for one provider request. No stored history grants access to live observations. */
export interface ChatRequestContextInput {
  sessionId: string
  turnId: string
  text: string
  signal: AbortSignal
}

/** Returns temporary observations for this turn. A missing result leaves the request unchanged. */
export type ChatRequestContextContributor = (input: ChatRequestContextInput) => Promise<string | undefined>

/**
 * Owns window-local observers. Registration never enters synchronized state or persisted history.
 * The caller invokes observers once per new owner turn, before provider tool steps begin.
 */
export class ChatRequestContexts {
  private readonly contributors = new Map<string, ChatRequestContextContributor>()

  get size() {
    return this.contributors.size
  }

  register(source: string, contributor: ChatRequestContextContributor) {
    this.contributors.set(source, contributor)
    return () => {
      if (this.contributors.get(source) === contributor)
        this.contributors.delete(source)
    }
  }

  clear() {
    this.contributors.clear()
  }

  async apply(conversation: Conversation, input: ChatRequestContextInput): Promise<Conversation> {
    input.signal.throwIfAborted()
    const index = conversation.turns.findLastIndex(turn => turn.type === 'user')
    const turn = conversation.turns[index]
    if (turn?.type !== 'user' || (turn.id !== input.turnId && turn.id !== `${input.turnId}-0`))
      return conversation
    const entries: { source: string, text: string }[] = []
    // Registration changes during a read apply to the next turn, never a second read in this turn.
    for (const [source, contributor] of [...this.contributors]) {
      if (this.contributors.get(source) !== contributor)
        continue
      const text = await contributor(input)
      input.signal.throwIfAborted()
      // An owner can stop the observer while its external request is still finishing.
      if (text?.trim() && this.contributors.get(source) === contributor)
        entries.push({ source, text })
    }
    if (!entries.length)
      return conversation
    const turns = [...conversation.turns]
    turns[index] = { ...turn, content: [...turn.content, { type: 'runtime-context', entries }] }
    return { ...conversation, turns }
  }
}
