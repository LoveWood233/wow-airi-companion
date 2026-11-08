<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { useEventListener, useResizeObserver, useWindowSize } from '@vueuse/core'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { guideSteps, useWowGuideStore } from '../stores/wow-guide'

const guide = useWowGuideStore()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const { width, height } = useWindowSize()
const bubble = ref<HTMLElement>()
const target = ref<HTMLElement>()
const spotlight = ref<{ top: number, left: number, width: number, height: number }>()
const navigating = ref(false)
const failed = ref(false)
let generation = 0
const inSettings = computed(() => router.currentRoute.value.path.startsWith('/settings'))
const open = computed(() => inSettings.value && guide.active && !guide.paused && !navigating.value && route.path === guide.path)

function measure() {
  const rect = target.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    spotlight.value = undefined
    return
  }
  const top = Math.max(48, rect.top - 6)
  const left = Math.max(8, rect.left - 6)
  const bottom = Math.min(height.value - 16, rect.bottom + 6, top + (height.value < 650 ? 80 : 180))
  spotlight.value = bottom > top ? { top, left, width: Math.max(0, Math.min(rect.right + 6, width.value - 8) - left), height: bottom - top } : undefined
}
useResizeObserver(target, measure)
useResizeObserver(bubble, measure)
useEventListener(window, 'resize', measure)
useEventListener(document, 'scroll', measure, { capture: true })
const bubbleStyle = computed(() => {
  const below = spotlight.value ? spotlight.value.top + spotlight.value.height + 20 : 80
  const top = Math.max(56, Math.min(below, height.value - 180))
  return { top: `${top}px`, maxHeight: `${Math.max(120, height.value - top - 16)}px` }
})

// Only explicit tour actions navigate. Leaving its page pauses the guide instead of redirecting the user back.
const stopRouting = router.afterEach((to) => {
  if (guide.active && !navigating.value && to.path !== guide.path)
    guide.paused = true
})
watch(() => [guide.active, guide.paused, guide.index, guide.game] as const, async () => {
  const request = ++generation
  target.value = undefined
  spotlight.value = undefined
  if (!guide.active || guide.paused)
    return
  navigating.value = true
  failed.value = false
  try {
    if (route.path !== guide.path)
      await router.push(guide.path)
    await nextTick()
    if (request !== generation)
      return
    if (route.path !== guide.path) {
      failed.value = true
      guide.paused = true
      return
    }
    const content = document.querySelector('[data-wow-guide-content]')
    target.value = content?.querySelector<HTMLElement>('[data-wow-guide-anchor]') ?? content?.querySelector<HTMLElement>(':scope > *') ?? undefined
    const bounds = target.value?.getBoundingClientRect()
    if (bounds && (bounds.top < 48 || bounds.top > height.value - 160))
      target.value?.scrollIntoView({ block: 'center', behavior: 'instant' })
    measure()
  }
  catch {
    if (request === generation) {
      failed.value = true
      guide.paused = true
    }
  }
  finally {
    if (request === generation)
      navigating.value = false
  }
}, { immediate: true, flush: 'post' })

watch(() => route.fullPath, () => {
  if (route.path === '/settings/wow-guide' && route.query.tour === 'auto') {
    guide.start()
    void router.replace({ path: route.path })
  }
}, { immediate: true })
onScopeDispose(() => {
  generation++
  stopRouting()
  if (guide.active)
    guide.paused = true
})
</script>

<template>
  <DialogRoot :open="open" @update:open="value => !value && guide.close()">
    <DialogPortal>
      <DialogOverlay :class="['fixed inset-0 z-9999 overflow-hidden']" :style="{ background: spotlight ? 'transparent' : 'rgb(0 0 0 / 0.65)' }">
        <div
          v-if="spotlight" data-testid="wow-guide-spotlight" aria-hidden="true"
          :class="['pointer-events-none absolute rounded-xl border-2 border-primary-300']"
          :style="{ ...Object.fromEntries(Object.entries(spotlight).map(([key, value]) => [key, `${value}px`])), boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.65)' }"
        />
      </DialogOverlay>
      <DialogContent as-child @interact-outside.prevent @escape-key-down.prevent="guide.close()">
        <section
          ref="bubble" data-testid="wow-guide-bubble"
          :class="['fixed right-4 z-9999 w-[min(380px,calc(100vw-32px))] rounded-2xl p-5 shadow-xl outline-none', 'max-h-[calc(100dvh-80px)] overflow-y-auto bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100']"
          :style="bubbleStyle"
        >
          <div aria-hidden="true" :class="['absolute left-8 top-0 h-3 w-3 rotate-45 bg-white dark:bg-neutral-900']" />
          <p aria-live="polite" :class="['mb-2 text-xs font-medium text-primary-600 dark:text-primary-300']">
            {{ t('wow-companion.guide.progress', { current: guide.index + 1, total: guideSteps.length }) }}
          </p>
          <DialogTitle :class="['text-lg font-semibold']">
            {{ t(`wow-companion.guide.steps.${guide.step.id}.title`) }}
          </DialogTitle>
          <DialogDescription :class="['mt-3 whitespace-pre-line text-sm leading-relaxed text-neutral-600 dark:text-neutral-300']">
            {{ t(`wow-companion.guide.steps.${guide.step.id}.${guide.step.id === 'connection' ? guide.game : 'body'}`) }}
          </DialogDescription>
          <p v-if="!spotlight" role="status" :class="['mt-2 text-xs text-neutral-500']">
            {{ t('wow-companion.guide.target-unavailable') }}
          </p>
          <div :class="['mt-5 flex flex-wrap gap-2']">
            <Button v-if="guide.index > 0" size="sm" @click="guide.move(-1)">
              {{ t('wow-companion.guide.previous') }}
            </Button>
            <Button v-if="guide.index > 0 && guide.index < guideSteps.length - 1" size="sm" @click="guide.paused = true">
              {{ t('wow-companion.guide.configure') }}
            </Button>
            <Button v-if="guide.step.id === 'welcome' || guide.step.id === 'finish'" size="sm" @click="guide.paused = true">
              {{ t('wow-companion.setup.title') }}
            </Button>
            <Button variant="primary" color="primary" size="sm" @click="guide.index === guideSteps.length - 1 ? guide.close(true) : guide.move(1)">
              {{ t(guide.index === guideSteps.length - 1 ? 'wow-companion.guide.complete' : 'wow-companion.guide.next') }}
            </Button>
            <Button size="sm" @click="guide.close()">
              {{ t('wow-companion.guide.skip') }}
            </Button>
          </div>
        </section>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
  <div v-if="inSettings && guide.active && guide.paused" role="region" :aria-label="t('wow-companion.guide.title')" :class="['fixed bottom-4 right-4 z-40 max-w-[calc(100vw-32px)] rounded-xl bg-white p-3 shadow-xl dark:bg-neutral-900']">
    <p v-if="failed" role="alert" :class="['mb-2 text-sm']">
      {{ t('wow-companion.guide.navigation-failed') }}
    </p>
    <div :class="['flex flex-wrap gap-2']">
      <Button size="sm" color="primary" variant="primary" @click="guide.paused = false">
        {{ t('wow-companion.guide.resume') }}
      </Button>
      <Button size="sm" @click="guide.close()">
        {{ t('wow-companion.guide.skip') }}
      </Button>
    </div>
  </div>
</template>
