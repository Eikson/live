import { expect, test, type Page } from '@playwright/test';
import { HABIT, onboard } from './helpers';

test.use({ serviceWorkers: 'block' });

// Donnerstag, 5. November 2026, vormittags.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+01:00'));
});

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const eveningStatus = (page: Page) => page.locator('[data-role="evening-status"]');
const planStatus = (page: Page) => page.locator('[data-role="plan-status"]');
const avoidanceStatus = (page: Page) => page.locator('[data-role="avoidance-status"]');
const group = (page: Page, name: string) => page.getByRole('group', { name, exact: true });

async function openTab(page: Page, name: 'Plan' | 'Heute') {
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name }).click();
  await expect(h1(page)).toContainText(name);
}

async function openEvening(page: Page) {
  await page.locator('[data-role="evening-entry"], [data-role="evening-card"]').getByRole('link', { name: 'Tag abschließen' }).click();
  await expect(h1(page)).toHaveText('Wie war dein Tag? · Do, 5. Nov.');
}

test('Abendkarte ab 18 Uhr; Abend-Check-in speichert alles und bleibt änderbar', async ({ page }) => {
  await onboard(page, { counters: true });
  // Vormittags gibt es nur den ruhigen Link.
  await expect(page.locator('[data-role="evening-card"]')).toHaveCount(0);
  await expect(page.locator('[data-role="evening-entry"]').getByRole('link', { name: 'Tag abschließen' })).toBeVisible();

  await page.clock.setFixedTime(new Date('2026-11-05T19:00:00+01:00'));
  await page.reload();
  const card = page.locator('[data-role="evening-card"]');
  await expect(card).toContainText('Wie war dein Tag?');
  await openEvening(page);

  await group(page, 'Stimmung').getByRole('button', { name: '3' }).click();
  await group(page, 'Energie').getByRole('button', { name: '4' }).click();
  await group(page, 'Energie').getByRole('button', { name: '4' }).click(); // zweiter Tipp nimmt zurück
  await expect(group(page, 'Energie').getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'false');
  await group(page, 'Etwas Wichtiges aufgeschoben?').getByRole('button', { name: 'Nein' }).click();

  // Die Ausweichliste ist anfangs leer; ein Eintrag lässt sich direkt hier anlegen.
  await expect(page.getByText('Deine Ausweichliste ist noch leer.')).toBeVisible();
  await page.getByRole('button', { name: 'Eintrag zur Ausweichliste hinzufügen' }).click();
  await expect(page.getByRole('textbox', { name: 'Neuer Eintrag' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Neuer Eintrag' }).fill('Scrollen');
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(eveningStatus(page)).toHaveText('Eintrag hinzugefügt.');
  const chip = page.locator('button.chip', { hasText: 'Scrollen' });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  // Die bisherigen Eingaben bleiben dabei erhalten.
  await expect(group(page, 'Stimmung').getByRole('button', { name: '3' })).toHaveAttribute('aria-pressed', 'true');

  const open = page.locator('[data-role="open"]');
  await expect(open.getByRole('heading', { name: 'Noch offen' })).toBeVisible();
  await group(page, HABIT).getByRole('button', { name: 'Gemacht' }).click();

  await page.getByRole('button', { name: 'Tag abschließen' }).click();
  await expect(eveningStatus(page)).toHaveText('Tag abgeschlossen.');
  await expect(eveningStatus(page)).toBeFocused();
  await expect(open).toHaveCount(0); // beantwortet

  await page.reload();
  await expect(page.locator('[data-role="closed-before"]')).toHaveText(
    'Dieser Tag ist abgeschlossen. Du kannst die Angaben noch ändern.',
  );
  await expect(group(page, 'Stimmung').getByRole('button', { name: '3' })).toHaveAttribute('aria-pressed', 'true');
  await expect(group(page, 'Energie').locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect(group(page, 'Etwas Wichtiges aufgeschoben?').getByRole('button', { name: 'Nein' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  // Eine Antwort lässt sich ändern.
  await group(page, 'Etwas Wichtiges aufgeschoben?').getByRole('button', { name: 'Teilweise' }).click();
  await page.getByRole('button', { name: 'Tag abschließen' }).click();
  await expect(eveningStatus(page)).toHaveText('Tag abgeschlossen.');
  await page.reload();
  await expect(group(page, 'Etwas Wichtiges aufgeschoben?').getByRole('button', { name: 'Teilweise' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('link', { name: 'Zu Heute' }).click();
  await expect(page.locator('[data-role="evening-entry"]')).toContainText('Tag abgeschlossen.');
  await expect(page.locator('[data-role="evening-card"]')).toHaveCount(0);
  await expect(page.locator('article.habit-card')).toContainText('Erledigt. Eine Wiederholung mehr in deinem Alltag.');
  await page.getByRole('link', { name: 'Abend-Angaben ändern' }).click();
  await expect(h1(page)).toHaveText('Wie war dein Tag? · Do, 5. Nov.');
});

test('Ausnahmetag markieren, anzeigen und aufheben', async ({ page }) => {
  await onboard(page);
  await openEvening(page);
  await expect(page.locator('[data-role="counters"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Ausnahmetag markieren' }).click();
  await expect(page.getByRole('radio', { name: 'Krank' })).toBeFocused();
  await page.getByRole('radio', { name: 'Urlaub' }).check();
  await page.getByRole('textbox', { name: /Notiz/ }).fill('<b>Ostsee</b>');
  await page.getByRole('button', { name: 'Als Ausnahmetag markieren' }).click();
  await expect(eveningStatus(page)).toHaveText('Als Ausnahmetag markiert.');

  const exception = page.locator('[data-role="exception"]');
  await expect(exception).toContainText('Ausnahmetag: Urlaub');
  await expect(exception).toContainText('<b>Ostsee</b>'); // als Text, nicht als HTML
  await page.reload();
  await expect(exception).toContainText('Ausnahmetag: Urlaub');

  await exception.getByRole('button', { name: 'Ausnahmetag aufheben' }).click();
  await expect(eveningStatus(page)).toHaveText('Ausnahmetag aufgehoben.');
  await expect(exception).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ausnahmetag markieren' })).toBeFocused();
});

test('Gegen-Habits: vordefiniert und eigenes anlegen, bearbeiten, abends beantworten', async ({ page }) => {
  await onboard(page);
  await openTab(page, 'Plan');
  const counters = page.locator('[data-role="counters"]');
  await expect(counters).toContainText('Noch keine Gegen-Habits.');

  await counters.getByRole('link', { name: 'Gegen-Habit hinzufügen' }).click();
  await expect(h1(page)).toHaveText('Neues Gegen-Habit');
  await expect(page.getByRole('radio', { name: /Nicht aufgeschoben/ })).toBeChecked();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(h1(page)).toHaveText('Plan');
  await expect(planStatus(page)).toHaveText('Gegen-Habit gespeichert. Es erscheint ab heute im Abend-Check-in.');
  await expect(counters).toContainText('Nicht aufgeschoben');

  // Vordefinierte gibt es je nur einmal.
  await counters.getByRole('link', { name: 'Gegen-Habit hinzufügen' }).click();
  await expect(page.getByRole('radio', { name: /Nicht aufgeschoben/ })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Eigenes Gegen-Habit' }).check();
  const text = page.getByRole('textbox', { name: 'Was lässt du bleiben?' });
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(text).toBeFocused(); // Pflichtfeld
  await text.fill('Kein Alkohol unter der Woche');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(planStatus(page)).toHaveText('Gegen-Habit gespeichert. Es erscheint ab heute im Abend-Check-in.');

  const custom = counters.locator('li[data-habit]', { hasText: 'Kein Alkohol unter der Woche' });
  await expect(custom.locator('details')).toHaveAttribute('open', '');
  await custom.getByRole('link', { name: 'Bearbeiten: Kein Alkohol unter der Woche' }).click();
  await expect(h1(page)).toHaveText('Gegen-Habit bearbeiten');
  await page.getByRole('textbox', { name: 'Was lässt du bleiben?' }).fill('Kein Alkohol am Abend');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(planStatus(page)).toHaveText('Änderungen gespeichert. Rhythmus und Gewicht gelten ab heute.');
  await expect(counters).toContainText('Kein Alkohol am Abend');

  // Der vordefinierte Text ist fest; nur das Gewicht lässt sich ändern.
  await counters.locator('li[data-habit]', { hasText: 'Nicht aufgeschoben' }).locator('summary').click();
  await counters.getByRole('link', { name: 'Bearbeiten: Nicht aufgeschoben' }).click();
  await expect(page.getByText('Der Text dieses Gegen-Habits ist fest.')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await page.getByRole('link', { name: 'Abbrechen' }).click();

  await openTab(page, 'Heute');
  await openEvening(page);
  await group(page, 'Kein Alkohol am Abend').getByRole('button', { name: 'Eingehalten' }).click();
  await group(page, 'Etwas Wichtiges aufgeschoben?').getByRole('button', { name: 'Ja' }).click();
  await page.getByRole('button', { name: 'Tag abschließen' }).click();
  await expect(eveningStatus(page)).toHaveText('Tag abgeschlossen.');
  await page.reload();
  await expect(group(page, 'Kein Alkohol am Abend').getByRole('button', { name: 'Eingehalten' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('Ausweichliste: hinzufügen, umbenennen, sortieren, ausblenden, löschen', async ({ page }) => {
  await onboard(page, { counters: true });
  await openTab(page, 'Plan');
  await page.locator('[data-role="counters"] li[data-habit]', { hasText: 'Kein Ausweichverhalten' }).locator('summary').click();
  await page.getByRole('link', { name: 'Liste bearbeiten ›' }).click();
  await expect(h1(page)).toHaveText('Ausweichliste');
  await expect(page.getByText('Deine Liste ist noch leer.')).toBeVisible();

  const input = page.getByRole('textbox', { name: 'Neuer Eintrag' });
  for (const label of ['Scrollen', 'Kühlschrank', 'Nachrichten']) {
    await input.fill(label);
    await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
    await expect(avoidanceStatus(page)).toHaveText('Eintrag hinzugefügt.');
    await expect(input).toHaveValue('');
  }
  await input.fill('scrollen');
  await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click();
  await expect(page.getByText('Diesen Eintrag gibt es schon.')).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill('');

  const labels = page.locator('[data-role="active-items"] .avoidance-item__label');
  await expect(labels).toHaveText(['Scrollen', 'Kühlschrank', 'Nachrichten']);

  await page.getByRole('button', { name: 'Umbenennen: Kühlschrank' }).click();
  const rename = page.getByRole('textbox', { name: 'Neuer Name für „Kühlschrank“' });
  await expect(rename).toBeFocused();
  await rename.fill('Snacks');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(avoidanceStatus(page)).toHaveText('Umbenannt.');

  await page.getByRole('button', { name: 'Nach oben: Snacks' }).click();
  await expect(labels).toHaveText(['Snacks', 'Scrollen', 'Nachrichten']);
  await expect(page.getByRole('button', { name: 'Nach oben: Snacks' })).toBeDisabled();

  await page.getByRole('button', { name: 'Ausblenden: Nachrichten' }).click();
  await expect(avoidanceStatus(page)).toHaveText('Ausgeblendet.');
  await expect(labels).toHaveText(['Snacks', 'Scrollen']);
  await expect(page.locator('details[data-group="hidden"] > summary')).toHaveText('Ausgeblendet (1)');

  await page.getByRole('button', { name: 'Löschen: Snacks' }).click();
  await expect(page.locator('[data-role="confirm"]')).toBeFocused();
  await page.getByRole('button', { name: 'Ja, löschen: Snacks' }).click();
  await expect(avoidanceStatus(page)).toHaveText('Gelöscht.');
  await expect(labels).toHaveText(['Scrollen']);

  // Abends erscheinen nur die aktiven Einträge.
  await page.goto('/#/abend');
  await expect(page.locator('button.chip')).toHaveText(['Scrollen']);
});
