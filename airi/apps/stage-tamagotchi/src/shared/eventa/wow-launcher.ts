import type { LauncherResult, LauncherSaveRequest, LauncherState, LauncherTarget } from '../wow-launcher'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowLauncherGet = defineInvokeEventa<LauncherState>('eventa:invoke:wow-launcher:get')
export const wowLauncherPick = defineInvokeEventa<{ path: string | null }>('eventa:invoke:wow-launcher:pick')
export const wowLauncherSave = defineInvokeEventa<LauncherResult, LauncherSaveRequest>('eventa:invoke:wow-launcher:save')
export const wowLauncherLaunch = defineInvokeEventa<LauncherResult, { target?: LauncherTarget }>('eventa:invoke:wow-launcher:launch')
