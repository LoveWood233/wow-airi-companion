import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { electronOpenSettings } from '../../shared/eventa'
import { useWowGuideStore } from '../stores/wow-guide'

/** Offers one product tour after provider onboarding. Failed window opens remain retryable on the next launch. */
export function useWowGuideStartup() {
  const guide = useWowGuideStore()
  const onboarding = useOnboardingStore()
  const openSettings = useElectronEventaInvoke(electronOpenSettings)
  const { t } = useI18n()
  let offering = false
  let mounted = false
  async function offer() {
    if (!mounted || guide.offered || offering || onboarding.needsOnboarding)
      return
    offering = true
    try {
      await openSettings({ route: '/settings/wow-guide?tour=auto' })
      guide.offered = true
    }
    catch {
      toast.error(t('wow-companion.guide.open-failed'))
    }
    finally {
      offering = false
    }
  }
  watch(() => onboarding.needsOnboarding, () => void offer())
  onMounted(() => {
    mounted = true
    void offer()
  })
}
