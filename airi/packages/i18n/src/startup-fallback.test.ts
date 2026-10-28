import { describe, expect, it } from 'vitest'

import { serializeStartupFallbackLocales } from './startup-fallback'

describe('serializeStartupFallbackLocales', () => {
  it('uses local labels and fills missing labels from English', () => {
    const serialized = serializeStartupFallbackLocales({
      'en': {
        'companion-ui': { app: { name: 'WoW Companion' } },
        'stage': { startup: { failed: 'Could not start.', retry: 'Retry' } },
      },
      'fr': {
        'companion-ui': { app: { name: 'Compagnon WoW' } },
        'stage': { startup: { failed: 'Impossible de démarrer.' } },
        'settings': { dialogs: { onboarding: { retry: 'Réessayer' } } },
      },
      'zh-Hant': {},
    }, { 'fr-CA': 'fr', 'zh-TW': 'zh-Hant' })

    expect(JSON.parse(serialized)).toEqual({
      labels: {
        'en': { name: 'WoW Companion', failed: 'Could not start.', retry: 'Retry' },
        'fr': { name: 'Compagnon WoW', failed: 'Impossible de démarrer.', retry: 'Réessayer' },
        'zh-Hant': { name: 'WoW Companion', failed: 'Could not start.', retry: 'Retry' },
      },
      localeRemap: { 'fr-ca': 'fr', 'zh-tw': 'zh-Hant' },
      availableLocales: { 'en': 'en', 'fr': 'fr', 'zh-hant': 'zh-Hant' },
    })
  })

  it('escapes markup before embedding labels in an HTML script', () => {
    const serialized = serializeStartupFallbackLocales({
      en: {
        'companion-ui': { app: { name: '</script>WoW Companion' } },
        'stage': { startup: { failed: 'Could not start.', retry: 'Retry' } },
      },
    }, {})

    expect(serialized).not.toContain('<')
    expect(serialized).toContain('\\u003c/script>')
  })

  it('requires English error labels', () => {
    expect(() => serializeStartupFallbackLocales({}, {})).toThrow('English startup error labels are required')
  })

  it('requires the English application name', () => {
    expect(() => serializeStartupFallbackLocales({
      en: { stage: { startup: { failed: 'Could not start.', retry: 'Retry' } } },
    }, {})).toThrow('The English application name is required')
  })
})
