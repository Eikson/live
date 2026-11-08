import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { HABIT, onboard } from './helpers';

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

/** Wartet, bis der Service Worker die Seite kontrolliert (nach dem ersten Laden ist ein Neuladen nötig). */
async function controlledBySw(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(h1(page)).toContainText('Heute');
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test.describe('Service Worker', () => {
  test.describe.configure({ timeout: 60_000 });

  test('läuft nach dem ersten Laden offline, mit allen Daten', async ({ page, context }) => {
    const card = await onboard(page);
    await card.getByRole('button', { name: 'Gemacht', exact: true }).click();
    await expect(page.locator('[data-role="confirmation"]')).toContainText('Erledigt.');
    await controlledBySw(page);

    await context.setOffline(true);
    try {
      await page.reload();
      await expect(h1(page)).toContainText('Heute');
      await expect(page.locator('article.habit-card').getByRole('heading', { name: HABIT })).toBeVisible();
      await expect(page.locator('[data-role="confirmation"]')).toContainText('Erledigt.');
      // Auch andere Seiten kommen aus dem Cache.
      await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Verlauf' }).click();
      await expect(h1(page)).toContainText('Verlauf');
      await page.goto('/#/plan');
      await expect(h1(page)).toContainText('Plan');
    } finally {
      await context.setOffline(false);
    }
  });

  test('eine neue Version wartet, bis du bestätigst; offene Eingaben bleiben stehen', async ({ page }) => {
    await onboard(page);
    await controlledBySw(page);

    await page.goto('/#/ziel-neu');
    const title = page.getByRole('textbox').first();
    await title.fill('Noch nicht gespeichert');

    // Neue Version auf dem Server: sw.js ändert sich. `vite preview` liest die Datei bei jeder Anfrage.
    const swPath = new URL('../../dist/sw.js', import.meta.url);
    const original = await readFile(swPath, 'utf8');
    try {
      await writeFile(swPath, `${original}\n// neue Version ${Date.now()}\n`);
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      });
      const banner = page.locator('[data-banner="update"]');
      await expect(banner.getByRole('button', { name: 'Neue Version verfügbar – neu laden' })).toBeVisible({ timeout: 20_000 });
      // Nichts lädt von selbst neu: die Eingabe ist noch da.
      await expect(title).toHaveValue('Noch nicht gespeichert');

      // „Später“ blendet nur den Hinweis aus.
      await banner.getByRole('button', { name: 'Später' }).click();
      await expect(banner).toHaveCount(0);
      await expect(title).toHaveValue('Noch nicht gespeichert');
    } finally {
      await writeFile(swPath, original);
    }
  });

  test('„neu laden“ aktiviert die neue Version', async ({ page }) => {
    await onboard(page);
    await controlledBySw(page);
    const swPath = new URL('../../dist/sw.js', import.meta.url);
    const original = await readFile(swPath, 'utf8');
    try {
      await writeFile(swPath, `${original}\n// neue Version ${Date.now()}\n`);
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration())?.update();
      });
      const reload = page.getByRole('button', { name: 'Neue Version verfügbar – neu laden' });
      await expect(reload).toBeVisible({ timeout: 20_000 });
      await Promise.all([page.waitForEvent('load'), reload.click()]);
      await expect(h1(page)).toContainText('Heute');
      await expect(reload).toHaveCount(0);
      await expect(page.locator('article.habit-card').getByRole('heading', { name: HABIT })).toBeVisible();
    } finally {
      await writeFile(swPath, original);
    }
  });
});

test.describe('Fehlerzustände', () => {
  test.use({ serviceWorkers: 'block' });

  test('ohne IndexedDB (privater Modus) erscheint eine Erklärung statt eines leeren Bildschirms', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
    });
    await page.goto('/');
    await expect(h1(page)).toHaveText('Live kann hier keine Daten speichern');
    await expect(page.getByText('privaten Modus')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
  });

  test('wenn der Browser das Öffnen des Speichers verweigert, erscheint dieselbe Erklärung', async ({ page }) => {
    await page.addInitScript(() => {
      IDBFactory.prototype.open = () => {
        throw new DOMException('Zugriff verweigert', 'SecurityError');
      };
    });
    await page.goto('/');
    await expect(h1(page)).toHaveText('Live kann hier keine Daten speichern');
  });

  test('voller Speicher: die Angabe wird nicht gespeichert, ein Hinweis erklärt den Grund', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+01:00'));
    const card = await onboard(page);
    await page.evaluate(() => {
      IDBObjectStore.prototype.put = () => {
        throw new DOMException('Der Speicher ist voll.', 'QuotaExceededError');
      };
    });
    await card.getByRole('button', { name: 'Gemacht', exact: true }).click();

    const banner = page.locator('[data-banner="quota"]');
    await expect(banner).toContainText('Der Speicher auf diesem Gerät ist voll.');
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(page.getByText('Deine Angabe wurde nicht gespeichert. Versuch es bitte noch einmal.')).toBeVisible();

    await banner.getByRole('button', { name: 'Zum Export' }).click();
    await expect(h1(page)).toHaveText('Daten');

    // Nach dem Neuladen (Speicher wieder frei) gibt es keinen halben Eintrag.
    await page.goto('/');
    await expect(page.locator('article.habit-card').getByRole('button', { name: 'Gemacht', exact: true })).toBeVisible();
    await expect(page.locator('[data-role="confirmation"]')).toHaveCount(0);
  });
});

test.describe('Installationsanleitung', () => {
  test.use({ serviceWorkers: 'block' });

  test('ist aus den Einstellungen erreichbar und erklärt Android und Desktop', async ({ page }) => {
    await onboard(page);
    await page.getByRole('link', { name: 'Einstellungen' }).click();
    await page.getByRole('link', { name: 'App installieren' }).click();
    await expect(h1(page)).toHaveText('App installieren');
    await expect(page.getByRole('heading', { name: 'Android mit Chrome' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Computer mit Chrome oder Edge' })).toBeVisible();
    await expect(page.getByText('https')).toBeVisible();
    // Der Zahnrad-Eintrag bleibt markiert.
    await expect(page.getByRole('link', { name: 'Einstellungen', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Zurück zu den Einstellungen' }).click();
    await expect(h1(page)).toHaveText('Einstellungen');
  });

  test('das Manifest ist vollständig für die Installation', async ({ request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest).toMatchObject({ name: 'Live', lang: 'de', display: 'standalone', start_url: '.', scope: '.' });
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose?.includes('maskable'))).toBe(true);
    for (const icon of manifest.icons) expect((await request.get(`/${icon.src}`)).ok()).toBe(true);
  });
});

/** Kurzprüfung je Seite: Namen, Überschriften, IDs, Sprache, Überlauf, Symbole. */
async function audit(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const visible = (el: Element) => (el as HTMLElement).offsetParent !== null || el.getClientRects().length > 0;
    const nameOf = (el: Element): string => {
      const label = el.getAttribute('aria-label');
      if (label) return label;
      const by = el.getAttribute('aria-labelledby');
      if (by) return by.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      const labels = (el as HTMLInputElement).labels;
      if (labels?.length) return [...labels].map((l) => l.textContent ?? '').join(' ');
      return (el.textContent ?? '').trim() || el.getAttribute('title') || '';
    };

    if (document.documentElement.lang !== 'de') problems.push('lang fehlt');
    const h1s = [...document.querySelectorAll('h1')].filter(visible);
    if (h1s.length !== 1) problems.push(`${h1s.length} h1`);

    const fields = document.querySelectorAll('input:not([type="hidden"]), select, textarea, button, a[href]');
    for (const el of fields) {
      if (!visible(el)) continue;
      if (!nameOf(el).trim()) problems.push(`ohne Namen: ${el.outerHTML.slice(0, 80)}`);
    }
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) problems.push(`doppelte id ${id}`);

    for (const svg of document.querySelectorAll('svg')) {
      const hidden = svg.closest('[aria-hidden="true"]');
      const named = svg.getAttribute('aria-label') || svg.querySelector('title') || svg.getAttribute('aria-labelledby');
      if (!hidden && !named) problems.push(`svg ohne Text: ${svg.outerHTML.slice(0, 60)}`);
    }
    for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) problems.push('img ohne alt');

    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 3)
        .map((el) => el.outerHTML.slice(0, 60));
      problems.push(`horizontaler Überlauf: ${wide.join(' | ')}`);
    }
    return problems;
  });
}

const ROUTES = [
  'heute',
  'plan',
  'verlauf',
  'einstellungen',
  'ziel-neu',
  'gewohnheit-neu',
  'abend',
  'gegen-habit-neu',
  'ausweichliste',
  'wochenrueckblick',
  'daten',
  'gespeichert',
  'installieren',
  'info',
];

test.describe('Barrierefreiheit', () => {
  test.use({ serviceWorkers: 'block', viewport: { width: 320, height: 640 } });
  test.describe.configure({ timeout: 90_000 });

  for (const scheme of ['light', 'dark'] as const) {
    test(`alle Seiten bei 320 px Breite (${scheme === 'light' ? 'hell' : 'dunkel'})`, async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-05T19:00:00+01:00'));
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto('/');
      expect(await audit(page), 'erster Start').toEqual([]);
      await onboard(page, { counters: true });
      // Lange Texte dürfen das Layout nicht sprengen.
      for (const route of ROUTES) {
        await page.goto(`/#/${route}`);
        await expect(h1(page)).toBeVisible();
        expect(await audit(page), route).toEqual([]);
      }
    });
  }

  test('Navigation und Check-in gehen mit der Tastatur', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+01:00'));
    await onboard(page);
    await page.goto('/#/heute');
    await expect(h1(page)).toContainText('Heute');

    // Mit Tab zum Knopf „Gemacht“ und mit der Leertaste auslösen.
    const done = page.getByRole('button', { name: 'Gemacht', exact: true });
    for (let i = 0; i < 25 && !(await done.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(done).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.locator('[data-role="confirmation"]')).toContainText('Erledigt.');

    // Zum Tab „Plan“ und mit Enter öffnen; die Überschrift bekommt den Fokus.
    const plan = page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Plan' });
    for (let i = 0; i < 40 && !(await plan.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(plan).toBeFocused();
    const outline = await plan.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(h1(page)).toContainText('Plan');
    await expect(h1(page)).toBeFocused();
  });
});
