import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:3100',
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command:
        'npm run build --workspace @pointrush/contracts && npx tsc -p apps/api/tsconfig.test.json && cd apps/api && POINTRUSH_BROWSER_TEST=1 node .test-dist/test/helpers/web-server.js',
      cwd: '../..',
      url: 'http://localhost:8081/api/v1/health/live',
      timeout: 90000,
    },
    {
      command:
        'NEXT_PUBLIC_API_ORIGIN=http://localhost:8081 NEXT_PUBLIC_FEATURE_JOBS=on npm run dev -- --port 3100',
      url: 'http://localhost:3100/login',
      timeout: 90000,
    },
  ],
});
