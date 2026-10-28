import { env } from 'node:process'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

import launcherConfig from './vitest.launcher.config'

// Both Warcraft settings use the same real Vue, UnoCSS, and browser setup.
export default defineConfig({
  ...launcherConfig,
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'screen-assist-node',
          environment: 'node',
          include: [
            'src/main/services/airi/wow-screen-*.test.ts',
            'src/renderer/stores/wow-screen-*.test.ts',
            '../../packages/stage-ui/src/stores/chat/request-context.test.ts',
          ],
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      {
        extends: true,
        test: {
          name: 'screen-assist-browser',
          include: ['src/renderer/pages/settings/wow-screen-assist.browser.test.ts'],
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
