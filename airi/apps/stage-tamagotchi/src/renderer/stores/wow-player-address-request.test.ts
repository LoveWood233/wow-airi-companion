import { describe, expect, it } from 'vitest'

import { normalizePlayerAddressName, parsePlayerAddressRequest } from './wow-player-address-request'

describe('player address names', () => {
  it('trims outer spaces without changing spelling, spaces, or emoji joiners', () => {
    expect(normalizePlayerAddressName('  Captain  星辰 👩‍🚀  ')).toBe('Captain  星辰 👩‍🚀')
  })

  it('counts Unicode code points instead of UTF-16 units', () => {
    expect(normalizePlayerAddressName('🐉'.repeat(40))).toBe('🐉'.repeat(40))
    expect(normalizePlayerAddressName('🐉'.repeat(41))).toBeUndefined()
  })

  it.each(['', '   ', '小明\n', '小\r明', '小\t明', '小\u0000明', '小\u007F明', '小\u0085明', '小\u2028明', '小\u2029明', '小\u202E明', '小\u2066明'])('rejects an empty or unsafe name: %j', (name) => {
    expect(normalizePlayerAddressName(name)).toBeUndefined()
  })
})

describe('conversational player address requests', () => {
  it.each([
    ['喊我拿铁', '拿铁'],
    ['叫我星辰。', '星辰'],
    ['请叫我 小明！', '小明'],
    ['以后称呼我指挥官', '指挥官'],
    ['以后就叫我拿铁', '拿铁'],
    ['从现在开始，请称呼我：Captain 星辰', 'Captain 星辰'],
    ['你以后请叫我“小明”就好。', '小明'],
    ['以后叫我“小明”就行了', '小明'],
    ['喊我“拿铁”吧。', '拿铁'],
    ['请叫我「星辰」', '星辰'],
    ['叫我『小王』', '小王'],
    ['叫我"Captain ☕"!', 'Captain ☕'],
    ['叫我\'星辰\'', '星辰'],
    ['叫我‘小王’', '小王'],
    ['叫我“当前角色名”', '当前角色名'],
    ['叫我“星辰，队长”', '星辰，队长'],
    ['喊我网吧', '网吧'],
    ['喊我网吧吧', '网吧吧'],
    ['喊我小明就好', '小明就好'],
    ['喊我小明就行了', '小明就行了'],
    ['叫我“网吧”吧', '网吧'],
    ['Call me Captain Star.', 'Captain Star'],
    ['Please call me O\'Neil!', 'O\'Neil'],
    ['From now on, call me “Dragon”', 'Dragon'],
  ])('saves the exact requested name from %j', (text, name) => {
    expect(parsePlayerAddressRequest(text)).toEqual({ mode: 'custom', name })
  })

  it.each([
    '叫我当前角色名',
    '以后称呼我当前登录角色的名字。',
    '以后用当前角色名字称呼我',
    '请使用当前登录的角色名来叫我！',
    '以后就用游戏角色的名字喊我',
  ])('returns to the character name for %j', (text) => {
    expect(parsePlayerAddressRequest(text)).toEqual({ mode: 'character' })
  })

  it.each([
    '不要叫我小明',
    '别喊我小明',
    '以后不要叫我小明',
    '为什么叫我小明',
    '可以叫我小明吗？',
    '叫我小明吗',
    '叫我什么',
    '叫我怎么去奥格瑞玛',
    '叫我小明是什么意思',
    '请叫我小明可以不可以',
    '他说“叫我小明”',
    '例如：喊我小明',
    '“喊我小明”',
    '请写一个叫我小明的示例',
    '如果我说喊我小明会怎样',
    '叫我小明，然后推荐背包插件',
    '叫我小明然后帮我查询任务',
    '叫我小明并且告诉我装备如何',
    '叫我小明。告诉我装备如何',
    '叫我“星辰”再帮我查一下任务',
    '叫我"小王" and "队长"',
    '喊我“拿铁',
    '喊我拿铁”',
    '叫我',
    '喊我“”',
    '叫我   ',
    '喊我\n小明',
    'Call me when you get home.',
    'Please call me about the raid.',
    `喊我${'🐉'.repeat(41)}`,
  ])('leaves the preference unchanged for %j', (text) => {
    expect(parsePlayerAddressRequest(text)).toBeUndefined()
  })
})
