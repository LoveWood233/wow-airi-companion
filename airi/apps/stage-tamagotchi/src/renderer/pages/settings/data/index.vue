<script setup lang="ts">
import type { ChatSessionsExport } from '@proj-airi/stage-ui/types/chat-session'

import ChatsSection from '@proj-airi/stage-pages/pages/settings/data/components/chats-section.vue'
import DangerSection from '@proj-airi/stage-pages/pages/settings/data/components/danger-section.vue'
import DownloadedModelsSection from '@proj-airi/stage-pages/pages/settings/data/components/downloaded-models-section.vue'
import StatusBanner from '@proj-airi/stage-pages/pages/settings/data/components/status-banner.vue'

import { createDataSettingsStatusState } from '@proj-airi/stage-pages/pages/settings/data/status'
import { useDataMaintenance } from '@proj-airi/stage-ui/composables/use-data-maintenance'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { DoubleCheckButton, SettingsCard } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

import DesktopFolderSection from './components/desktop-folder-section.vue'
import DesktopResetSection from './components/desktop-reset-section.vue'

import { useWowItemStorageStore } from '../../../stores/wow-companion-item-storage'
import { useWowCompanionMemoriesStore } from '../../../stores/wow-companion-memories'

const { statusMessage, statusTone, handleStatus } = createDataSettingsStatusState()
const chatSession = useChatSessionStore()
const memories = useWowCompanionMemoriesStore()
const items = useWowItemStorageStore()
const { t } = useI18n()
const { resetModulesSettings } = useDataMaintenance()

async function resetModules() {
  try {
    await resetModulesSettings()
    handleStatus({ message: t('settings.pages.data.status.modules_reset'), tone: 'success' })
  }
  catch {
    handleStatus({ message: t('dsh-pet.operation-error'), tone: 'error' })
  }
}

async function syncImportedChats(payload: ChatSessionsExport) {
  await chatSession.importSessions(payload)
}

async function clearCompanionData() {
  try {
    await memories.clear()
    await items.clear()
  }
  catch {
    throw new Error(t('wow-companion.memory.notifications.operation-failed'))
  }
}
</script>

<template>
  <div :class="['flex flex-col gap-4 pb-4']">
    <StatusBanner v-if="statusMessage" :message="statusMessage" :tone="statusTone" />
    <DesktopFolderSection @status="handleStatus" />
    <ChatsSection :sync-imported-chats="syncImportedChats" @status="handleStatus" />
    <DownloadedModelsSection @status="handleStatus" />
    <SettingsCard>
      <h2 :class="['text-lg font-medium']">
        {{ t('settings.pages.data.sections.modules.title') }}
      </h2>
      <p :class="['text-sm text-neutral-600 dark:text-neutral-400']">
        {{ t('settings.pages.data.sections.modules.description') }}
      </p>
      <DoubleCheckButton color="orange" @confirm="resetModules">
        {{ t('settings.pages.data.sections.modules.reset') }}
        <template #confirm>
          {{ t('settings.pages.data.confirmations.yes') }}
        </template>
        <template #cancel>
          {{ t('settings.pages.card.cancel') }}
        </template>
      </DoubleCheckButton>
    </SettingsCard>
    <DesktopResetSection @status="handleStatus" />
    <DangerSection :after-delete-all="clearCompanionData" @status="handleStatus" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.data.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.data.description
  icon: i-solar:database-bold-duotone
  settingsEntry: true
  order: 7
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
