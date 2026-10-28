<script setup lang="ts">
import WowLauncherSettings from '../../components/wow-launcher-settings.vue'
</script>

<template>
  <WowLauncherSettings />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-companion.launcher.title
  subtitleKey: settings.title
  descriptionKey: wow-companion.launcher.description
  icon: i-solar:play-circle-bold-duotone
  settingsEntry: true
  order: 10
  stageTransition:
    name: slide
</route>
