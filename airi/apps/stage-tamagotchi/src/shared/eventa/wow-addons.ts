import type { AddonFile, AddonGame, AddonInstallRequest, AddonMetadata, AddonResult, AddonSearchRequest, AddonSearchResult, AddonSettings, AddonSettingsUpdate, InstalledAddon } from '../wow-addons'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowAddonsGetSettings = defineInvokeEventa<AddonResult<AddonSettings>, undefined>('eventa:invoke:wow-addons:settings:get')
export const wowAddonsSaveSettings = defineInvokeEventa<AddonResult<AddonSettings>, AddonSettingsUpdate>('eventa:invoke:wow-addons:settings:save')
export const wowAddonsChooseDirectory = defineInvokeEventa<AddonResult<string | null>, { game: AddonGame }>('eventa:invoke:wow-addons:directory')
export const wowAddonsMetadata = defineInvokeEventa<AddonResult<AddonMetadata>, undefined>('eventa:invoke:wow-addons:metadata')
export const wowAddonsSearch = defineInvokeEventa<AddonResult<AddonSearchResult>, AddonSearchRequest>('eventa:invoke:wow-addons:search')
export const wowAddonsFiles = defineInvokeEventa<AddonResult<AddonFile[]>, { game: AddonGame, modId: number, gameVersionTypeId: number }>('eventa:invoke:wow-addons:files')
export const wowAddonsInstall = defineInvokeEventa<AddonResult<InstalledAddon>, AddonInstallRequest>('eventa:invoke:wow-addons:install')
export const wowAddonsInstalled = defineInvokeEventa<AddonResult<InstalledAddon[]>, { game: AddonGame }>('eventa:invoke:wow-addons:installed')
