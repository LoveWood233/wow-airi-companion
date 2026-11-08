<script setup lang="ts">
import WowDataSettings from '../../components/wow-data-settings.vue'
</script>

<template>
  <WowDataSettings />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-data.title
  subtitleKey: settings.title
  descriptionKey: wow-data.description
  icon: i-solar:database-bold-duotone
  settingsTool: true
  order: 16
  stageTransition:
    name: slide
</route>
