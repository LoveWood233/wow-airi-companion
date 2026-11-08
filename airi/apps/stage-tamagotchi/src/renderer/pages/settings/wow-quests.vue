<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import WowQuests from '../../components/wow-quests.vue'

const route = useRoute()
const initialGame = computed(() => typeof route.query.game === 'string' ? route.query.game : undefined)
const initialQuestId = computed(() => typeof route.query.id === 'string' ? route.query.id : undefined)
</script>

<template>
  <WowQuests :initial-game="initialGame" :initial-quest-id="initialQuestId" />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-quests.title
  subtitleKey: settings.title
  descriptionKey: wow-quests.description
  icon: i-solar:notebook-bold-duotone
  settingsTool: true
  order: 17
  stageTransition:
    name: slide
</route>
