import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// .mts on purpose: this package is CommonJS, and a .ts config fails to load on
// Node 20.18 with ERR_REQUIRE_ESM. See planning/03-decisions.md, D-06.
const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // Tests never read .env files, so local secrets cannot change a result.
  envDir: false,
  resolve: { alias: { '@': root } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
})
