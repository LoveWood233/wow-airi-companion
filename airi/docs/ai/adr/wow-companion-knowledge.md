# Local Warcraft knowledge

Date: 2026-10-28

## Context

The companion needs Warcraft abbreviations and community jokes during conversation. Retail, Forever, and Classic require separate knowledge scopes.
The existing character research contains useful sources, but chat does not retrieve it.

## Decision

`@proj-airi/stage-shared/wow-knowledge` owns the curated JSON records, validation, retrieval, and bounded prompt text.
Shared records cover concepts across versions. Each version has general facts and optional language-community records.

Explicit game names in the current message override the observed game. An unknown version selects shared records only.
Comparison questions retain each matching version label. Classic advice retains its branch restrictions.
Message language selects community records. The interface locale resolves short inputs without a reliable language signal.

Chat adds references to the request copy after speech transcription. It does not persist retrieval results in the context registry.
Game-event reactions use the same retrieval function. Fixed speech templates retain their existing translation path.

Records contain source references, evidence status, usage limits, and review dates. Community phrases do not become official quotations.
The prompt permits occasional fictional faction jokes while preserving the active persona and conversation language.

## Limits

The initial community catalogs cover Chinese and English. Other languages can use general facts.
Retrieval uses aliases and tags. It requires no vector database, embeddings, network access, or extra model calls.
The catalog is bundled at build time. It does not provide current patch data or live Classic telemetry.

## Validation

Tests cover version isolation, abbreviation boundaries, community selection, empty queries, source requirements, and prompt limits.
Request-projection tests cover replacement and removal of per-turn references without mutation of stored conversation data.

### Results on 2026-10-28

The new retrieval tests passed 15 cases. The new request-projection tests passed 7 cases.
All 60 catalog IDs are unique. Every repository source path exists.

From `airi/`:

```sh
pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-shared exec vitest run src/wow-knowledge/index.test.ts
```

From `airi/packages/stage-ui/`:

```sh
node ../../node_modules/vitest/vitest.mjs run src/stores/chat/wow-knowledge-context.test.ts --config ../stage-shared/vitest.config.ts
```

The projection tests used real package exports and the shared Node test configuration.
The existing server packages used their normal runtime build outputs. No internal import mock replaced those boundaries.

The focused type check passed. From the repository root:

```sh
node airi/node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --noUnusedLocals --module ESNext --moduleResolution bundler --target ESNext --resolveJsonModule --esModuleInterop --verbatimModuleSyntax --skipLibCheck airi/packages/stage-shared/src/wow-knowledge/index.ts airi/packages/stage-shared/src/wow-knowledge/index.test.ts
```

These workspace checks ran from `airi/`, but missing development dependencies blocked them:

| Command | Result |
| --- | --- |
| `pnpm --config.verify-deps-before-run=false lint` | Missing `moeru-lint` |
| `pnpm --config.verify-deps-before-run=false typecheck` | Missing `turbo` |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-shared typecheck` | Missing existing Vue, Pinia, Tempora, gpuu, and UnoCSS dependencies |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-ui typecheck` | Missing `vue-tsc` |
| `pnpm --config.verify-deps-before-run=false -F @proj-airi/stage-tamagotchi typecheck` | Missing `vue-tsc` |

The full chat contract test could not start with its normal configuration because Vue and UnoCSS test plugins were absent.
The desktop browser assertions were updated but were not run. A complete desktop build and live model conversation remain unverified.
Native audio without text or a transcript has no text to retrieve against. This change does not request an extra transcription.
