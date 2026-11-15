import { describe, expect, it } from 'vitest'

import stories from './wow-forever-region-stories.json'

import { foreverArrivalText } from './wow-companion-forever-arrival'

describe('location stories in Forever', () => {
  it('keeps the published background within 50 characters and IDs unique', () => {
    const invalidBackgrounds = stories.filter(({ background }) => !background.trim() || [...background].length > 50)
    expect(invalidBackgrounds).toEqual([])
    const maps = stories.flatMap(({ mapId }) => mapId === undefined ? [] : [mapId])
    const instances = stories.flatMap(({ instanceId }) => instanceId === undefined ? [] : [instanceId])
    expect(new Set(maps).size).toBe(maps.length)
    expect(new Set(instances).size).toBe(instances.length)
  })

  it('selects the region by UiMap ID', () => {
    expect(foreverArrivalText({ map: 1429, instanceType: 'none' })).toMatch(/^艾尔文森林。/)
    expect(foreverArrivalText({ map: 37, instanceType: 'none' })).toBeUndefined()
  })

  it('uses the instance ID when an outdoor map lingers or a floor has no map', () => {
    expect(foreverArrivalText({ map: 1429, instanceType: 'party', instanceID: 36 })).toMatch(/^死亡矿井。/)
    expect(foreverArrivalText({ map: 0, instanceType: 'party', instanceID: 36 })).toMatch(/^死亡矿井。/)
    expect(foreverArrivalText({ map: 1429, instanceType: 'party', instanceID: 999999 })).toBeUndefined()
  })

  it('resolves battleground maps only with a battleground observation', () => {
    expect(foreverArrivalText({ map: 1460, instanceType: 'pvp' })).toMatch(/^战歌峡谷。/)
    expect(foreverArrivalText({ map: 1460, instanceType: 'none' })).toBeUndefined()
    expect(foreverArrivalText({ map: 1429, instanceType: 'unknown' })).toBeUndefined()
  })
})
