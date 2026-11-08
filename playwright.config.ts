import { defineConfig, devices } from '@playwright/test';

// E2E läuft gegen den Production-Build (vite preview), damit auch der Service Worker geprüft wird.
// Mit LIVE_BASE=/live/ läuft der Build unter einem Unterpfad wie später auf GitHub Pages.
const base = process.env.LIVE_BASE ?? '/';
// E2E_PORT, falls 4173 schon belegt ist (z. B. durch eine laufende Vorschau).
const port = Number(process.env.E2E_PORT ?? 4173);
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: origin + base,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'pixel8', use: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: origin + base,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
