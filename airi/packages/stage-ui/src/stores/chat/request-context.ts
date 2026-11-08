import type { Conversation, UserTurn } from '@proj-airi/core-agent'

/** Local user input for one provider request. No stored history grants access to live observations. */
export interface ChatRequestContextInput {
  sessionId: string
  turnId: string
  text: string
  signal: AbortSignal
}

/** A fresh image and its completed visual read share the lifetime of one provider request. */
export interface ChatRequestImage {
  url: string
  description: string
}

/** Text-only observations and image observations are supported. Images never become durable user attachments. */
export interface ChatRequestObservation {
  text: string
  images?: readonly ChatRequestImage[]
}

/** Returns temporary evidence. A text result carries no images. A missing result leaves the request unchanged. */
export type ChatRequestContextContributor = (input: ChatRequestContextInput) => Promise<string | ChatRequestObservation | undefined>

/** The caller projects pre-read images for text models without storing their descriptions or reading them again. */
export interface AppliedChatRequestContext {
  conversation: Conversation
  imageDescriptions: readonly (ChatRequestImage & { turnId: string })[]
}

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

  async apply(conversation: Conversation, input: ChatRequestContextInput): Promise<AppliedChatRequestContext> {
    input.signal.throwIfAborted()
    const imageDescriptions: (ChatRequestImage & { turnId: string })[] = []
    const index = conversation.turns.findLastIndex(turn => turn.type === 'user')
    const turn = conversation.turns[index]
    if (turn?.type !== 'user' || (turn.id !== input.turnId && turn.id !== `${input.turnId}-0`))
      return { conversation, imageDescriptions }
    const entries: { source: string, text: string }[] = []
    const images: Extract<UserTurn['content'][number], { type: 'image' }>[] = []
    // Registration changes during a read apply to the next turn, never a second read in this turn.
    for (const [source, contributor] of [...this.contributors]) {
      if (this.contributors.get(source) !== contributor)
        continue
      const result = await contributor(input)
      input.signal.throwIfAborted()
      // An owner can stop the observer while its external request is still finishing.
      if (result === undefined || this.contributors.get(source) !== contributor)
        continue
      const observation = typeof result === 'string' ? { text: result } : result
      if (observation.text.trim())
        entries.push({ source, text: observation.text })
      if (observation.images) {
        for (const image of observation.images) {
          images.push({ type: 'image', url: image.url })
          imageDescriptions.push({ ...image, turnId: turn.id })
        }
      }
    }
    if (!entries.length && !images.length)
      return { conversation, imageDescriptions }
    const turns = [...conversation.turns]
    const content: UserTurn['content'] = [...turn.content, ...images]
    if (entries.length)
      content.push({ type: 'runtime-context', entries })
    turns[index] = { ...turn, content }
    return { conversation: { ...conversation, turns }, imageDescriptions }
  }
}
