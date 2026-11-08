# `@proj-airi/stage-shared`

## Structured Warcraft references

`wow-knowledge` exports `readWowReferenceAnswer`, source evidence types, and safe source URL and build readers.
These functions normalize supported recorded MCP results without network access or model inference.
The chat widget and MCP transport share this boundary. See [the design](../../docs/ai/adr/wow-structured-reference-answers.md).

## Profession material calculations

`wow-knowledge` also exports bounded crafting readers and pure recipe and skill-route calculations.
They merge material identities, share inventory balances, reuse intermediate products, and preserve incomplete evidence.
See [the profession planner design](../../docs/ai/adr/wow-profession-materials.md).

## Retail query contracts

`wow-knowledge` exports strict local Retail query contracts and a reader for recorded native-tool answers.
They retain source build, locale, snapshot identity, and dependent table limits without exposing filesystem paths.
See [the Retail query design](../../docs/ai/adr/wow-retail-database.md).

## Warcraft cache contracts

`wow-knowledge` exports bounded cache keys, evidence contracts, and the wuxianwow caching policy.
Game, build, locale, source snapshot, connection, tool, and arguments isolate records.
Adapters preserve original source times and record cache serving times separately.
See [the cache design](../../docs/ai/adr/wow-data-updates-and-cache.md). Filesystem ownership belongs to the desktop main process.

## Quest references

`wow-knowledge` exports bounded quest queries, source readers, progress evidence, risk explanations, and recorded-answer validation.
Client completion flags, task readiness, objective coverage, and session turn-ins retain separate meanings.
Forever references never establish Retail quest facts. See [the quest design](../../docs/ai/adr/wow-quest-and-leveling-assistant.md).

## Talent and equipment explanations

`wow-knowledge` exports strict build queries, talent-plan readers, investment differences, explicit-slot equipment comparisons, and recorded-result validation.
Committed observations remain separate from reference descriptions. Missing values, draft choices, and item-instance uncertainty retain explicit limits.
See [the explanation design](../../docs/ai/adr/wow-talents-and-equipment-explanations.md).

Shared contracts and runtime-neutral helpers for AIRI stage applications and UI packages.

## Use this package

Use this package when a type or behavior must cross stage application boundaries without depending on Electron, browser-only code, or a feature UI package.

The `plugin-host` entrypoint owns the serializable Plugin Host snapshots exchanged between the Electron main process and shared renderer code:

```ts
import type { PluginHostDebugSnapshot } from '@proj-airi/stage-shared/plugin-host'
```

The `model-assets` entrypoint owns model file manifests, download status, and
the storage adapter contract. Use a platform adapter to store and open files.
It does not own a recognizer or Worker.

The `speaker-model` entrypoint pins the CAM++ speaker embedding pack. The renderer and the Electron main process both read it:

```ts
import { speakerModel } from '@proj-airi/stage-shared/speaker-model'
```

The `wow-knowledge` entrypoint owns local Warcraft reference retrieval. It separates game versions and language communities.
See [the knowledge guide](src/wow-knowledge/README.md) for sources, data layout, and extension rules.

```ts
import { createWowKnowledgeContext } from '@proj-airi/stage-shared/wow-knowledge'

const context = createWowKnowledgeContext({ text: '怀旧服DZ是什么意思', locale: 'zh-Hans' })
```

## Do not use this package

Keep Electron IPC definitions in the Electron application. Keep UI state and actions in `@proj-airi/stage-ui`. Keep Extension runtime and manifest behavior in `@proj-airi/plugin-sdk`.

Do not add application startup, persistence, or platform-specific side effects here.
