import type { ContextSnapshot, Conversation } from '@proj-airi/core-agent'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { describe, expect, it } from 'vitest'

import { currentWowKnowledgeGame, withWowKnowledgeContext } from './wow-knowledge-context'

function conversation(text: string): Conversation {
  return { turns: [{ id: 'user-1', type: 'user', content: [{ type: 'text', text }] }] }
}

function references(value: Conversation) {
  return value.turns.flatMap(turn => turn.type === 'user'
    ? turn.content.flatMap(part => part.type === 'runtime-context' ? part.entries.filter(entry => entry.source === 'wow:knowledge') : [])
    : [])
}

describe('warcraft request knowledge', () => {
  it('explains Chinese shorthand offline without changing stored history', () => {
    const source = conversation('DZ是什么意思？')
    const before = structuredClone(source)
    const projected = withWowKnowledgeContext(source, { locale: 'en' })

    expect(references(projected)).toHaveLength(1)
    expect(references(projected)[0]?.text).toContain('盗贼')
    expect(source).toEqual(before)
    expect(references(source)).toHaveLength(0)
  })

  it('does not search earlier user messages or unrelated runtime observations', () => {
    const source = withWowKnowledgeContext(conversation('DZ是什么意思？'), { locale: 'zh-Hans' })
    source.turns.push({
      id: 'user-2',
      type: 'user',
      content: [
        { type: 'text', text: '今晚吃什么？' },
        { type: 'runtime-context', entries: [{ source: 'other-observation', text: 'DZ in Warcraft' }] },
      ],
    })
    const projected = withWowKnowledgeContext(source, { locale: 'zh-Hans' })

    expect(references(projected)).toHaveLength(0)
    expect(JSON.stringify(projected)).toContain('other-observation')
    expect(references(source)).toHaveLength(1)
  })

  it('replaces its references across model steps and keeps other runtime context', () => {
    const source = conversation('DZ是什么意思？')
    const turn = source.turns[0]
    if (turn?.type !== 'user')
      throw new Error('Expected a user turn')
    turn.content.push({ type: 'runtime-context', entries: [{ source: 'weather', text: 'Sunny' }] })
    const first = withWowKnowledgeContext(source, { locale: 'zh-Hans' })
    const second = withWowKnowledgeContext(first, { locale: 'zh-Hans' })

    expect(references(second)).toHaveLength(1)
    expect(references(second)).toEqual(references(first))
    expect(JSON.stringify(second)).toContain('Sunny')
  })

  it('leaves an unrelated request unchanged', () => {
    const source = conversation('今晚吃什么？')
    expect(withWowKnowledgeContext(source, { locale: 'zh-Hans' })).toBe(source)
  })

  it('uses the selected game but lets an explicit Classic question override Retail', () => {
    const retail = withWowKnowledgeContext(conversation('M+'), { game: 'retail', locale: 'en' })
    const forever = withWowKnowledgeContext(conversation('M+'), { game: 'forever', locale: 'en' })
    const classic = withWowKnowledgeContext(conversation('怀旧服有哪些分支？'), { game: 'retail', locale: 'zh-Hans' })

    expect(references(retail)[0]?.text).toContain('retail-mythic-plus')
    expect(JSON.stringify(references(forever))).not.toContain('retail-mythic-plus')
    expect(references(classic)[0]?.text).toContain('Game scope: classic.')
    expect(references(classic)[0]?.text).not.toContain('"game":"retail"')
  })
})

describe('current Warcraft version', () => {
  function snapshot(game: unknown): ContextSnapshot {
    return {
      'wow-companion-player-address': [{
        id: 'current',
        contextId: 'wow-current-player-address',
        strategy: ContextUpdateStrategy.ReplaceSelf,
        content: { game },
        text: 'Current player',
        createdAt: 1,
      }],
    }
  }

  it('reads a structured selection and clears it when the latest player goes offline', () => {
    expect(currentWowKnowledgeGame(snapshot('retail'))).toBe('retail')
    expect(currentWowKnowledgeGame(snapshot('forever'))).toBe('forever')
    expect(currentWowKnowledgeGame(snapshot('classic'))).toBe('classic')
    expect(currentWowKnowledgeGame(snapshot(null))).toBeUndefined()
    expect(currentWowKnowledgeGame({})).toBeUndefined()
  })

  it('does not infer a version from old telemetry or arbitrary content', () => {
    expect(currentWowKnowledgeGame(snapshot('unknown'))).toBeUndefined()
    const contexts = snapshot('retail')
    const current = contexts['wow-companion-player-address']?.[0]
    if (!current)
      throw new Error('Expected a current-player context')
    current.contextId = 'wow-current-player-retail'
    expect(currentWowKnowledgeGame(contexts)).toBeUndefined()
  })
})
