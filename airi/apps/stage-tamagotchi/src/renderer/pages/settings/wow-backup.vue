<script setup lang="ts">
import type { BackupPreview, BackupScope, BackupSelection, BackupStatus } from '../../../shared/wow-backup'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Button, FieldCheckbox, SettingsCard } from '@proj-airi/ui'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { wowBackupCancel, wowBackupExport, wowBackupOpenFolder, wowBackupPick, wowBackupRestart, wowBackupSchedule, wowBackupStatus } from '../../../shared/eventa/wow-backup'
import { BrowserBackupStorage } from '../../utils/wow-browser-backup'

const { t, locale } = useI18n()
const tn = (key: string) => t(`wow-companion.backup.${key}`)
const scopes: BackupScope[] = ['settings', 'history', 'chats']
const exportSelection = ref<BackupSelection>({ settings: true, history: true, chats: false })
const restoreSelection = ref<BackupSelection>({ settings: false, history: false, chats: false })
const status = ref<BackupStatus>({ pending: null, last: null })
const preview = ref<BackupPreview | null>(null)
const busy = ref(false)
const message = ref('')
const failed = ref(false)
const getStatus = useElectronEventaInvoke(wowBackupStatus)
const exportFile = useElectronEventaInvoke(wowBackupExport)
const pick = useElectronEventaInvoke(wowBackupPick)
const schedule = useElectronEventaInvoke(wowBackupSchedule)
const cancel = useElectronEventaInvoke(wowBackupCancel)
const restart = useElectronEventaInvoke(wowBackupRestart)
const openFolder = useElectronEventaInvoke(wowBackupOpenFolder)
const browser = new BrowserBackupStorage()

function date(at: number) {
  return new Date(at).toLocaleString(locale.value)
}

async function run(operation: () => Promise<void>) {
  if (busy.value)
    return
  busy.value = true
  failed.value = false
  message.value = ''
  try {
    await operation()
  }
  catch (error) {
    failed.value = true
    const code = errorMessageFrom(error) ?? ''
    message.value = tn(code.includes('backup-checksum') ? 'checksum-failed' : code.includes('backup-too-large') ? 'too-large' : code.includes('backup-missing-assets') ? 'missing-assets' : 'failed')
  }
  finally {
    busy.value = false
  }
}

async function save() {
  const selection = { ...exportSelection.value }
  const data = await browser.read(selection.chats, true, selection.settings)
  const result = await exportFile({ browser: data, selection })
  if (result)
    message.value = `${tn('saved')} ${result.path}`
}

async function inspect() {
  preview.value = null
  const result = await pick()
  if (result) {
    preview.value = result
    restoreSelection.value = { ...result.scopes }
  }
}

async function queue() {
  if (!preview.value)
    return
  status.value = await schedule({ id: preview.value.id, selection: { ...restoreSelection.value } })
  preview.value = null
}

onMounted(() => run(async () => {
  status.value = await getStatus()
}))
</script>

<template>
  <div data-testid="wow-backup-settings" :class="['flex flex-col gap-5 pb-12']" :aria-busy="busy">
    <p :class="['text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
      {{ tn('description') }}
    </p>
    <SettingsCard>
      <h2 :class="['text-lg font-semibold']">
        {{ tn('export') }}
      </h2>
      <p :class="['text-sm leading-relaxed']">
        {{ tn('exclusions') }}
      </p>
      <div role="group" :aria-label="tn('export-scope')" :class="['flex flex-col gap-3']">
        <FieldCheckbox v-for="scope in scopes" :key="scope" v-model="exportSelection[scope]" :label="tn(scope)" :disabled="busy" />
      </div>
      <Button :disabled="busy || !Object.values(exportSelection).some(Boolean)" @click="run(save)">
        {{ tn('export') }}
      </Button>
    </SettingsCard>
    <SettingsCard>
      <h2 :class="['text-lg font-semibold']">
        {{ tn('restore') }}
      </h2>
      <p :class="['text-sm leading-relaxed']">
        {{ tn('restore-help') }}
      </p>
      <Button :disabled="busy || !!status.pending" @click="run(inspect)">
        {{ tn('pick') }}
      </Button>
      <section v-if="preview" :aria-label="tn('preview')" :class="['flex min-w-0 flex-col gap-3']">
        <h3 :class="['font-medium']">
          {{ tn('preview') }}
        </h3>
        <p>{{ date(preview.createdAt) }} · {{ tn('version') }} {{ preview.appVersion }}</p>
        <p :class="['break-all text-xs']">
          SHA-256: {{ preview.sha256 }}
        </p>
        <p>{{ tn('manifest') }}: {{ preview.manifest.length }}</p>
        <div :class="['max-h-64 overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-700']">
          <table :class="['w-full text-left text-xs']">
            <thead>
              <tr>
                <th :class="['p-2']">
                  {{ tn('entry') }}
                </th><th :class="['p-2']">
                  {{ tn('bytes') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in preview.manifest.slice(0, 100)" :key="item.key">
                <td :class="['break-all p-2']">
                  {{ item.key }}
                </td><td :class="['p-2']">
                  {{ item.bytes }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="preview.manifest.length > 100" :class="['text-xs']">
          {{ tn('manifest-limit') }}
        </p>
        <div role="group" :aria-label="tn('restore-scope')" :class="['flex flex-col gap-3']">
          <FieldCheckbox v-for="scope in scopes" :key="scope" v-model="restoreSelection[scope]" :label="tn(scope)" :disabled="busy || !preview.scopes[scope]" />
        </div>
        <p :class="['text-sm leading-relaxed text-amber-700 dark:text-amber-300']">
          {{ tn('confirmation') }}
        </p>
        <Button :disabled="busy || !Object.values(restoreSelection).some(Boolean)" @click="run(queue)">
          {{ tn('schedule') }}
        </Button>
      </section>
      <section v-if="status.pending" :aria-label="tn('pending')" :class="['flex flex-col gap-3']">
        <h3 :class="['font-medium']">
          {{ tn('pending') }}
        </h3>
        <p>{{ tn('restart-help') }}</p>
        <p>{{ scopes.filter(scope => status.pending?.scopes[scope]).map(scope => tn(scope)).join(' · ') }}</p>
        <div :class="['flex flex-wrap gap-3']">
          <Button :disabled="busy" @click="run(async () => { await restart() })">
            {{ tn('restart') }}
          </Button>
          <Button :disabled="busy" @click="run(async () => { status = await cancel() })">
            {{ tn('cancel') }}
          </Button>
        </div>
      </section>
    </SettingsCard>
    <SettingsCard>
      <p v-if="status.last" :class="['break-all text-sm']">
        {{ tn(status.last.outcome) }} · {{ date(status.last.at) }} · {{ status.last.checkpoint }}
      </p>
      <Button :disabled="busy" @click="run(async () => { await openFolder() })">
        {{ tn('open-folder') }}
      </Button>
    </SettingsCard>
    <p v-if="message" :role="failed ? 'alert' : 'status'" :class="['break-all text-sm']">
      {{ message }}
    </p>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: wow-companion.backup.title
  descriptionKey: wow-companion.backup.description
  subtitleKey: settings.title
  icon: i-solar:database-bold-duotone
  settingsTool: true
  order: 12
</route>
