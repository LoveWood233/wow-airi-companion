<script setup lang="ts">
import { Button, Progress, SettingsCard } from '@proj-airi/ui'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import { useWowDataUpdateStore } from '../stores/wow-data-update'

const { t, te, locale } = useI18n()
const tn = (key: string) => t(`wow-data.${key}`)
const data = useWowDataUpdateStore()
const ready = computed(() => Boolean(data.status?.config.gameRoot && data.status.config.toolsRoot && data.status.discovery.build && data.status.checks.length && data.status.checks.every(check => check.status === 'ready')))
const sourceSelected = computed(() => data.status?.activeSource)
const hasKnownProgress = computed(() => Boolean(data.status?.job?.total && data.status.job.total > 0))

function error(code: string) {
  const key = `wow-data.errors.${code}`
  return te(key) ? t(key) : tn('errors.generic')
}

function date(value: string) {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(locale.value) : value
}

function mib(bytes: number) {
  return t('wow-data.cache.mib', { size: (bytes / 1_048_576).toLocaleString(locale.value, { maximumFractionDigits: 1 }) })
}

onMounted(() => data.initialize())
onBeforeUnmount(() => data.stopMonitoring())
</script>

<template>
  <div data-testid="wow-data-settings" :class="['mx-auto max-w-4xl flex flex-col gap-5 pb-12', 'text-neutral-900 dark:text-neutral-100']">
    <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ tn('description') }}
    </p>
    <p v-if="data.errorCode" role="alert" :class="['break-words text-sm text-red-600 dark:text-red-400']">
      {{ error(data.errorCode) }}
    </p>
    <p v-if="data.feedback" role="status" :class="['text-sm text-primary-700 dark:text-primary-300']">
      {{ tn(`feedback.${data.feedback}`) }}
    </p>

    <SettingsCard role="region" :aria-label="tn('current.title')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('current.title') }}
      </h2>
      <dl :class="['grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm']">
        <dt :class="['text-neutral-500 dark:text-neutral-400']">
          {{ tn('current.client-build') }}
        </dt><dd :class="['min-w-0 break-words']">
          {{ data.status?.discovery.build ?? tn('current.unknown') }}
        </dd>
        <template v-if="data.status?.discovery.previousBuild">
          <dt :class="['text-neutral-500 dark:text-neutral-400']">
            {{ tn('current.previous-build') }}
          </dt><dd :class="['min-w-0 break-words']">
            {{ data.status.discovery.previousBuild }}
          </dd>
        </template>
        <template v-if="sourceSelected">
          <dt :class="['text-neutral-500 dark:text-neutral-400']">
            {{ tn('current.active') }}
          </dt><dd :class="['min-w-0 break-words']">
            {{ sourceSelected.build }} · {{ sourceSelected.locale }}
          </dd>
        </template>
      </dl>
      <p v-if="data.status?.discovery.checkedAt" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('wow-data.current.checked', { time: date(data.status.discovery.checkedAt) }) }}
      </p>
      <p v-if="data.status?.discovery.changed" role="status" :class="['rounded-lg p-3 text-sm leading-relaxed', 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200']">
        {{ tn('current.changed') }}
      </p>
      <p v-if="data.status?.discovery.errorCode" :class="['text-sm text-amber-700 dark:text-amber-300']">
        {{ error(data.status.discovery.errorCode) }}
      </p>
      <p v-if="data.status?.activeSelection === 'external'" :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
        {{ tn('current.external') }}
      </p>
      <p v-else-if="data.status?.activeSelection === 'none'" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('current.none') }}
      </p>
      <RouterLink to="/settings/wow-retail-database" :class="['self-start text-sm text-primary-700 underline dark:text-primary-300']">
        {{ tn('current.open-query') }}
      </RouterLink>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('current.no-auto-update') }}
      </p>
    </SettingsCard>

    <SettingsCard role="region" :aria-label="tn('paths.title')">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('paths.title') }}
      </h2>
      <dl :class="['flex flex-col gap-3 text-sm']">
        <div>
          <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('paths.game') }}
          </dt><dd :class="['mt-1 break-all']">
            {{ data.status?.config.gameRoot ?? tn('paths.unselected') }}
          </dd>
        </div>
        <div>
          <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('paths.tools') }}
          </dt><dd :class="['mt-1 break-all']">
            {{ data.status?.config.toolsRoot ?? tn('paths.unselected') }}
          </dd>
        </div>
      </dl>
      <div :class="['flex flex-wrap gap-2']">
        <Button :disabled="data.busy || data.running" @click="data.chooseGame()">
          {{ tn('paths.choose-game') }}
        </Button>
        <Button :disabled="data.busy || data.running" @click="data.chooseTools()">
          {{ tn('paths.choose-tools') }}
        </Button>
        <Button :disabled="data.busy || data.running" @click="data.check()">
          {{ tn('paths.check') }}
        </Button>
      </div>
      <ul v-if="data.status?.checks.length" :class="['flex flex-col gap-2 text-sm']">
        <li v-for="check in data.status.checks" :key="check.id" :class="['flex flex-wrap items-center justify-between gap-2']">
          <span>{{ tn(`paths.checks.${check.id}`) }}</span>
          <span :class="[check.status === 'ready' ? 'text-primary-700 dark:text-primary-300' : 'text-amber-700 dark:text-amber-300']">{{ tn(`paths.statuses.${check.status}`) }}</span>
        </li>
      </ul>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('paths.offline') }}
      </p>
    </SettingsCard>

    <SettingsCard role="region" :aria-label="tn('job.title')" data-testid="data-update-job">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('job.title') }}
      </h2>
      <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
        {{ tn('job.description') }}
      </p>
      <div :class="['flex flex-wrap gap-2']">
        <Button variant="primary" color="primary" :disabled="!ready || data.busy || data.running" :loading="data.pendingAction === 'start'" @click="data.start()">
          {{ tn('job.start') }}
        </Button>
        <Button :disabled="!data.running || data.busy" :loading="data.pendingAction === 'cancel'" @click="data.cancel()">
          {{ tn('job.cancel') }}
        </Button>
      </div>
      <p v-if="data.pendingAction === 'cancel'" role="status" :class="['text-sm']">
        {{ tn('job.cancelling') }}
      </p>
      <template v-if="data.status?.job">
        <p role="status" :class="['text-sm font-medium']">
          {{ tn(`job.phases.${data.status.job.phase}`) }}<span v-if="data.status.job.build"> · {{ data.status.job.build }}</span>
        </p>
        <div v-if="hasKnownProgress" role="progressbar" :aria-label="tn(`job.phases.${data.status.job.phase}`)" :aria-valuemin="0" :aria-valuemax="data.status.job.total ?? undefined" :aria-valuenow="data.status.job.completed">
          <Progress :progress="Math.min(100, data.status.job.completed / data.status.job.total! * 100)" aria-hidden="true" />
        </div>
        <p v-if="hasKnownProgress" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('wow-data.job.progress', { completed: data.status.job.completed, total: data.status.job.total }) }}
        </p>
        <p v-else-if="data.status.job.phase === 'exporting'" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('wow-data.job.progress-unknown', { completed: data.status.job.completed }) }}
        </p>
        <p v-else :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ tn('job.no-count') }}
        </p>
        <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ t('wow-data.job.updated', { time: date(data.status.job.updatedAt) }) }}
        </p>
        <p v-if="data.status.job.errorCode" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
          {{ error(data.status.job.errorCode) }}
        </p>
        <p v-if="data.status.job.phase === 'ready'" :class="['rounded-lg p-3 text-sm leading-relaxed', 'bg-primary-50 text-primary-800 dark:bg-primary-950/60 dark:text-primary-200']">
          {{ tn(data.status.job.snapshotId === data.status.activeSnapshotId ? 'job.ready-selected' : 'job.ready') }}
        </p>
      </template>
      <p v-else :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('job.idle') }}
      </p>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('job.progress-note') }}
      </p>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('job.failure-keeps-active') }}
      </p>
    </SettingsCard>

    <SettingsCard role="region" :aria-label="tn('snapshots.title')" data-testid="data-update-snapshots">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('snapshots.title') }}
      </h2>
      <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
        {{ tn('snapshots.description') }}
      </p>
      <p v-if="!data.status?.snapshots.length" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('snapshots.empty') }}
      </p>
      <ol v-else :class="['flex flex-col gap-3']">
        <li v-for="(snapshot, index) in data.status.snapshots" :key="snapshot.id" :data-testid="`data-snapshot-${snapshot.id}`" :class="['min-w-0 flex flex-col gap-2 rounded-lg border p-3', 'border-neutral-200 dark:border-neutral-800']">
          <div :class="['flex flex-wrap items-center justify-between gap-2']">
            <h3 :class="['break-words text-sm font-semibold']">
              {{ snapshot.build }}
            </h3><span v-if="snapshot.selected" :class="['text-xs text-primary-700 dark:text-primary-300']">{{ tn('snapshots.selected') }}</span>
          </div>
          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('snapshots.verified') }}
          </p>
          <p :class="['text-xs']">
            {{ t('wow-data.snapshots.source', { name: snapshot.source.name }) }}
          </p>
          <p :class="['text-xs']">
            {{ t('wow-data.snapshots.locale', { locale: snapshot.source.locale }) }}
          </p>
          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('wow-data.snapshots.exported', { time: date(snapshot.source.exportedAt) }) }}
          </p>
          <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ t('wow-data.snapshots.created', { time: date(snapshot.createdAt) }) }}
          </p>
          <p v-if="!snapshot.source.hotfixesApplied" :class="['text-xs text-amber-700 dark:text-amber-300']">
            {{ tn('snapshots.no-hotfixes') }}
          </p>
          <p v-if="snapshot.source.tables.some(table => table.encrypted)" :class="['text-xs text-amber-700 dark:text-amber-300']">
            {{ tn('snapshots.encrypted') }}
          </p>
          <Button :disabled="snapshot.selected || data.busy || data.running" :aria-label="`${tn(index === 0 ? 'snapshots.activate' : 'snapshots.rollback')} · ${snapshot.build}`" :class="['self-start']" @click="data.activate(snapshot.id)">
            {{ tn(index === 0 ? 'snapshots.activate' : 'snapshots.rollback') }}
          </Button>
        </li>
      </ol>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('snapshots.switch-note') }}
      </p>
    </SettingsCard>

    <SettingsCard role="region" :aria-label="tn('cache.title')" data-testid="wow-data-cache">
      <h2 :class="['text-lg font-semibold']">
        {{ tn('cache.title') }}
      </h2>
      <p v-if="data.cacheErrorCode" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
        {{ error(data.cacheErrorCode) }}
      </p>
      <dl v-if="data.cache" :class="['grid grid-cols-1 gap-3 text-sm sm:grid-cols-2']">
        <div>
          <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('cache.entries') }}
          </dt><dd :class="['mt-1 font-medium']">
            {{ data.cacheErrorCode ? tn('current.unknown') : data.cache.entries }}
          </dd>
        </div>
        <div>
          <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('cache.used') }}
          </dt><dd :class="['mt-1 font-medium']">
            {{ data.cacheErrorCode ? tn('current.unknown') : mib(data.cache.bytes) }}
          </dd>
        </div>
        <div>
          <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('cache.maximum') }}
          </dt><dd :class="['mt-1 font-medium']">
            {{ mib(data.cache.maxBytes) }}
          </dd>
        </div>
        <div>
          <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('cache.static-ttl') }}
          </dt><dd :class="['mt-1 font-medium']">
            {{ t('wow-data.cache.hours', { count: data.cache.staticTtlMs / 3_600_000 }) }}
          </dd>
        </div>
        <div>
          <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('cache.price-ttl') }}
          </dt><dd :class="['mt-1 font-medium']">
            {{ t('wow-data.cache.minutes', { count: data.cache.priceTtlMs / 60_000 }) }}
          </dd>
        </div>
      </dl>
      <p v-else :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('cache.unavailable') }}
      </p>
      <div :class="['flex flex-wrap gap-2']">
        <Button :disabled="data.cacheBusy" @click="data.inspectCache()">
          {{ tn('cache.inspect') }}
        </Button><Button :disabled="data.cacheBusy || !data.cache" :loading="data.cacheBusy" @click="data.clearCache()">
          {{ tn('cache.clear') }}
        </Button>
      </div>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('cache.policy') }}
      </p>
      <p :class="['text-xs leading-relaxed text-neutral-500 dark:text-neutral-400']">
        {{ tn('cache.clear-note') }}
      </p>
    </SettingsCard>
  </div>
</template>
