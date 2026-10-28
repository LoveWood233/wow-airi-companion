import type { ContextSnapshot, Conversation } from '@proj-airi/core-agent'
import type { KnowledgeGame, KnowledgeQuery } from '@proj-airi/stage-shared/wow-knowledge'

import { createWowKnowledgeContext } from '@proj-airi/stage-shared/wow-knowledge'
import { nullable, object, picklist, safeParse } from 'valibot'

const knowledgeSource = 'wow:knowledge'
const currentGameSchema = object({ game: nullable(picklist(['retail', 'forever', 'classic'])) })

/** Reads only the desktop's current-player selection. Old observations cannot select a game after logout. */
export function currentWowKnowledgeGame(contexts: ContextSnapshot): KnowledgeGame | undefined {
  const current = contexts['wow-companion-player-address']?.at(-1)
  if (current?.contextId !== 'wow-current-player-address')
    return undefined

  const result = safeParse(currentGameSchema, current.content)
  return result.success ? result.output.game ?? undefined : undefined
}

/**
 * Adds local Warcraft references to a provider copy of the latest user turn.
 * Repeated tool steps replace the references. Stored history and unrelated context remain unchanged.
 */
export function withWowKnowledgeContext(conversation: Conversation, query: Omit<KnowledgeQuery, 'text'>): Conversation {
  const currentIndex = conversation.turns.findLastIndex(turn => turn.type === 'user')
  const current = conversation.turns[currentIndex]
  if (current?.type !== 'user')
    return conversation

  // Runtime observations and earlier messages do not request new references for this user turn.
  const text = current.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
  const knowledge = createWowKnowledgeContext({ ...query, text })
  let changed = false
  const turns = conversation.turns.map((turn, index) => {
    if (turn.type !== 'user')
      return turn

    let removed = false
    const content = turn.content.flatMap((part): typeof turn.content => {
      if (part.type !== 'runtime-context' || !part.entries.some(entry => entry.source === knowledgeSource))
        return [part]
      removed = true
      const entries = part.entries.filter(entry => entry.source !== knowledgeSource)
      return entries.length ? [{ ...part, entries }] : []
    })
    if (index === currentIndex && knowledge)
      content.push({ type: 'runtime-context', entries: [{ source: knowledgeSource, text: knowledge }] })
    if (!removed && (index !== currentIndex || !knowledge))
      return turn
    changed = true
    return { ...turn, content }
  })
  return changed ? { ...conversation, turns } : conversation
}
