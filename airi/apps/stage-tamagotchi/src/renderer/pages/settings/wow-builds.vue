<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import WowBuilds from '../../components/wow-builds.vue'

const route = useRoute()
const initialGame = computed(() => typeof route.query.game === 'string' ? route.query.game : undefined)
function id(value: unknown) {
  return typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : undefined
}
const linkedQuery = computed(() => {
  const game = route.query.game
  if (game !== 'retail' && game !== 'forever')
    return undefined
  if (route.query.spellId !== undefined)
    return { operation: 'spell', game, spellId: id(route.query.spellId) }
  if (route.query.itemId !== undefined)
    return { operation: 'compare-item', game, slot: id(route.query.slot), itemId: id(route.query.itemId) }
  if (route.query.nodeId !== undefined) {
    const nodeId = id(route.query.nodeId)
    return nodeId === undefined ? undefined : { operation: 'talents', game, classId: id(route.query.classId), level: id(route.query.level), nodeId }
  }
  return undefined
})
</script>

<template>
  <WowBuilds :initial-game="initialGame" :linked-query="linkedQuery" />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-builds.title
  subtitleKey: settings.title
  descriptionKey: wow-builds.description
  icon: i-solar:shield-star-bold-duotone
  settingsTool: true
  order: 18
  stageTransition:
    name: slide
</route>
