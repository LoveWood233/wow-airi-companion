<script setup lang="ts">
import type { AddonClientSettings, AddonGame, AddonSettings, AddonVersionType } from '../../shared/wow-addons'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Button, FieldInput, Select, SettingsCard } from '@proj-airi/ui'
import { computed, onMounted, onScopeDispose, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { wowAddonsChooseDirectory, wowAddonsGetSettings, wowAddonsMetadata, wowAddonsSaveSettings } from '../../shared/eventa/wow-addons'

const { t, te } = useI18n()
const router = useRouter()
const tn = (key: string) => t(`wow-addons.${key}`)
const getSettings = useElectronEventaInvoke(wowAddonsGetSettings)
const saveSettings = useElectronEventaInvoke(wowAddonsSaveSettings)
const chooseDirectory = useElectronEventaInvoke(wowAddonsChooseDirectory)
const getMetadata = useElectronEventaInvoke(wowAddonsMetadata)
const games: AddonGame[] = ['retail', 'classic', 'forever']
const clients = reactive<Record<AddonGame, AddonClientSettings>>({
  retail: { directory: '', gameVersionTypeId: null },
  classic: { directory: '', gameVersionTypeId: null },
  forever: { directory: '', gameVersionTypeId: null },
})
const loaded = ref(false)
const busy = ref(false)
const metadataBusy = ref(false)
const hasApiKey = ref(false)
const apiKey = ref('')
const versionTypes = ref<AddonVersionType[]>([])
const error = ref('')
const metadataError = ref('')
const message = ref('')
let active = true
let metadataRequest = 0
onScopeDispose(() => {
  active = false
  metadataRequest++
  apiKey.value = ''
})

const options = computed(() => Object.fromEntries(games.map(game => [game, versionTypes.value
  .filter(type => type.group === game)
  .map(type => ({ label: type.name, value: type.id }))])) as Record<AddonGame, { label: string, value: number }[]>)

function errorText(code: string) {
  const key = `wow-addons.errors.${code}`
  return te(key) ? t(key) : tn('errors.unknown')
}

function applySettings(settings: AddonSettings) {
  hasApiKey.value = settings.hasApiKey
  for (const game of games)
    Object.assign(clients[game], settings.clients[game])
}

function installPath(directory: string) {
  const separator = directory.includes('\\') ? '\\' : '/'
  return `${directory.replace(/[\\/]+$/, '')}${separator}Interface${separator}AddOns`
}

async function loadMetadata() {
  const request = ++metadataRequest
  metadataError.value = ''
  versionTypes.value = []
  if (!hasApiKey.value)
    return
  metadataBusy.value = true
  try {
    const result = await getMetadata()
    if (!active || request !== metadataRequest)
      return
    if (!result.ok)
      metadataError.value = errorText(result.error)
    else
      versionTypes.value = result.data.versionTypes
  }
  catch (cause) {
    if (active && request === metadataRequest)
      metadataError.value = errorText(errorMessageFrom(cause) ?? '')
  }
  finally {
    if (active && request === metadataRequest)
      metadataBusy.value = false
  }
}

async function load() {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  try {
    const result = await getSettings()
    if (!active)
      return
    if (!result.ok) {
      error.value = errorText(result.error)
      return
    }
    applySettings(result.data)
    loaded.value = true
    await loadMetadata()
  }
  catch (cause) {
    if (active)
      error.value = errorText(errorMessageFrom(cause) ?? '')
  }
  finally {
    if (active)
      busy.value = false
  }
}

async function browse(game: AddonGame) {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await chooseDirectory({ game })
    if (!active)
      return
    if (!result.ok)
      error.value = errorText(result.error)
    else if (result.data !== null)
      clients[game].directory = result.data
  }
  catch (cause) {
    if (active)
      error.value = errorText(errorMessageFrom(cause) ?? '')
  }
  finally {
    if (active)
      busy.value = false
  }
}

async function save() {
  if (busy.value || !loaded.value)
    return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await saveSettings({
      clients: Object.fromEntries(games.map(game => [game, { ...clients[game] }])) as Record<AddonGame, AddonClientSettings>,
      ...(apiKey.value.trim() ? { apiKey: apiKey.value.trim() } : {}),
    })
    if (!active)
      return
    if (!result.ok) {
      error.value = errorText(result.error)
      return
    }
    applySettings(result.data)
    message.value = tn('settings.saved')
    await loadMetadata()
  }
  catch (cause) {
    if (active)
      error.value = errorText(errorMessageFrom(cause) ?? '')
  }
  finally {
    apiKey.value = ''
    if (active)
      busy.value = false
  }
}

function cancel() {
  apiKey.value = ''
  router.push('/settings/wow-addons')
}

onMounted(load)
</script>

<template>
  <div :class="['mx-auto max-w-4xl pb-8', 'flex flex-col gap-5']">
    <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ tn('settings.description') }}
    </p>
    <p v-if="error" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
      {{ error }}
    </p>
    <Button v-if="!loaded" :loading="busy" :label="tn('retry')" @click="load" />
    <template v-else>
      <SettingsCard>
        <div :class="['flex flex-wrap items-center justify-between gap-2']">
          <h2 :class="['font-semibold']">
            {{ tn('settings.key-title') }}
          </h2>
          <span role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">{{ tn(hasApiKey ? 'settings.key-configured' : 'settings.key-missing') }}</span>
        </div>
        <FieldInput v-model="apiKey" type="password" autocomplete="new-password" :label="tn('settings.key-label')" :description="tn('settings.key-description')" :disabled="busy" />
        <p :class="['text-sm text-neutral-600 dark:text-neutral-300']">
          {{ tn('settings.key-instructions') }}
        </p>
        <a href="https://support.curseforge.com/support/solutions/articles/9000208346-about-the-curseforge-api-and-how-to-apply-for-a-key" target="_blank" rel="noopener noreferrer" :class="['w-fit text-sm text-primary-600 underline dark:text-primary-300']">{{ tn('settings.key-link') }}</a>
      </SettingsCard>
      <p v-if="!hasApiKey" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('settings.save-key-first') }}
      </p>
      <p v-if="metadataError" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
        {{ metadataError }}
      </p>
      <Button v-if="metadataError" :loading="metadataBusy" :label="tn('settings.retry-metadata')" @click="loadMetadata" />
      <SettingsCard v-for="game in games" :key="game">
        <h2 :class="['font-semibold']">
          {{ tn(`games.${game}`) }}
        </h2>
        <div :class="['grid items-end gap-3 sm:grid-cols-[1fr_auto]']">
          <FieldInput v-model="clients[game].directory" :label="tn('settings.directory')" :description="tn('settings.directory-description')" :disabled="busy" />
          <Button :label="tn('settings.browse')" :aria-label="t('wow-addons.settings.browse-game', { game: tn(`games.${game}`) })" :disabled="busy" icon="i-solar:folder-open-linear" @click="browse(game)" />
        </div>
        <label :class="['flex flex-col gap-2 text-sm font-medium']">
          {{ tn('settings.version-type') }}
          <Select v-model="clients[game].gameVersionTypeId" :options="options[game]" :placeholder="tn('settings.choose-version')" :disabled="busy || metadataBusy || !options[game].length" />
        </label>
        <p v-if="hasApiKey && !metadataBusy && !metadataError && !options[game].length" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          {{ tn('settings.no-version-types') }}
        </p>
        <div v-if="clients[game].directory" :class="['min-w-0 text-xs text-neutral-500 dark:text-neutral-400']">
          <p>{{ tn('settings.install-target') }}</p>
          <p :class="['mt-1 break-all font-mono']">
            {{ installPath(clients[game].directory) }}
          </p>
        </div>
      </SettingsCard>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('settings.reload-hint') }}
      </p>
      <p v-if="message" role="status" :class="['text-sm text-primary-700 dark:text-primary-300']">
        {{ message }}
      </p>
      <div :class="['flex flex-wrap gap-3']">
        <Button variant="primary" color="primary" :label="tn('settings.save')" :loading="busy" @click="save" />
        <Button :label="tn('settings.cancel')" :disabled="busy" @click="cancel" />
        <Button :label="tn('settings.back')" :disabled="busy" icon="i-solar:arrow-left-linear" @click="router.push('/settings/wow-addons')" />
      </div>
    </template>
  </div>
</template>
