<script setup lang="ts">
import type { CaptureSettings, CompanionSettings, DemoRequest, GameVersion } from '../../shared/wow-companion'
import type { EquipmentHistoryEntry } from '../../shared/wow-companion-equipment-history'

import { errorMessageFrom } from '@moeru/std'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { Button, Collapsible, FieldCheckbox, FieldInput, Input, Radio, SettingsCard } from '@proj-airi/ui'
import { computed, defineAsyncComponent, onMounted, reactive, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { defaultSettings } from '../../shared/wow-companion'
import { formatCompanionError } from '../../shared/wow-companion-errors'
import { useWowCompanionStore } from '../stores/wow-companion'
import { useWowCompanionMemoriesStore } from '../stores/wow-companion-memories'
import { useWowPlayerAddressSettingsStore } from '../stores/wow-player-address-settings'

const props = defineProps<{ game: GameVersion }>()
const WowCompanionEquipmentSwaps = defineAsyncComponent(() => import('./wow-companion-equipment-swaps.vue'))
const WowCompanionEquipment = defineAsyncComponent(() => import('./wow-companion-equipment.vue'))
const WowCompanionItemStorage = defineAsyncComponent(() => import('./wow-companion-item-storage.vue'))
const WowCompanionLevelHistory = defineAsyncComponent(() => import('./wow-companion-level-history.vue'))
const WowCompanionLoadout = defineAsyncComponent(() => import('./wow-companion-loadout.vue'))
const WowConnectionStatus = defineAsyncComponent(() => import('./wow-connection-status.vue'))

// Route wrappers key this component by game. Pending actions retain their original profile.
const game = props.game
const router = useRouter()
const { t, locale } = useI18n()
const tn = (key: string) => t(`wow-companion.${key}`)
const companion = useWowCompanionStore()
const memories = useWowCompanionMemoriesStore()
const cards = useAiriCardStore()
const collectingMemory = ref(false)
const profile = companion.profiles[game]
const consciousness = useConsciousnessStore()
const settings = reactive<CompanionSettings>({ ...defaultSettings, enabled: game === 'retail' })
const capture = reactive<CaptureSettings>({ x: 8, y: 8, cellSize: 1, pollMs: 100, paused: false })
const busy = ref(false)
const message = ref('')
const actionError = ref('')
const accountNames = reactive<Record<string, string>>({})
const goldSavingAccount = ref('')
const goldMessage = ref('')
const goldActionError = ref('')
const storedAccountNames = new Map<string, string>()
const settingsLoaded = ref(false)
const captureLoaded = ref(false)
const archivesOpen = ref(false)
const diagnosticsOpen = ref(false)
const activityOpen = ref(false)
const panelId = useId()
const playerAddress = useWowPlayerAddressSettingsStore()
const addressMode = ref<string>(playerAddress.mode)
const customAddress = ref(playerAddress.customName)
const addressInvalid = ref(false)
const addressSaved = ref(false)

watch(() => [playerAddress.mode, playerAddress.customName] as const, ([mode, name]) => {
  addressMode.value = mode
  customAddress.value = name
  addressInvalid.value = false
  addressSaved.value = false
}, { flush: 'sync' })

function clearAddressFeedback() {
  addressInvalid.value = false
  addressSaved.value = false
}

function selectAddressMode(mode: string) {
  addressMode.value = mode
  addressInvalid.value = false
  addressSaved.value = false
  if (mode === 'character')
    playerAddress.setCharacterName()
}

function saveCustomAddress() {
  addressInvalid.value = !playerAddress.setCustomName(customAddress.value)
  addressSaved.value = !addressInvalid.value
  if (addressSaved.value)
    customAddress.value = playerAddress.customName
}

async function collectEquipmentMemory(entry: EquipmentHistoryEntry) {
  if (collectingMemory.value)
    return
  collectingMemory.value = true
  actionError.value = ''
  message.value = ''
  try {
    await memories.collectEquipment({ personaId: cards.activeCardId, character: { game, account: entry.account, guid: entry.record.guid }, characterName: entry.name, record: entry.record })
    message.value = t('wow-companion.memory.notifications.saved')
  }
  catch {
    actionError.value = t('wow-companion.memory.notifications.operation-failed')
  }
  finally {
    collectingMemory.value = false
  }
}

const bridge = computed(() => profile.state.bridge)
const snapshot = computed(() => bridge.value?.snapshot)
const status = computed(() => {
  if (!profile.state.settings.enabled)
    return 'disabled'
  if (profile.error || profile.state.error)
    return 'disconnected'
  return bridge.value?.status ?? 'waiting'
})
const isCurrent = computed(() => status.value === 'live' || status.value === 'demo')
const error = computed(() => actionError.value || profile.error || profile.state.error || bridge.value?.error)
const preferences = ['enabled', 'muted', 'quietInCombat', 'levelUp', 'zone', 'death', 'revive', 'allowDemo'] as const
const demoActions = ['level_up', 'zone', 'death', 'revive', 'combat'] as const
const goldAccounts = computed(() => profile.state.gold.accounts)
const currentMoney = computed(() => {
  if (status.value !== 'live' || bridge.value?.source !== 'screen' || bridge.value.error || !snapshot.value?.online)
    return null
  return snapshot.value.copper
})
const summaryFields = ['earned', 'spent', 'net', 'balance'] as const
const coordinates = computed(() => {
  const current = snapshot.value
  const age = bridge.value?.ageSeconds
  if (status.value !== 'live' || bridge.value?.source !== 'screen' || error.value || !current?.online
    || !current.map || typeof current.px !== 'number' || typeof current.py !== 'number'
    || typeof age !== 'number' || !Number.isFinite(age) || age < 0 || age > 5) {
    return null
  }
  const formatter = new Intl.NumberFormat(locale.value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return { x: formatter.format(current.px / 100), y: formatter.format(current.py / 100) }
})

/** Keep full copper precision for account totals that exceed the safe number range. */
function formatMoney(copper: string | number) {
  const amount = BigInt(copper)
  const absolute = amount < 0n ? -amount : amount
  return t('wow-companion.gold.money', {
    sign: amount < 0n ? '−' : '',
    gold: (absolute / 10000n).toLocaleString(locale.value),
    silver: (absolute % 10000n / 100n).toString(),
    copper: (absolute % 100n).toString(),
  })
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString(locale.value)
}

watch(goldAccounts, (accounts) => {
  for (const account of accounts) {
    if (!(account.account in accountNames) || accountNames[account.account] === storedAccountNames.get(account.account))
      accountNames[account.account] = account.name
    storedAccountNames.set(account.account, account.name)
  }
}, { immediate: true })

watch(() => profile.state, (value) => {
  if (!settingsLoaded.value && profile.loaded) {
    Object.assign(settings, value.settings)
    settingsLoaded.value = true
  }
  if (!captureLoaded.value && value.bridge) {
    Object.assign(capture, value.bridge.config)
    captureLoaded.value = true
  }
}, { immediate: true })

async function perform(action: () => Promise<void>, success = 'saved') {
  busy.value = true
  actionError.value = ''
  message.value = ''
  try {
    await action()
    message.value = tn(success)
  }
  catch (cause) {
    actionError.value = errorMessageFrom(cause) ?? tn('failed')
  }
  finally {
    busy.value = false
  }
}

function demo(enabled: boolean, action: DemoRequest['action'] = 'none') {
  return perform(() => companion.demo(game, { enabled, action }))
}

async function saveAccountName(account: string) {
  goldSavingAccount.value = account
  goldActionError.value = ''
  goldMessage.value = ''
  try {
    await companion.setAccountName(game, { account, name: accountNames[account] ?? '' })
    if (profile.state.gold.storageError)
      return
    const saved = profile.state.gold.accounts.find(item => item.account === account)
    if (saved)
      accountNames[account] = saved.name
    goldMessage.value = tn('saved')
  }
  catch (cause) {
    goldActionError.value = errorMessageFrom(cause) ?? tn('failed')
  }
  finally {
    goldSavingAccount.value = ''
  }
}

onMounted(() => companion.start())
</script>

<template>
  <div :class="['mx-auto max-w-4xl pb-12', 'flex flex-col gap-5']">
    <nav :aria-label="tn('versions.label')" :class="['flex flex-wrap gap-2']">
      <Button
        v-for="version in ['retail', 'forever'] as const" :key="version"
        :variant="game === version ? 'primary' : 'secondary'" :color="game === version ? 'primary' : 'neutral'"
        :aria-current="game === version ? 'page' : undefined"
        @click="router.push(version === 'retail' ? '/settings/wow-companion' : '/settings/wow-companion-forever')"
      >
        {{ tn(`versions.${version}.name`) }}
      </Button>
    </nav>
    <header>
      <h2 :class="['text-xl font-semibold']">
        {{ tn(`versions.${game}.name`) }}
      </h2>
      <p :class="['mt-2 text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('versions.isolation') }}
      </p>
      <p v-if="game === 'forever'" :class="['mt-2 text-sm text-amber-700 dark:text-amber-300']">
        {{ tn('versions.forever.preview') }}
      </p>
    </header>
    <SettingsCard>
      <header>
        <h2 :class="['text-lg font-semibold']">
          {{ tn('connection') }}
        </h2>
        <p :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('description') }}
        </p>
      </header>
      <div :class="['flex flex-col gap-3']">
        <div :class="['flex flex-wrap items-center gap-3']">
          <span :class="['rounded-full px-3 py-1 text-sm font-medium', isCurrent ? 'bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-100' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300']">
            {{ tn(`status.${status}`) }}
          </span>
          <span v-if="bridge?.lastSeen" :class="['text-xs text-neutral-500']">{{ tn('last-seen') }} {{ new Date(bridge.lastSeen).toLocaleTimeString() }}</span>
        </div>
        <p v-if="status === 'demo'" :class="['text-sm text-amber-700 dark:text-amber-300']">
          {{ tn('demo-warning') }}
        </p>
        <p v-if="!consciousness.activeProvider || !consciousness.activeModel" :class="['text-sm text-amber-700 dark:text-amber-300']">
          {{ tn('model-required') }}
        </p>
        <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('start-bridge') }}
        </p>
        <p v-if="error && (actionError || profile.error || profile.state.error || !bridge?.connection?.reason)" role="alert" :class="['break-words text-sm text-red-600 dark:text-red-400']">
          {{ formatCompanionError(error, t) }}
        </p>
        <p v-if="message" role="status" :class="['text-sm text-primary-600 dark:text-primary-300']">
          {{ message }}
        </p>
        <div v-if="snapshot" :class="['grid grid-cols-2 gap-4 rounded-xl p-4 sm:grid-cols-3', 'bg-neutral-50 dark:bg-neutral-900', !isCurrent && 'opacity-60']">
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('player') }}
            </p><p>{{ snapshot.name }} · {{ snapshot.realm }}</p>
          </div>
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('level') }}
            </p><p :class="['text-2xl font-semibold']">
              {{ snapshot.level }}
            </p>
          </div>
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('zone-label') }}
            </p><p>{{ snapshot.zone }}</p>
          </div>
          <div data-testid="wow-coordinates">
            <p :class="['text-xs text-neutral-500']">
              {{ tn('coordinates.title') }}
            </p>
            <p>{{ coordinates ? t('wow-companion.coordinates.value', coordinates) : tn('coordinates.unavailable') }}</p>
            <p :class="['mt-1 text-xs text-neutral-500']">
              {{ tn('coordinates.note') }}
            </p>
          </div>
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('class-spec') }}
            </p><p>{{ snapshot.class }} / {{ snapshot.spec }}</p>
          </div>
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('faction') }}
            </p><p>{{ snapshot.faction === null ? tn('identity-unknown') : tn(`factions.${snapshot.faction}`) }}</p>
          </div>
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('race') }}
            </p><p :class="['break-words']">
              {{ snapshot.race ?? tn('identity-unknown') }}
            </p>
          </div>
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('activity') }}
            </p><p>{{ tn(snapshot.dead ? 'dead' : snapshot.combat ? 'combat' : 'exploring') }}</p>
          </div>
          <div>
            <p :class="['text-xs text-neutral-500']">
              {{ tn('freshness') }}
            </p><p>{{ tn(isCurrent ? 'current' : 'historical') }}</p>
          </div>
        </div>
        <p v-else :class="['text-sm text-neutral-500']">
          {{ tn('no-character') }}
        </p>
      </div>
    </SettingsCard>

    <SettingsCard>
      <header>
        <h2 :class="['text-lg font-semibold']">
          {{ tn('preferences') }}
        </h2>
        <p :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('preferences-description') }}
        </p>
      </header>
      <div :class="['flex flex-col gap-5']">
        <FieldCheckbox v-for="key in preferences" :key="key" v-model="settings[key]" :label="tn(`options.${key}`)" :description="tn(`hints.${key}`)" :disabled="busy || !settingsLoaded" />
        <FieldInput v-model="settings.cooldownSeconds" type="number" :label="tn('cooldown')" :description="tn('cooldown-description')" :disabled="busy || !settingsLoaded" />
        <div>
          <Button color="primary" variant="primary" :loading="busy" :disabled="!settingsLoaded" @click="perform(() => companion.setSettings(game, { ...settings }))">
            {{ tn('save-preferences') }}
          </Button>
        </div>
        <div :class="['flex flex-col items-start gap-2']">
          <Button @click="router.push('/settings/wow-chatter')">
            {{ tn('chatter.title') }}
          </Button>
          <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
            {{ tn('chatter.description') }}
          </p>
        </div>
      </div>
    </SettingsCard>

    <SettingsCard>
      <section :aria-label="tn('player-address.title')" :class="['flex flex-col gap-4']">
        <h2 :class="['text-lg font-semibold']">
          {{ tn('player-address.title') }}
        </h2>
        <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('player-address.description') }}
        </p>
        <div role="radiogroup" :aria-label="tn('player-address.title')" :class="['flex flex-col gap-2']">
          <Radio
            :id="`${game}-address-character`" :model-value="addressMode" :name="`${game}-player-address`"
            value="character" :title="tn('player-address.character')"
            :class="['focus-within:outline focus-within:outline-2 focus-within:outline-primary-400']"
            @update:model-value="selectAddressMode"
          />
          <p :class="['px-3 text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('player-address.character-hint') }}
          </p>
          <Radio
            :id="`${game}-address-custom`" :model-value="addressMode" :name="`${game}-player-address`"
            value="custom" :title="tn('player-address.custom')"
            :class="['focus-within:outline focus-within:outline-2 focus-within:outline-primary-400']"
            @update:model-value="selectAddressMode"
          />
        </div>
        <div v-if="addressMode === 'custom'" :class="['flex flex-col gap-3']">
          <label :for="`${game}-address-name`" :class="['text-sm font-medium']">
            {{ tn('player-address.custom-label') }}
          </label>
          <Input
            :id="`${game}-address-name`" v-model="customAddress" type="text" autocomplete="off"
            :aria-invalid="addressInvalid" :aria-describedby="`${game}-address-hint${addressInvalid ? ` ${game}-address-error` : ''}`"
            @update:model-value="clearAddressFeedback"
            @keydown.enter.prevent="saveCustomAddress"
          />
          <p :id="`${game}-address-hint`" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
            {{ tn('player-address.custom-hint') }}
          </p>
          <p v-if="addressInvalid" :id="`${game}-address-error`" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
            {{ tn('player-address.invalid') }}
          </p>
          <p v-if="addressSaved" role="status" :class="['text-sm text-primary-600 dark:text-primary-300']">
            {{ tn('player-address.saved') }}
          </p>
          <Button :class="['self-start']" @click="saveCustomAddress">
            {{ tn('player-address.save') }}
          </Button>
        </div>
        <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
          {{ tn('player-address.conversation-hint') }}
        </p>
      </section>
    </SettingsCard>

    <SettingsCard>
      <Collapsible v-model="archivesOpen">
        <template #trigger="{ visible, setVisible }">
          <Button :aria-expanded="visible" :aria-controls="`${panelId}-archives`" :icon="visible ? 'i-solar:alt-arrow-up-linear' : 'i-solar:alt-arrow-down-linear'" @click="setVisible(!visible)">
            {{ tn('archives.title') }}
          </Button>
        </template>
        <div :id="`${panelId}-archives`" :class="['mt-4 min-w-0 flex flex-col gap-5']" data-testid="wow-archives">
          <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
            {{ tn('archives.description') }}
          </p>
          <WowCompanionLevelHistory :game="game" :history="profile.state.levelHistory" :current="status === 'live' && !error && snapshot?.online ? snapshot : null" />
          <WowCompanionLoadout :game="game" :history="profile.state.equipmentLoadouts" :current="status === 'live' && !error && snapshot?.online ? snapshot : null" :error="bridge?.equipmentLoadoutError ?? null" />
          <WowCompanionItemStorage :game="game" :summary="profile.state.itemStorage" />
          <WowCompanionEquipment :game="game" :bridge="bridge" :history="profile.state.equipmentHistory" :comparisons="profile.state.equipmentComparisons" :collecting="collectingMemory" @collect-memory="collectEquipmentMemory" />
          <WowCompanionEquipmentSwaps :bridge="bridge" :current="isCurrent && !error && Boolean(snapshot?.online)" />

          <SettingsCard>
            <header>
              <h2 :class="['text-lg font-semibold']">
                {{ tn('gold.title') }}
              </h2>
              <p :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
                {{ tn('gold.description') }}
              </p>
            </header>
            <div :class="['flex flex-col gap-5']">
              <div :class="['rounded-xl p-4', 'bg-neutral-50 dark:bg-neutral-900']">
                <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
                  {{ tn('gold.current-balance') }}
                </p>
                <p v-if="currentMoney !== null" :class="['mt-1 text-xl font-semibold tabular-nums']">
                  {{ formatMoney(currentMoney) }}
                </p>
                <p v-else :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
                  {{ tn('gold.current-unavailable') }}
                </p>
              </div>
              <p v-if="profile.state.gold.storageError" role="alert" :class="['break-words text-sm text-red-600 dark:text-red-400']">
                {{ tn('gold.storage-error') }} {{ formatCompanionError(profile.state.gold.storageError, t) }}
              </p>
              <p v-if="goldActionError" role="alert" :class="['break-words text-sm text-red-600 dark:text-red-400']">
                {{ formatCompanionError(goldActionError, t) }}
              </p>
              <p v-if="goldMessage" role="status" :class="['text-sm text-primary-600 dark:text-primary-300']">
                {{ goldMessage }}
              </p>
              <p v-if="!goldAccounts.length" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
                {{ tn('gold.empty') }}
              </p>
              <article
                v-for="account in goldAccounts" :key="account.account"
                :aria-label="account.name || account.account"
                :class="['min-w-0 rounded-xl p-4', 'border border-neutral-200 dark:border-neutral-800', 'flex flex-col gap-4']"
              >
                <div>
                  <h3 :class="['font-semibold']">
                    {{ account.name || tn('gold.unnamed-account') }}
                  </h3>
                  <p :class="['mt-1 break-all text-xs text-neutral-500 dark:text-neutral-400']">
                    {{ tn('gold.account-id') }} {{ account.account }}
                  </p>
                  <p :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
                    {{ t('wow-companion.gold.character-count', { count: account.characterCount }) }} · {{ tn('gold.since') }} {{ formatDate(account.firstSeen) }}
                  </p>
                </div>
                <form :class="['flex flex-col gap-2 sm:flex-row sm:items-end']" @submit.prevent="saveAccountName(account.account)">
                  <div :class="['min-w-0 flex-1']">
                    <label :for="`gold-account-${game}-${account.account}`" :class="['mb-1 block text-sm']">{{ tn('gold.account-name') }}</label>
                    <Input
                      :id="`gold-account-${game}-${account.account}`" v-model="accountNames[account.account]"
                      type="text" :maxlength="64" :placeholder="tn('gold.account-name-placeholder')"
                      :disabled="Boolean(goldSavingAccount)" :aria-describedby="`gold-account-${game}-help-${account.account}`"
                    />
                    <p :id="`gold-account-${game}-help-${account.account}`" :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
                      {{ tn('gold.account-name-help') }}
                    </p>
                  </div>
                  <Button type="submit" color="primary" variant="primary" :loading="goldSavingAccount === account.account" :disabled="Boolean(goldSavingAccount)">
                    {{ tn('gold.save-name') }}
                  </Button>
                </form>
                <dl :class="['grid grid-cols-1 gap-4 sm:grid-cols-2']">
                  <div v-for="field in summaryFields" :key="field">
                    <dt :class="['text-xs text-neutral-500 dark:text-neutral-400']">
                      {{ tn(`gold.${field}`) }}
                    </dt>
                    <dd :class="['mt-1 break-words font-medium tabular-nums']">
                      {{ formatMoney(account[field]) }}
                    </dd>
                  </div>
                </dl>
                <div :class="['overflow-x-auto']">
                  <table :class="['w-full text-left text-sm']">
                    <caption :class="['mb-2 text-left text-xs text-neutral-500 dark:text-neutral-400']">
                      {{ tn('gold.characters-description') }}
                    </caption>
                    <thead :class="['text-neutral-500 dark:text-neutral-400']">
                      <tr>
                        <th v-for="column in ['character', 'realm', 'character-balance', 'earned', 'spent', 'last-seen']" :key="column" scope="col" :class="['whitespace-nowrap px-2 py-2 font-medium']">
                          {{ tn(`gold.${column}`) }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="character in account.characters" :key="character.guid" :class="['border-t border-neutral-200 dark:border-neutral-800']">
                        <th scope="row" :class="['whitespace-nowrap px-2 py-3 font-medium']">
                          {{ character.name }}
                        </th>
                        <td :class="['whitespace-nowrap px-2 py-3']">
                          {{ character.realm }}
                        </td>
                        <td :class="['whitespace-nowrap px-2 py-3 tabular-nums']">
                          {{ formatMoney(character.copper) }}
                        </td>
                        <td :class="['whitespace-nowrap px-2 py-3 tabular-nums']">
                          {{ formatMoney(character.earned) }}
                        </td>
                        <td :class="['whitespace-nowrap px-2 py-3 tabular-nums']">
                          {{ formatMoney(character.spent) }}
                        </td>
                        <td :class="['whitespace-nowrap px-2 py-3 text-xs text-neutral-500 dark:text-neutral-400']">
                          <time :datetime="new Date(character.lastSeen).toISOString()">{{ formatDate(character.lastSeen) }}</time>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </article>
              <ul :class="['list-disc pl-5 text-xs text-neutral-500 dark:text-neutral-400', 'flex flex-col gap-2']">
                <li>{{ tn('gold.identity-note') }}</li>
                <li>{{ tn('gold.flow-note') }}</li>
                <li>{{ tn('gold.balance-note') }}</li>
                <li>{{ tn('gold.demo-note') }}</li>
              </ul>
            </div>
          </SettingsCard>
        </div>
      </Collapsible>
    </SettingsCard>
    <SettingsCard>
      <Collapsible v-model="diagnosticsOpen">
        <template #trigger="{ visible, setVisible }">
          <Button :aria-expanded="visible" :aria-controls="`${panelId}-diagnostics`" @click="setVisible(!visible)">
            {{ tn('archives.diagnostics') }}
          </Button>
        </template>
        <div :id="`${panelId}-diagnostics`" :class="['mt-4 min-w-0 flex flex-col gap-5']" data-testid="wow-diagnostics">
          <WowConnectionStatus :bridge="bridge" :enabled="profile.state.settings.enabled" :busy="busy" @retry="perform(() => companion.reconnect(game), 'connection-details.retry-started')" />
          <SettingsCard>
            <header>
              <h2 :class="['text-lg font-semibold']">
                {{ tn('capture') }}
              </h2>
              <p :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
                {{ tn('capture-description') }}
              </p>
            </header>
            <div :class="['grid grid-cols-2 gap-4']">
              <FieldInput v-model="capture.x" type="number" :label="tn('capture-x')" :disabled="busy" />
              <FieldInput v-model="capture.y" type="number" :label="tn('capture-y')" :disabled="busy" />
              <FieldInput v-model="capture.cellSize" type="number" :label="tn('cell-size')" :disabled="busy" />
              <FieldInput v-model="capture.pollMs" type="number" :min="100" :max="5000" :step="100" :label="tn('poll-ms')" :disabled="busy" />
              <FieldCheckbox v-model="capture.paused" :label="tn('pause-capture')" :disabled="busy" />
            </div>
            <p :class="['my-4 text-sm text-neutral-500']">
              {{ tn(`versions.${game}.capture-help`) }}
            </p>
            <Button :loading="busy" :disabled="!bridge || !profile.state.settings.enabled" @click="perform(() => companion.setCapture(game, { ...capture }))">
              {{ tn('save-capture') }}
            </Button>
          </SettingsCard>
        </div>
      </Collapsible>
    </SettingsCard>
    <SettingsCard>
      <Collapsible v-model="activityOpen">
        <template #trigger="{ visible, setVisible }">
          <Button :aria-expanded="visible" :aria-controls="`${panelId}-activity`" @click="setVisible(!visible)">
            {{ tn('archives.activity') }}
          </Button>
        </template>
        <div :id="`${panelId}-activity`" :class="['mt-4 min-w-0 flex flex-col gap-5']" data-testid="wow-activity">
          <SettingsCard>
            <header>
              <h2 :class="['text-lg font-semibold']">
                {{ tn('demo') }}
              </h2>
              <p :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
                {{ tn('demo-description') }}
              </p>
            </header>
            <div :class="['flex flex-wrap gap-2']">
              <Button :loading="busy" :disabled="!bridge || !profile.state.settings.enabled" @click="demo(bridge?.source !== 'demo')">
                {{ tn(bridge?.source === 'demo' ? 'stop-demo' : 'start-demo') }}
              </Button>
              <Button v-for="action in demoActions" :key="action" :disabled="busy || !profile.state.settings.enabled || bridge?.source !== 'demo'" @click="demo(true, action)">
                {{ tn(`actions.${action}`) }}
              </Button>
            </div>
          </SettingsCard>

          <SettingsCard>
            <header>
              <h2 :class="['text-lg font-semibold']">
                {{ tn('events') }}
              </h2>
              <p :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
                {{ tn('events-description') }}
              </p>
            </header>
            <ol v-if="bridge?.events.length" :class="['flex max-h-80 flex-col gap-3 overflow-y-auto']">
              <li v-for="event in [...bridge.events].reverse()" :key="event.id" :class="['rounded-lg p-3', 'bg-neutral-50 dark:bg-neutral-900']">
                <div :class="['flex items-center justify-between gap-3 text-sm']">
                  <strong>{{ event.demo ? `[${tn('demo-label')}] ` : '' }}{{ event.title }}</strong>
                  <time :datetime="event.timestamp" :class="['shrink-0 text-xs text-neutral-500']">{{ new Date(event.timestamp).toLocaleTimeString() }}</time>
                </div>
                <p :class="['mt-1 text-sm text-neutral-500']">
                  {{ event.detail }}
                </p>
              </li>
            </ol>
            <p v-else :class="['text-sm text-neutral-500']">
              {{ tn('no-events') }}
            </p>
          </SettingsCard>
        </div>
      </Collapsible>
    </SettingsCard>
  </div>
</template>
