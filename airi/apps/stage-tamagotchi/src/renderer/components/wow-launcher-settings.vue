<script setup lang="ts">
import type { LauncherTarget } from '../../shared/wow-launcher'

import { Button, FieldCheckbox, FieldInput, SettingsCard } from '@proj-airi/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useWowLauncherStore } from '../stores/wow-launcher'

const { t } = useI18n()
const tn = (key: string) => t(`wow-companion.launcher.${key}`)
const launcher = useWowLauncherStore()
const targets: LauncherTarget[] = ['battle-net', 'retail', 'forever', 'classic']
const target = ref<LauncherTarget>('battle-net')
const path = ref('')
const makeDefault = ref(false)
const selectedName = computed(() => tn(`targets.${target.value}`))
const disabled = computed(() => launcher.busy || launcher.loading || !launcher.state?.supported)
const savedPath = computed(() => launcher.state?.paths[target.value] ?? '')
const unsaved = computed(() => path.value !== savedPath.value || makeDefault.value)
const canLaunch = computed(() => !disabled.value && !!savedPath.value && !unsaved.value)
const launchLabel = computed(() => target.value === 'battle-net' ? tn('launch-battle-net') : tn('launch-game'))

function resetDraft() {
  path.value = savedPath.value
  makeDefault.value = false
  launcher.clearFeedback()
}

watch(target, resetDraft)

async function load() {
  await launcher.refresh()
  if (!launcher.state)
    return
  target.value = launcher.state.defaultTarget
  path.value = launcher.state.paths[target.value]
}

async function browse() {
  const selected = await launcher.browse()
  if (selected !== null)
    path.value = selected
}

async function save() {
  if (await launcher.save({ target: target.value, path: path.value, makeDefault: makeDefault.value })) {
    path.value = launcher.state?.paths[target.value] ?? ''
    makeDefault.value = false
  }
}

async function clear() {
  if (await launcher.save({ target: target.value, path: '', makeDefault: false })) {
    path.value = ''
    makeDefault.value = false
  }
}

onMounted(load)
</script>

<template>
  <div data-testid="wow-launcher-settings" :class="['mx-auto max-w-3xl pb-12', 'flex flex-col gap-5']" :aria-busy="launcher.loading || launcher.busy">
    <header>
      <h2 :class="['text-xl font-semibold']">
        {{ tn('title') }}
      </h2>
      <p :class="['mt-2 text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('description') }}
      </p>
    </header>

    <p v-if="launcher.state && !launcher.state.supported" role="status" :class="['text-sm text-amber-700 dark:text-amber-300']">
      {{ tn('errors.unsupported-platform') }}
    </p>
    <p v-if="launcher.errorCode || launcher.state?.error" id="wow-launcher-error" role="alert" :class="['break-words text-sm text-red-600 dark:text-red-400']">
      {{ tn(`errors.${launcher.errorCode ?? launcher.state?.error}`) }}
    </p>
    <p v-if="launcher.outcome" role="status" aria-live="polite" :class="['text-sm text-primary-600 dark:text-primary-300']">
      {{ tn(launcher.outcome) }}
    </p>

    <SettingsCard>
      <div role="group" :aria-label="tn('target')" :class="['flex flex-wrap gap-2']">
        <Button
          v-for="item in targets" :key="item"
          :variant="target === item ? 'primary' : 'secondary'" :color="target === item ? 'primary' : 'neutral'"
          :aria-pressed="target === item" :disabled="launcher.busy || launcher.loading"
          @click="target = item"
        >
          {{ tn(`targets.${item}`) }}
        </Button>
      </div>

      <p v-if="launcher.state" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ t('wow-companion.launcher.default-summary', { target: tn(`targets.${launcher.state.defaultTarget}`) }) }}
      </p>
      <FieldInput
        v-model="path" :label="t('wow-companion.launcher.path-label', { target: selectedName })"
        :description="tn('path-description')" :placeholder="tn('path-placeholder')" :disabled="disabled" type="text"
        @update:model-value="launcher.clearFeedback()"
      />
      <Button :disabled="disabled" :class="['self-start']" @click="browse">
        {{ tn('browse') }}
      </Button>

      <FieldCheckbox
        v-if="launcher.state && target !== launcher.state.defaultTarget"
        v-model="makeDefault" :label="tn('make-default')" :description="tn('make-default-description')" :disabled="disabled"
        @update:model-value="launcher.clearFeedback()"
      />
      <p v-else-if="launcher.state" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
        {{ tn('current-default') }}
      </p>

      <div :class="['flex flex-wrap gap-2']">
        <Button :disabled="disabled || !path.trim()" :loading="launcher.busy" variant="primary" color="primary" @click="save">
          {{ tn('save') }}
        </Button>
        <Button :disabled="!canLaunch" @click="launcher.launch(target)">
          {{ launchLabel }}
        </Button>
        <Button :disabled="disabled || !savedPath" @click="clear">
          {{ tn('clear') }}
        </Button>
        <Button v-if="!launcher.state" :disabled="launcher.loading" @click="load">
          {{ tn('retry') }}
        </Button>
      </div>
      <p v-if="unsaved" :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('unsaved') }}
      </p>
      <p :class="['text-xs text-neutral-500 dark:text-neutral-400']">
        {{ tn('launch-note') }}
      </p>

      <dl v-if="launcher.executable" :class="['min-w-0 grid gap-1 text-sm', '[overflow-wrap:anywhere] text-neutral-600 dark:text-neutral-300']">
        <dt :class="['font-medium']">
          {{ tn('verified-program') }}
        </dt>
        <dd>{{ launcher.executable.productName }} · {{ launcher.executable.fileVersion }}</dd>
        <dd>{{ launcher.executable.path }}</dd>
      </dl>
    </SettingsCard>
  </div>
</template>
