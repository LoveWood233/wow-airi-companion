<script setup lang="ts">
import {
  ProviderAccountIdInput,
  ProviderAdvancedSettings,
  ProviderApiKeyInput,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
  ProviderValidationAlerts,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

const providerId = 'azure-ai-foundry'
const providerStore = useProviderConfigStore()
const { configs: providers } = storeToRefs(providerStore)

// Define computed properties for credentials
const apiKey = computed({
  get: () => {
    const value = providers.value[providerId]?.apiKey
    return typeof value === 'string' ? value : ''
  },
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].apiKey = value
  },
})

const resourceName = computed({
  get: () => {
    const value = providers.value[providerId]?.resourceName
    return typeof value === 'string' ? value : ''
  },
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].resourceName = value
  },
})

const apiVersion = computed({
  get: () => {
    const value = providers.value[providerId]?.apiVersion
    return typeof value === 'string' ? value : ''
  },
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].apiVersion = value
  },
})

const modelId = computed({
  get: () => {
    const value = providers.value[providerId]?.modelId
    return typeof value === 'string' ? value : ''
  },
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].modelId = value
  },
})

// Use the composable to get validation logic and state
const {
  t,
  router,
  providerMetadata,
  isValidating,
  isValid,
  validationMessage,
  handleResetSettings,
  forceValid,
  hasManualValidators,
  isManualTesting,
  manualTestPassed,
  manualTestMessage,
  runManualTest,
} = useProviderValidation(providerId)
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName"
    :provider-icon-color="providerMetadata?.iconColor"
    :on-back="() => router.back()"
  >
    <ProviderSettingsContainer>
      <ProviderBasicSettings
        :title="t('settings.pages.providers.common.section.basic.title')"
        :description="t('settings.pages.providers.common.section.basic.description')"
        :on-reset="handleResetSettings"
      >
        <ProviderApiKeyInput
          v-model="apiKey"
          :provider-name="providerMetadata?.localizedName"
          placeholder="..."
          required
        />
        <ProviderAccountIdInput
          v-model="resourceName"
          :label="t('companion-providers.resource-name')"
          placeholder="..."
          :description="t('companion-providers.resource-name-description')"
          required
        />
        <ProviderAccountIdInput
          v-model="modelId"
          :label="t('companion-providers.model-id')"
          placeholder="..."
          :description="t('companion-providers.model-id-description')"
          required
        />
      </ProviderBasicSettings>

      <ProviderAdvancedSettings :title="t('settings.pages.providers.common.section.advanced.title')">
        <ProviderAccountIdInput
          v-model="apiVersion"
          :label="t('companion-providers.api-version')"
          :placeholder="t('companion-providers.api-version-placeholder')"
          :description="t('companion-providers.api-version-description')"
        />
      </ProviderAdvancedSettings>

      <ProviderValidationAlerts
        :is-valid="isValid"
        :is-validating="isValidating"
        :validation-message="validationMessage"
        :has-manual-validators="hasManualValidators"
        :is-manual-testing="isManualTesting"
        :manual-test-passed="manualTestPassed"
        :manual-test-message="manualTestMessage"
        :on-run-test="runManualTest"
        :on-force-valid="forceValid"
        :on-go-to-model-selection="() => router.push('/settings/modules/consciousness')"
      />
    </ProviderSettingsContainer>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
  meta:
    layout: settings
    stageTransition:
      name: slide
  </route>
