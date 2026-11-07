import { expect, test, type Page } from '@playwright/test';
import { HABIT, onboard } from './helpers';

test.use({ serviceWorkers: 'block' });

// Erster Start am Donnerstag, 5. November 2026; Rückblickstag ist Sonntag, 8. November.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+01:00'));
});

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const reviewCard = (page: Page) => page.locator('[data-role="review-card"]');
const group = (page: Page, name: string) => page.getByRole('group', { name, exact: true });

async function onSunday(page: Page) {
  await onboard(page);
  await expect(reviewCard(page)).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2026-11-08T10:00:00+01:00'));
  await page.reload();
  await expect(reviewCard(page)).toContainText('Wie lief die Woche vom 2. Nov. bis 8. Nov.?');
}

test('Rückblick ausfüllen: Vorschlag mit Grund, Entscheidung, danach verschwindet die Karte', async ({ page }) => {
  await onSunday(page);
  await reviewCard(page).getByRole('link', { name: 'Rückblick öffnen' }).click();
  await expect(h1(page)).toHaveText('Wochenrückblick');

  const habit = page.locator('[data-role="review-habit"]');
  await expect(habit.getByRole('heading', { name: HABIT })).toBeVisible();
  await habit.getByRole('textbox', { name: 'Was hat geholfen?' }).fill('Schuhe an der Tür');
  // Keine Vorschläge, solange nichts darauf hindeutet
  await expect(habit.locator('[data-role="suggestions"]')).toBeHidden();
  await group(page, 'Wie leicht fühlt es sich an?').getByRole('button', { name: '2' }).click();
  await expect(habit.locator('[data-role="suggestions"]')).toContainText('Weil du die Leichtigkeit mit 2 von 5 eingeschätzt hast.');
  await group(page, 'Wie oft hast du es im geplanten Moment gemacht?').getByRole('button', { name: 'meistens' }).click();
  await group(page, 'Für nächste Woche').getByRole('button', { name: 'etwas kleiner' }).click();
  // Die Automatik ist erst im 4. Rückblick dran.
  await expect(page.locator('[data-role="automaticity"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Fertig' }).click();
  const done = page.locator('[data-role="review-done"]');
  await expect(done).toContainText('Dein Rückblick ist gespeichert.');
  await expect(done).toContainText('Der nächste Rückblick erscheint am So, 15. Nov.');
  await done.getByRole('link', { name: `„${HABIT}“ kleiner machen` }).click();
  await expect(page.getByRole('textbox', { name: 'Was ist die kleinste Version davon?' })).toBeFocused();

  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Heute' }).click();
  await expect(h1(page)).toContainText('Heute');
  await expect(reviewCard(page)).toHaveCount(0);

  // Die Werte erscheinen im Verlauf als eigene Einschätzung der Woche.
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Verlauf' }).click();
  await expect(page.locator('[data-role="review-values"]')).toHaveText('Woche ab 2. Nov.: Leichtigkeit 2 von 5 · im geplanten Moment: meistens');
});

test('Rückblick überspringen und in den Einstellungen ausschalten', async ({ page }) => {
  await onSunday(page);
  await reviewCard(page).getByRole('link', { name: 'Rückblick öffnen' }).click();
  await page.getByRole('button', { name: 'Jetzt überspringen' }).click();
  await expect(page.locator('[data-role="review-done"]')).toContainText('Rückblick für diese Woche übersprungen.');
  await page.getByRole('link', { name: 'Zu Heute' }).click();
  await expect(reviewCard(page)).toHaveCount(0);

  // Eine Woche später steht der nächste an (auf „Heute“ hat nach zehn Tagen ohne Eintrag
  // der Wiedereinstieg Vorrang); ausgeschaltet verschwindet er.
  await page.clock.setFixedTime(new Date('2026-11-15T10:00:00+01:00'));
  await page.goto('/#/wochenrueckblick');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Fertig' })).toBeVisible();
  await page.goto('/#/einstellungen');
  const enabled = page.getByRole('checkbox', { name: 'Wochenrückblick anzeigen' });
  await expect(enabled).toBeChecked();
  await enabled.uncheck();
  await expect(page.locator('[data-role="settings-status"]')).toHaveText('Gespeichert.');
  await expect(page.getByRole('combobox', { name: 'Wochentag' })).toBeDisabled();
  await page.goto('/#/heute');
  await expect(h1(page)).toContainText('Heute');
  await expect(reviewCard(page)).toHaveCount(0);
  await page.goto('/#/wochenrueckblick');
  await expect(page.locator('[data-role="review-state"]')).toContainText('Der Wochenrückblick ist ausgeschaltet.');
});
