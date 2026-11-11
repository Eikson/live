import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import { onboard } from './helpers';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+01:00'));
});

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const exportBox = (page: Page) => page.locator('[data-role="export"]');
const preview = (page: Page) => page.locator('[data-role="import-preview"]');
const status = (page: Page) => page.locator('[data-role="data-status"]');
const dataError = (page: Page) => page.locator('[data-role="data-error"]');

/** Ohne Teilen-Menü (wie am Desktop): Export als Download. */
async function withoutShare(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true });
  });
}

async function openData(page: Page) {
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await page.getByRole('link', { name: 'Exportieren und importieren' }).click();
  await expect(h1(page)).toHaveText('Daten');
}

async function exportFile(page: Page, password?: string): Promise<{ name: string; text: string }> {
  if (password) {
    await exportBox(page).getByRole('checkbox', { name: 'Datei mit Passwort verschlüsseln' }).check();
    await exportBox(page).getByLabel('Passwort', { exact: true }).fill(password);
    await exportBox(page).getByLabel('Passwort wiederholen', { exact: true }).fill(password);
  }
  const download = page.waitForEvent('download');
  await exportBox(page).getByRole('button', { name: 'Exportdatei herunterladen' }).click();
  const file = await download;
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, 'utf8') };
}

async function chooseImport(page: Page, file: { name: string; text: string }) {
  await page.getByLabel('Datei auswählen').setInputFiles({
    name: file.name,
    mimeType: 'application/json',
    buffer: Buffer.from(file.text, 'utf8'),
  });
}

test('Export als Datei, dann Ersetzen mit Vorschau und Sicherheitskopie', async ({ page }) => {
  await withoutShare(page);
  const card = await onboard(page);
  await openData(page);
  await expect(exportBox(page).locator('[data-role="last-backup"]')).toHaveText('Bisher gibt es keinen Export.');

  const file = await exportFile(page);
  expect(file.name).toBe('live-backup-2026-11-05.json');
  expect(JSON.parse(file.text)).toMatchObject({ format: 'live-backup', formatVersion: 2 });
  await expect(status(page)).toHaveText('Export erstellt: live-backup-2026-11-05.json');
  await expect(exportBox(page).locator('[data-role="last-backup"]')).toHaveText('Letzter Export: 5. Nov. 2026');

  // Danach ein Check-in, der durch das Ersetzen wieder verschwindet.
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Heute' }).click();
  await card.getByRole('button', { name: 'Gemacht', exact: true }).click();
  await expect(page.locator('[data-role="confirmation"]')).toBeVisible();

  await openData(page);
  await chooseImport(page, file);
  await expect(preview(page)).toContainText('Exportiert am 5. Nov. 2026');
  await expect(preview(page)).toContainText('1 Ziel, 1 Gewohnheit, 0 Check-ins');
  await expect(preview(page)).toContainText('Die Datei enthält noch keine Check-ins.');

  await preview(page).getByRole('button', { name: 'Ersetzen', exact: true }).click();
  await expect(preview(page).locator('[data-role="confirm"]')).toBeFocused();
  const safety = page.waitForEvent('download');
  await preview(page).getByRole('button', { name: 'Ja, ersetzen' }).click();
  expect((await safety).suggestedFilename()).toBe('live-sicherheitskopie-2026-11-05.json');
  const copy = JSON.parse(await readFile(((await (await safety).path()) as string), 'utf8'));
  expect(copy.data.checkIns).toHaveLength(1);

  await expect(status(page)).toHaveText('Deine Daten wurden ersetzt. Die Sicherheitskopie liegt in deinen Downloads.');
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Heute' }).click();
  await expect(page.locator('article.habit-card')).toHaveCount(1);
  await expect(page.locator('[data-role="confirmation"]')).toHaveCount(0);
});

test('verschlüsselte Datei auf einem zweiten Gerät zusammenführen', async ({ page, browser }) => {
  await withoutShare(page);
  await onboard(page);
  await openData(page);
  await exportBox(page).getByRole('checkbox', { name: 'Datei mit Passwort verschlüsseln' }).check();
  await exportBox(page).getByLabel('Passwort', { exact: true }).fill('kurz');
  await exportBox(page).getByRole('button', { name: 'Exportdatei herunterladen' }).click();
  await expect(dataError(page)).toBeVisible();
  const file = await exportFile(page, 'ein-langes-passwort');
  expect(file.name).toBe('live-backup-2026-11-05-verschluesselt.json');
  expect(file.text).not.toContain('Mehr Bewegung');

  // Zweites „Gerät“: eigener Browser-Kontext mit eigenem Bestand.
  const other = await browser.newContext({ serviceWorkers: 'block' });
  const b = await other.newPage();
  await b.clock.setFixedTime(new Date('2026-11-06T09:00:00+01:00'));
  await onboard(b);
  await openData(b);
  await chooseImport(b, file);
  const unlock = b.locator('[data-role="import-unlock"]');
  await unlock.getByLabel('Passwort', { exact: true }).fill('falsches-passwort');
  await unlock.getByRole('button', { name: 'Entschlüsseln' }).click();
  await expect(dataError(b)).toHaveText('Das Passwort passt nicht zu dieser Datei.');
  await unlock.getByLabel('Passwort', { exact: true }).fill('ein-langes-passwort');
  await unlock.getByRole('button', { name: 'Entschlüsseln' }).click();
  await expect(preview(b)).toContainText('1 Ziel, 1 Gewohnheit, 0 Check-ins');

  await preview(b).getByRole('button', { name: 'Zusammenführen' }).click();
  await expect(status(b)).toHaveText('Die Datei wurde zusammengeführt.');
  await b.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Heute' }).click();
  await expect(b.locator('article.habit-card')).toHaveCount(2);
  await other.close();
});

test('unbrauchbare Dateien werden mit Grund abgelehnt, nichts ändert sich', async ({ page }) => {
  await onboard(page);
  await openData(page);
  await chooseImport(page, { name: 'kaputt.json', text: '{"format":"live-backup",' });
  await expect(dataError(page)).toContainText('Sie ist beschädigt oder keine Exportdatei von Live.');
  await expect(preview(page)).toHaveCount(0);
  await chooseImport(page, { name: 'fremd.json', text: '{"name":"etwas anderes"}' });
  await expect(dataError(page)).toBeVisible();
  await expect(preview(page)).toHaveCount(0);
});

test('Teilen-Menü: Export wird über das Teilen ausgegeben', async ({ page }) => {
  await page.addInitScript(() => {
    const shared: string[] = [];
    (window as unknown as { shared: string[] }).shared = shared;
    Object.defineProperty(Navigator.prototype, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(Navigator.prototype, 'share', {
      value: async (data: { files: File[] }) => void shared.push(data.files[0]!.name),
      configurable: true,
    });
  });
  await onboard(page);
  await openData(page);
  await exportBox(page).getByRole('button', { name: 'Exportieren und teilen' }).click();
  await expect(status(page)).toHaveText('Export erstellt: live-backup-2026-11-05.json');
  expect(await page.evaluate(() => (window as unknown as { shared: string[] }).shared)).toEqual(['live-backup-2026-11-05.json']);
});

test('„Was wird gespeichert?“ nennt Speicherort und Speicherstatus', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await page.getByRole('link', { name: 'Was wird gespeichert?' }).click();
  await expect(h1(page)).toHaveText('Was wird gespeichert?');
  await expect(page.locator('[data-role="persistence"]')).toBeVisible();
  await expect(page.getByText('gegen Datenverlust geschützt')).toHaveCount(0);
  await page.getByRole('link', { name: 'Zum Export' }).click();
  await expect(h1(page)).toHaveText('Daten');
});

test('Alle Daten löschen erst nach Eingabe von „löschen“, danach erster Start', async ({ page }) => {
  await onboard(page);
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  const box = page.locator('[data-role="delete-all"]');
  await box.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(box.getByRole('alert')).toBeVisible();
  await box.getByLabel('Tippe zur Bestätigung „löschen“ ein').fill('Löschen');
  await box.getByRole('button', { name: 'Endgültig löschen' }).click();
  await expect(h1(page)).toContainText('Wähle etwas, das dir selbst wichtig ist');
  await page.reload();
  await expect(page.getByRole('button', { name: "Los geht's" })).toBeVisible();
});

test.describe('Backup-Hinweis', () => {
  const backupCard = (page: Page) => page.locator('[data-role="backup-card"]');

  async function day(page: Page, iso: string) {
    await page.clock.setFixedTime(new Date(iso));
    await page.reload();
    await expect(h1(page)).toContainText('Heute');
  }

  /** Erster Start ohne Wochenrückblick: dessen Karte hätte sonst Vorrang vor dem Backup-Hinweis. */
  async function start(page: Page) {
    await onboard(page);
    await page.getByRole('link', { name: 'Einstellungen' }).click();
    await page.getByRole('checkbox', { name: 'Wochenrückblick anzeigen' }).uncheck();
    await expect(page.locator('[data-role="settings-status"]')).not.toBeEmpty();
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Heute' }).click();
  }

  test('erscheint nach mehr als 14 Tagen ohne Export, „Später“ blendet ihn für heute aus', async ({ page }) => {
    await start(page);
    await expect(backupCard(page)).toHaveCount(0);
    // Tag 14: noch kein Hinweis. Ein Check-in hält die Wiedereinstiegskarte fern.
    await day(page, '2026-11-19T09:00:00+01:00');
    await expect(backupCard(page)).toHaveCount(0);
    await page.locator('article.habit-card').getByRole('button', { name: 'Gemacht', exact: true }).click();
    await expect(page.locator('[data-role="confirmation"]')).toBeVisible();

    await day(page, '2026-11-20T09:00:00+01:00');
    await expect(backupCard(page)).toContainText('Du hast deine Einträge noch nicht exportiert.');
    await backupCard(page).getByRole('button', { name: 'Später' }).click();
    await expect(backupCard(page)).toHaveCount(0);
    await expect(h1(page)).toBeFocused();
    await page.reload();
    await expect(backupCard(page)).toHaveCount(0);

    // Am nächsten Tag wieder da; der Link führt zum Export.
    await day(page, '2026-11-21T09:00:00+01:00');
    await backupCard(page).getByRole('link', { name: 'Exportieren' }).click();
    await expect(h1(page)).toHaveText('Daten');
  });

  test('lässt sich in den Einstellungen abschalten', async ({ page }) => {
    await start(page);
    await day(page, '2026-11-19T09:00:00+01:00');
    await page.locator('article.habit-card').getByRole('button', { name: 'Gemacht', exact: true }).click();
    await expect(page.locator('[data-role="confirmation"]')).toBeVisible();
    await day(page, '2026-11-20T09:00:00+01:00');
    await expect(backupCard(page)).toBeVisible();

    await page.getByRole('link', { name: 'Einstellungen' }).click();
    await expect(page.locator('[data-role="backup-due"]')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Backup-Hinweis anzeigen' }).uncheck();
    await expect(page.locator('[data-role="settings-status"]')).not.toBeEmpty();
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Heute' }).click();
    await expect(page.locator('article.habit-card')).toHaveCount(1);
    await expect(backupCard(page)).toHaveCount(0);
  });
});
