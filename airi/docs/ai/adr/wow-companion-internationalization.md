# WoW Companion interface languages

The desktop uses the same locale in the renderer, native menu, tray and window titles. The supported locales are English, Simplified Chinese, Traditional Chinese, Spanish, French, Italian, Portuguese, Japanese, Korean, Russian, Thai and Vietnamese. Regional aliases resolve to a supported language; unknown locales use English. Existing profile paths, provider identifiers, transport fields and credentials keep their previous identifiers.

All 3,948 English source messages have matching keys and named placeholders in each locale. Companion namespaces cover game status, equipment, addon installation, runtime errors, speech settings, model controls, provider settings and other interface controls. Runtime errors carry message IDs and interpolation values across IPC, so an open error changes language with the interface. Game and external service names, user content and diagnostic details remain data.

The WoW addons use GetLocale independently of the desktop. Localization.lua loads before other modules, with English fallback and regional aliases. UI translation does not rewrite telemetry keys or game observations. Equipment comparison also recognizes the client's public localized stat names and numeric tooltip templates. Unrecognized effects still require review.

WoW features, confirmation prompts and prominent controls were manually translated or reviewed. Some advanced baseline settings use locally generated translations and need further native-speaker editing. The local translation model, temporary tooling, caches and user profiles are excluded from delivery.

Validation includes complete catalog/placeholder checks, compilation of all 47,376 locale strings, regional locale resolution, real browser settings tests, native menu command preservation and game-localized tooltip regression tests. Keep language selection under Settings → System → General → Language. Do not translate API keys, command syntax, filenames used by protocols, or saved user content.
