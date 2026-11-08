import { expect, test } from '@playwright/test';

/**
 * Prüft den Build unter einem Unterpfad wie auf GitHub Pages (`https://<name>.github.io/<repo>/`).
 * Läuft nur mit gesetztem LIVE_BASE, z. B. `LIVE_BASE=/live/ npx playwright test base-path`.
 * Alle Adressen hier sind relativ, damit sie unter dem Unterpfad bleiben.
 */
const base = process.env.LIVE_BASE ?? '/';

test.describe('Unterpfad wie auf GitHub Pages', () => {
  test.skip(base === '/', 'nur mit LIVE_BASE');
  test.describe.configure({ timeout: 60_000 });

  test('Service Worker, Manifest und Offline-Start bleiben im Unterpfad', async ({ page, context, request }) => {
    await page.goto('./');
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    const firstHeading = await heading.textContent();

    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(new URL(scope).pathname).toBe(base);

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBe(`${base}manifest.webmanifest`);
    const manifest = await (await request.get('manifest.webmanifest')).json();
    for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);

    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    await context.setOffline(true);
    try {
      await page.reload();
      await expect(heading).toHaveText(firstHeading ?? '');
      expect(new URL(page.url()).pathname).toBe(base);
    } finally {
      await context.setOffline(false);
    }
  });
});
