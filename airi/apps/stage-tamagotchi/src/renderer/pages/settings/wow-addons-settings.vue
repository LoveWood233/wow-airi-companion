<script setup lang="ts">
import WowAddonsSettings from '../../components/wow-addons-settings.vue'
</script>

<template>
  <WowAddonsSettings />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-addons.settings.title
  subtitleKey: wow-addons.title
  stageTransition:
    name: slide
</route>
