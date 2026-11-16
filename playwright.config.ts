import { defineConfig, devices } from '@playwright/test';

// TECHNICAL-DESIGN.md 13. The OnePlus Pad 3 (Chrome) is the MVP target;
// WebKit/iPad runs too, to catch Safari gaps early, but isn't a target
// yet. A OnePlus Pad 3 reports roughly a 1356x960 CSS viewport at DPR 2.5.
const onePlusPad = {
  ...devices['Desktop Chrome'],
  deviceScaleFactor: 2.5,
  isMobile: true,
  hasTouch: true,
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4300/',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'tablet-landscape', use: { ...onePlusPad, viewport: { width: 1356, height: 960 } } },
    { name: 'tablet-portrait', use: { ...onePlusPad, viewport: { width: 960, height: 1356 } } },
    { name: 'webkit-ipad', use: { ...devices['iPad Pro 11 landscape'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx ng serve --port 4300',
    url: 'http://localhost:4300/',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
