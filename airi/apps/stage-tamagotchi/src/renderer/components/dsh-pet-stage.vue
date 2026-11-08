<script setup lang="ts">
import type { DshPetPack } from '../../shared/dsh-pet'

import { onMounted, onScopeDispose, ref, watch } from 'vue'

import { nextPetAnimation, petAnimationUrl, petStatusAnimation, pickPetAnimation } from '../utils/dsh-pet-animation'

const props = withDefaults(defineProps<{
  pack: DshPetPack
  paused?: boolean
  sleeping?: boolean
  facing?: 'left' | 'right'
  animation?: string
  speaking?: boolean
  thinking?: boolean
  emotion?: string
  scale?: number
}>(), { paused: false, sleeping: false, facing: 'left', animation: '', speaking: false, thinking: false, emotion: 'neutral', scale: 1 })
const emit = defineEmits<{
  'error': [error: Error]
  'reset': []
  'update:sleeping': [value: boolean]
  'update:facing': [value: 'left' | 'right']
  'dragStart': [event: PointerEvent]
  'contextmenu': [event: MouseEvent]
}>()
const state = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })
const canvas = ref<HTMLCanvasElement>()
const firstVideo = ref<HTMLVideoElement>()
const secondVideo = ref<HTMLVideoElement>()
const direction = ref(props.facing)
let front = -1
let generation = 0
let mounted = false
let controller: AbortController | undefined
let raf = 0
let previousFrame = 0
let observer: ResizeObserver | undefined
let current = ''
let turnsAfterClip = false
let sleepPhase: 'awake' | 'start' | 'loop' | 'end' = 'awake'
let sleepSet: NonNullable<DshPetPack['animations']['sleep']>[number] | undefined
let pointer: { id: number, x: number, y: number, dragging: boolean } | undefined
const urls: Array<string | undefined> = [undefined, undefined]
const videos = () => [firstVideo.value, secondVideo.value]

function draw() {
  const surface = canvas.value
  const video = videos()[front]
  const context = surface?.getContext('2d', { willReadFrequently: true })
  if (!surface || !context || !video || video.readyState < 2)
    return
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, surface.width, surface.height)
  const scale = Math.min(surface.width / video.videoWidth, surface.height / video.videoHeight) * Math.min(2, Math.max(0.5, props.scale))
  const width = video.videoWidth * scale
  const height = video.videoHeight * scale
  context.save()
  if (direction.value === 'right') {
    context.translate(surface.width, 0)
    context.scale(-1, 1)
  }
  context.drawImage(video, (surface.width - width) / 2, (surface.height - height) / 2, width, height)
  context.restore()
}

function frame(time: number) {
  if (!mounted || props.paused)
    return
  if (time - previousFrame >= 30) {
    draw()
    previousFrame = time
  }
  raf = requestAnimationFrame(frame)
}

function startFrames() {
  cancelAnimationFrame(raf)
  if (mounted && !props.paused)
    raf = requestAnimationFrame(frame)
}

function resize() {
  const element = canvas.value
  if (!element)
    return
  const bounds = element.getBoundingClientRect()
  const ratio = Math.min(devicePixelRatio || 1, 2, 2048 / Math.max(1, bounds.width), 2048 / Math.max(1, bounds.height))
  element.width = Math.max(1, Math.round(bounds.width * ratio))
  element.height = Math.max(1, Math.round(bounds.height * ratio))
  draw()
}

/** A/B slots keep the last complete frame visible. Generation checks prevent obsolete fetches and decode events from taking ownership. */
async function playAnimation(name: string, loop = false, turn = false) {
  if (!mounted)
    return
  const ownGeneration = ++generation
  controller?.abort()
  const pending = new AbortController()
  controller = pending
  const slot = front === 0 ? 1 : 0
  const video = videos()[slot]
  if (!video)
    return
  video.onloadeddata = null
  video.onended = null
  video.onerror = null
  video.pause()
  if (front === -1)
    state.value = 'loading'
  try {
    const url = petAnimationUrl(props.pack, name, document.baseURI)
    const response = await fetch(url, { signal: AbortSignal.any([pending.signal, AbortSignal.timeout(15_000)]) })
    if (!response.ok)
      throw new Error('Pet animation could not be loaded')
    const media = await response.blob()
    if (media.size === 0 || media.size > 64 * 1024 * 1024)
      throw new Error('Invalid pet animation size')
    if (!mounted || generation !== ownGeneration)
      return
    const previous = urls[slot]
    if (previous)
      URL.revokeObjectURL(previous)
    urls[slot] = URL.createObjectURL(media)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Pet animation decoding timed out')), 15_000)
      const complete = (error?: Error) => {
        clearTimeout(timer)
        pending.signal.removeEventListener('abort', onAbort)
        error ? reject(error) : resolve()
      }
      function onAbort() {
        complete(new Error('Pet animation was replaced'))
      }
      pending.signal.addEventListener('abort', onAbort, { once: true })
      video.onloadeddata = () => complete()
      video.onerror = () => complete(new Error('Pet animation could not be decoded'))
      video.loop = loop
      video.src = urls[slot]!
      video.load()
    })
    if (!mounted || generation !== ownGeneration)
      return
    if (!props.paused)
      await video.play()
    if (!mounted || generation !== ownGeneration)
      return
    const outgoing = videos()[front]
    if (outgoing && outgoing !== video) {
      outgoing.onended = null
      outgoing.pause()
    }
    front = slot
    current = name
    turnsAfterClip = turn
    video.onended = () => front === slot && advance()
    video.onerror = () => emit('error', new Error('Pet animation playback failed'))
    state.value = 'mounted'
    draw()
    startFrames()
  }
  catch (error) {
    if (mounted && generation === ownGeneration && !pending.signal.aborted)
      emit('error', error instanceof Error ? error : new Error('Pet animation failed'))
  }
}

function advance() {
  if (props.paused || pointer?.dragging)
    return
  if (sleepPhase === 'start' || sleepPhase === 'loop') {
    sleepPhase = 'loop'
    void playAnimation(pickPetAnimation(sleepSet!.loop, current)!, true)
    return
  }
  if (sleepPhase === 'end') {
    sleepPhase = 'awake'
    sleepSet = undefined
  }
  if (props.speaking || props.thinking) {
    void playAnimation(petStatusAnimation(props.pack, props.speaking ? 'speaking' : 'thinking', current))
    return
  }
  if (turnsAfterClip) {
    direction.value = direction.value === 'left' ? 'right' : 'left'
    emit('update:facing', direction.value)
  }
  const next = nextPetAnimation(props.pack, current, direction.value)
  void playAnimation(next.name, false, next.turn)
}

function setSleeping(value: boolean) {
  if (value) {
    const sets = props.pack.animations.sleep
    if (!sets?.length)
      return
    sleepSet = sets[Math.floor(Math.random() * sets.length)]
    sleepPhase = 'start'
    void playAnimation(pickPetAnimation(sleepSet!.start)!)
  }
  else if (sleepSet) {
    sleepPhase = 'end'
    void playAnimation(pickPetAnimation(sleepSet.end)!)
  }
}

function retry() {
  emit('reset')
  sleepPhase = 'awake'
  sleepSet = undefined
  front = -1
  if (props.sleeping && props.pack.animations.sleep?.length)
    setSleeping(true)
  else
    void playAnimation(pickPetAnimation(props.pack.animations.idle)!)
}

function pointerDown(event: PointerEvent) {
  if (event.button !== 0)
    return
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false }
  canvas.value?.setPointerCapture(event.pointerId)
}

function pointerMove(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId || pointer.dragging || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) <= 6)
    return
  pointer.dragging = true
  const name = pickPetAnimation(props.pack.animations.drag)
  if (name)
    void playAnimation(name, true)
  emit('dragStart', event)
}

function endDrag() {
  if (!pointer)
    return
  const dragged = pointer.dragging
  pointer = undefined
  if (dragged)
    advance()
}

function pointerUp(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId)
    return
  const dragged = pointer.dragging
  endDrag()
  if (dragged)
    return
  activate()
}

function activate() {
  if (props.sleeping) {
    emit('update:sleeping', false)
    return
  }
  const name = pickPetAnimation(props.pack.animations.clicks, current)
  if (name)
    void playAnimation(name)
}

watch(() => props.pack, () => retry())
watch(() => props.facing, value => direction.value = value)
watch(() => props.scale, draw)
watch(() => props.animation, value => value && void playAnimation(value))
watch(() => props.sleeping, setSleeping)
watch(() => props.emotion, (emotion) => {
  if (sleepPhase !== 'awake' || props.speaking || props.thinking || pointer?.dragging)
    return
  const animations: Record<string, string> = {
    happy: '工作状态-雀跃庆祝',
    sad: '工作状态-垂头叹气冒汗',
    angry: '点击回应-傲娇生气',
    surprised: '点击回应-害羞惊讶',
    think: '工作状态-思考冒泡',
    curious: '东张西望',
    question: '工作状态-原地踱步张望',
    awkward: '点击回应-害羞惊讶',
  }
  const name = animations[emotion]
  if (name && props.pack.files.includes(`${name}.webm`))
    void playAnimation(name)
})
watch([() => props.speaking, () => props.thinking], () => {
  if (sleepPhase !== 'awake' || pointer?.dragging)
    return
  if (props.speaking || props.thinking)
    void playAnimation(petStatusAnimation(props.pack, props.speaking ? 'speaking' : 'thinking', current))
  else
    void playAnimation(pickPetAnimation(props.pack.animations.idle, current)!)
})
watch(() => props.paused, (paused) => {
  if (paused) {
    cancelAnimationFrame(raf)
    videos().forEach(video => video?.pause())
  }
  else {
    void videos()[front]?.play().catch(error => emit('error', error))
    startFrames()
  }
})

onMounted(() => {
  mounted = true
  observer = new ResizeObserver(resize)
  observer.observe(canvas.value!)
  window.addEventListener('pointerup', pointerUp)
  window.addEventListener('blur', endDrag)
  resize()
  retry()
})
onScopeDispose(() => {
  mounted = false
  generation++
  controller?.abort()
  cancelAnimationFrame(raf)
  observer?.disconnect()
  window.removeEventListener('pointerup', pointerUp)
  window.removeEventListener('blur', endDrag)
  videos().forEach((video) => {
    if (!video)
      return
    video.onloadeddata = null
    video.onended = null
    video.onerror = null
    video.pause()
    video.removeAttribute('src')
    video.load()
  })
  urls.forEach(url => url && URL.revokeObjectURL(url))
})

defineExpose({ canvasElement: () => canvas.value, playAnimation, retry, endDrag })
</script>

<template>
  <div :class="['relative h-full w-full overflow-hidden']">
    <canvas
      ref="canvas"
      :aria-label="pack.name"
      role="button"
      tabindex="0"
      :class="['h-full w-full touch-none select-none']"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointercancel="endDrag"
      @contextmenu="emit('contextmenu', $event)"
      @keydown.enter="activate"
      @keydown.space.prevent="activate"
    />
    <video ref="firstVideo" muted playsinline preload="auto" aria-hidden="true" :class="['pointer-events-none absolute h-px w-px opacity-0']" />
    <video ref="secondVideo" muted playsinline preload="auto" aria-hidden="true" :class="['pointer-events-none absolute h-px w-px opacity-0']" />
  </div>
</template>
