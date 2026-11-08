<script setup lang="ts">
import type { StatisticsCounters } from '../../../shared/wow-statistics'

import { Button, FieldCheckbox, FieldInput, SettingsCard } from '@proj-airi/ui'
import { safeParse } from 'valibot'
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { statisticsEndpointSchema } from '../../../shared/wow-statistics'
import { useWowStatisticsStore } from '../../stores/wow-statistics'

const statistics = useWowStatisticsStore()
const { t, locale } = useI18n()
const tn = (key: string) => t(`wow-statistics.${key}`)
const enabled = ref(false)
const endpoint = ref('')
const invalid = ref(false)
const saved = ref(false)
watch(() => statistics.state, (state) => {
  if (!state)
    return
  enabled.value = state.disclosed ? state.enabled : true
  endpoint.value = state.endpoint
}, { immediate: true })

async function save() {
  invalid.value = false
  saved.value = false
  const value = endpoint.value.trim()
  const choice = enabled.value
  if (!safeParse(statisticsEndpointSchema, value).success) {
    invalid.value = true
    return
  }
  if (!statistics.state?.disclosed) {
    // Save the chosen destination before acknowledgement can start reporting.
    if (!await statistics.configure({ enabled: false, endpoint: value }))
      return
    saved.value = await statistics.acknowledge(choice)
    return
  }
  saved.value = await statistics.configure({ enabled: choice, endpoint: value })
}

function number(value: number) {
  return value.toLocaleString(locale.value)
}

function counterValue(key: keyof StatisticsCounters) {
  const counters = statistics.state?.counters
  if (!counters)
    return tn('unavailable')
  const coverage = {
    inputTokens: counters.inputReportedRequests,
    outputTokens: counters.outputReportedRequests,
    totalTokens: counters.totalReportedRequests,
  }
  if (key in coverage && counters.requests > 0 && coverage[key as keyof typeof coverage] === 0)
    return tn('unavailable')
  return number(counters[key])
}

onMounted(() => statistics.refresh())
</script>

<template>
  <div :class="['min-w-0 flex flex-col gap-5 pb-12']" :aria-busy="statistics.busy">
    <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ tn('description') }}
    </p>
    <SettingsCard>
      <h2 :class="['text-lg font-semibold']">
        {{ tn('disclosure-title') }}
      </h2>
      <p :class="['text-sm leading-relaxed']">
        {{ tn('collect') }}
      </p>
      <p :class="['text-sm leading-relaxed']">
        {{ tn('no-content') }}
      </p>
      <p :class="['text-sm leading-relaxed']">
        {{ tn('coverage') }}
      </p>
      <p :class="['text-sm leading-relaxed']">
        {{ tn('installation-limit') }}
      </p>
      <p :class="['text-sm leading-relaxed']">
        {{ tn('control') }}
      </p>
    </SettingsCard>
    <SettingsCard>
      <form :class="['min-w-0 flex flex-col gap-4']" @submit.prevent="save">
        <FieldCheckbox v-model="enabled" :label="tn('enabled')" :disabled="statistics.busy || !statistics.state" />
        <FieldInput v-model="endpoint" :label="tn('endpoint')" :description="tn('endpoint-help')" placeholder="https://statistics.example.com" :disabled="statistics.busy || !statistics.state" />
        <p v-if="invalid" role="alert" :class="['text-sm text-red-700 dark:text-red-300']">
          {{ tn('errors.invalid-config') }}
        </p>
        <p v-if="statistics.failed" role="alert" :class="['text-sm text-red-700 dark:text-red-300']">
          {{ tn('operation-failed') }}
        </p>
        <p v-if="statistics.state?.lastError" role="status" :class="['text-sm text-amber-700 dark:text-amber-300']">
          {{ tn(`errors.${statistics.state.lastError}`) }}
        </p>
        <p v-if="statistics.state && !statistics.state.configured" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('not-configured') }}
        </p>
        <p v-if="saved" role="status" :class="['text-sm text-primary-700 dark:text-primary-300']">
          {{ tn('saved') }}
        </p>
        <Button type="submit" variant="primary" color="primary" :disabled="statistics.busy || !statistics.state">
          {{ tn(statistics.state?.disclosed ? 'save' : 'confirm-save') }}
        </Button>
      </form>
    </SettingsCard>
    <SettingsCard v-if="statistics.state">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('local-totals') }}
      </h2>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('coverage') }}
      </p>
      <dl :class="['grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2']">
        <div v-for="key in ['requests', 'requestsWithUsage', 'requestsWithoutUsage', 'inputTokens', 'outputTokens', 'totalTokens'] as const" :key="key">
          <dt :class="['text-sm text-neutral-500 dark:text-neutral-400']">
            {{ tn(`counters.${key}`) }}
          </dt>
          <dd :class="['mt-1 text-lg font-semibold']">
            {{ counterValue(key) }}
          </dd>
        </div>
      </dl>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('wow-statistics.coverage-counts', { input: number(statistics.state.counters.inputReportedRequests), output: number(statistics.state.counters.outputReportedRequests), total: number(statistics.state.counters.totalReportedRequests) }) }}
      </p>
      <p :class="['text-sm']">
        {{ tn('last-reported') }}: {{ statistics.state.lastReportedAt === null ? tn('never') : new Date(statistics.state.lastReportedAt).toLocaleString(locale) }}
      </p>
      <p :class="['break-all text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('installation-id') }}: {{ statistics.state.installationId ?? tn('not-created') }}
      </p>
      <Button :disabled="statistics.busy" @click="statistics.refresh()">
        {{ tn('refresh') }}
      </Button>
    </SettingsCard>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  settingsEntry: true
  titleKey: wow-statistics.title
  descriptionKey: wow-statistics.description
  icon: i-solar:chart-square-linear
  order: 23
</route>
