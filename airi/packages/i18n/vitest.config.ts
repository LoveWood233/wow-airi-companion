import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['glossary/**/*.test.ts', 'src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
