import type { GameVersion } from './wow-companion'

/** Checks describe observed evidence, never a successful game login inferred from configuration alone. */
export type SetupStatus = 'passed' | 'failed' | 'unconfigured' | 'untested'
export interface SetupCheck { status: SetupStatus, code: string }
export interface SetupInspection {
  game: GameVersion
  directory: string
  client: SetupCheck
  addon: SetupCheck
  clientVersion?: string
  addonVersion?: string
  expectedAddonVersion?: string
  sourceAvailable: boolean
  inspectedAt: number
}
export interface SetupEnvironment {
  python: SetupCheck
  pythonPath?: string
  resources: SetupCheck
  runtime: { status: string, error: string | null }
}
