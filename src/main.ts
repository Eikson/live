import './styles.css';
import type { AppContext } from './app/context';
import { IdbRepository } from './data/idb-repository';
import { de } from './i18n/de';
import { systemClock, today } from './platform/clock';
import { newId } from './platform/ids';
import { isIndexedDbAvailable, requestPersistentStorage } from './platform/storage';
import { setupServiceWorker } from './platform/sw-update';
import { applyCachedTheme, applyTheme } from './platform/theme';
import { h } from './ui/dom';
import { navigate, parseParams, parseRoute, routeHref, type Route } from './ui/router';
import type { Screen, ScreenEnv } from './ui/screen';
import { renderStorageError } from './ui/screens/error';
import { goalNewScreen } from './ui/screens/goal-new';
import { habitNewScreen } from './ui/screens/habit-new';
import { historyScreen } from './ui/screens/history';
import { onboardingScreen } from './ui/screens/onboarding';
import { planScreen } from './ui/screens/plan';
import { settingsScreen } from './ui/screens/settings';
import { todayScreen } from './ui/screens/today';
import { createShell, type Shell } from './ui/shell';

const SCREENS: Record<Route, Screen> = {
  heute: todayScreen,
  plan: planScreen,
  verlauf: historyScreen,
  einstellungen: settingsScreen,
  start: onboardingScreen,
  'ziel-neu': goalNewScreen,
  'gewohnheit-neu': habitNewScreen,
};

/** Seiten, die bei einem Tageswechsel neu aufgebaut werden (keine Formulare mit offenen Eingaben). */
const DAY_SENSITIVE: ReadonlySet<Route> = new Set(['heute', 'verlauf', 'plan']);

function showBanner(shell: Shell, text: string, action?: { label: string; run: () => void }, dismissible = false): void {
  const banner = h('div', { class: 'banner', role: 'status' }, text ? h('p', null, text) : null);
  if (action) banner.append(h('button', { type: 'button', class: 'button primary', onclick: action.run }, action.label));
  if (dismissible) {
    banner.append(h('button', { type: 'button', class: 'button quiet', onclick: () => banner.remove() }, de.update.later));
  }
  shell.banners.replaceChildren(banner);
}

async function start(): Promise<void> {
  applyCachedTheme();
  const mount = document.getElementById('app')!;

  if (!isIndexedDbAvailable()) {
    mount.replaceChildren(renderStorageError());
    return;
  }

  const shell = createShell();
  let repo: IdbRepository;
  try {
    repo = await IdbRepository.open({
      // Ein anderer Tab mit neuerer Version: Verbindung ist geschlossen, Hinweis zum Neuladen.
      onVersionChange: () => showBanner(shell, de.errors.otherTab, { label: de.common.reload, run: () => location.reload() }),
    });
  } catch {
    mount.replaceChildren(renderStorageError());
    return;
  }

  const ctx: AppContext = { repo, clock: systemClock, newId };
  const prefs = await repo.getPreferences();
  applyTheme(prefs.theme);
  let onboarded = Boolean(prefs.onboardingCompletedAt);

  mount.replaceChildren(shell.root);
  void requestPersistentStorage();
  setupServiceWorker((reload) =>
    showBanner(shell, '', { label: de.update.available, run: () => void reload() }, true),
  );

  let renderToken = 0;
  let currentRoute: Route | undefined;
  let renderedDay = today(ctx.clock);

  const env: ScreenEnv = {
    ctx,
    params: new URLSearchParams(),
    onboardingDone() {
      onboarded = true;
      navigate('heute', { replace: true });
    },
  };

  async function render(focus: boolean): Promise<void> {
    let route = parseRoute(location.hash) ?? 'heute';
    if (!onboarded && route !== 'start') route = 'start';
    if (onboarded && route === 'start') route = 'heute';
    // Parameter (z. B. `?ziel=…`) bleiben erhalten, solange die Route selbst stimmt.
    if (parseRoute(location.hash) !== route || !location.hash.startsWith(`#/${route}`)) {
      history.replaceState(null, '', routeHref(route));
    }

    const token = ++renderToken;
    currentRoute = route;
    renderedDay = today(ctx.clock);
    shell.setRoute(route);
    try {
      const view = await SCREENS[route]({ ...env, params: parseParams(location.hash) });
      if (token !== renderToken) return; // inzwischen weiter navigiert
      shell.main.replaceChildren(view);
    } catch {
      if (token !== renderToken) return;
      shell.main.replaceChildren(
        h(
          'section',
          { class: 'screen' },
          h('h1', { tabindex: '-1' }, de.errors.loadFailed),
          h('button', { type: 'button', class: 'button', onclick: () => void render(true) }, de.errors.retry),
        ),
      );
    }
    if (focus) shell.main.querySelector<HTMLElement>('h1')?.focus();
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', () => void render(true));

  // Tageswechsel: Timer bis Mitternacht plus Prüfung beim Zurückkehren in den Tab.
  function checkDay(): void {
    if (today(ctx.clock) !== renderedDay && currentRoute && DAY_SENSITIVE.has(currentRoute)) void render(false);
  }
  function scheduleMidnight(): void {
    const now = ctx.clock.now();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    window.setTimeout(() => {
      checkDay();
      scheduleMidnight();
    }, next.getTime() - now.getTime());
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDay();
  });
  scheduleMidnight();

  await render(false);
}

void start();
