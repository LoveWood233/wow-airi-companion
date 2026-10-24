<script setup lang="ts">
import WowCompanionSettings from '../../components/wow-companion-settings.vue'
</script>

<template>
  <WowCompanionSettings key="retail" game="retail" />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-companion.versions.retail.name
  subtitleKey: settings.title
  descriptionKey: wow-companion.versions.retail.description
  icon: i-solar:gamepad-bold-duotone
  settingsEntry: true
  order: 8
  stageTransition:
    name: slide
</route>
