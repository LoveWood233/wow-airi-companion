import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { CompanionState } from '../../../shared/wow-companion'

import process from 'node:process'

import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { app } from 'electron'
import { parse } from 'valibot'

import { wowCompanionDemo, wowCompanionGet, wowCompanionSetAccountName, wowCompanionSetCapture, wowCompanionSetSettings } from '../../../shared/eventa/wow-companion'
import { captureSchema, defaultSettings, demoSchema, settingsSchema } from '../../../shared/wow-companion'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { createConfig } from '../../libs/electron/persistence'
import { CompanionBridgeClient } from './wow-companion-client'
import { CompanionGoldLedger } from './wow-companion-gold'
import { CompanionBridgeRuntime } from './wow-companion-runtime'

/**
 * Owns the HTTP poller for the desktop lifetime, including when settings close.
 * Only the fixed loopback decoder is reachable through these IPC handlers.
 */
export function setupWowCompanion(context: ReturnType<typeof createContext>['context']) {
  const config = createConfig('wow-companion', 'v1.json', settingsSchema, { default: defaultSettings, autoHeal: true })
  config.setup()
  let settings = config.get() ?? defaultSettings
  const client = new CompanionBridgeClient()
  const runtime = new CompanionBridgeRuntime({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
    platform: process.platform,
  })
  const gold = new CompanionGoldLedger(join(app.getPath('userData'), 'wow-companion-gold-v1.json'))
  let stopped = false
  let generation = 0
  let connectionError: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  function read(): CompanionState {
    const state = client.read()
    return {
      settings: structuredClone(settings),
      ...state,
      error: settings.enabled ? connectionError ?? runtime.read().error ?? state.error : null,
      gold: gold.read(),
    }
  }

  async function poll() {
    await gold.load()
    const currentGeneration = generation
    if (settings.enabled && !stopped) {
      try {
        await runtime.ensureReady()
        // Disabling or quitting can finish while the helper is starting.
        if (!stopped && settings.enabled && currentGeneration === generation) {
          connectionError = null
          await client.refresh()
        }
      }
      catch (error) {
        if (!stopped && settings.enabled && currentGeneration === generation) {
          connectionError = errorMessageFrom(error) ?? 'WoW bridge failed to start'
          client.invalidate()
        }
      }
    }
    if (!stopped) {
      const state = client.read()
      await gold.observe(settings.enabled && !connectionError ? state.bridge : null, connectionError ?? state.error)
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
    defineInvokeHandler(context, wowCompanionSetSettings, async (input) => {
      const next = parse(settingsSchema, input)
      if (next.enabled !== settings.enabled) {
        generation++
        connectionError = null
        client.invalidate()
      }
      settings = next
      config.update(next)
      if (!next.enabled)
        await runtime.stop()
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
    generation++
    client.dispose()
    clearTimeout(timer)
    disposers.forEach(dispose => dispose())
    await Promise.all([gold.flush(), runtime.dispose()])
  })
}
