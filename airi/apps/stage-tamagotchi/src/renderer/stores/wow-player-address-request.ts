/** A direct user request changes the saved address mode, independently of the current character. */
export type PlayerAddressRequest = { mode: 'character' } | { mode: 'custom', name: string }

/**
 * Keeps a display name on one line with at most 40 Unicode code points.
 * Emoji joiners remain valid. Control and directional formatting characters do not.
 *
 * @example
 * normalizePlayerAddressName('  星辰 ☕  ')
 * // => '星辰 ☕'
 */
export function normalizePlayerAddressName(name: string): string | undefined {
  if (/[\p{Cc}\p{Zl}\p{Zp}\u200E\u200F\u202A-\u202E\u2066-\u2069]/u.test(name))
    return undefined
  const normalized = name.trim()
  if (!normalized || Array.from(normalized).length > 40)
    return undefined
  return normalized
}

/**
 * Recognizes complete address commands from the current user turn.
 * Quoted examples, questions, and compound requests leave the saved preference unchanged.
 *
 * @example
 * parsePlayerAddressRequest('以后请叫我“拿铁”。')
 * // => { mode: 'custom', name: '拿铁' }
 */
export function parsePlayerAddressRequest(text: string): PlayerAddressRequest | undefined {
  if (/[\p{Cc}\p{Zl}\p{Zp}？?]/u.test(text))
    return undefined
  const request = text.trim().replace(/[。.!！]+$/u, '').trim()
  const chinesePrefix = /^(?:你\s*)?(?:(?:以后|今后|从现在开始)\s*[，,]?\s*)?(?:请\s*)?(?:就\s*)?/u
  const command = request.replace(chinesePrefix, '')
  const characterName = /^(?:当前(?:登录)?的?|游戏)?角色的?名字?$/u

  const reset = command.match(/^(?:使用|用)(.+?)来?(?:称呼我|喊我|叫我)$/u)
  if (reset && characterName.test(reset[1].trim()))
    return { mode: 'character' }

  const custom = command.match(/^(?:称呼我|喊我|叫我)(.+)$/u)
    ?? request.match(/^(?:from now on[,\s]+)?(?:please\s+)?call me\s+(\S.*)$/iu)
  if (!custom)
    return undefined
  const value = custom[1].trim().replace(/^[：:]/u, '').trim()
  if (characterName.test(value))
    return { mode: 'character' }

  // Explicit name quotes distinguish a chosen phrase from extra conversational instructions.
  const quotes: Record<string, string> = { '"': '"', '\'': '\'', '“': '”', '‘': '’', '「': '」', '『': '』' }
  const closeQuote = quotes[value.charAt(0)]
  let candidate = value
  if (closeQuote) {
    const quoteEnd = value.indexOf(closeQuote, 1)
    if (quoteEnd < 0)
      return undefined
    candidate = value.slice(1, quoteEnd)
    const suffix = value.slice(quoteEnd + 1).trim()
    if (suffix && !/^(?:就好了?|就行了?|吧)$/u.test(suffix))
      return undefined
  }
  else if (/[，,。.!！;；:：“”‘’「」『』"`]/u.test(value)
    || /(?:[吗么嘛呢]|什么|为什么|好不好|行不行|可不可以|可以不可以)$/u.test(value)
    || /然后|并且|顺便|接着|但是|不过|帮我|告诉我|不要|别再|什么意思|的意思|是什么|怎么|是不是|能不能|会不会/u.test(value)
    || /^(?:about|when|whenever|once|if|at|on|back|later|tomorrow|tonight|today|in|after|before|to)\b/iu.test(value)) {
    return undefined
  }

  const name = normalizePlayerAddressName(candidate)
  return name ? { mode: 'custom', name } : undefined
}
