import stories from './wow-forever-region-stories.json'

const aliases: Readonly<Record<string, readonly string[]>> = {
  荆棘谷: ['荊棘谷', 'Stranglethorn Vale', 'Stranglethorn', 'STV', '藏宝海湾', '藏寶海灣', 'Booty Bay'],
  祖尔格拉布: ['祖爾格拉布', 'Zul\'Gurub', 'Zul Gurub', 'Zul-Gurub', 'Zulgurub'],
  艾尔文森林: ['Elwynn Forest'],
  暮色森林: ['Duskwood'],
  西部荒野: ['Westfall'],
  灰谷: ['Ashenvale'],
  暴风城: ['Stormwind City', 'Stormwind'],
  奥格瑞玛: ['Orgrimmar'],
  铁炉堡: ['Ironforge'],
  幽暗城: ['Undercity'],
  死亡矿井: ['The Deadmines', 'Deadmines'],
  沉没的神庙: ['沉没神庙', 'Sunken Temple', 'Temple of Atal\'Hakkar'],
  黑石深渊: ['Blackrock Depths'],
  厄运之槌: ['厄运之锤', 'Dire Maul'],
  斯坦索姆: ['Stratholme'],
  熔火之心: ['Molten Core'],
  黑翼之巢: ['Blackwing Lair'],
  纳克萨玛斯: ['Naxxramas', 'Naxx'],
}

const loreRequest = /背景|[来來][历歷]|由[来來]|[历歷]史|典故|趣[闻聞事]|[轶軼]事|故事|[传傳][说說]|[剧劇]情|\b(?:lore|backstory|history|anecdotes?|stories?|legend)\b/iu
const overviewRequest = /介[绍紹]|讲讲|講講|聊聊|说说|說說|[了瞭]解|\b(?:overview|introduce|tell me about)\b/iu
const unrelatedRequest = /怎么[去走到接打]|如何(?:[去接打]|前往|到达)|路线|攻略|在哪里|在哪儿|几点|任务|装备|副本入口|\b(?:directions|route|quests?|gear|location|how to (?:find|get|reach|travel))\b/iu
const correctionCue = /^(?:那?算了|还是|改成|换成|改讲|换讲)/u

/**
 * Matches typographic punctuation and display-name casing from chat.
 *
 * @example
 * normalizeLocationName('Zul’Gurub')
 * // => "zul'gurub"
 */
function normalizeLocationName(text: string) {
  return text.normalize('NFKC').replace(/[‘’]/gu, '\'').toLowerCase()
}

const catalogByName = new Map(stories.flatMap(story =>
  [story.name, ...(aliases[story.name] ?? [])].map(name => [normalizeLocationName(name), story] as const),
))
const locationPattern = new RegExp(
  [...catalogByName.keys()]
    .sort((first, second) => second.length - first.length)
    .map((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return /^[a-z]/u.test(name) ? `\\b${escaped}\\b` : escaped
    })
    .join('|'),
  'gu',
)

type LocationStory = typeof stories[number]

function requestedPlaces(text: string): LocationStory[] {
  const finalSentence = text.split(/[。.!?！？;；\n]/u).at(-1) ?? text
  const clauses = finalSentence.split(/[,，、]/u)
  const lastClause = clauses.at(-1)?.trim() ?? ''
  const previousClause = clauses.at(-2)?.trim() ?? ''
  const correction = correctionCue.exec(lastClause)
  const previousCue = correctionCue.exec(previousClause)
  const corrected = correction
    ? lastClause.slice(correction[0].length).replace(/^[:：\s]+/u, '')
    : previousCue?.[0] === previousClause ? lastClause : undefined
  const focus = corrected?.replace(/^[讲講说說聊](?![讲講说說聊])\s*/u, '') ?? text
  const lore = loreRequest.test(focus)
  if (!lore && unrelatedRequest.test(text))
    return []

  const shortName = /[呢吧]$/u.test(focus) ? focus.slice(0, -1).replace(/^那(?:就|么)?[,，、:：\s]*/u, '').trim() : ''
  const exact = catalogByName.get(focus) ?? catalogByName.get(shortName)
  if (exact)
    return [exact]
  if (!lore && !overviewRequest.test(focus))
    return []

  const places = new Set<LocationStory>()
  for (const [name] of focus.matchAll(locationPattern)) {
    const story = catalogByName.get(name)
    if (story)
      places.add(story)
    if (places.size === 3)
      break
  }
  return [...places]
}

/** Supplies location background from the local catalog without a connected character. */
export function foreverStoryRequestContext(text: string): string | undefined {
  const request = normalizeLocationName(text).trim().replace(/[。.!?！？,，、;；\s]+$/u, '')
  const places = requestedPlaces(request)
  if (!places.length)
    return undefined

  const evidence = places.map(({ name, background, anecdote }) => ({ name, background, anecdote }))
  return [
    'The companion has the following curated World of Warcraft Infinite location lore for this request.',
    'Tell the requested location’s background and anecdotes directly in the user’s language. Preserve the supplied historical version qualifiers and keep the story within the supplied facts.',
    'Leave citations, source names, URLs, and page or map IDs out of the introduction, even if they appeared earlier in the conversation. Keep player status, current whereabouts, level, equipment, and saved snapshots out of the story.',
    JSON.stringify(evidence),
  ].join('\n')
}
