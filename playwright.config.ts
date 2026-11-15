import { defineConfig } from '@playwright/test'

// End-to-end tests against the production build (`vite preview`), the way people get the app. Each test uses its own
// origin (<name>.localhost), so their storage never mixes and nothing touches real data on :5199.
// PW_CHROMIUM points at an already-installed Chromium where Playwright's own download isn't available.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'off',
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM || undefined,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
    permissions: ['microphone'],
  },
  webServer: { command: 'npx vite preview --port 5220 --strictPort', port: 5220, reuseExistingServer: !process.env.CI },
})
