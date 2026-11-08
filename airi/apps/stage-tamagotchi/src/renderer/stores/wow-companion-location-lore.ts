import type { GameVersion, Snapshot } from '../../shared/wow-companion'

/** Historical facts for the arrival prompt. These facts do not describe the current game phase or visible scene. */
export interface LocationLore {
  readonly title: string
  readonly facts: readonly string[]
  readonly sources: readonly string[]
}

interface LocationEntry extends LocationLore {
  readonly maps: readonly number[]
  readonly instances?: readonly number[]
  readonly instanceTypes?: readonly NonNullable<Snapshot['instanceType']>[]
}

const sources = {
  haunted: 'https://news.blizzard.com/en-gb/article/19931210/haunted-azeroth-the-frightening-and-bizarre',
  travel: 'https://news.blizzard.com/en-us/article/23156366/wow-classic-getting-around-azeroth',
  primer: 'https://news.blizzard.com/en-us/article/23090134/wow-classic-primer-for-new-players',
  karazhan: 'https://worldofwarcraft.blizzard.com/en-us/news/15157593/cracking-karazhan',
  borean: 'https://news.blizzard.com/en-us/article/23816544/wrath-classic-zone-guide-borean-tundra-and-howling-fjord',
  dragonblight: 'https://news.blizzard.com/en-us/article/23840668/wrath-classic-zone-guide-dragonblight-and-grizzly-hills',
  zuldrak: 'https://news.blizzard.com/en-gb/article/23846691/wrath-classic-zone-guide-zuldrak-and-sholazar-basin',
  peaks: 'https://news.blizzard.com/en-us/article/23850850/wrath-classic-zone-guide-the-storm-peaks-and-icecrown',
  icecrown: 'https://worldofwarcraft.blizzard.com/en-us/news/24013834',
  ulduar: 'https://news.blizzard.com/en-gb/article/23897173/wrath-of-the-lich-king-classic-ulduar-now-live',
  blackrock: 'https://news.blizzard.com/en-gb/article/23789456/updated-31-may-shadowlands-9-2-5-content-update-notes',
  battlegrounds: 'https://worldofwarcraft.blizzard.com/en-us/news/23237900',
  arathi: 'https://worldofwarcraft.blizzard.com/en-us/news/23320961/wow-classic-arathi-basin-now-available',
} as const

// UiMapIDs identify zones and floors. Instance IDs identify the whole dungeon or battleground.
// The source register in docs/ai/adr/wow-companion-location-lore.md records both ID domains.
const locations: readonly LocationEntry[] = [
  {
    maps: [37],
    title: 'Elwynn Forest',
    facts: ['Goldshire has a strange group of six children whose movements and unsettling sounds became one of Azeroth\'s haunted curiosities.'],
    sources: [sources.haunted],
  },
  {
    maps: [84],
    title: 'Stormwind',
    facts: ['The Deeprun Tram links Stormwind and Ironforge. Its Stormwind entrance is in the Dwarven District.'],
    sources: [sources.travel],
  },
  {
    maps: [85],
    title: 'Orgrimmar',
    facts: ['Orgrimmar became the capital shared by the orcs and Darkspear trolls in the original World of Warcraft.'],
    sources: [sources.primer],
  },
  {
    maps: [87],
    title: 'Ironforge',
    facts: ['Ironforge was the shared capital of dwarves and gnomes. Tinker Town connects the city to Stormwind through the Deeprun Tram.'],
    sources: [sources.primer, sources.travel],
  },
  {
    maps: [88],
    title: 'Thunder Bluff',
    facts: ['Thunder Bluff was the tauren capital in the original World of Warcraft, while their adventures began in Mulgore.'],
    sources: [sources.primer],
  },
  {
    maps: [18, 2070],
    title: 'Tirisfal Glades',
    facts: ['The Whispering Forest has a mushroom ring where faerie dragons gather for a mysterious musical ritual.'],
    sources: [sources.haunted],
  },
  {
    maps: [47],
    title: 'Duskwood',
    facts: ['Blizzard\'s Karazhan history links the darkness over Duskwood and Deadwind Pass to the curse after Medivh\'s death.'],
    sources: [sources.karazhan],
  },
  {
    maps: [42],
    title: 'Deadwind Pass',
    facts: ['Medivh made his home in Karazhan, the tower in Deadwind Pass. Its history is tied to the Guardians of Tirisfal.'],
    sources: [sources.karazhan],
  },
  {
    maps: [114],
    title: 'Borean Tundra',
    facts: ['Kaskala is a tuskarr settlement. The Kalu\'ak used giant turtles to connect their coastal settlements in Northrend.'],
    sources: [sources.borean],
  },
  {
    maps: [115],
    title: 'Dragonblight',
    facts: ['Wyrmrest Temple stands amid five dragonshrines. The region is an ancient resting place for dragons.'],
    sources: [sources.dragonblight],
  },
  {
    maps: [116],
    title: 'Grizzly Hills',
    facts: ['The furbolgs made Grizzlemaw their home inside the remains of the fallen World Tree Vordrassil.'],
    sources: [sources.dragonblight],
  },
  {
    maps: [117],
    title: 'Howling Fjord',
    facts: ['Utgarde Keep belongs to the vrykul, an ancient people whose large stone buildings mark Howling Fjord.'],
    sources: [sources.borean],
  },
  {
    maps: [118],
    title: 'Icecrown',
    facts: ['The Argent Crusade held the Argent Tournament in Icecrown to prepare champions for the struggle against the Lich King.'],
    sources: [sources.ulduar],
  },
  {
    maps: [119],
    title: 'Sholazar Basin',
    facts: ['Titan pylons protected Sholazar\'s warm jungle climate amid Northrend\'s ice. A fallen pylon broke part of that protection.'],
    sources: [sources.zuldrak],
  },
  {
    maps: [120],
    title: 'The Storm Peaks',
    facts: ['Ancient titan watchers watched over Azeroth from these mountains. Ulduar preserves clues to their history.'],
    sources: [sources.peaks],
  },
  {
    maps: [121],
    title: 'Zul\'Drak',
    facts: ['During the Scourge invasion, desperate Drakkari turned against their own loa to seize power from their blood.'],
    sources: [sources.zuldrak],
  },
  {
    maps: [350, 351, 352, 353, 354, 355, 356, 357, 358, 359, 360, 361, 362, 363, 364, 365, 366],
    instances: [532, 1651],
    instanceTypes: ['raid', 'party'],
    title: 'Karazhan',
    facts: ['Medivh\'s tower holds an opera stage and a giant chessboard. The Kirin Tor formed the Violet Eye to watch its secrets.'],
    sources: [sources.karazhan],
  },
  {
    maps: [186, 187, 188, 189, 190, 191, 192, 193],
    instances: [631],
    instanceTypes: ['raid'],
    title: 'Icecrown Citadel',
    facts: ['The Lich King ruled from the Frozen Throne at the citadel\'s summit. The raid also introduced the Shadowmourne legendary quest.'],
    sources: [sources.icecrown],
  },
  {
    maps: [147, 148, 149, 150, 151, 152],
    instances: [603],
    instanceTypes: ['raid'],
    title: 'Ulduar',
    facts: ['Ulduar was built as a titan prison for Yogg-Saron, rather than a treasure vault. Brann Bronzebeard led an expedition into it.'],
    sources: [sources.ulduar],
  },
  {
    maps: [242, 243],
    instances: [230],
    instanceTypes: ['party'],
    title: 'Blackrock Depths',
    facts: ['Blackrock Depths contains Shadowforge City, a home of the Dark Iron dwarves beneath Blackrock Mountain.'],
    sources: [sources.blackrock],
  },
  {
    maps: [155],
    instances: [615],
    instanceTypes: ['raid'],
    title: 'The Obsidian Sanctum',
    facts: ['The Obsidian Sanctum lies beneath Wyrmrest Temple. Sartharion and three drake lieutenants guarded it during the Northrend campaign.'],
    sources: [sources.dragonblight],
  },
  {
    maps: [92, 1339],
    instances: [489, 2106],
    instanceTypes: ['pvp'],
    title: 'Warsong Gulch',
    facts: ['The original Warsong Gulch entrances lay in the Northern Barrens for the Horde and Ashenvale for the Alliance.'],
    sources: [sources.battlegrounds],
  },
  {
    maps: [93, 1366],
    instances: [529, 2107],
    instanceTypes: ['pvp'],
    title: 'Arathi Basin',
    facts: ['The League of Arathor and the Forsaken Defilers fought over the basin\'s farms, mines, and other resources.'],
    sources: [sources.arathi],
  },
  {
    maps: [91],
    instances: [30],
    instanceTypes: ['pvp'],
    title: 'Alterac Valley',
    facts: ['The Stormpike Guard and Frostwolf Clan fought here under Vanndar Stormpike and Drek\'Thar, amid towers, mines, and graveyards.'],
    sources: [sources.battlegrounds],
  },
]

/**
 * Returns source-backed retail history for the observed location. Names never select facts.
 * Observed instance identity takes precedence over floor maps, which can lag during loading.
 * Unknown locations and Forever return no history because their identifiers are not verified here.
 */
export function locationLore(game: GameVersion, snapshot: Snapshot): LocationLore | undefined {
  if (game !== 'retail' || snapshot.instanceType === 'unknown')
    return undefined

  const instanceID = snapshot.instanceID
  if (instanceID != null) {
    const location = locations.find(entry => entry.instances?.includes(instanceID))
    if (location && snapshot.instanceType && location.instanceTypes?.includes(snapshot.instanceType))
      return location

    // A known instance ID overrides an old outdoor map and cannot borrow another location's history.
    return undefined
  }

  const location = locations.find(entry => entry.maps.includes(snapshot.map))
  if (!location)
    return undefined

  if (location.instanceTypes) {
    if (snapshot.instanceType && !location.instanceTypes.includes(snapshot.instanceType))
      return undefined
  }
  else if (snapshot.instanceType && snapshot.instanceType !== 'none') {
    return undefined
  }

  return location
}
