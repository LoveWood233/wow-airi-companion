import { parse, safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import manifest from '../public/dsh-pet/builtin/pack.json'

import { dshPetFileSchema, dshPetManifestSchema, dshPetPackSchema } from '../../shared/dsh-pet'
import { nextPetAnimation, petAnimationUrl, petStatusAnimation, pickPetAnimation } from './dsh-pet-animation'

const pack = parse(dshPetPackSchema, { ...manifest, baseUrl: './dsh-pet/builtin' })

describe('validated DSH animation packs', () => {
  it('preserves the actual source animation pools and only declared media references', () => {
    expect(parse(dshPetManifestSchema, manifest).files.length).toBe(114)
    expect(pack.animations.sleep?.[0]).toEqual({ start: ['睡觉-开始'], loop: ['睡觉-循环'], end: ['睡觉-起来'] })
    expect(safeParse(dshPetManifestSchema, { ...manifest, files: manifest.files.filter(name => name !== '待机呼吸休闲.webm') }).success).toBe(false)
    expect(safeParse(dshPetManifestSchema, { ...manifest, chatApiKey: 'not-allowed' }).success).toBe(false)
  })

  it.each(['../outside.webm', '/absolute.webm', 'C:/absolute.webm', 'dir\\bad.webm', 'dir/%2e%2e.webm', 'bad.webm?query', 'bad.webm#hash'])('rejects unsafe media path %s', (file) => {
    expect(safeParse(dshPetFileSchema, file).success).toBe(false)
  })

  it('limits runtime media URLs to controlled local roots', () => {
    expect(safeParse(dshPetPackSchema, { ...manifest, baseUrl: 'https://example.com' }).success).toBe(false)
    expect(safeParse(dshPetPackSchema, { ...manifest, baseUrl: 'dsh-pet://packs/7dfd5012-1875-470a-a7de-6ed998ce494d' }).success).toBe(true)
    expect(petAnimationUrl(pack, '待机呼吸休闲', 'file:///app/out/renderer/index.html')).toBe('file:///app/out/renderer/dsh-pet/builtin/%E5%BE%85%E6%9C%BA%E5%91%BC%E5%90%B8%E4%BC%91%E9%97%B2.webm')
    expect(() => petAnimationUrl(pack, '../outside', 'https://localhost/')).toThrow('not part')
  })

  it('avoids immediate repeats and retains one-entry pools', () => {
    expect(pickPetAnimation(['one', 'two'], 'one', 0)).toBe('two')
    expect(pickPetAnimation(['one'], 'one', 0)).toBe('one')
    expect(pickPetAnimation([], '', 0)).toBeUndefined()
  })

  it('selects weighted idle, turn and action animations and excludes mirrored text', () => {
    expect(nextPetAnimation(pack, '', 'left', 0)).toEqual({ name: '待机呼吸休闲', turn: false })
    expect(nextPetAnimation(pack, '', 'left', 0.12)).toEqual({ name: '东张西望', turn: true })
    const noMirror = pack.animations.categories.filter(category => category.noMirror).flatMap(category => category.actions)
    for (const roll of [0.2, 0.4, 0.6, 0.8, 0.99])
      expect(noMirror).not.toContain(nextPetAnimation(pack, '', 'right', roll).name)
  })

  it('uses declared work and speaking event slots', () => {
    expect(petStatusAnimation(pack, 'thinking')).toBe('工作状态-思考冒泡')
    expect(pack.animations.events?.whisper.flat()).toContain(petStatusAnimation(pack, 'speaking'))
    expect(petStatusAnimation({ ...pack, animations: { ...pack.animations, events: undefined } }, 'thinking')).toBe('待机呼吸休闲')
  })
})
