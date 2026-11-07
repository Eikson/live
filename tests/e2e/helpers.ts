import { expect, type Locator, type Page } from '@playwright/test';

export const HABIT = '10 Minuten spazieren';

export async function next(page: Page) {
  await page.getByRole('button', { name: 'Weiter' }).click();
}

export interface OnboardOptions {
  /** Ausgeschriebene Wochentage, z. B. „Montag“. Ohne Angabe: täglich. */
  weekdays?: string[];
  coping?: { obstacle: string; response: string };
  /** Im letzten Schritt die beiden vordefinierten Gegen-Habits einrichten. */
  counters?: boolean;
}

/** Erster Start mit den Pflichtangaben; optionale Fragen werden übersprungen. */
export async function onboard(page: Page, options: OnboardOptions = {}): Promise<Locator> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Wähle etwas, das dir selbst wichtig ist');
  await page.getByRole('button', { name: "Los geht's" }).click();

  await page.getByRole('textbox', { name: 'Was möchtest du in deinem Alltag verändern?' }).fill('Mehr Bewegung');
  await next(page);
  await next(page); // Warum (optional)
  await next(page); // Woran merke ich es (optional)

  await page.getByRole('textbox', { name: 'Was tust du konkret?' }).fill(HABIT);
  await next(page);

  await expect(page.getByRole('radio', { name: 'Nach einer Routine' })).toBeChecked();
  await page.getByRole('textbox', { name: 'Nach welcher Routine?' }).fill('Nach dem Mittagessen');
  await expect(page.getByRole('radio', { name: 'Täglich' })).toBeChecked();
  if (options.weekdays) {
    await page.getByRole('radio', { name: 'An bestimmten Wochentagen' }).check();
    for (const day of options.weekdays) await page.getByRole('checkbox', { name: day }).check();
  }
  await next(page);

  await page.getByRole('textbox', { name: 'Was ist die kleinste Version davon?' }).fill('2 Minuten vor die Tür');
  await next(page);

  await expect(page.getByRole('heading', { name: 'Dein Plan' })).toBeVisible();
  await expect(page.locator('[data-role="plan-sentence"]')).toContainText('nach dem Mittagessen');
  if (options.coping) {
    await page.getByRole('button', { name: 'Hindernis hinzufügen' }).click();
    const row = page.getByRole('group', { name: 'Hindernis 1' });
    await row.getByRole('textbox', { name: 'Wenn … dazwischenkommt' }).fill(options.coping.obstacle);
    await row.getByRole('textbox', { name: 'dann …' }).fill(options.coping.response);
  }
  await next(page);

  await expect(page.getByRole('heading', { name: 'Abends zusätzlich festhalten?' })).toBeVisible();
  await page.getByRole('button', { name: options.counters ? 'Einrichten' : 'Später' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Heute');
  const card = page.locator('article.habit-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('heading', { name: HABIT })).toBeVisible();
  return card;
}

export const confirmation = (scope: Page | Locator) => scope.locator('[data-role="confirmation"]');
