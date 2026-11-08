<script setup lang="ts">
import WowChatterSettings from '../../components/wow-chatter-settings.vue'
</script>

<template>
  <WowChatterSettings />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-companion.chatter.title
  subtitleKey: settings.title
  descriptionKey: wow-companion.chatter.description
  icon: i-solar:chat-round-dots-bold-duotone
  settingsEntry: true
  order: 12
  stageTransition:
    name: slide
</route>
