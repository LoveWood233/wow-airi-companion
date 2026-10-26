import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { CaptureSettings, CompanionSettings, CompanionState, DemoRequest, GameVersion } from '../../../shared/wow-companion'

import process from 'node:process'

import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { app } from 'electron'
import { object, parse } from 'valibot'

import { wowCompanionDemo, wowCompanionGet, wowCompanionSetAccountName, wowCompanionSetCapture, wowCompanionSetSettings } from '../../../shared/eventa/wow-companion'
import { captureSchema, defaultSettings, demoSchema, gameProfiles, gameVersionSchema, settingsSchema } from '../../../shared/wow-companion'
import { accountNameSchema } from '../../../shared/wow-companion-gold'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { createConfig } from '../../libs/electron/persistence'
import { CompanionBridgeClient } from './wow-companion-client'
import { CompanionEquipmentComparisons } from './wow-companion-equipment-comparisons'
import { CompanionEquipmentHistory } from './wow-companion-equipment-history'
import { CompanionGoldLedger } from './wow-companion-gold'
import { CompanionLevelHistory } from './wow-companion-level-history'
import { CompanionLoadouts } from './wow-companion-loadouts'
import { CompanionBridgeRuntime } from './wow-companion-runtime'

const getSchema = object({ game: gameVersionSchema })
const settingsRequestSchema = object({ game: gameVersionSchema, settings: settingsSchema })
const captureRequestSchema = object({ game: gameVersionSchema, capture: captureSchema })
const demoRequestSchema = object({ game: gameVersionSchema, request: demoSchema })
const accountRequestSchema = object({ game: gameVersionSchema, request: accountNameSchema })

/** Each profile owns one poller, lifecycle generation, settings, gold ledger, equipment history, and level history. */
class CompanionProfile {
  private readonly config
  private settings: CompanionSettings
  private readonly client: CompanionBridgeClient
  private readonly runtime: CompanionBridgeRuntime
  readonly gold: CompanionGoldLedger
  private readonly equipmentHistory: CompanionEquipmentHistory
  private readonly levelHistory: CompanionLevelHistory
  private readonly equipmentComparisons: CompanionEquipmentComparisons
  private readonly equipmentLoadouts: CompanionLoadouts
  private stopped = false
  private generation = 0
  private connectionError: string | null = null
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly game: GameVersion) {
    const profile = gameProfiles[game]
    const defaults = { ...defaultSettings, enabled: game === 'retail' }
    this.config = createConfig(profile.settingsNamespace, 'v1.json', settingsSchema, { default: defaults, autoHeal: true })
    this.config.setup()
    this.settings = this.config.get() ?? defaults
    this.client = new CompanionBridgeClient(undefined, game)
    this.runtime = new CompanionBridgeRuntime({
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath('userData'),
      platform: process.platform,
      game,
    })
    this.gold = new CompanionGoldLedger(join(app.getPath('userData'), profile.goldFile))
    this.equipmentHistory = new CompanionEquipmentHistory(join(app.getPath('userData'), profile.historyFile))
    this.levelHistory = new CompanionLevelHistory(join(app.getPath('userData'), profile.levelsFile))
    this.equipmentComparisons = new CompanionEquipmentComparisons(join(app.getPath('userData'), profile.comparisonsFile))
    this.equipmentLoadouts = new CompanionLoadouts(join(app.getPath('userData'), profile.loadoutsFile))
  }

  read(): CompanionState {
    const state = this.client.read()
    return {
      game: this.game,
      settings: structuredClone(this.settings),
      ...state,
      error: this.settings.enabled ? this.connectionError ?? this.runtime.read().error ?? state.error : null,
      gold: this.gold.read(),
      equipmentHistory: this.equipmentHistory.read(),
      levelHistory: this.levelHistory.read(),
      equipmentComparisons: this.equipmentComparisons.read(),
      equipmentLoadouts: this.equipmentLoadouts.read(),
    }
  }

  start() {
    void this.poll()
  }

  async setSettings(next: CompanionSettings) {
    const connectionChanged = next.enabled !== this.settings.enabled
    if (connectionChanged) {
      this.generation++
      this.connectionError = null
      this.client.invalidate()
    }
    this.settings = next
    this.config.update(next)
    if (connectionChanged)
      await this.levelHistory.observe(null)
    if (!next.enabled)
      await this.runtime.stop()
    return this.read()
  }

  async setCapture(capture: CaptureSettings) {
    await this.ensureConnected()
    await this.client.update('/api/config', capture)
    return this.read()
  }

  async demo(request: DemoRequest) {
    await this.ensureConnected()
    await this.client.update('/api/demo', {
      enabled: request.enabled,
      ...(request.action === 'none' ? {} : { action: request.action }),
    })
    return this.read()
  }

  async dispose() {
    this.stopped = true
    this.generation++
    this.client.dispose()
    clearTimeout(this.timer)
    await Promise.all([this.gold.flush(), this.equipmentHistory.flush(), this.levelHistory.flush(), this.equipmentComparisons.flush(), this.equipmentLoadouts.flush(), this.runtime.dispose()])
  }

  private async ensureConnected() {
    const generation = this.generation
    if (!this.settings.enabled || this.stopped)
      throw new Error('Enable the companion connection for this game before capture or demo commands.')
    await this.runtime.ensureReady()
    if (!this.settings.enabled || this.stopped || generation !== this.generation)
      throw new Error('The companion connection changed before the command completed.')
  }

  private async poll() {
    await Promise.all([this.gold.load(), this.equipmentHistory.load(), this.levelHistory.load(), this.equipmentComparisons.load(), this.equipmentLoadouts.load()])
    const generation = this.generation
    if (this.settings.enabled && !this.stopped) {
      try {
        await this.runtime.ensureReady()
        // Disabling or quitting can finish while this profile starts its helper.
        if (!this.stopped && this.settings.enabled && generation === this.generation) {
          this.connectionError = null
          await this.client.refresh()
        }
      }
      catch (error) {
        if (!this.stopped && this.settings.enabled && generation === this.generation) {
          this.connectionError = errorMessageFrom(error) ?? 'WoW bridge failed to start'
          this.client.invalidate()
        }
      }
    }
    if (!this.stopped) {
      const state = this.client.read()
      const bridge = this.settings.enabled && !this.connectionError ? state.bridge : null
      const error = this.connectionError ?? state.error
      await Promise.all([this.gold.observe(bridge, error), this.equipmentHistory.observe(bridge, error), this.levelHistory.observe(bridge, error), this.equipmentComparisons.observe(bridge, error), this.equipmentLoadouts.observe(bridge, error)])
      if (!this.stopped)
        this.timer = setTimeout(() => this.poll(), 250)
    }
  }
}

/**
 * Keeps both game profiles active outside settings pages.
 * IPC validates the game key before it selects a fixed profile. Requests cannot select files, executables, or network addresses.
 */
export function setupWowCompanion(context: ReturnType<typeof createContext>['context']) {
  const profiles = {
    retail: new CompanionProfile('retail'),
    forever: new CompanionProfile('forever'),
  }
  const disposers = [
    defineInvokeHandler(context, wowCompanionGet, (input) => {
      const { game } = parse(getSchema, input)
      return profiles[game].read()
    }),
    defineInvokeHandler(context, wowCompanionSetAccountName, async (input) => {
      const { game, request } = parse(accountRequestSchema, input)
      await profiles[game].gold.setAccountName(request)
      return profiles[game].read()
    }),
    defineInvokeHandler(context, wowCompanionSetSettings, async (input) => {
      const { game, settings } = parse(settingsRequestSchema, input)
      return profiles[game].setSettings(settings)
    }),
    defineInvokeHandler(context, wowCompanionSetCapture, async (input) => {
      const { game, capture } = parse(captureRequestSchema, input)
      return profiles[game].setCapture(capture)
    }),
    defineInvokeHandler(context, wowCompanionDemo, async (input) => {
      const { game, request } = parse(demoRequestSchema, input)
      return profiles[game].demo(request)
    }),
  ]

  Object.values(profiles).forEach(profile => profile.start())
  onAppBeforeQuit(async () => {
    disposers.forEach(dispose => dispose())
    await Promise.all(Object.values(profiles).map(profile => profile.dispose()))
  })
}
