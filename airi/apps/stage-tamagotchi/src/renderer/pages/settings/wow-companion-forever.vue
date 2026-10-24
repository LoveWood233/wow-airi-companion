<script setup lang="ts">
import WowCompanionSettings from '../../components/wow-companion-settings.vue'
</script>

<template>
  <WowCompanionSettings key="forever" game="forever" />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-companion.versions.forever.name
  subtitleKey: settings.title
  descriptionKey: wow-companion.versions.forever.description
  icon: i-solar:gamepad-bold-duotone
  settingsEntry: true
  order: 9
  stageTransition:
    name: slide
</route>
