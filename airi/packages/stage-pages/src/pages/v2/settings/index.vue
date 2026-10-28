<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t: translateCompanion } = useI18n({ useScope: 'global' })
</script>

<template>
  <div>
    {{ translateCompanion('companion-extra.settings-c7f73b') }}
  </div>
</template>
