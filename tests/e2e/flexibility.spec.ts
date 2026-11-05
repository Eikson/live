import { expect, test, type Page } from '@playwright/test';
import { HABIT, onboard } from './helpers';

test.use({ serviceWorkers: 'block' });

// Donnerstag, 5. November 2026.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+01:00'));
});

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const status = (page: Page) => page.locator('[data-role="plan-status"]');
const groupSummary = (page: Page, key: string) => page.locator(`details[data-group="${key}"] > summary`);
const MINIMUM = 'Was ist die kleinste Version davon?';

async function openTab(page: Page, name: 'Plan' | 'Heute') {
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name }).click();
}

async function openPlan(page: Page) {
  await openTab(page, 'Plan');
  await expect(h1(page)).toHaveText('Plan');
}

/** Klappt die Gewohnheit im Ziel auf, damit ihre Aktionen sichtbar sind. */
async function openHabit(page: Page) {
  await page.locator('article.goal li[data-habit] summary').first().click();
}

test('Bearbeiten: neue Minimalversion wird gespeichert, ohne Änderung gibt es einen Hinweis', async ({ page }) => {
  await onboard(page);
  await openPlan(page);
  await openHabit(page);
  await page.getByRole('link', { name: `Bearbeiten: ${HABIT}` }).click();

  await expect(h1(page)).toHaveText('Gewohnheit bearbeiten');
  await expect(page.getByText('Ziel „Mehr Bewegung“')).toBeVisible();
  await expect(page.locator('[data-role="edit-note"]')).toHaveText(
    'Rhythmus und Gewicht gelten ab heute. Frühere Einträge bleiben, wie sie sind.',
  );
  await expect(page.getByRole('textbox', { name: 'Was tust du konkret?' })).toHaveValue(HABIT);

  const minimum = page.getByRole('textbox', { name: MINIMUM });
  await minimum.fill('');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(minimum).toBeFocused(); // Pflichtfeld leer: nichts gespeichert

  await minimum.fill('1 Minute vor die Tür');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(h1(page)).toHaveText('Plan');
  await expect(status(page)).toHaveText('Änderungen gespeichert. Rhythmus und Gewicht gelten ab heute.');
  await expect(page.locator('article.goal li[data-habit] .facts')).toContainText('1 Minute vor die Tür');
  await expect(page).not.toHaveURL(/meldung/);

  await page.getByRole('link', { name: `Bearbeiten: ${HABIT}` }).click();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(status(page)).toHaveText('Gespeichert. Es gab keine Änderung.');

  await page.getByRole('link', { name: `Bearbeiten: ${HABIT}` }).click();
  await page.getByRole('link', { name: 'Abbrechen' }).click();
  await expect(h1(page)).toHaveText('Plan');
});

test('Pausieren und Fortsetzen: pausierte Gewohnheit ruht und erscheint nicht auf „Heute“', async ({ page }) => {
  await onboard(page);
  await openPlan(page);
  await openHabit(page);
  await page.getByRole('button', { name: `Pausieren: ${HABIT}` }).click();

  await expect(status(page)).toHaveText('Pausiert. Die Gewohnheit ruht, bis du sie fortsetzt.');
  await expect(status(page)).toBeFocused();
  await expect(groupSummary(page, 'paused')).toHaveText('Pausiert (1)');
  await expect(page.locator('article.goal li[data-habit]')).toHaveCount(0);

  await openTab(page, 'Heute');
  await expect(page.locator('article.habit-card')).toHaveCount(0);

  await openPlan(page);
  await groupSummary(page, 'paused').click();
  await page.locator('details[data-group="paused"] li[data-habit] summary').click();
  await page.getByRole('button', { name: `Fortsetzen: ${HABIT}` }).click();
  await expect(status(page)).toHaveText('Fortgesetzt. Die Gewohnheit steht ab heute wieder auf „Heute“.');
  await expect(groupSummary(page, 'paused')).toHaveText('Pausiert (0)');

  await openTab(page, 'Heute');
  await expect(page.locator('article.habit-card')).toHaveCount(1);
});

test('Archivieren und Löschen fragen vorher nach; Abbrechen lässt alles, wie es ist', async ({ page }) => {
  await onboard(page);
  await openPlan(page);
  await openHabit(page);

  const archive = page.getByRole('button', { name: `Archivieren: ${HABIT}` });
  await archive.click();
  const question = page.locator('[data-role="confirm"]');
  await expect(question).toContainText('Archivieren ist endgültig.');
  await expect(question).toBeFocused();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(archive).toBeFocused();

  await archive.click();
  await page.getByRole('button', { name: `Ja, archivieren: ${HABIT}` }).click();
  await expect(status(page)).toHaveText('Archiviert.');
  await expect(groupSummary(page, 'archived')).toHaveText('Archiviert (1)');
  await expect(page.getByRole('link', { name: `Bearbeiten: ${HABIT}` })).toHaveCount(0);

  await page.getByRole('button', { name: `Löschen: ${HABIT}` }).click();
  await expect(page.locator('[data-role="confirm"]')).toContainText('Das lässt sich nicht rückgängig machen.');
  await page.getByRole('button', { name: `Ja, löschen: ${HABIT}` }).click();
  await expect(status(page)).toHaveText('Gelöscht.');
  await expect(groupSummary(page, 'archived')).toHaveText('Archiviert (0)');

  await page.reload();
  await expect(page.getByText(HABIT)).toHaveCount(0);
});

test('Ziel bearbeiten und löschen; das Löschen nimmt die Gewohnheiten mit', async ({ page }) => {
  await onboard(page);
  await openPlan(page);

  await page.getByRole('link', { name: 'Ziel bearbeiten: Mehr Bewegung' }).click();
  await expect(h1(page)).toHaveText('Ziel bearbeiten');
  await page.getByRole('textbox', { name: 'Ziel', exact: true }).fill('Mehr draußen sein');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(status(page)).toHaveText('Ziel gespeichert.');
  await expect(page.locator('article.goal h2')).toContainText('Mehr draußen sein');

  await page.getByRole('button', { name: 'Ziel löschen: Mehr draußen sein' }).click();
  await expect(page.locator('[data-role="confirm"]')).toContainText('das Ziel und eine Gewohnheit');
  await page.getByRole('button', { name: 'Ja, löschen: Mehr draußen sein' }).click();
  await expect(status(page)).toHaveText('Ziel gelöscht.');
  await expect(page.locator('article.goal')).toHaveCount(0);

  await openTab(page, 'Heute');
  await expect(page.locator('article.habit-card')).toHaveCount(0);
});

test.describe('Wiedereinstieg', () => {
  const reentry = (page: Page) => page.locator('[data-role="reentry"]');
  const todayStatus = (page: Page) => page.locator('[data-role="today-status"]');

  /** Plan eine Woche vorher angelegt, seitdem keine Angabe. */
  async function returnAfterAWeek(page: Page) {
    await page.clock.setFixedTime(new Date('2026-10-29T09:00:00+01:00'));
    await onboard(page);
    await expect(reentry(page)).toHaveCount(0);
    await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+01:00'));
    await page.reload();
    await expect(reentry(page)).toBeVisible();
    return reentry(page);
  }

  test('„Weitermachen“ blendet die Karte aus, ohne etwas nachzufordern', async ({ page }) => {
    const card = await returnAfterAWeek(page);
    await expect(card).toContainText('Willkommen zurück. Du musst nichts nachholen.');
    await expect(card).toContainText('Was passt jetzt am besten?');
    await expect(card).toContainText(HABIT);

    await card.getByRole('button', { name: 'Weitermachen' }).click();
    await expect(card).toHaveCount(0);
    await expect(todayStatus(page)).toHaveText('Dein Plan geht ab heute weiter.');
    await expect(page.locator('article.habit-card')).toHaveCount(1);

    await page.reload();
    await expect(reentry(page)).toHaveCount(0);
  });

  test('„Kleiner machen“ führt zur Minimalversion im Bearbeiten-Formular', async ({ page }) => {
    const card = await returnAfterAWeek(page);
    await card.getByRole('button', { name: 'Kleiner machen' }).click();

    await expect(h1(page)).toHaveText('Gewohnheit bearbeiten');
    await expect(page.getByText('Ein kleinerer Plan kann besser zu deinem Alltag passen.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: MINIMUM })).toBeFocused();
  });

  test('„Ausblenden“ merkt sich die Karte, „Pausieren“ pausiert die Gewohnheit', async ({ page }) => {
    const card = await returnAfterAWeek(page);
    await card.getByRole('button', { name: 'Ausblenden' }).click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.locator('article.habit-card')).toHaveCount(1);
    await expect(reentry(page)).toHaveCount(0);

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await reentry(page).getByRole('button', { name: 'Pausieren' }).click();
    await expect(todayStatus(page)).toHaveText(`„${HABIT}“ ist pausiert. Du kannst die Gewohnheit im Plan fortsetzen.`);
    await expect(page.locator('article.habit-card')).toHaveCount(0);
  });
});
