<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import WowDeliveryChecks from '../../components/wow-delivery-checks.vue'
import WowLocalUpdate from '../../components/wow-local-update.vue'

const { t } = useI18n()
</script>

<template>
  <div :class="['flex flex-col gap-5 pb-12']">
    <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ t('wow-companion.delivery.description') }}
    </p>
    <p :class="['text-sm leading-relaxed']">
      {{ t('wow-companion.delivery.no-auto-update') }}
    </p>
    <WowDeliveryChecks />
    <WowLocalUpdate />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-companion.delivery.title
  descriptionKey: wow-companion.delivery.description
  subtitleKey: settings.title
  icon: i-solar:box-bold-duotone
  settingsTool: true
  order: 13
</route>
