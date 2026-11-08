<script setup lang="ts">
import type { LocalUpdatePreview, LocalUpdateStatus } from '../../shared/wow-local-update'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Button, SettingsCard } from '@proj-airi/ui'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { wowLocalUpdateLaunch, wowLocalUpdatePick, wowLocalUpdateStatus } from '../../shared/eventa/wow-local-update'
import { BrowserBackupStorage } from '../utils/wow-browser-backup'

const { t } = useI18n()
const tn = (key: string) => t(`wow-companion.local-update.${key}`)
const getStatus = useElectronEventaInvoke(wowLocalUpdateStatus)
const pick = useElectronEventaInvoke(wowLocalUpdatePick)
const launch = useElectronEventaInvoke(wowLocalUpdateLaunch)
const status = ref<LocalUpdateStatus>({ supported: false, last: null })
const preview = ref<LocalUpdatePreview | null>(null)
const busy = ref(false)
const message = ref('')
const browser = new BrowserBackupStorage()
async function run(operation: () => Promise<void>) {
  if (busy.value)
    return
  busy.value = true
  message.value = ''
  try {
    await operation()
  }
  catch (error) {
    const code = errorMessageFrom(error) ?? ''
    message.value = tn(code.includes('update-version') ? 'version-error' : code.includes('update-checksum') ? 'checksum-error' : 'failed')
  }
  finally { busy.value = false }
}
async function inspect() {
  preview.value = null
  preview.value = await pick()
}
async function confirm() {
  if (!preview.value)
    return
  const id = preview.value.id
  preview.value = null
  await launch({ id, browser: await browser.read(true, false), portable: await browser.read(true, true) })
  message.value = tn('starting')
}
onMounted(() => run(async () => {
  status.value = await getStatus()
}))
</script>

<template>
  <SettingsCard :aria-busy="busy" role="region" :aria-label="tn('title')">
    <h2 :class="['text-lg font-semibold']">
      {{ tn('title') }}
    </h2>
    <p :class="['text-sm leading-relaxed']">
      {{ tn('description') }}
    </p>
    <p v-if="!status.supported" :class="['text-sm']">
      {{ tn('unsupported') }}
    </p>
    <Button :disabled="busy || !status.supported" @click="run(inspect)">
      {{ tn('pick') }}
    </Button>
    <section v-if="preview" :class="['flex flex-col gap-3']" :aria-label="tn('preview')">
      <h3 :class="['font-medium']">
        {{ tn('preview') }} · {{ preview.releaseVersion }}
      </h3>
      <p :class="['break-all text-sm']">
        {{ preview.directory }}
      </p>
      <p :class="['text-sm']">
        {{ tn('files') }}: {{ preview.files }} · {{ (preview.bytes / 1024 ** 2).toFixed(1) }} MiB
      </p>
      <p :class="['text-sm leading-relaxed text-amber-700 dark:text-amber-300']">
        {{ tn('confirmation') }}
      </p>
      <Button :disabled="busy" @click="run(confirm)">
        {{ tn('confirm') }}
      </Button>
    </section>
    <p v-if="status.last" :class="['break-all text-sm']">
      {{ tn(status.last.outcome) }} · {{ status.last.checkpoint }}
    </p>
    <p v-if="message" role="status" :class="['text-sm']">
      {{ message }}
    </p>
  </SettingsCard>
</template>
