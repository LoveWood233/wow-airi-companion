<script setup lang="ts">
import WowScreenAssistSettings from '../../components/wow-screen-assist-settings.vue'
</script>

<template>
  <WowScreenAssistSettings />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-companion.screen-assist.title
  subtitleKey: settings.title
  descriptionKey: wow-companion.screen-assist.description
  icon: i-solar:camera-bold-duotone
  settingsEntry: true
  order: 11
  stageTransition:
    name: slide
</route>
