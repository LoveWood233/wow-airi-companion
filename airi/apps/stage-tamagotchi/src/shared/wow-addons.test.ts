import type { AddonMetadata } from './wow-addons'

import { describe, expect, it } from 'vitest'

import { resolveAddonVersionType } from './wow-addons'

const metadata: AddonMetadata = { categories: [], versionTypes: [
  { id: 517, name: 'Retail', slug: 'game', group: 'retail' },
  { id: 67408, name: 'Classic', slug: 'classic', group: 'classic' },
  { id: 79434, name: 'Mists Classic', slug: 'mists-classic', group: 'classic' },
  { id: 88568, name: 'Forever', slug: 'forever', group: 'forever' },
] }

describe('addon version selection', () => {
  it('infers a unique Retail or Forever branch without changing saved settings', () => {
    expect(resolveAddonVersionType(metadata, 'retail', null)?.id).toBe(517)
    expect(resolveAddonVersionType(metadata, 'forever', null)?.id).toBe(88568)
  })

  it('requires an explicit Classic branch and refuses foreign or stale selections', () => {
    expect(resolveAddonVersionType(metadata, 'classic', null)).toBeUndefined()
    expect(resolveAddonVersionType(metadata, 'classic', 79434)?.id).toBe(79434)
    expect(resolveAddonVersionType(metadata, 'retail', 67408)).toBeUndefined()
    expect(resolveAddonVersionType(metadata, 'retail', 999)).toBeUndefined()
    expect(resolveAddonVersionType(undefined, 'retail', null)).toBeUndefined()
  })
})
