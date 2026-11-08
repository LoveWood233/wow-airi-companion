import type { createContext } from '@moeru/eventa/adapters/electron/main'

import process from 'node:process'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'
import { parse, strictObject } from 'valibot'

import { wowStatisticsAcknowledge, wowStatisticsConfigure, wowStatisticsGet, wowStatisticsRecord } from '../../../shared/eventa/wow-statistics'
import { companionReleaseSchema } from '../../../shared/wow-delivery'
import { statisticsAcknowledgeSchema, statisticsConfigureSchema, statisticsEndpointSchema, statisticsUsageObservationSchema } from '../../../shared/wow-statistics'
import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'
import { CompanionStatistics } from './wow-statistics-service'

/** Registers statistics IPC before renderers start. Public publisher configuration contains only a server URL, never an administrator key. */
export function setupWowStatistics(context: ReturnType<typeof createContext>['context']) {
  let service: CompanionStatistics | undefined
  let loading: Promise<CompanionStatistics> | undefined
  let stopped = false
  const owner = () => loading ??= (async () => {
    let endpoint = ''
    try {
      const configuration = JSON.parse(await readFile(join(app.getAppPath(), 'resources', 'wow-statistics.json'), 'utf8'))
      endpoint = parse(strictObject({ endpoint: statisticsEndpointSchema }), configuration).endpoint
    }
    catch {
      // An absent or invalid publisher endpoint keeps a new installation offline until the user configures a valid server.
    }
    let clientVersion = app.getVersion()
    try {
      const release = JSON.parse(await readFile(join(app.getAppPath(), 'resources', 'wow-companion-release.json'), 'utf8'))
      clientVersion = parse(companionReleaseSchema, release).releaseVersion
    }
    catch {
      // Development runs without a release manifest identify the Electron workspace version.
    }
    service = new CompanionStatistics(join(app.getPath('userData'), 'wow-installation-statistics-v1.json'), {
      endpoint,
      clientVersion,
      platform: process.platform,
    })
    await service.load()
    if (stopped)
      await service.stop()
    else
      await service.start()
    return service
  })()
  const disposers = [
    defineInvokeHandler(context, wowStatisticsGet, async () => (await owner()).read()),
    defineInvokeHandler(context, wowStatisticsConfigure, async input => (await owner()).configure(parse(statisticsConfigureSchema, input))),
    defineInvokeHandler(context, wowStatisticsAcknowledge, async input => (await owner()).acknowledge(parse(statisticsAcknowledgeSchema, input).enabled)),
    defineInvokeHandler(context, wowStatisticsRecord, async (input) => {
      await (await owner()).record(parse(statisticsUsageObservationSchema, input))
    }),
  ]
  void owner().catch(() => {})
  onAppBeforeQuit(async () => {
    stopped = true
    disposers.forEach(dispose => dispose())
    await loading?.catch(() => {})
    await service?.stop()
  })
}
