import type { CompanionState, GameVersion } from './wow-companion'
import type { SetupEnvironment, SetupInspection } from './wow-setup'

import { defaultSettings } from './wow-companion'

/** Creates an empty real-profile envelope, with no game observation or invented character. */
export function setupState(game: GameVersion = 'retail'): CompanionState {
  return { game, settings: { ...defaultSettings }, bridge: null, error: null, updatedAt: Date.now(), gold: { accounts: [], storageError: null }, equipmentHistory: { entries: [], storageError: null }, equipmentComparisons: { entries: [], storageError: null }, equipmentLoadouts: { entries: [], latestCharacter: null, storageError: null }, levelHistory: { characters: [], storageError: null } }
}
export function setupInspection(game: GameVersion = 'retail'): SetupInspection {
  return { game, directory: '', client: { status: 'unconfigured', code: 'choose-client' }, addon: { status: 'untested', code: 'choose-client' }, sourceAvailable: true, inspectedAt: Date.now() }
}
export function setupEnvironment(): SetupEnvironment {
  return { python: { status: 'passed', code: 'python-found' }, resources: { status: 'passed', code: 'resources-found' }, runtime: { status: 'stopped', error: null } }
}
