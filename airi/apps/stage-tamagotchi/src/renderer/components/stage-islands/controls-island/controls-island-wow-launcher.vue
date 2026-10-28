<script setup lang="ts">
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import ControlButtonTooltip from './control-button-tooltip.vue'
import ControlButton from './control-button.vue'

import { electronOpenSettings } from '../../../../shared/eventa'
import { useWowLauncherStore } from '../../../stores/wow-launcher'

defineProps<{ buttonStyle?: string, iconClass?: string }>()

const { t } = useI18n()
const launcher = useWowLauncherStore()
const openSettings = useElectronEventaInvoke(electronOpenSettings)

async function launch() {
  const launched = await launcher.launch()
  if (launched) {
    toast.success(t('wow-companion.launcher.launched'))
    return
  }
  if (launcher.errorCode === 'not-configured') {
    await openSettings({ route: '/settings/wow-launcher' })
    return
  }
  if (launcher.errorCode)
    toast.error(t(`wow-companion.launcher.errors.${launcher.errorCode}`))
}

onMounted(() => launcher.refresh())
</script>

<template>
  <ControlButtonTooltip side="inward" as-child>
    <ControlButton
      data-testid="controls-island-wow-launcher" :button-style="buttonStyle" :aria-label="t('wow-companion.launcher.quick-launch')"
      :aria-busy="launcher.busy" :disabled="launcher.busy || launcher.state?.supported === false" @click="launch"
    >
      <div :class="['i-solar:play-circle-outline text-primary-600 dark:text-primary-400', iconClass]" />
    </ControlButton>
    <template #tooltip>
      {{ launcher.state?.supported === false ? t('wow-companion.launcher.errors.unsupported-platform') : t('wow-companion.launcher.quick-launch-description') }}
    </template>
  </ControlButtonTooltip>
</template>
