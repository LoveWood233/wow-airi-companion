<script setup lang="ts">
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { watch } from 'vue'

import WowCompanionMemories from '../../components/wow-companion-memories.vue'

import { useWowCompanionMemoriesStore } from '../../stores/wow-companion-memories'

const memories = useWowCompanionMemoriesStore()
const cards = useAiriCardStore()
watch(() => cards.activeCardId, (personaId) => {
  memories.selectPersona(personaId)
  void memories.refresh()
}, { immediate: true })
</script>

<template>
  <WowCompanionMemories
    :key="memories.personaId"
    :persona-id="memories.personaId"
    :persona-name="cards.activeCard?.name || memories.personaId"
    :state="memories.state"
    :loading="memories.loading"
    :error="memories.error"
    :actions="memories"
  />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-companion.memory.title
  subtitleKey: settings.title
  descriptionKey: wow-companion.memory.description
  icon: i-solar:notebook-bold-duotone
  settingsEntry: true
  order: 13
  stageTransition:
    name: slide
</route>
