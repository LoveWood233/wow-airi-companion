<script setup lang="ts">
import { companionProductVersion, companionProjectUrl } from '@proj-airi/stage-ui/constants/wow-companion-product'
import { SettingsCard } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

import companionIcon from '../../../resources/icon.png'

const { t } = useI18n()
</script>

<template>
  <main :class="['mx-auto max-w-2xl p-6', 'flex flex-col gap-6', 'text-neutral-900 dark:text-neutral-100']">
    <header :class="['flex flex-col items-center gap-4 py-6 text-center']">
      <img :src="companionIcon" alt="" :class="['h-14 w-14 object-contain']">
      <h1 :class="['text-3xl font-semibold']">
        {{ t('companion-ui.app.name') }}
      </h1>
      <p :class="['text-neutral-600 dark:text-neutral-300']">
        {{ t('wow-companion.product.description') }}
      </p>
    </header>
    <SettingsCard>
      <dl :class="['flex items-center justify-between gap-4']">
        <dt>{{ t('wow-companion.product.version') }}</dt>
        <dd :class="['font-mono']">
          {{ companionProductVersion }}
        </dd>
      </dl>
      <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
        {{ t('wow-companion.product.local-provider-note') }}
      </p>
      <a :href="companionProjectUrl" target="_blank" rel="noopener noreferrer" :class="['inline-flex items-center gap-2 text-primary-700 underline dark:text-primary-300']">
        <span :class="['i-simple-icons:github h-4 w-4']" />
        {{ t('wow-companion.product.project') }}
      </a>
    </SettingsCard>
    <SettingsCard>
      <h2 :class="['font-semibold']">
        {{ t('wow-companion.product.third-party') }}
      </h2>
      <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
        {{ t('wow-companion.product.license-note') }}
      </p>
    </SettingsCard>
  </main>
</template>

<route lang="yaml">
meta:
  layout: plain
  titleKey: wow-companion.product.about-title
</route>
