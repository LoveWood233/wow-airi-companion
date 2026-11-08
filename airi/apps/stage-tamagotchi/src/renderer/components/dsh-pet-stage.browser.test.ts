import { parse } from 'valibot'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref } from 'vue'

import manifest from '../public/dsh-pet/builtin/pack.json'
import DshPetStage from './dsh-pet-stage.vue'

import { dshPetPackSchema } from '../../shared/dsh-pet'

import 'virtual:uno.css'

let base: HTMLBaseElement
beforeEach(() => {
  base = document.createElement('base')
  const testModuleUrl = import.meta.url
  base.href = new URL('../public/', testModuleUrl).href
  document.head.prepend(base)
})
afterEach(() => {
  cleanup()
  base.remove()
})

function fixture() {
  const pack = ref(parse(dshPetPackSchema, { ...manifest, baseUrl: './dsh-pet/builtin' }))
  const paused = ref(false)
  const sleeping = ref(false)
  const facing = ref<'left' | 'right'>('left')
  const state = ref<'pending' | 'loading' | 'mounted'>('pending')
  const error = vi.fn()
  const stage = ref<InstanceType<typeof DshPetStage>>()
  const screen = render(defineComponent({
    setup: () => () => h('div', { style: { width: '640px', height: '360px' } }, [h(DshPetStage, {
      'ref': stage,
      'pack': pack.value,
      'paused': paused.value,
      'sleeping': sleeping.value,
      'facing': facing.value,
      'state': state.value,
      'onUpdate:state': value => state.value = value,
      'onUpdate:sleeping': value => sleeping.value = value,
      'onUpdate:facing': value => facing.value = value,
      'onError': error,
    })]),
  }))
  return { pack, paused, sleeping, facing, state, error, stage, screen }
}

async function mountedStage(value: ReturnType<typeof fixture>) {
  await value.screen
  await vi.waitFor(() => {
    expect(value.error.mock.calls).toEqual([])
    expect(value.state.value).toBe('mounted')
  }, { timeout: 4_000 })
  expect(value.error).not.toHaveBeenCalled()
  return value.stage.value!.canvasElement()!
}

describe('actual transparent DSH WebM playback', () => {
  it('decodes an alpha video into a readable canvas with opaque and transparent pixels', async () => {
    const value = fixture()
    const canvas = await mountedStage(value)
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let opaque = 0
    let transparent = 0
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index]! > 200)
        opaque++
      if (pixels[index] === 0)
        transparent++
    }
    expect(opaque).toBeGreaterThan(100)
    expect(transparent).toBeGreaterThan(100)
    expect(canvas.width).toBeGreaterThan(1)
    expect(canvas.height).toBeGreaterThan(1)
  })

  it('freezes playback and resumes without loading another renderer', async () => {
    const value = fixture()
    await mountedStage(value)
    value.paused.value = true
    await nextTick()
    expect([...document.querySelectorAll('video')].every(video => video.paused)).toBe(true)
    value.paused.value = false
    await vi.waitFor(() => expect([...document.querySelectorAll('video')].some(video => !video.paused)).toBe(true))
  })

  it('replaces pending loads with the latest pack and retains a readable canvas', async () => {
    const value = fixture()
    value.pack.value = { ...value.pack.value, id: 'changed-first' }
    await nextTick()
    value.pack.value = { ...value.pack.value, id: 'changed-latest' }
    const canvas = await mountedStage(value)
    expect(canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data.length).toBe(4)
    expect([...document.querySelectorAll('video')].filter(video => !video.paused).length).toBe(1)
  })

  it('accepts click animations and wakes a sleeping pet through its public model', async () => {
    const value = fixture()
    await mountedStage(value)
    await page.getByRole('button', { name: 'DSH Pet' }).click()
    await vi.waitFor(() => expect(document.querySelectorAll('video[src]').length).toBe(2))
    value.sleeping.value = true
    await nextTick()
    await page.getByRole('button', { name: 'DSH Pet' }).click()
    await nextTick()
    expect(value.sleeping.value).toBe(false)
    expect(value.error).not.toHaveBeenCalled()
  })

  it('keeps the sleep start, repeating sleep and waking clips in the same sequence', async () => {
    const value = fixture()
    await mountedStage(value)
    const playing = () => [...document.querySelectorAll('video')].find(video => !video.paused && video.readyState >= 2)
    const idleSource = playing()!.currentSrc
    value.sleeping.value = true
    await vi.waitFor(() => expect(playing()?.currentSrc).not.toBe(idleSource))
    const start = playing()!
    expect(start.loop).toBe(false)
    start.currentTime = start.duration - 0.02
    await vi.waitFor(() => expect(playing()?.loop).toBe(true))
    const sleepingSource = playing()!.currentSrc
    await page.getByRole('button', { name: 'DSH Pet' }).click()
    await vi.waitFor(() => {
      expect(value.sleeping.value).toBe(false)
      expect(playing()?.currentSrc).not.toBe(sleepingSource)
      expect(playing()?.loop).toBe(false)
    })
    const waking = playing()!
    const wakingSource = waking.currentSrc
    waking.currentTime = waking.duration - 0.02
    await vi.waitFor(() => expect(playing()?.currentSrc).not.toBe(wakingSource))
    expect(value.error).not.toHaveBeenCalled()
  })
})
