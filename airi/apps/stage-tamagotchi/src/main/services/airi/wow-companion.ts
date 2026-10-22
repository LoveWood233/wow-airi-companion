import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { CompanionState } from '../../../shared/wow-companion'

import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'
import { parse } from 'valibot'

import { wowCompanionDemo, wowCompanionGet, wowCompanionSetCapture, wowCompanionSetSettings } from '../../../shared/eventa/wow-companion'
import { captureSchema, defaultSettings, demoSchema, settingsSchema } from '../../../shared/wow-companion'
import { createConfig } from '../../libs/electron/persistence'
import { CompanionBridgeClient } from './wow-companion-client'

/**
 * Owns the HTTP poller for the desktop lifetime, including when settings close.
 * Only the fixed loopback decoder is reachable through these IPC handlers.
 */
export function setupWowCompanion(context: ReturnType<typeof createContext>['context']) {
  const config = createConfig('wow-companion', 'v1.json', settingsSchema, { default: defaultSettings, autoHeal: true })
  config.setup()
  let settings = config.get() ?? defaultSettings
  const client = new CompanionBridgeClient()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function read(): CompanionState {
    return { settings: structuredClone(settings), ...client.read() }
  }

  async function poll() {
    if (settings.enabled)
      await client.refresh()
    if (!stopped)
      timer = setTimeout(poll, 750)
  }

  const disposers = [
    defineInvokeHandler(context, wowCompanionGet, read),
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
  app.once('before-quit', () => {
    stopped = true
    client.dispose()
    clearTimeout(timer)
    disposers.forEach(dispose => dispose())
  })
}
