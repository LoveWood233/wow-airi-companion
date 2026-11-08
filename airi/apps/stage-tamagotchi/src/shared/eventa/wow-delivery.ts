import type { DeliveryReport } from '../wow-delivery'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowDeliveryInspect = defineInvokeEventa<DeliveryReport>('eventa:invoke:wow-delivery:inspect')
