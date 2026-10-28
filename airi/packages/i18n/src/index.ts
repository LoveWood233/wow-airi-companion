export const all = {
  'en': 'English',
  'es': 'Español',
  'fr': 'Français',
  'it': 'Italiano',
  'ja': '日本語',
  'ko': '한국어',
  'pt': 'Português',
  'ru': 'Русский',
  'th': 'ไทย',
  'vi': 'Tiếng Việt',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
}

export const localeRemap: Record<string, string> = {
  'zh': 'zh-Hans',
  'zh-CN': 'zh-Hans',
  'zh-SG': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'zh-HK': 'zh-Hant',
  'zh-MO': 'zh-Hant',
  'zh-Hant': 'zh-Hant',
  'zh-Hans': 'zh-Hans',
  'en': 'en',
  'en-US': 'en',
  'en-GB': 'en',
  'en-AU': 'en',
  'es': 'es',
  'es-ES': 'es',
  'es-MX': 'es',
  'es-AR': 'es',
  'es-419': 'es',
  'fr': 'fr',
  'fr-FR': 'fr',
  'fr-CA': 'fr',
  'it': 'it',
  'it-IT': 'it',
  'it-CH': 'it',
  'ja': 'ja',
  'ja-JP': 'ja',
  'ko': 'ko',
  'ko-KR': 'ko',
  'pt': 'pt',
  'pt-BR': 'pt',
  'pt-PT': 'pt',
  'ru': 'ru',
  'ru-RU': 'ru',
  'th': 'th',
  'th-TH': 'th',
  'vi': 'vi',
  'vi-VN': 'vi',
}

const normalizedLocaleRemap = Object.fromEntries(Object.entries(localeRemap).map(([locale, target]) => [locale.toLowerCase(), target]))

/**
 * Matches language tags from operating systems, browsers, and saved settings to an available catalog.
 * Exact catalogs take precedence over aliases, scripts, and base languages.
 *
 * @example
 * resolveSupportedLocale('pt-BR', ['en', 'pt'])
 * // => 'pt'
 */
export function resolveSupportedLocale(
  locale: string | null | undefined,
  supportedLocales: readonly string[],
  fallbackLocale = 'en',
): string {
  function findLocale(value: string | null | undefined): string | undefined {
    const normalizedLocale = value?.trim().replaceAll('_', '-').toLowerCase()
    if (!normalizedLocale)
      return undefined

    const exactLocale = supportedLocales.find(supported => supported.toLowerCase() === normalizedLocale)
    if (exactLocale)
      return exactLocale

    const [language, ...subtags] = normalizedLocale.split('-')
    let mappedLocale = normalizedLocaleRemap[normalizedLocale]

    if (!mappedLocale && language === 'zh') {
      if (subtags.includes('hans'))
        mappedLocale = 'zh-Hans'
      else if (subtags.includes('hant') || subtags.some(subtag => ['tw', 'hk', 'mo'].includes(subtag)))
        mappedLocale = 'zh-Hant'
      else
        mappedLocale = 'zh-Hans'
    }

    mappedLocale ??= normalizedLocaleRemap[language] ?? language

    return supportedLocales.find(supported => supported.toLowerCase() === mappedLocale.toLowerCase())
  }

  const preferredLocale = findLocale(locale)
  if (preferredLocale)
    return preferredLocale

  const configuredFallback = findLocale(fallbackLocale)
  if (configuredFallback)
    return configuredFallback

  // English contains every message. A catalog without English still needs an available locale.
  const availableFallback = findLocale('en') ?? supportedLocales[0]
  if (availableFallback)
    return availableFallback

  throw new Error('At least one supported locale is required')
}

export { createFallbackOptions } from './fallback'
export { serializeStartupFallbackLocales } from './startup-fallback'
