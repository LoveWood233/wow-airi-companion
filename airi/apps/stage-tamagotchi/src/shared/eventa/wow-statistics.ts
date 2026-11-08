import type { StatisticsConfigure, StatisticsState, StatisticsUsageObservation } from '../wow-statistics'

import { defineInvokeEventa } from '@moeru/eventa'

export const wowStatisticsGet = defineInvokeEventa<StatisticsState, void>('eventa:invoke:wow-statistics:get')
export const wowStatisticsConfigure = defineInvokeEventa<StatisticsState, StatisticsConfigure>('eventa:invoke:wow-statistics:configure')
export const wowStatisticsAcknowledge = defineInvokeEventa<StatisticsState, { enabled: boolean }>('eventa:invoke:wow-statistics:acknowledge')
export const wowStatisticsRecord = defineInvokeEventa<void, StatisticsUsageObservation>('eventa:invoke:wow-statistics:record')
