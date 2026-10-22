import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { CompanionState } from '../../../shared/wow-companion'

import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'
import { parse } from 'valibot'

import { wowCompanionDemo, wowCompanionGet, wowCompanionSetAccountName, wowCompanionSetCapture, wowCompanionSetSettings } from '../../../shared/eventa/wow-companion'
import { captureSchema, defaultSettings, demoSchema, settingsSchema } from '../../../shared/wow-companion'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { createConfig } from '../../libs/electron/persistence'
import { CompanionBridgeClient } from './wow-companion-client'
import { CompanionGoldLedger } from './wow-companion-gold'

/**
 * Owns the HTTP poller for the desktop lifetime, including when settings close.
 * Only the fixed loopback decoder is reachable through these IPC handlers.
 */
export function setupWowCompanion(context: ReturnType<typeof createContext>['context']) {
  const config = createConfig('wow-companion', 'v1.json', settingsSchema, { default: defaultSettings, autoHeal: true })
  config.setup()
  let settings = config.get() ?? defaultSettings
  const client = new CompanionBridgeClient()
  const gold = new CompanionGoldLedger(join(app.getPath('userData'), 'wow-companion-gold-v1.json'))
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function read(): CompanionState {
    return { settings: structuredClone(settings), ...client.read(), gold: gold.read() }
  }

  async function poll() {
    await gold.load()
    if (settings.enabled)
      await client.refresh()
    if (!stopped) {
      const state = client.read()
      await gold.observe(settings.enabled ? state.bridge : null, state.error)
      if (!stopped)
        timer = setTimeout(poll, 750)
    }
  }

  const disposers = [
    defineInvokeHandler(context, wowCompanionGet, read),
    defineInvokeHandler(context, wowCompanionSetAccountName, async (input) => {
      await gold.setAccountName(input)
      return read()
    }),
    defineInvokeHandler(context, wowCompanionSetSettings, (input) => {
      const next = parse(settingsSchema, input)
      if (next.enabled !== settings.enabled)
        client.invalidate()
      settings = next
      config.update(next)
      return read()
    }),
    defineInvokeHandler(context, wowCompanionSetCapture, async (input) => {
      await client.update('/api/config', parse(captureSchema, input))
      return read()
    }),
    defineInvokeHandler(context, wowCompanionDemo, async (input) => {
      const demo = parse(demoSchema, input)
      await client.update('/api/demo', {
        enabled: demo.enabled,
        ...(demo.action === 'none' ? {} : { action: demo.action }),
      })
      return read()
    }),
  ]

  void poll()
  onAppBeforeQuit(async () => {
    stopped = true
    client.dispose()
    clearTimeout(timer)
    disposers.forEach(dispose => dispose())
    await gold.flush()
  })
}
