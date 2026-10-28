import { describe, expect, it } from 'vitest'

import { all, resolveSupportedLocale } from './index'

const supportedLocales = Object.keys(all)

describe('resolveSupportedLocale', () => {
  it.each([
    ['en-NZ', 'en'],
    ['es-CO', 'es'],
    ['es-419', 'es'],
    ['fr-CA', 'fr'],
    ['it-CH', 'it'],
    ['pt-BR', 'pt'],
    ['pt-PT', 'pt'],
    ['pt-AO', 'pt'],
    ['ja-JP', 'ja'],
    ['ko-KR', 'ko'],
    [' zh_hant_HK ', 'zh-Hant'],
    ['ZH-hANS-sg', 'zh-Hans'],
    ['zh-MO', 'zh-Hant'],
    ['zh-SG', 'zh-Hans'],
    ['zh', 'zh-Hans'],
  ])('resolves %s to %s', (locale, expected) => {
    expect(resolveSupportedLocale(locale, supportedLocales)).toBe(expected)
  })

  it.each([undefined, null, '', 'unknown', 'de-DE'])('uses English for an unavailable locale %s', (locale) => {
    expect(resolveSupportedLocale(locale, supportedLocales)).toBe('en')
  })

  it('resolves the configured fallback through the same language rules', () => {
    expect(resolveSupportedLocale('de-DE', supportedLocales, 'pt-BR')).toBe('pt')
  })

  it('returns an available locale when the configured fallback is unavailable', () => {
    expect(resolveSupportedLocale('de-DE', ['fr'], 'unknown')).toBe('fr')
  })

  it('prefers an exact available regional locale', () => {
    expect(resolveSupportedLocale('es-MX', ['en', 'es', 'es-MX'])).toBe('es-MX')
  })

  it('rejects an empty catalog', () => {
    expect(() => resolveSupportedLocale('en', [])).toThrow('At least one supported locale is required')
  })
})
