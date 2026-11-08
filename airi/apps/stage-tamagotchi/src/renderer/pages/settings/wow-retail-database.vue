<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import WowRetailDatabase from '../../components/wow-retail-database.vue'

const route = useRoute()
const initialRecordId = computed(() => typeof route.query.id === 'string' ? route.query.id : undefined)
</script>

<template>
  <WowRetailDatabase :initial-record-id="initialRecordId" />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-retail-query.title
  subtitleKey: settings.title
  descriptionKey: wow-retail-query.description
  icon: i-solar:database-bold-duotone
  settingsTool: true
  order: 15
  stageTransition:
    name: slide
</route>
