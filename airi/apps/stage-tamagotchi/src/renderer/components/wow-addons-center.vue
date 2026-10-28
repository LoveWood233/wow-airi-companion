<script setup lang="ts">
import type { AddonCategory, AddonFile, AddonGame, AddonMetadata, AddonSearchRequest, AddonSettings, AddonSummary, InstalledAddon } from '../../shared/wow-addons'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Button, GhostButton, Input, Select, SettingsCard } from '@proj-airi/ui'
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { wowAddonsFiles, wowAddonsGetSettings, wowAddonsInstall, wowAddonsInstalled, wowAddonsMetadata, wowAddonsSearch } from '../../shared/eventa/wow-addons'

const { t, te, locale } = useI18n()
const tn = (key: string) => t(`wow-addons.${key}`)
const router = useRouter()
const getSettings = useElectronEventaInvoke(wowAddonsGetSettings)
const getMetadata = useElectronEventaInvoke(wowAddonsMetadata)
const searchAddons = useElectronEventaInvoke(wowAddonsSearch)
const getFiles = useElectronEventaInvoke(wowAddonsFiles)
const installAddon = useElectronEventaInvoke(wowAddonsInstall)
const getInstalled = useElectronEventaInvoke(wowAddonsInstalled)
const games: AddonGame[] = ['retail', 'classic', 'forever']
const game = ref<AddonGame>('retail')
const view = ref<'browse' | 'installed'>('browse')
const settings = ref<AddonSettings>()
const metadata = ref<AddonMetadata>()
const loading = ref(false)
const searching = ref(false)
const filesLoading = ref(false)
const installedLoading = ref(false)
const installing = ref(false)
const searchInput = ref('')
const query = ref('')
const category = ref(0)
const sort = ref<AddonSearchRequest['sort']>('popular')
const index = ref(0)
const total = ref(0)
const addons = ref<AddonSummary[]>([])
const installed = ref<InstalledAddon[]>([])
const selected = ref<{ id: number, name: string }>()
const files = ref<AddonFile[]>([])
const fileId = ref<number>()
const loadError = ref('')
const searchError = ref('')
const filesError = ref('')
const installedError = ref('')
const installError = ref('')
const message = ref('')
const details = ref<HTMLElement>()

// Each read belongs to its selection generation. Navigation and disposal invalidate pending reads.
let active = true
let searchRequest = 0
let filesRequest = 0
let installedRequest = 0
onScopeDispose(() => {
  active = false
  searchRequest++
  filesRequest++
  installedRequest++
})

const client = computed(() => settings.value?.clients[game.value])
const versionType = computed(() => metadata.value?.versionTypes.find(type => type.id === client.value?.gameVersionTypeId && type.group === game.value))
const configured = computed(() => Boolean(client.value?.directory && versionType.value))
const selectedFile = computed(() => files.value.find(file => file.id === fileId.value))
const selectedInstalled = computed(() => installed.value.find(addon => addon.modId === selected.value?.id))
const sortOptions = computed(() => ['popular', 'updated', 'downloads'].map(value => ({ label: tn(`sort.${value}`), value: value as AddonSearchRequest['sort'] })))
const fileOptions = computed(() => files.value.map(file => ({ label: `${file.displayName} · ${releaseType(file.releaseType)} · ${formatDate(file.fileDate)}`, value: file.id })))
const categoryOptions = computed(() => {
  const categories = metadata.value?.categories
  const result = [{ value: 0, label: tn('categories.all') }]
  if (!categories)
    return result
  const visited = new Set<number>()
  function append(category: AddonCategory, depth: number) {
    if (visited.has(category.id))
      return
    visited.add(category.id)
    const key = `wow-addons.categories.${category.slug}`
    result.push({ value: category.id, label: `${'— '.repeat(depth)}${te(key) ? t(key) : category.name}` })
    for (const child of categories!.filter(child => child.parentCategoryId === category.id))
      append(child, depth + 1)
  }
  for (const category of categories.filter(category => !categories.some(parent => parent.id === category.parentCategoryId)))
    append(category, 0)
  for (const category of categories)
    append(category, 0)
  return result
})

function errorText(code: string) {
  const key = `wow-addons.errors.${code}`
  return te(key) ? t(key) : tn('errors.unknown')
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString(locale.value)
}

function releaseType(type: number) {
  return tn(type === 1 ? 'release.stable' : type === 2 ? 'release.beta' : 'release.alpha')
}

function clearSelection() {
  filesRequest++
  filesLoading.value = false
  selected.value = undefined
  files.value = []
  fileId.value = undefined
  filesError.value = ''
  installError.value = ''
  message.value = ''
}

async function load() {
  if (loading.value)
    return
  loading.value = true
  loadError.value = ''
  try {
    const result = await getSettings()
    if (!active)
      return
    if (!result.ok) {
      loadError.value = errorText(result.error)
      return
    }
    settings.value = result.data
    if (!result.data.hasApiKey)
      return
    const response = await getMetadata()
    if (!active)
      return
    if (!response.ok) {
      loadError.value = errorText(response.error)
      return
    }
    metadata.value = response.data
    await Promise.all([search(), refreshInstalled()])
  }
  catch (cause) {
    if (active)
      loadError.value = errorText(errorMessageFrom(cause) ?? '')
  }
  finally {
    if (active)
      loading.value = false
  }
}

async function search() {
  const request = ++searchRequest
  searchError.value = ''
  addons.value = []
  total.value = 0
  if (!settings.value?.hasApiKey || !configured.value || !versionType.value) {
    searching.value = false
    return
  }
  searching.value = true
  try {
    const response = await searchAddons({
      game: game.value,
      gameVersionTypeId: versionType.value.id,
      search: query.value,
      index: index.value,
      sort: sort.value,
      ...(category.value ? { categoryId: category.value } : {}),
    })
    if (!active || request !== searchRequest)
      return
    if (!response.ok) {
      searchError.value = errorText(response.error)
    }
    else {
      addons.value = response.data.addons
      total.value = response.data.totalCount
    }
  }
  catch (cause) {
    if (active && request === searchRequest)
      searchError.value = errorText(errorMessageFrom(cause) ?? '')
  }
  finally {
    if (active && request === searchRequest)
      searching.value = false
  }
}

async function refreshInstalled() {
  const request = ++installedRequest
  installed.value = []
  installedError.value = ''
  if (!client.value?.directory) {
    installedLoading.value = false
    return
  }
  installedLoading.value = true
  try {
    const response = await getInstalled({ game: game.value })
    if (!active || request !== installedRequest)
      return
    if (!response.ok)
      installedError.value = errorText(response.error)
    else
      installed.value = response.data
  }
  catch (cause) {
    if (active && request === installedRequest)
      installedError.value = errorText(errorMessageFrom(cause) ?? '')
  }
  finally {
    if (active && request === installedRequest)
      installedLoading.value = false
  }
}

async function selectAddon(addon: { id: number, name: string }) {
  if (installing.value || !versionType.value)
    return
  clearSelection()
  selected.value = addon
  const request = ++filesRequest
  filesLoading.value = true
  const typeId = versionType.value.id
  await nextTick()
  if (!active || request !== filesRequest)
    return
  details.value?.scrollIntoView({ block: 'nearest' })
  try {
    const response = await getFiles({ game: game.value, modId: addon.id, gameVersionTypeId: typeId })
    if (!active || request !== filesRequest)
      return
    if (!response.ok) {
      filesError.value = errorText(response.error)
    }
    else {
      files.value = response.data.filter(file => file.modId === addon.id && file.gameVersionTypeIds.includes(typeId))
      fileId.value = files.value[0]?.id
    }
  }
  catch (cause) {
    if (active && request === filesRequest)
      filesError.value = errorText(errorMessageFrom(cause) ?? '')
  }
  finally {
    if (active && request === filesRequest)
      filesLoading.value = false
  }
}

async function install() {
  if (installing.value || !selected.value || !selectedFile.value || !configured.value)
    return
  installing.value = true
  installError.value = ''
  message.value = ''
  try {
    const response = await installAddon({ game: game.value, modId: selected.value.id, fileId: selectedFile.value.id })
    if (!active)
      return
    if (!response.ok)
      installError.value = errorText(response.error)
    else
      message.value = tn('install-success')
  }
  catch (cause) {
    if (active)
      installError.value = errorText(errorMessageFrom(cause) ?? '')
  }
  finally {
    if (active) {
      await refreshInstalled()
      installing.value = false
    }
  }
}

function submitSearch() {
  const nextQuery = searchInput.value.trim()
  if (installing.value || (searching.value && nextQuery === query.value))
    return
  if (query.value === nextQuery) {
    index.value = 0
    clearSelection()
    search()
  }
  else {
    query.value = nextQuery
  }
}

function changePage(nextIndex: number) {
  index.value = nextIndex
  clearSelection()
  search()
}

watch(game, () => {
  category.value = 0
  refreshInstalled()
})
watch([game, category, sort, query], () => {
  index.value = 0
  clearSelection()
  search()
})
onMounted(load)
</script>

<template>
  <div :class="['mx-auto max-w-5xl pb-8', 'flex flex-col gap-5']">
    <div :class="['flex items-start justify-between gap-3']">
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('description') }}
      </p>
      <Button shape="circle" icon="i-solar:settings-linear" :aria-label="tn('settings.title')" :title="tn('settings.title')" :disabled="installing" @click="router.push('/settings/wow-addons-settings')" />
    </div>
    <div role="group" :aria-label="tn('game-version')" :class="['flex flex-wrap gap-2']">
      <GhostButton v-for="item in games" :key="item" :active="game === item" :aria-pressed="game === item" :label="tn(`games.${item}`)" :disabled="installing" @click="game = item" />
    </div>
    <p v-if="loading" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      {{ tn('loading') }}
    </p>
    <div v-if="loadError" role="alert" :class="['flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-400']">
      <p>{{ loadError }}</p>
      <Button :label="tn('retry')" :loading="loading" @click="load" />
    </div>
    <SettingsCard v-if="settings && !settings.hasApiKey">
      <div :class="['i-solar:key-minimalistic-square-bold-duotone size-10 text-primary-500']" />
      <h2 :class="['text-lg font-semibold']">
        {{ tn('setup.title') }}
      </h2>
      <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('setup.description') }}
      </p>
      <Button variant="primary" color="primary" :label="tn('setup.action')" @click="router.push('/settings/wow-addons-settings')" />
    </SettingsCard>
    <template v-else-if="metadata && settings">
      <SettingsCard v-if="!configured">
        <p :class="['font-medium']">
          {{ t('wow-addons.setup.client-title', { game: tn(`games.${game}`) }) }}
        </p>
        <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('setup.client-description') }}
        </p>
        <Button :label="tn('setup.configure-client')" @click="router.push('/settings/wow-addons-settings')" />
      </SettingsCard>
      <template v-else>
        <div :class="['min-w-0 text-xs text-neutral-500 dark:text-neutral-400']">
          <p>{{ t('wow-addons.current-version', { version: versionType?.name }) }}</p>
          <p :class="['mt-1 break-all']">
            {{ client?.directory }}
          </p>
        </div>
        <div role="group" :aria-label="tn('view')" :class="['flex gap-2']">
          <GhostButton :active="view === 'browse'" :aria-pressed="view === 'browse'" :label="tn('browse')" @click="view = 'browse'" />
          <GhostButton :active="view === 'installed'" :aria-pressed="view === 'installed'" :label="tn('installed')" @click="view = 'installed'" />
        </div>
        <template v-if="view === 'browse'">
          <form :class="['flex flex-col gap-3']" @submit.prevent="submitSearch">
            <div :class="['flex gap-2']">
              <Input v-model="searchInput" :aria-label="tn('search-label')" :placeholder="tn('search-placeholder')" :disabled="installing" />
              <Button type="submit" icon="i-solar:magnifer-linear" :label="tn('search')" :loading="searching" :disabled="installing" />
            </div>
            <div :class="['grid gap-3 sm:grid-cols-2']">
              <label :class="['flex flex-col gap-2 text-sm']">{{ tn('category') }}<Select v-model="category" :options="categoryOptions" :disabled="installing" /></label>
              <label :class="['flex flex-col gap-2 text-sm']">{{ tn('sort-label') }}<Select v-model="sort" :options="sortOptions" :disabled="installing" /></label>
            </div>
          </form>
          <p v-if="searching" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
            {{ tn('loading') }}
          </p>
          <div v-if="searchError" role="alert" :class="['flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-400']">
            <p>{{ searchError }}</p><Button :label="tn('retry')" @click="search" />
          </div>
          <p v-else-if="!searching && !addons.length" :class="['py-6 text-center text-sm text-neutral-500 dark:text-neutral-400']">
            {{ tn('no-results') }}
          </p>
          <div :class="['flex flex-col gap-3']">
            <article v-for="addon in addons" :key="addon.id" :class="['flex gap-3 rounded-xl p-3', 'bg-neutral-100 dark:bg-neutral-900']">
              <img v-if="addon.logoUrl" :src="addon.logoUrl" alt="" loading="lazy" :class="['size-14 shrink-0 rounded-lg object-cover']">
              <div v-else :class="['i-solar:widget-add-bold-duotone size-14 shrink-0 text-primary-400']" />
              <div :class="['min-w-0 flex-1']">
                <GhostButton :label="addon.name" :disabled="installing" :class="['max-w-full text-left font-semibold']" @click="selectAddon(addon)" />
                <p :class="['mt-1 break-words text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ t('wow-addons.authors', { authors: addon.authors.join(', ') }) }}
                </p>
                <p :class="['mt-2 break-words text-sm']">
                  {{ addon.summary }}
                </p>
                <p :class="['mt-2 text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ t('wow-addons.downloads', { count: addon.downloadCount.toLocaleString(locale) }) }}
                </p>
              </div>
            </article>
          </div>
          <div v-if="total > 0" :class="['flex flex-wrap items-center justify-between gap-3']">
            <Button :label="tn('previous')" :disabled="index === 0 || searching || installing" @click="changePage(Math.max(0, index - 20))" />
            <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              {{ t('wow-addons.pagination', { page: Math.floor(index / 20) + 1, pages: Math.ceil(total / 20), total }) }}
            </p>
            <Button :label="tn('next')" :disabled="index + 20 >= total || searching || installing" @click="changePage(index + 20)" />
          </div>
        </template>
        <template v-else>
          <div :class="['flex flex-wrap items-center justify-between gap-3']">
            <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              {{ tn('installed-description') }}
            </p><Button :label="tn('refresh')" :loading="installedLoading" :disabled="installing" @click="refreshInstalled" />
          </div>
          <p v-if="installedError" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
            {{ installedError }}
          </p>
          <p v-else-if="!installedLoading && !installed.length" :class="['py-6 text-center text-sm text-neutral-500 dark:text-neutral-400']">
            {{ tn('none-installed') }}
          </p>
          <article v-for="addon in installed" :key="addon.modId" :class="['flex flex-wrap items-center justify-between gap-3 rounded-xl p-4', 'bg-neutral-100 dark:bg-neutral-900']">
            <div :class="['min-w-0']">
              <h3 :class="['break-words font-medium']">
                {{ addon.name }}
              </h3><p :class="['mt-1 break-words text-xs text-neutral-500 dark:text-neutral-400']">
                {{ addon.version }}
              </p><p :class="['mt-1 break-all text-xs text-neutral-500 dark:text-neutral-400']">
                {{ addon.folders.join(', ') }}
              </p>
            </div>
            <Button :label="tn('choose-update')" :disabled="installing || addon.gameVersionTypeId !== versionType?.id" @click="selectAddon({ id: addon.modId, name: addon.name })" />
          </article>
        </template>
        <section v-if="selected" ref="details" :aria-label="tn('file-details')">
          <SettingsCard>
            <div :class="['flex items-center justify-between gap-3']">
              <h2 :class="['min-w-0 break-words font-semibold']">
                {{ selected.name }}
              </h2><Button shape="circle" icon="i-solar:close-circle-linear" :aria-label="tn('close')" :disabled="installing" @click="clearSelection" />
            </div>
            <p v-if="filesLoading" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
              {{ tn('loading-files') }}
            </p>
            <div v-if="filesError" role="alert" :class="['flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-400']">
              <p>{{ filesError }}</p><Button :label="tn('retry')" @click="selectAddon(selected)" />
            </div>
            <p v-else-if="!filesLoading && !files.length" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
              {{ tn('no-files') }}
            </p>
            <template v-if="files.length">
              <label :class="['flex flex-col gap-2 text-sm']">{{ tn('compatible-files') }}<Select v-model="fileId" :options="fileOptions" :disabled="installing" /></label>
              <template v-if="selectedFile">
                <p :class="['break-words text-xs text-neutral-500 dark:text-neutral-400']">
                  {{ selectedFile.gameVersions.join(', ') }}
                </p>
                <div :class="['text-sm text-neutral-600 dark:text-neutral-300']">
                  <p>{{ tn('required-dependencies') }}</p><p :class="['mt-1 break-words']">
                    {{ selectedFile.dependencies.filter(dependency => dependency.required).map(dependency => `#${dependency.modId}`).join(', ') || tn('no-dependencies') }}
                  </p><p :class="['mt-1 text-xs']">
                    {{ tn('dependencies-hint') }}
                  </p>
                </div>
                <p v-if="selectedInstalled?.fileId === selectedFile.id" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
                  {{ tn('current-file') }}
                </p>
                <Button variant="primary" color="primary" icon="i-solar:download-linear" :label="tn(selectedInstalled ? 'update' : 'install')" :loading="installing" :disabled="selectedInstalled?.fileId === selectedFile.id" @click="install" />
              </template>
            </template>
            <p v-if="installError" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
              {{ installError }}
            </p>
            <p v-if="message" role="status" :class="['text-sm text-primary-700 dark:text-primary-300']">
              {{ message }}
            </p>
            <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              {{ tn('settings.reload-hint') }}
            </p>
          </SettingsCard>
        </section>
      </template>
    </template>
  </div>
</template>
