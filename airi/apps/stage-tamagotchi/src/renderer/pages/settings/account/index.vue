<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
void router.replace('/settings')
</script>

<template>
  <div />
</template>

<route lang="yaml">
meta:
  layout: settings
  settingsEntry: false
</route>
