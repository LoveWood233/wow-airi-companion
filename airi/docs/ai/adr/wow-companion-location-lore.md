# Location history for companion arrivals

Date: 2026-10-29

## Decision

`locationLore(game, snapshot)` returns a short fact record for the arrival prompt.
The catalog contains 24 locations across outdoor zones, cities, instances, and battlegrounds.
Facts are original short summaries of Blizzard articles.
They are model context, rather than English interface text.
The chat model states them in the active language and persona.

The catalog contains history, rather than live observations.
It does not establish the current phase, NPC presence, quest status, route, or combat conditions.
It performs no network requests.
The runtime does not download articles during gameplay.

Known instance IDs take precedence over UiMapIDs because floor maps can lag after a loading screen.
An inconsistent scene type returns no facts.
Location names never select records.
An unrecognized location returns no facts, rather than unrelated nearby history.

Forever returns no catalog record.
Its identifiers and world history require separate validation.
The runtime can still acknowledge an arrival without inventing historical details.

## Level suitability

Arrival requests include the observed player level. Ordinary chat and arrival narration share the same level guidance.
Before recommending a zone, the model must compare that level with verified requirements for the specific zone and game version.
An expansion-wide leveling range does not prove that every zone suits the player.
Below a verified minimum, the reply must state that the player's level is too low and recommend returning later.
Below a recommendation, the reply must explain the gap without inventing a hard access restriction.
The warning takes precedence over historical flavor or an invitation to explore.

Current telemetry does not report zone level limits or Chromie Time. The history catalog does not provide those requirements.
Without matching evidence, the reply must disclose that suitability is unconfirmed.
The model cannot invent level ranges, XP penalties, quest locks, routes, or NPCs.
This is a prompt constraint, not a deterministic assessment of zone access or generated speech.

## Sources for history

All sources were reviewed on 2026-10-29.
The catalog includes links beside each fact.

| Locations | Blizzard source |
| --- | --- |
| Elwynn Forest, Tirisfal Glades | [Haunted Azeroth](https://news.blizzard.com/en-gb/article/19931210/haunted-azeroth-the-frightening-and-bizarre) |
| Stormwind, Ironforge | [Getting around Azeroth](https://news.blizzard.com/en-us/article/23156366/wow-classic-getting-around-azeroth) |
| Orgrimmar, Ironforge, Thunder Bluff | [Classic primer](https://news.blizzard.com/en-us/article/23090134/wow-classic-primer-for-new-players) |
| Deadwind Pass, Duskwood, Karazhan | [Cracking Karazhan](https://worldofwarcraft.blizzard.com/en-us/news/15157593/cracking-karazhan) |
| Borean Tundra, Howling Fjord | [Borean Tundra and Howling Fjord](https://news.blizzard.com/en-us/article/23816544/wrath-classic-zone-guide-borean-tundra-and-howling-fjord) |
| Dragonblight, Grizzly Hills, Obsidian Sanctum | [Dragonblight and Grizzly Hills](https://news.blizzard.com/en-us/article/23840668/wrath-classic-zone-guide-dragonblight-and-grizzly-hills) |
| Zul'Drak, Sholazar Basin | [Zul'Drak and Sholazar Basin](https://news.blizzard.com/en-gb/article/23846691/wrath-classic-zone-guide-zuldrak-and-sholazar-basin) |
| The Storm Peaks | [The Storm Peaks and Icecrown](https://news.blizzard.com/en-us/article/23850850/wrath-classic-zone-guide-the-storm-peaks-and-icecrown) |
| Icecrown, Ulduar | [Ulduar](https://news.blizzard.com/en-gb/article/23897173/wrath-of-the-lich-king-classic-ulduar-now-live) |
| Icecrown Citadel | [The way into Icecrown Citadel](https://worldofwarcraft.blizzard.com/en-us/news/24013834) |
| Blackrock Depths | [Shadowlands 9.2.5 notes](https://news.blizzard.com/en-gb/article/23789456/updated-31-may-shadowlands-9-2-5-content-update-notes) |
| Warsong Gulch, Alterac Valley | [Classic battlegrounds](https://worldofwarcraft.blizzard.com/en-us/news/23237900) |
| Arathi Basin | [Arathi Basin](https://worldofwarcraft.blizzard.com/en-us/news/23320961/wow-classic-arathi-basin-now-available) |

## Identifier evidence

UiMapIDs differ from instance IDs.
The catalog does not accept a numeric ID from one domain as an ID from the other domain.

- The local portal catalog records reviewed city and zone IDs in `WOWAddons/data/retail-portals/maps.json`.
- [Storyline's source](https://github.com/Total-RP/Storyline/blob/main/BackgroundsManager.lua) independently records Elwynn, Tirisfal, and Arathi UiMapIDs.
- [BtWLoadouts' instance table](https://github.com/Breeni/BtWLoadouts/blob/main/Instances.lua) records Karazhan 532, Return to Karazhan 1651, Ulduar 603, Icecrown Citadel 631, and Obsidian Sanctum 615.
- [Battleground Helper's author table](https://www.curseforge.com/wow/addons/bgh-battle-ground-helper/files/7816353) records original and remade Warsong and Arathi instance IDs.
- [The UiMapID reference](https://warcraft.wiki.gg/wiki/UiMapID) supplies a secondary cross-check for dungeon floors and older battleground maps.

Warsong's 1460 and Arathi's 1461 belong to Classic's UiMapID namespace.
They are not aliases in this retail catalog.
Map 42 is Deadwind Pass, rather than the Karazhan instance.
Karazhan's original floor maps begin at 350.

## Validation

The Node tests cover namespace isolation, delayed maps, floor changes, unknown instances, and localized or hostile names.
The tests do not invoke a model or claim to validate the current game phase.
