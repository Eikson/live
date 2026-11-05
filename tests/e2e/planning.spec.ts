import { expect, test, type Page } from '@playwright/test';
import { confirmation, HABIT, next, onboard } from './helpers';

test.use({ serviceWorkers: 'block' });

// Donnerstag, 5. November 2026.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+01:00'));
});

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

async function openPlan(page: Page) {
  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Plan' }).click();
  await expect(h1(page)).toHaveText('Plan');
}

/** Gewohnheits-Assistent ab Schritt 1; endet vor dem Speichern im Plan-Schritt. */
async function fillHabit(page: Page, action: string, routine: string, minimum: string) {
  await page.getByRole('textbox', { name: 'Was tust du konkret?' }).fill(action);
  await next(page);
  await page.getByRole('textbox', { name: 'Nach welcher Routine?' }).fill(routine);
  await next(page);
  await page.getByRole('textbox', { name: 'Was ist die kleinste Version davon?' }).fill(minimum);
  await next(page);
  await expect(page.getByRole('heading', { name: 'Dein Plan' })).toBeVisible();
}

test('Wochentage: nicht geplanter Tag zeigt „Trotzdem gemacht“, der Eintrag lässt sich zurücknehmen', async ({
  page,
}) => {
  const card = await onboard(page, { weekdays: ['Montag', 'Mittwoch'] });
  await expect(card.locator('[data-role="card-label"]')).toHaveText('Heute nicht geplant – nächstes Mal: Mo');
  await expect(card.getByRole('button', { name: 'Gemacht', exact: true })).toHaveCount(0);

  await card.getByRole('button', { name: 'Trotzdem gemacht' }).click();
  await expect(confirmation(card)).toContainText('Festgehalten.');
  await expect(card.getByRole('checkbox', { name: 'war die Minimalversion' })).toHaveCount(0);

  await page.reload();
  const again = page.locator('article.habit-card');
  await expect(confirmation(again)).toContainText('Festgehalten.');
  await again.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(again.getByRole('status')).toHaveText('Eintrag entfernt.');
  await expect(again.getByRole('button', { name: 'Trotzdem gemacht' })).toBeFocused();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Trotzdem gemacht' })).toBeVisible();

  await openPlan(page);
  await page.getByText(HABIT, { exact: true }).click();
  await expect(page.locator('.facts')).toContainText('Mo, Mi');
});

test('Wochentage verlangen mindestens einen Tag', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: "Los geht's" }).click();
  await page.getByRole('textbox', { name: 'Was möchtest du in deinem Alltag verändern?' }).fill('Mehr Ruhe');
  await next(page);
  await next(page);
  await next(page);
  await page.getByRole('textbox', { name: 'Was tust du konkret?' }).fill('5 Minuten lesen');
  await next(page);
  await page.getByRole('textbox', { name: 'Nach welcher Routine?' }).fill('Nach dem Abendessen');
  await page.getByRole('radio', { name: 'An bestimmten Wochentagen' }).check();
  await next(page);
  await expect(page.getByText('Bitte wähle mindestens einen Tag.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Montag' })).toHaveAttribute('aria-invalid', 'true');
});

test('Hindernisplan wird gespeichert und im Plan angezeigt', async ({ page }) => {
  await onboard(page, { coping: { obstacle: 'Regen', response: '10 Minuten Treppe' } });
  await openPlan(page);
  await page.getByText(HABIT, { exact: true }).click();
  await expect(page.locator('.facts')).toContainText('Wenn Regen dazwischenkommt, dann 10 Minuten Treppe.');
  await expect(page.locator('.facts')).toContainText('Wenn es nach dem Mittagessen ist, dann 10 Minuten spazieren.');
});

test('zweites Ziel, dann Entwurf an der Aufbau-Grenze', async ({ page }) => {
  await onboard(page);
  await openPlan(page);

  await page.getByRole('link', { name: 'Ziel hinzufügen' }).click();
  await expect(page.getByText('Neues Ziel')).toBeVisible();
  await page.getByRole('textbox', { name: 'Was möchtest du in deinem Alltag verändern?' }).fill('Mehr Ruhe');
  await next(page);
  await next(page);
  await page.getByRole('button', { name: 'Ziel speichern' }).click();

  await expect(page.getByText('Neue Gewohnheit für das Ziel „Mehr Ruhe“')).toBeVisible();
  await fillHabit(page, '5 Minuten lesen', 'Nach dem Abendessen', 'Eine Seite');
  await page.getByRole('button', { name: 'Gewohnheit speichern' }).click();

  await expect(h1(page)).toHaveText('Plan');
  await expect(page.locator('[data-role="plan-status"]')).toHaveText(
    'Gewohnheit gespeichert. Sie steht ab heute auf „Heute“.',
  );
  await expect(page.getByRole('heading', { name: 'Ziel „Mehr Ruhe“' })).toBeVisible();

  // Zwei Gewohnheiten im Aufbau: die dritte wird ein Entwurf.
  await page.getByRole('link', { name: 'Gewohnheit hinzufügen zum Ziel „Mehr Bewegung“' }).click();
  await fillHabit(page, 'Treppe statt Aufzug', 'Wenn ich ins Büro komme', 'Ein Stockwerk');
  await expect(page.locator('[data-role="draft-note"]')).toContainText('Du baust gerade 2 Gewohnheiten auf.');
  await page.getByRole('button', { name: 'Als Entwurf speichern' }).click();

  await expect(page.locator('[data-role="plan-status"]')).toHaveText('Als Entwurf gespeichert.');
  const drafts = page.locator('[data-group="drafts"]');
  await expect(drafts.locator('summary').first()).toHaveText('Entwürfe (1)');
  await expect(drafts).toHaveAttribute('open', '');
  await expect(drafts).toContainText('Treppe statt Aufzug');
  await expect(drafts).toContainText('Aktivieren geht, sobald ein Platz frei ist.');
  await expect(drafts.getByRole('button', { name: 'Aktivieren' })).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Heute' }).click();
  await expect(page.locator('article.habit-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Treppe statt Aufzug' })).toHaveCount(0);
});

test('Nachtragen für einen vergangenen Tag', async ({ page }) => {
  // Angelegt am Dienstag; nachgetragen wird erst am Donnerstag.
  await page.clock.setFixedTime(new Date('2026-11-03T09:00:00+01:00'));
  await onboard(page);
  await page.clock.setFixedTime(new Date('2026-11-05T09:00:00+01:00'));
  await page.reload();
  await expect(h1(page)).toHaveText('Heute · Do, 5. Nov.');
  await page.getByText('Tag wechseln').click();
  await page.getByRole('button', { name: 'Mi, 4. Nov.' }).click();
  await expect(h1(page)).toHaveText('Nachtragen · Mi, 4. Nov.');
  await expect(h1(page)).toBeFocused();

  const card = page.locator('article.habit-card');
  await card.getByRole('button', { name: 'Gemacht', exact: true }).click();
  await expect(confirmation(card)).toContainText('Nachgetragen. Eine Wiederholung mehr in deinem Alltag.');

  await page.getByRole('button', { name: 'Zurück zu heute' }).click();
  await expect(h1(page)).toHaveText('Heute · Do, 5. Nov.');
  await expect(card.getByRole('button', { name: 'Gemacht', exact: true })).toBeVisible();

  await page.reload();
  await page.getByText('Tag wechseln').click();
  await page.getByRole('button', { name: 'Mi, 4. Nov.' }).click();
  await expect(confirmation(page)).toContainText('Nachgetragen.');

  // Mehr als 7 Tage zurück ist nicht wählbar.
  await expect(page.getByRole('button', { name: 'Do, 29. Okt.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mi, 28. Okt.' })).toHaveCount(0);
});
