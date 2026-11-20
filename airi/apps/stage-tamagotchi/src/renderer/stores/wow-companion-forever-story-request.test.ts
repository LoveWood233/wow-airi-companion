import { describe, expect, it } from 'vitest'

import { foreverStoryRequestContext } from './wow-companion-forever-story-request'

describe('manual location lore', () => {
  it.each([
    '给我介绍点荆棘谷的背景故事',
    '介绍一下荆棘谷',
    '想听荊棘谷的趣聞',
    'Tell me about Stranglethorn Vale.',
    'Tell me the history of STV.',
    '讲讲藏宝海湾有什么趣闻',
  ])('supplies verified Stranglethorn evidence for %s', (text) => {
    const context = foreverStoryRequestContext(text)
    expect(context).toContain('古拉巴什巨魔遗迹')
    expect(context).toContain('藏宝海湾的钓鱼大赛')
  })

  it('limits the introduction to the story and excludes source details from its facts', () => {
    const context = foreverStoryRequestContext('那灰谷呢？')
    expect(context).toContain('Leave citations, source names, URLs, and page or map IDs out of the introduction')
    expect(context).toContain('Keep player status, current whereabouts, level, equipment, and saved snapshots out of the story.')
    expect(context).not.toMatch(/https?:|wuxianwow|atlas\/1440|databaseSource|supportingSources/iu)
    expect(JSON.parse(context?.split('\n').at(-1) ?? 'null')).toEqual([{
      name: '灰谷',
      background: expect.stringContaining('暗夜精灵的古林'),
      anecdote: expect.any(String),
    }])
  })

  it('finds more than one requested location, including an instance', () => {
    const context = foreverStoryRequestContext('聊聊暴风城和 Zul’Gurub 的背景故事')
    expect(context).toContain('"name":"暴风城"')
    expect(context).toContain('"name":"祖尔格拉布"')
  })

  it('prefers a longer catalog name over an overlapping name', () => {
    const context = foreverStoryRequestContext('介绍纳克萨玛斯（单人剧情记录）的剧情')
    expect(context).toContain('"name":"纳克萨玛斯（单人剧情记录）"')
    expect(context).not.toContain('"name":"纳克萨玛斯"')
  })

  it.each([
    '灰谷。',
    'Ashenvale?',
    '那灰谷呢？',
    '是那什么金鸡谷。 金鸡谷。 那算了，灰谷。',
    '荆棘谷。算了，灰谷。',
    '讲讲荆棘谷的历史。还是讲灰谷。',
    '讲讲荆棘谷的历史。还是讲灰谷的历史。',
  ])('supplies the last chosen location for %s', (text) => {
    const context = foreverStoryRequestContext(text)
    expect(context).toContain('"name":"灰谷"')
    expect(context).toContain('暗夜精灵的古林')
    expect(context).not.toContain('"name":"荆棘谷"')
  })

  it.each([
    '我到了灰谷。',
    '我准备去灰谷。',
    '那灰谷怎么去？',
    '讲讲荆棘谷的背景。算了，金鸡谷。',
    '讲讲荆棘谷的背景。还是介绍灰谷的任务。',
    '荆棘谷怎么去',
    '介绍一下荆棘谷怎么走',
    '介绍一下荆棘谷的任务',
    'Tell me about the route to Stranglethorn Vale.',
    'Tell me about STVtest',
    '给我介绍一下不存在的区域背景故事',
  ])('leaves unrelated or unmatched requests alone for %s', (text) => {
    expect(foreverStoryRequestContext(text)).toBeUndefined()
  })
})
