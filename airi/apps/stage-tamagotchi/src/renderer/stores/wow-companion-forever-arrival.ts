import type { Snapshot } from '../../shared/wow-companion'

import stories from './wow-forever-region-stories.json'

interface LocationStory {
  readonly mapId?: number
  readonly instanceId?: number
  readonly name: string
  readonly background: string
  readonly anecdote?: string
}

const catalog: readonly LocationStory[] = stories
const maps = new Map<number, LocationStory>()
const instances = new Map<number, LocationStory>()

for (const story of catalog) {
  if (story.mapId !== undefined)
    maps.set(story.mapId, story)
  if (story.instanceId !== undefined)
    instances.set(story.instanceId, story)
}

/** Returns a published Chinese story only for a matching Forever map or observed instance. */
export function foreverArrivalText(snapshot: Pick<Snapshot, 'map' | 'instanceType' | 'instanceID'>): string | undefined {
  const { map, instanceType, instanceID } = snapshot
  if (instanceType === 'unknown')
    return undefined

  // The instance ID takes precedence because the outdoor map can linger during the transition.
  let story: LocationStory | undefined
  if (instanceID != null) {
    if (!instanceType || instanceType === 'none')
      return undefined
    story = instances.get(instanceID)
  }
  else if (instanceType !== undefined && instanceType !== 'none') {
    if (instanceType === 'pvp') {
      const battleground = maps.get(map)
      if (battleground?.instanceId !== undefined)
        story = battleground
    }
  }
  else {
    const area = maps.get(map)
    if (area?.instanceId === undefined)
      story = area
  }

  if (!story)
    return undefined
  const background = `${story.name}。 ${story.background}`
  return story.anecdote ? `${background} ${story.anecdote}` : background
}
