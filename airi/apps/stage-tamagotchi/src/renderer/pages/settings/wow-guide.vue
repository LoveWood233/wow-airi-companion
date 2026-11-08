<script setup lang="ts">
import { Button, Collapsible, SettingsCard } from '@proj-airi/ui'
import { computed, defineAsyncComponent, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'

import { guideSteps, useWowGuideStore } from '../../stores/wow-guide'

const guide = useWowGuideStore()
const { t } = useI18n()
const router = useRouter()
const checksOpen = ref(false)
const checksId = useId()
const WowMcpCheck = defineAsyncComponent(() => import('../../components/wow-mcp-check.vue'))
const WowSetupChecks = defineAsyncComponent(() => import('../../components/wow-setup-checks.vue'))
const tools = computed(() => router.getRoutes()
  .filter(route => route.meta.settingsTool === true)
  .sort((left, right) => Number(left.meta.order ?? 0) - Number(right.meta.order ?? 0))
  .map(route => ({
    path: route.path,
    title: typeof route.meta.titleKey === 'string' ? t(route.meta.titleKey) : '',
    description: typeof route.meta.descriptionKey === 'string' ? t(route.meta.descriptionKey) : '',
    icon: typeof route.meta.icon === 'string' ? route.meta.icon : '',
  })))
</script>

<template>
  <div :class="['flex flex-col gap-5 pb-12']">
    <header>
      <h2 :class="['text-xl font-semibold']">
        {{ t('wow-companion.tools.title') }}
      </h2>
      <p :class="['mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
        {{ t('wow-companion.tools.description') }}
      </p>
    </header>
    <nav :aria-label="t('wow-companion.tools.title')" :class="['grid min-w-0 gap-3 sm:grid-cols-2']">
      <RouterLink
        v-for="tool in tools" :key="tool.path" :to="tool.path" :aria-label="tool.title"
        :class="['min-w-0 flex items-start gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700', 'hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-primary-500 dark:hover:bg-neutral-900']"
      >
        <span :class="[tool.icon, 'mt-1 size-6 shrink-0 text-primary-600 dark:text-primary-300']" aria-hidden="true" />
        <span :class="['min-w-0']">
          <strong :class="['block break-words text-sm font-medium']">{{ tool.title }}</strong>
          <span :class="['mt-1 block break-words text-xs text-neutral-500 dark:text-neutral-400']">{{ tool.description }}</span>
        </span>
      </RouterLink>
    </nav>
    <SettingsCard data-wow-guide-anchor>
      <h2 :class="['text-xl font-semibold']">
        {{ t('wow-companion.guide.title') }}
      </h2>
      <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
        {{ t('wow-companion.guide.description') }}
      </p>
      <div :class="['flex flex-wrap gap-3']" role="group" :aria-label="t('wow-companion.guide.game')">
        <Button :aria-pressed="guide.game === 'retail'" @click="guide.game = 'retail'">
          {{ t('wow-companion.versions.retail.name') }}
        </Button>
        <Button :aria-pressed="guide.game === 'forever'" @click="guide.game = 'forever'">
          {{ t('wow-companion.versions.forever.name') }}
        </Button>
      </div>
      <div :class="['flex flex-wrap gap-3']">
        <Button variant="primary" color="primary" @click="guide.start()">
          {{ t(guide.outcome === 'new' ? 'wow-companion.guide.start' : 'wow-companion.guide.restart') }}
        </Button>
        <Button v-if="guide.outcome === 'started' || guide.outcome === 'skipped'" @click="guide.start(false)">
          {{ t('wow-companion.guide.continue') }}
        </Button>
      </div>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ t('wow-companion.guide.no-changes') }}
      </p>
    </SettingsCard>
    <SettingsCard>
      <Collapsible v-model="checksOpen">
        <template #trigger="{ visible, setVisible }">
          <Button :aria-expanded="visible" :aria-controls="checksId" @click="setVisible(!visible)">
            {{ t('wow-companion.setup.title') }}
          </Button>
        </template>
        <div :id="checksId" :class="['mt-4 min-w-0 flex flex-col gap-5']">
          <WowSetupChecks :key="guide.game" :game="guide.game" />
          <WowMcpCheck />
        </div>
      </Collapsible>
    </SettingsCard>
    <ol :class="['grid gap-3 sm:grid-cols-2']">
      <li v-for="(step, index) in guideSteps" :key="step.id" :class="['rounded-xl border border-neutral-200 p-4 dark:border-neutral-700']">
        <span :class="['text-xs text-primary-600 dark:text-primary-300']">{{ index + 1 }} / {{ guideSteps.length }}</span>
        <h3 :class="['mt-1 font-medium']">
          {{ t(`wow-companion.guide.steps.${step.id}.title`) }}
        </h3>
      </li>
    </ol>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-companion.tools.title
  descriptionKey: wow-companion.tools.description
  subtitleKey: settings.title
  icon: i-solar:map-arrow-right-bold-duotone
  settingsEntry: true
  order: 14
</route>
