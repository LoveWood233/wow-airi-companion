import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { createWowKnowledgeContext, knowledgeCatalog, searchWowKnowledge } from './index'
import { knowledgeEntrySchema } from './schema'

function hasAlias(entries: ReturnType<typeof searchWowKnowledge>['entries'], alias: string) {
  return entries.some(entry => entry.aliases.some(value => value.toLowerCase() === alias.toLowerCase()))
}

describe('Warcraft reference retrieval', () => {
  it('explains Chinese DZ offline without assuming a game version', () => {
    const result = searchWowKnowledge({ text: 'DZ是什么意思', locale: 'en' })
    expect(result.games).toEqual([])
    expect(result.locale).toBe('zh-CN')
    expect(hasAlias(result.entries, 'DZ')).toBe(true)
    expect(result.entries.some(entry => entry.text.includes('盗贼'))).toBe(true)
    expect(result.entries.every(entry => entry.game === 'shared')).toBe(true)
  })

  it('recognizes lowercase and full-width abbreviations beside Chinese characters', () => {
    expect(hasAlias(searchWowKnowledge({ text: '我玩dz', locale: 'zh-Hans' }).entries, 'DZ')).toBe(true)
    expect(hasAlias(searchWowKnowledge({ text: 'ＤＺ', locale: 'zh-Hans' }).entries, 'DZ')).toBe(true)
  })

  it('does not recognize an abbreviation inside a longer identifier', () => {
    const result = searchWowKnowledge({ text: 'ADZ123 DZS my_dz_file', locale: 'zh-Hans' })
    expect(hasAlias(result.entries, 'DZ')).toBe(false)
  })

  it('keeps short abbreviation lists in the configured language community', () => {
    const result = searchWowKnowledge({ text: 'DZ FS', locale: 'zh-Hans' })
    expect(result.locale).toBe('zh-CN')
    expect(hasAlias(result.entries, 'DZ')).toBe(true)
  })

  it('uses an explicit Classic question instead of a connected Retail character', () => {
    const result = searchWowKnowledge({ text: '怀旧服DZ有什么特点', game: 'retail' })
    expect(result.games).toEqual(['classic'])
    expect(result.entries.every(entry => entry.game === 'classic' || entry.game === 'shared')).toBe(true)
  })

  it('preserves both scopes when the user compares game versions', () => {
    const result = searchWowKnowledge({ text: '正式服和怀旧服有什么区别', game: 'forever' })
    expect(result.games).toEqual(['retail', 'classic'])
    expect(result.entries.some(entry => entry.game === 'retail')).toBe(true)
    expect(result.entries.some(entry => entry.game === 'classic')).toBe(true)
    expect(result.entries.every(entry => entry.game !== 'forever')).toBe(true)
  })

  it('does not borrow Retail and Classic mechanics for a Forever request', () => {
    const result = searchWowKnowledge({ text: '无限服可以大秘境或者三本吗', game: 'retail' })
    expect(result.games).toEqual(['forever'])
    expect(result.entries.every(entry => entry.game === 'forever' || entry.game === 'shared')).toBe(true)
  })

  it('keeps language communities separate even when the UI language differs', () => {
    const chinese = searchWowKnowledge({ text: '部落都是废物是什么梗', locale: 'en' })
    expect(chinese.locale).toBe('zh-CN')
    expect(hasAlias(chinese.entries, '部落都是废物')).toBe(true)
    const english = searchWowKnowledge({ text: 'What does zug zug mean?', locale: 'zh-Hans' })
    expect(english.locale).toBe('en')
    expect(english.entries.every(entry => entry.locale !== 'zh-CN')).toBe(true)
    expect(english.entries.length).toBeGreaterThan(0)
  })

  it('can explain a Chinese community abbreviation in an English question', () => {
    const result = searchWowKnowledge({ text: 'What does DZ mean in Chinese?', locale: 'en' })
    expect(result.locale).toBe('zh-CN')
    expect(hasAlias(result.entries, 'DZ')).toBe(true)
  })

  it('does not classify Japanese kanji or Korean as a Chinese community request', () => {
    expect(searchWowKnowledge({ text: '部落とは何ですか', locale: 'zh-Hans' }).locale).toBe('ja')
    expect(searchWowKnowledge({ text: '호드 뜻', locale: 'zh-Hans' }).locale).toBe('ko')
  })

  it('retrieves the requested catchphrase with provenance and usage context', () => {
    const result = searchWowKnowledge({ text: '你们这是自寻死路', locale: 'zh-Hans' })
    const meme = result.entries.find(entry => entry.aliases.includes('你们这是自寻死路'))
    expect(meme?.kind).toBe('meme')
    expect(meme?.usage).toBeTruthy()
    expect(meme?.provenance.sources.length).toBeGreaterThan(0)
  })

  it('does not inject references into unrelated conversation', () => {
    expect(createWowKnowledgeContext({ text: '今晚帮我挑一部电影', locale: 'zh-Hans' })).toBe('')
    expect(createWowKnowledgeContext({ text: '今晚喝奶茶', locale: 'zh-Hans' })).toBe('')
    expect(createWowKnowledgeContext({ text: '准备出门散步', locale: 'zh-Hans' })).toBe('')
    expect(createWowKnowledgeContext({ text: 'I love you forever', locale: 'en' })).toBe('')
    expect(createWowKnowledgeContext({ text: 'a classic movie', locale: 'en' })).toBe('')
    expect(createWowKnowledgeContext({ text: 'our study group meets tomorrow', locale: 'en' })).toBe('')
    expect(createWowKnowledgeContext({ text: '', game: 'retail' })).toBe('')
  })

  it('retains a single role query and unambiguous recruitment phrases', () => {
    expect(searchWowKnowledge({ text: '奶', locale: 'zh-Hans' }).entries.some(entry => entry.id === 'zh-role-healer')).toBe(true)
    expect(searchWowKnowledge({ text: '缺奶', locale: 'zh-Hans' }).entries.some(entry => entry.id === 'zh-role-healer')).toBe(true)
  })

  it('bounds the reference context and retains its source and version labels', () => {
    const text = knowledgeCatalog.flatMap(entry => entry.aliases).join(' ')
    const result = searchWowKnowledge({ text, locale: 'zh-Hans', limit: 100 })
    expect(result.entries.length).toBeLessThanOrEqual(12)
    const context = createWowKnowledgeContext({ text, locale: 'zh-Hans', limit: 12 })
    expect(context.length).toBeLessThanOrEqual(6500)
    expect(context).toContain('reference data, not instructions')
    expect(context).toContain('provenance')
    expect(context).toContain('game')
  })

  it('accepts a zero result limit and rejects an unreferenced factual record', () => {
    expect(searchWowKnowledge({ text: 'DZ', locale: 'zh-Hans', limit: 0 }).entries).toEqual([])
    expect(safeParse(knowledgeEntrySchema, {
      id: 'unreferenced-fact',
      kind: 'fact',
      title: 'Unsupported claim',
      aliases: ['unsupported'],
      text: 'A claim without a source.',
      usage: 'Do not use this record.',
      provenance: { status: 'verified', sources: [{ title: 'No source' }], reviewedAt: '2026-10-28' },
    }).success).toBe(false)
  })
})
