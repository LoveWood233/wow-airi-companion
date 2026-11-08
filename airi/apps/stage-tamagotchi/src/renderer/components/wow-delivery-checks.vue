<script setup lang="ts">
import type { DeliveryCheck, DeliveryReport } from '../../shared/wow-delivery'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Button, SettingsCard } from '@proj-airi/ui'
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { wowDeliveryInspect } from '../../shared/eventa/wow-delivery'

const { t, locale } = useI18n()
const tn = (key: string) => t(`wow-companion.delivery.${key}`)
const inspect = useElectronEventaInvoke(wowDeliveryInspect)
const report = ref<DeliveryReport>()
const checking = ref(false)
const failed = ref(false)
let disposed = false
const emptyRows = Object.freeze([])
const rows = computed<readonly { id: string, check: DeliveryCheck }[]>(() => report.value
  ? [
      { id: 'app', check: report.value.app },
      { id: 'resources', check: report.value.resources },
      { id: 'bundled-bridge', check: report.value.bundledBridge },
      { id: 'retail-addon', check: report.value.addons.retail },
      { id: 'forever-addon', check: report.value.addons.forever },
      { id: 'python', check: report.value.python },
      { id: 'retail-running', check: report.value.runningBridges.retail },
      { id: 'forever-running', check: report.value.runningBridges.forever },
    ]
  : emptyRows)

async function refresh() {
  if (checking.value)
    return
  checking.value = true
  failed.value = false
  try {
    const result = await inspect()
    if (!disposed)
      report.value = result
  }
  catch {
    if (!disposed)
      failed.value = true
  }
  finally {
    if (!disposed)
      checking.value = false
  }
}

onMounted(refresh)
onScopeDispose(() => {
  disposed = true
})
</script>

<template>
  <SettingsCard data-testid="wow-delivery-checks">
    <section :aria-label="tn('checks-title')" :aria-busy="checking" :class="['flex min-w-0 flex-col gap-4']">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('checks-title') }}
      </h2>
      <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
        {{ tn('checks-description') }}
      </p>
      <Button :disabled="checking" @click="refresh">
        {{ tn(checking ? 'checking' : 'refresh') }}
      </Button>
      <p v-if="failed" role="alert" :class="['text-sm text-red-600 dark:text-red-300']">
        {{ tn('check-failed') }}
      </p>
      <p v-if="report" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('checked-at') }} {{ new Date(report.checkedAt).toLocaleString(locale) }}
        <span v-if="report.release"> · {{ tn('release') }} {{ report.release }}</span>
      </p>
      <ul v-if="report" :class="['flex flex-col gap-3']">
        <li v-for="row in rows" :key="row.id" :data-testid="`delivery-${row.id}`" :class="['min-w-0 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700']">
          <div :class="['flex flex-wrap items-center justify-between gap-2']">
            <h3 :class="['text-sm font-medium']">
              {{ tn(`rows.${row.id}`) }}
            </h3>
            <span :class="['text-xs', row.check.status === 'passed' ? 'text-green-700 dark:text-green-300' : row.check.status === 'failed' ? 'text-red-700 dark:text-red-300' : 'text-neutral-500 dark:text-neutral-400']">{{ tn(`status.${row.check.status}`) }}</span>
          </div>
          <p :class="['mt-1 text-sm leading-relaxed']">
            {{ tn(`codes.${row.check.code}`) }}
          </p>
          <p v-if="row.check.actual || row.check.expected" :class="['mt-1 break-all text-xs text-neutral-500 dark:text-neutral-400']">
            <span v-if="row.check.actual">{{ tn('observed') }} {{ row.check.actual }}</span>
            <span v-if="row.check.expected"> · {{ tn('expected') }} {{ row.check.expected }}</span>
          </p>
          <p v-if="row.id === 'resources'" :class="['mt-1 text-xs']">
            {{ tn('verified-files') }} {{ report.resources.checked }}/{{ report.resources.total }}
          </p>
          <p v-if="row.id === 'python' && report.python.executable" :class="['mt-1 break-all text-xs']">
            {{ report.python.executable }}
          </p>
        </li>
      </ul>
      <p :class="['text-sm leading-relaxed']">
        {{ tn('python-help') }}
      </p>
      <a href="https://www.python.org/downloads/windows/" target="_blank" rel="noopener noreferrer" :class="['text-sm text-primary-600 underline dark:text-primary-300']">{{ tn('python-download') }}</a>
      <p :class="['text-sm leading-relaxed']">
        {{ tn('addon-help') }}
      </p>
      <RouterLink to="/settings/wow-guide" :class="['text-sm text-primary-600 underline dark:text-primary-300']">
        {{ tn('open-guide') }}
      </RouterLink>
    </section>
  </SettingsCard>
</template>
