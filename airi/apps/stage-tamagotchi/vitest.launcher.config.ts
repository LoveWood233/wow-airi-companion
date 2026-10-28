import { env } from 'node:process'

import vue from '@vitejs/plugin-vue'
import { playwright } from '@vitest/browser-playwright'
import UnoCss from 'unocss/vite'
import { normalizePath, searchForWorkspaceRoot } from 'vite'
import { defineConfig } from 'vitest/config'

import unoConfig from './uno.config'

// Launcher components use the real UI and IPC contracts without the model renderer or page router.
export default defineConfig({
  root: import.meta.dirname,
  optimizeDeps: { include: ['vue', 'pinia', 'vue-i18n', 'yaml', 'vitest-browser-vue'] },
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(import.meta.dirname), ...(env.VITE_LAUNCHER_CAPTURE_DIR ? [env.VITE_LAUNCHER_CAPTURE_DIR] : [])],
    },
  },
  plugins: [
    vue(),
    UnoCss({
      ...unoConfig,
      // NOTICE:
      // Config discovery replaces the initial stylesheet scan through a shallow merge.
      // The existing vitest.config.ts documents this behavior in @unocss/config loadConfig.
      // Remove this override when discovery preserves inline content.filesystem.
      configFile: false,
      content: {
        ...unoConfig.content,
        filesystem: [
          `${normalizePath(import.meta.dirname)}/src/renderer/components/wow-*-settings.vue`,
          `${normalizePath(import.meta.dirname)}/src/renderer/components/stage-islands/controls-island/*.vue`,
          `${normalizePath(import.meta.dirname)}/../../packages/ui/src/**/*.vue`,
        ],
      },
    }),
  ],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'launcher-node',
          environment: 'node',
          include: ['src/main/services/airi/wow-launcher-*.test.ts'],
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      {
        extends: true,
        test: {
          name: 'launcher-browser',
          include: ['src/renderer/pages/settings/wow-launcher.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: { executablePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
