import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'

import { companionError, formatCompanionError } from './wow-companion-errors'

describe('companion error localization', () => {
  it('keeps dynamic paths, ports, and diagnostics while changing language', () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'es',
      messages: {
        es: {
          'companion-errors': {
            'bridge-retry': 'Se reintentará en 30 segundos. {detail}',
            'bridge-port-unavailable': 'El puerto {port} no responde.',
            'gold-read': 'No se pudo leer {path}: {detail}',
          },
        },
        en: {
          'companion-errors': {
            'bridge-retry': 'Retrying in 30 seconds. {detail}',
            'bridge-port-unavailable': 'Port {port} did not respond.',
            'gold-read': 'Cannot read {path}: {detail}',
          },
        },
      },
    })
    const message = companionError('bridge-retry', {
      detail: companionError('bridge-port-unavailable', { port: '18766' }),
    })
    const storage = companionError('gold-read', { path: 'C:\\Players\\金\\ledger.json', detail: 'EACCES' })

    expect(formatCompanionError(message, i18n.global.t)).toBe('Se reintentará en 30 segundos. El puerto 18766 no responde.')
    expect(formatCompanionError(storage, i18n.global.t)).toBe('No se pudo leer C:\\Players\\金\\ledger.json: EACCES')

    i18n.global.locale.value = 'en'

    expect(formatCompanionError(message, i18n.global.t)).toBe('Retrying in 30 seconds. Port 18766 did not respond.')
  })

  it('preserves external diagnostics and rejects malformed application errors', () => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} } })

    expect(formatCompanionError('ECONNREFUSED 127.0.0.1:18765', i18n.global.t)).toBe('ECONNREFUSED 127.0.0.1:18765')
    expect(formatCompanionError('wow-companion-error:invalid', i18n.global.t)).toBe('wow-companion-error:invalid')
    expect(formatCompanionError('wow-companion-error:{"code":"unknown","parameters":{}}', i18n.global.t)).toContain('"code":"unknown"')
    expect(formatCompanionError(null, i18n.global.t)).toBe('')
  })
})
