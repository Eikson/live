import { expect, test, type Page } from '@playwright/test';
import { confirmation, HABIT, onboard } from './helpers';

test.use({ serviceWorkers: 'block' });

// Donnerstag, 5. November 2026, vormittags.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+01:00'));
});

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

async function openTab(page: Page, name: 'Verlauf' | 'Heute') {
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name }).click();
  await expect(h1(page)).toContainText(name);
}

test('Verlauf nach dem ersten Eintrag: Niveau noch ohne Zahl, Kalender und Ereignisse', async ({ page }) => {
  const card = await onboard(page);
  await card.getByRole('button', { name: 'Gemacht', exact: true }).click();
  await expect(confirmation(page)).toContainText('Erledigt.');

  await openTab(page, 'Verlauf');
  const level = page.locator('[data-role="level"]');
  await expect(level).toContainText('Bisher sind es 1.');
  await expect(level.locator('.level-value')).toHaveCount(0);
  await expect(level).toContainText('Noch zu wenig Daten für einen Vergleich.');
  // Das Diagramm hat einen Textersatz; die Wochentabelle zeigt nur Durchschnitte.
  await expect(level.getByRole('img', { name: 'Niveau der letzten Wochen' })).toBeVisible();
  await level.getByText('Als Tabelle anzeigen').click();
  const table = level.getByRole('table', { name: 'Niveau je Woche' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText(['Woche', 'Eingetragene Tage', 'Ø 28 Tage', 'Boden', 'Decke']);

  const calendar = page.locator('[data-role="calendar"]');
  await expect(calendar.locator('.month-title')).toHaveText('November 2026');
  const habit = calendar.locator('[data-role="calendar-habit"]');
  await expect(habit.getByRole('heading', { name: HABIT })).toBeVisible();
  await expect(habit).toContainText('an 1 von 1 geplanten Tagen');
  await expect(habit.getByRole('cell', { name: 'Do, 5. Nov.: gemacht' })).toBeVisible();
  await expect(habit.getByRole('cell', { name: 'Fr, 6. Nov.: nicht geplant' })).toBeVisible();
  await expect(calendar.locator('[data-role="events"]')).toContainText('aktiviert am');
  // Vor der ersten Aktivierung und nach dem aktuellen Monat gibt es nichts zu blättern.
  await expect(calendar.getByRole('link', { name: 'Vorheriger Monat' })).toHaveCount(0);
  await expect(calendar.getByRole('link', { name: 'Nächster Monat' })).toHaveCount(0);

  await expect(page.locator('[data-role="wellbeing"]')).toBeVisible();
});

test('Heute zeigt keine Score-Zahl; Hinweiskarte erscheint ohne Muster nicht', async ({ page }) => {
  const card = await onboard(page);
  await card.getByRole('button', { name: 'Gemacht', exact: true }).click();
  await expect(confirmation(page)).toContainText('Erledigt.');
  await expect(page.locator('main')).not.toContainText('Ø');
  await expect(page.locator('[data-role="hint"]')).toHaveCount(0);
});

test('Infoseite ist aus Verlauf und Einstellungen erreichbar', async ({ page }) => {
  await onboard(page);
  await openTab(page, 'Verlauf');
  await page.getByRole('link', { name: 'Was bedeuten diese Werte?' }).click();
  await expect(h1(page)).toHaveText('Über Live');
  await expect(page.getByRole('heading', { name: 'Deine Daten' })).toBeVisible();
  await page.getByRole('link', { name: 'Zurück zum Verlauf' }).click();
  await expect(h1(page)).toHaveText('Verlauf');

  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await expect(h1(page)).toHaveText('Einstellungen');
  await page.getByRole('link', { name: 'Über Live' }).click();
  await expect(h1(page)).toHaveText('Über Live');
});
