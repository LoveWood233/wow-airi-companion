<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import WowProfessions from '../../components/wow-professions.vue'

const route = useRoute()
const initialRecipeId = computed(() => typeof route.query.recipe === 'string' ? route.query.recipe : undefined)
</script>

<template>
  <WowProfessions :initial-recipe-id="initialRecipeId" />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-professions.title
  subtitleKey: settings.title
  descriptionKey: wow-professions.description
  icon: i-solar:box-minimalistic-bold-duotone
  settingsTool: true
  order: 14
  stageTransition:
    name: slide
</route>
