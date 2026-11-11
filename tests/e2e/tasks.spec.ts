import { expect, test, type Page } from '@playwright/test';
import { onboard } from './helpers';

test.use({ serviceWorkers: 'block' });

// Donnerstag, 5. November 2026.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+01:00'));
});

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const taskCard = (page: Page) => page.locator('article.task-card');
const todayStatus = (page: Page) => page.locator('[data-role="today-status"]');

async function openTab(page: Page, name: 'Heute' | 'Plan' | 'Verlauf') {
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name }).click();
  await expect(h1(page)).toContainText(name);
}

interface TaskFields {
  title: string;
  deadline: string;
  start?: string;
  step: string;
  minutes: string;
  review?: string;
}

async function addTask(page: Page, task: TaskFields) {
  await openTab(page, 'Plan');
  await page.getByRole('link', { name: 'Vorhaben hinzufügen' }).click();
  await expect(h1(page)).toHaveText('Neues Vorhaben');
  await page.getByLabel('Was steht an?').fill(task.title);
  await page.getByLabel('Wann soll das Ergebnis bei jemand anderem sein?').fill(task.deadline);
  if (task.start) await page.getByLabel('Wann willst du zum ersten Mal sichtbar daran arbeiten?').fill(task.start);
  await page.getByLabel('Was ist nach 15 Minuten auf dem Bildschirm anders?').fill(task.step);
  await page.getByLabel('Wie viele fokussierte Minuten braucht das vermutlich?').fill(task.minutes);
  if (task.review) await page.getByLabel('Bis wann soll jemand draufschauen?').fill(task.review);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(h1(page)).toHaveText('Plan');
  await expect(page.locator('[data-role="plan-status"]')).toHaveText('Vorhaben gespeichert. Es steht ab dem geplanten Start auf „Heute“.');
}

test('Vorhaben anlegen, anfangen, Review einholen, abschließen und im Verlauf sehen', async ({ page }) => {
  await onboard(page);

  // Pflichtfelder: leer speichern zeigt Meldungen und bleibt im Formular.
  await openTab(page, 'Plan');
  await page.getByRole('link', { name: 'Vorhaben hinzufügen' }).click();
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(h1(page)).toHaveText('Neues Vorhaben');
  await expect(page.getByLabel('Was steht an?')).toBeFocused();
  await expect(page.getByLabel('Was steht an?')).toHaveAttribute('aria-invalid', 'true');

  await addTask(page, { title: 'Steering-Deck', deadline: '2026-11-07', step: 'Fünf Überschriften für die Storyline', minutes: '120', review: '2026-11-06' });
  const entry = page.locator('[data-role="tasks"] li[data-task]');
  await expect(entry).toHaveCount(1);
  await expect(entry.locator('.habit-item__meta')).toHaveText('Start erreicht · Deadline 7. Nov.');

  // Startkarte auf „Heute“: benennen, Schritt verkleinern, anfangen.
  await openTab(page, 'Heute');
  const card = taskCard(page);
  await expect(card.locator('[data-role="card-label"]')).toHaveText('Vorhaben · Start heute');
  await expect(card).toContainText('Erster Schritt: Fünf Überschriften für die Storyline');
  await expect(card).toContainText('Deadline Sa, 7. Nov. · noch 2 Tage');
  await card.getByRole('button', { name: 'Jetzt anfangen' }).click();
  await card.getByRole('group', { name: 'Was ist gerade unangenehm?' }).getByRole('button', { name: 'Unklarheit' }).click();
  await card.getByRole('group', { name: 'Wie unangenehm fühlt sich der Start an?' }).getByRole('button', { name: '3' }).click();
  await card.getByLabel('Kleinster sichtbarer Schritt').fill('Drei Überschriften');
  await card.getByRole('button', { name: 'Angefangen' }).click();
  await expect(todayStatus(page)).toHaveText('Festgehalten. Du hast angefangen.');
  await expect(taskCard(page).locator('[data-role="card-label"]')).toHaveText('Vorhaben · läuft');
  await expect(taskCard(page)).toContainText('Erster Schritt: Drei Überschriften');
  // Pünktlich begonnen: keine Frage nach einem späten Start.
  await expect(taskCard(page).locator('[data-role="late-question"]')).toHaveCount(0);

  await taskCard(page).getByRole('button', { name: 'Review eingeholt' }).click();
  await expect(todayStatus(page)).toHaveText('Review festgehalten.');
  await expect(taskCard(page)).toContainText('Review eingeholt am Do, 5. Nov.');

  // Am nächsten Tag abschließen.
  await page.clock.setFixedTime(new Date('2026-11-06T17:00:00+01:00'));
  await page.reload();
  await taskCard(page).getByRole('button', { name: 'Fertig' }).click();
  await taskCard(page).getByLabel('Wie viele fokussierte Minuten waren es ungefähr?').fill('180');
  await taskCard(page).getByRole('button', { name: 'Abschließen' }).click();
  await expect(todayStatus(page)).toHaveText('Abgeschlossen, einen Tag vor der Deadline.');
  await expect(taskCard(page)).toHaveCount(0);

  await openTab(page, 'Verlauf');
  const metrics = page.locator('[data-role="task-metrics"]');
  await expect(metrics.locator('[data-role="task-proof"]')).toHaveText('Diese Woche hast du ein Vorhaben spätestens am geplanten Tag begonnen.');
  await expect(metrics).toContainText('Erscheint ab 3 begonnenen Vorhaben. Bisher: 1.');
  await expect(metrics).toContainText('1 von 1 rechtzeitig eingeholt');

  await openTab(page, 'Plan');
  await page.locator('[data-group="tasks-closed"] > summary').click();
  await expect(page.locator('[data-group="tasks-closed"] li[data-task]')).toContainText('Steering-Deck');
});

test('Kalendereintrag, bewusst verschieben und die Frage nach einem späten Start', async ({ page }) => {
  await onboard(page);
  await addTask(page, { title: 'Marktanalyse', deadline: '2026-11-12', step: 'Tabelle mit drei Spalten anlegen', minutes: '300' });

  // Kalendereintrag als Datei, solange nicht begonnen.
  const entry = page.locator('[data-role="tasks"] li[data-task]');
  const download = page.waitForEvent('download');
  await entry.getByRole('button', { name: 'Kalendereintrag: Marktanalyse' }).click();
  expect((await download).suggestedFilename()).toBe('live-start-marktanalyse.ics');
  await expect(page.locator('[data-role="plan-status"]')).toHaveText('Kalendereintrag erstellt: live-start-marktanalyse.ics');

  // Verschieben verlangt einen Grund.
  await openTab(page, 'Heute');
  await taskCard(page).getByRole('button', { name: 'Verschieben' }).click();
  await expect(taskCard(page).getByLabel('Neuer Start')).toHaveValue('2026-11-06');
  await taskCard(page).getByRole('button', { name: 'Start verschieben' }).click();
  await expect(taskCard(page).getByRole('alert')).toHaveText('Bitte halte den Grund fest.');
  await taskCard(page).getByLabel('Grund').fill('Zahlen vom Kunden kommen erst morgen');
  await taskCard(page).getByRole('button', { name: 'Start verschieben' }).click();
  await expect(todayStatus(page)).toHaveText('Verschoben. Neuer Start: Fr, 6. Nov.');
  await expect(taskCard(page)).toHaveCount(0);

  // Drei Tage nach dem neuen Start: die Karte nennt den geplanten Tag, ohne Wertung.
  await page.clock.setFixedTime(new Date('2026-11-09T09:00:00+01:00'));
  await page.reload();
  await expect(taskCard(page).locator('[data-role="card-label"]')).toHaveText('Vorhaben · Start war für Fr, 6. Nov. geplant');
  await taskCard(page).getByRole('button', { name: 'Jetzt anfangen' }).click();
  await taskCard(page).getByRole('button', { name: 'Angefangen' }).click();
  await expect(todayStatus(page)).toHaveText('Festgehalten. Du hast angefangen.');

  const late = taskCard(page).locator('[data-role="late-question"]');
  await expect(late).toContainText('Der Start war später als geplant.');
  await late.getByRole('button', { name: 'Schritt kleiner' }).click();
  await expect(todayStatus(page)).toHaveText('Festgehalten.');
  await expect(taskCard(page).locator('[data-role="late-question"]')).toHaveCount(0);

  await openTab(page, 'Plan');
  await page.locator('[data-role="tasks"] li[data-task] summary').click();
  await expect(page.locator('[data-role="tasks"] .facts')).toContainText('5. Nov. → 6. Nov.: Zahlen vom Kunden kommen erst morgen');

  await openTab(page, 'Verlauf');
  await expect(page.locator('[data-role="task-metrics"]')).toContainText('Ein Vorhaben begonnen, später als geplant.');
});

test('höchstens drei offene Vorhaben', async ({ page }) => {
  await onboard(page);
  for (const title of ['A', 'B', 'C']) {
    await addTask(page, { title, deadline: '2026-11-12', start: '2026-11-10', step: 'Datei anlegen', minutes: '30' });
  }
  await expect(page.getByRole('link', { name: 'Vorhaben hinzufügen' })).toHaveCount(0);
  await expect(page.locator('[data-role="task-limit"]')).toHaveText('Du hast 3 offene Vorhaben. Ein neues geht, sobald eines abgeschlossen ist.');
  // Kommende Vorhaben stehen noch nicht auf „Heute“.
  await openTab(page, 'Heute');
  await expect(taskCard(page)).toHaveCount(0);
  await page.goto('/#/vorhaben-neu');
  await expect(h1(page)).toHaveText('Du hast 3 offene Vorhaben. Ein neues geht, sobald eines abgeschlossen ist.');
});
