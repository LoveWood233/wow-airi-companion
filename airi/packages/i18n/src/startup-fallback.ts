interface StartupFallbackMessages {
  'companion-ui'?: { app?: { name?: string } }
  'stage'?: { startup?: { failed?: string, retry?: string } }
  'settings'?: { dialogs?: { onboarding?: { retry?: string } } }
}

/** Serializes boot error labels for the inline splash that runs before Vue. */
export function serializeStartupFallbackLocales(locales: Record<string, StartupFallbackMessages>, localeRemap: Record<string, string>): string {
  const english = locales.en?.stage?.startup
  if (!english?.failed || !english.retry)
    throw new Error('English startup error labels are required')

  const englishName = locales.en?.['companion-ui']?.app?.name
  if (!englishName)
    throw new Error('The English application name is required')

  const labels = Object.fromEntries(Object.entries(locales).map(([locale, messages]) => [locale, {
    name: messages['companion-ui']?.app?.name ?? englishName,
    failed: messages.stage?.startup?.failed ?? english.failed,
    retry: messages.stage?.startup?.retry ?? messages.settings?.dialogs?.onboarding?.retry ?? english.retry,
  }]))

  const normalizedRemap = Object.fromEntries(Object.entries(localeRemap).map(([locale, target]) => [locale.toLowerCase(), target]))
  const availableLocales = Object.fromEntries(Object.keys(locales).map(locale => [locale.toLowerCase(), locale]))

  return JSON.stringify({ labels, localeRemap: normalizedRemap, availableLocales }).replaceAll('<', '\\u003c')
}
