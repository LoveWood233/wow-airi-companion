<script setup lang="ts">
import WowAddonsCenter from '../../components/wow-addons-center.vue'
</script>

<template>
  <WowAddonsCenter />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-addons.title
  subtitleKey: settings.title
  descriptionKey: wow-addons.description
  icon: i-solar:widget-add-bold-duotone
  settingsEntry: true
  order: 8.2
  stageTransition:
    name: slide
</route>
