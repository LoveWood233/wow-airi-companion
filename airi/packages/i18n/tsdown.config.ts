import Yaml from 'unplugin-yaml/rolldown'

import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'locales/index': 'src/locales/index.ts',
    'locales/en/index': 'src/locales/en/index.ts',
    'locales/es/index': 'src/locales/es/index.ts',
    'locales/fr/index': 'src/locales/fr/index.ts',
    'locales/it/index': 'src/locales/it/index.ts',
    'locales/ja/index': 'src/locales/ja/index.ts',
    'locales/ko/index': 'src/locales/ko/index.ts',
    'locales/pt/index': 'src/locales/pt/index.ts',
    'locales/ru/index': 'src/locales/ru/index.ts',
    'locales/th/index': 'src/locales/th/index.ts',
    'locales/vi/index': 'src/locales/vi/index.ts',
    'locales/zh-Hans/index': 'src/locales/zh-Hans/index.ts',
    'locales/zh-Hant/index': 'src/locales/zh-Hant/index.ts',
  },
  copy: [
    { from: 'src/locales', to: 'dist/locales' },
  ],
  unbundle: true,
  plugins: [
    Yaml(),
  ],
})
