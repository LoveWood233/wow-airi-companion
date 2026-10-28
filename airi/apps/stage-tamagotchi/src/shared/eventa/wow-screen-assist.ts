import type { WowScreenCaptureRequest, WowScreenCaptureResult } from '../wow-screen-assist'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowScreenCapture = defineInvokeEventa<WowScreenCaptureResult, WowScreenCaptureRequest>('eventa:invoke:wow-screen-assist:capture')
