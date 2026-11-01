import { defineToolCallWidget } from '@proj-airi/stage-ui/components'
import { literal, maxLength, object, parseJson, pipe, safeParse, string } from 'valibot'

import WowAddonRecommendations from './wow-addon-recommendations.vue'

import { addonRecommendationReportSchema } from '../../../shared/wow-addon-recommendations'

/** Main-owned recommendation IDs authorize selection, while the card shows only public catalog facts. */
export const wowAddonRecommendationsWidget = defineToolCallWidget(WowAddonRecommendations, (result) => {
  const report = safeParse(pipe(string(), parseJson(), addonRecommendationReportSchema), result)
  if (report.success)
    return { props: { report: report.output }, autoOpen: report.output.expiresAt > Date.now() }
  const failure = safeParse(pipe(string(), parseJson(), object({ ok: literal(false), userMessage: pipe(string(), maxLength(4096)) })), result)
  return failure.success ? { props: { failure: failure.output.userMessage }, failed: true, autoOpen: true } : undefined
}, { title: () => ({ key: 'wow-addons.recommendations.title' }) })
