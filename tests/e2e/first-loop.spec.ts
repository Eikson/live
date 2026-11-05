import { expect, test } from '@playwright/test';
import { confirmation, next, onboard } from './helpers';

// Service Worker aus: sonst liefert der Cache beim Neuladen evtl. eine ältere Version aus.
test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+01:00'));
});

test('erster Start führt zu „Heute“, Check-in bleibt nach dem Neuladen erhalten', async ({ page }) => {
  const card = await onboard(page);
  await expect(card).toContainText('Kleinste Version: 2 Minuten vor die Tür');

  await card.getByRole('button', { name: 'Gemacht', exact: true }).click();
  await expect(confirmation(page)).toContainText('Erledigt. Eine Wiederholung mehr in deinem Alltag.');
  await expect(confirmation(page)).toBeFocused();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Heute');
  await expect(confirmation(page)).toContainText('Erledigt.');
  // Kein zweiter erster Start.
  await expect(page.getByRole('button', { name: "Los geht's" })).toHaveCount(0);
});

test('Minimalversion wird gespeichert', async ({ page }) => {
  const card = await onboard(page);
  await card.getByRole('button', { name: 'Gemacht', exact: true }).click();
  const minimal = page.getByRole('checkbox', { name: 'war die Minimalversion' });
  await minimal.check();
  await expect(minimal).toBeChecked();
  await expect(minimal).toBeEnabled();

  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'war die Minimalversion' })).toBeChecked();
});

test('„Heute nicht“ wird ruhig bestätigt', async ({ page }) => {
  const card = await onboard(page);
  await card.getByRole('button', { name: 'Heute nicht' }).click();
  await expect(confirmation(page)).toHaveText('Heute hat es nicht gepasst. Dein Plan bleibt bestehen.');
  // Keine Minimalversion für einen nicht gemachten Tag.
  await expect(page.getByRole('checkbox', { name: 'war die Minimalversion' })).toHaveCount(0);

  await page.reload();
  await expect(confirmation(page)).toHaveText('Heute hat es nicht gepasst. Dein Plan bleibt bestehen.');
});

test('Korrektur über „Ändern“ ersetzt das Ergebnis', async ({ page }) => {
  const card = await onboard(page);
  await card.getByRole('button', { name: 'Gemacht', exact: true }).click();
  await expect(confirmation(page)).toContainText('Erledigt.');

  await card.getByRole('button', { name: 'Ändern' }).click();
  await expect(card.getByRole('button', { name: 'Gemacht', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'Anders gemacht' }).click();
  await expect(confirmation(page)).toContainText('Festgehalten. Anders gemacht zählt auch.');
  await expect(card.getByRole('button', { name: 'Anders gemacht' })).toHaveCount(0);

  await page.reload();
  await expect(confirmation(page)).toContainText('Festgehalten. Anders gemacht zählt auch.');
});

test('Notiz wird gespeichert und als Text angezeigt', async ({ page }) => {
  const card = await onboard(page);
  await card.getByRole('button', { name: 'Gemacht', exact: true }).click();

  await card.getByRole('button', { name: 'Notiz', exact: true }).click();
  const note = page.getByRole('textbox', { name: 'Notiz zu heute' });
  await expect(note).toBeFocused();
  await note.fill('Kurz vor dem Regen <b>fett</b>');
  await card.getByRole('button', { name: 'Notiz speichern' }).click();

  await expect(card.getByRole('status')).toHaveText('Notiz gespeichert.');
  const text = page.locator('[data-role="note-text"]');
  await expect(text).toHaveText('Kurz vor dem Regen <b>fett</b>');
  await expect(text.locator('b')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('[data-role="note-text"]')).toHaveText('Kurz vor dem Regen <b>fett</b>');
});

test('Pflichtfeld im ersten Start meldet sich verständlich', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: "Los geht's" }).click();
  await next(page);
  const goal = page.getByRole('textbox', { name: 'Was möchtest du in deinem Alltag verändern?' });
  await expect(page.getByText('Bitte fülle dieses Feld aus.')).toBeVisible();
  await expect(goal).toBeFocused();
  await expect(goal).toHaveAttribute('aria-invalid', 'true');
});

test('Navigation zwischen den Bereichen', async ({ page }) => {
  await onboard(page);
  const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await nav.getByRole('link', { name: 'Plan' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan');
  await expect(page.getByText('Mehr Bewegung')).toBeVisible();
  await nav.getByRole('link', { name: 'Verlauf' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Verlauf');
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Einstellungen');
  await nav.getByRole('link', { name: 'Heute' }).click();
  await expect(page.locator('article.habit-card')).toHaveCount(1);
});
