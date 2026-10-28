import type { createContext } from '@moeru/eventa/adapters/electron/main'

import { defineInvokeHandler } from '@moeru/eventa'

import { wowScreenCapture } from '../../../shared/eventa/wow-screen-assist'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { WowScreenCapture } from './wow-screen-assist-runtime'
import { WindowsGameCapture } from './wow-screen-assist-windows'

/** Registers demand-only capture. Shutdown stops new requests. No background capture or image persistence is installed. */
export function setupWowScreenAssist(context: ReturnType<typeof createContext>['context']) {
  const capture = new WowScreenCapture(new WindowsGameCapture())
  const dispose = defineInvokeHandler(context, wowScreenCapture, input => capture.capture(input))
  onAppBeforeQuit(dispose)
}
