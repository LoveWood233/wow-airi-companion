<script setup lang="ts">
import type { AddonRecommendationReport } from '../../../shared/wow-addon-recommendations'
import type { InstalledAddon } from '../../../shared/wow-addons'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Button } from '@proj-airi/ui'
import { useNow } from '@vueuse/core'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { wowAddonsInstallRecommendation } from '../../../shared/eventa/wow-addons'

const props = defineProps<{ report?: AddonRecommendationReport, failure?: string }>()
const { t, te, locale } = useI18n()
const tn = (key: string) => t(`wow-addons.recommendations.${key}`)
const installRecommendation = useElectronEventaInvoke(wowAddonsInstallRecommendation)
const now = useNow({ interval: 1000 })
const installing = ref<number>()
const installed = ref<Record<number, InstalledAddon>>({})
const error = ref('')
watch(() => props.report?.id, () => {
  installed.value = {}
  error.value = ''
})

function errorText(code: string) {
  const key = `wow-addons.errors.${code}`
  return te(key) ? t(key) : t('wow-addons.errors.unknown')
}

async function install(modId: number) {
  const report = props.report
  if (!report || installing.value !== undefined || installed.value[modId] || report.expiresAt <= Date.now())
    return
  const recommendationId = report.id
  const addon = report.addons.find(addon => addon.id === modId)
  if (!addon?.installable)
    return
  installing.value = modId
  error.value = ''
  try {
    const response = await installRecommendation({ recommendationId, modId })
    if (props.report?.id !== recommendationId)
      return
    if (response.ok)
      installed.value[modId] = response.data
    else
      error.value = errorText(response.error)
  }
  catch (cause) {
    if (props.report?.id === recommendationId)
      error.value = errorText(errorMessageFrom(cause) ?? '')
  }
  finally {
    installing.value = undefined
  }
}
</script>

<template>
  <section v-if="report" :aria-label="tn('title')" :class="['flex min-w-0 flex-col gap-3 rounded-xl p-3', 'bg-white text-neutral-800 dark:bg-neutral-950 dark:text-neutral-100']">
    <header :class="['flex flex-col gap-1']">
      <h3 :class="['text-base font-semibold']">
        {{ tn('title') }}
      </h3>
      <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
        {{ report.query }} · {{ t(`wow-addons.games.${report.game}`) }} · {{ report.versionName }}
      </p>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('ranking') }}
      </p>
    </header>
    <p v-if="!report.addons.length" role="status" :class="['text-sm']">
      {{ t('wow-addons.no-results') }}
    </p>
    <p v-if="report.expiresAt <= now.getTime()" role="status" :class="['text-sm text-amber-700 dark:text-amber-300']">
      {{ tn('expired') }}
    </p>
    <p v-if="error" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
      {{ error }}
    </p>
    <ol :class="['m-0 flex min-w-0 list-none flex-col gap-3 p-0']">
      <li v-for="(addon, index) in report.addons" :key="addon.id" :class="['min-w-0 rounded-xl p-3', 'border border-neutral-200 dark:border-neutral-700', 'bg-neutral-50 dark:bg-neutral-900']">
        <article :aria-label="addon.name" :class="['flex min-w-0 flex-col gap-2']">
          <h4 :class="['break-words text-sm font-semibold']">
            {{ index + 1 }}. {{ addon.name }}
          </h4>
          <p :class="['break-words text-sm']">
            {{ addon.summary }}
          </p>
          <p :class="['text-xs text-neutral-600 dark:text-neutral-300']">
            {{ t('wow-addons.downloads', { count: new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(addon.downloadCount) }) }}
          </p>
          <p :class="['break-words text-xs text-neutral-500 dark:text-neutral-400']">
            {{ addon.fileVersion }} · {{ addon.gameVersions.join(', ') }}
          </p>
          <p v-if="!addon.installable && addon.unavailableReason" :class="['text-xs text-amber-700 dark:text-amber-300']">
            {{ errorText(addon.unavailableReason) }}
          </p>
          <p v-if="installed[addon.id]" role="status" :class="['text-sm text-green-700 dark:text-green-300']">
            {{ t('wow-addons.install-success') }}
          </p>
          <div :class="['flex flex-wrap items-center gap-3']">
            <Button :label="installed[addon.id] ? tn('installed') : installing === addon.id ? tn('installing') : t('wow-addons.install')" :loading="installing === addon.id" :disabled="!addon.installable || installing !== undefined || !!installed[addon.id] || report.expiresAt <= now.getTime()" @click="install(addon.id)" />
            <a v-if="addon.websiteUrl" :href="addon.websiteUrl" target="_blank" rel="noopener noreferrer" :class="['text-sm text-primary-600 underline underline-offset-2 dark:text-primary-400']">{{ tn('project') }}</a>
          </div>
        </article>
      </li>
    </ol>
    <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
      {{ tn('source') }}
    </p>
  </section>
  <p v-else-if="failure" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
    {{ failure }}
  </p>
</template>
