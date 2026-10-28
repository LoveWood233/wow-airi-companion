<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import companionIcon from '../../assets/wow-companion.png'

const { t } = useI18n()
</script>

<template>
  <RouterLink to="/" :class="['flex w-max items-center gap-2 px-2', 'text-nowrap text-2xl outline-none']">
    <img :src="companionIcon" alt="" :class="['h-8 w-8 object-contain']">
    <span :class="['translate-y-[2px] font-semibold']">{{ t('companion-ui.app.name') }}</span>
  </RouterLink>
</template>
