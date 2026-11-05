import { de } from '../i18n/de';
import { h, icon, icons } from './dom';
import { routeHref, type Route } from './router';

export interface Shell {
  root: HTMLElement;
  main: HTMLElement;
  banners: HTMLElement;
  /** Markiert den aktiven Tab; im ersten Start sind Tabs und Zahnrad ausgeblendet. */
  setRoute(route: Route): void;
}

const TABS: { route: Route; label: string; icon: string[] }[] = [
  { route: 'heute', label: de.nav.today, icon: icons.today },
  { route: 'plan', label: de.nav.plan, icon: icons.plan },
  { route: 'verlauf', label: de.nav.history, icon: icons.history },
];

/** Unterseiten, die zu einem Tab gehören. */
const TAB_OF: Partial<Record<Route, Route>> = {
  'ziel-neu': 'plan',
  'gewohnheit-neu': 'plan',
  'ziel-bearbeiten': 'plan',
  'gewohnheit-bearbeiten': 'plan',
};

export function createShell(): Shell {
  const gear = h('a', { class: 'icon-button', href: routeHref('einstellungen'), 'aria-label': de.nav.settings });
  gear.append(icon(icons.gear));

  const header = h(
    'header',
    { class: 'topbar' },
    h('a', { class: 'brand', href: routeHref('heute') }, de.appName),
    gear,
  );
  const banners = h('div', { class: 'banners' });
  const main = h('main', { id: 'main', class: 'content', tabindex: '-1' });

  const links = TABS.map((t) => {
    const a = h('a', { href: routeHref(t.route), class: 'tab', 'data-route': t.route }, h('span', null, t.label));
    a.prepend(icon(t.icon));
    return a;
  });
  const nav = h('nav', { class: 'tabbar', 'aria-label': de.nav.label }, h('ul', null, links.map((a) => h('li', null, a))));

  const root = h('div', { class: 'app' }, header, banners, main, nav);

  return {
    root,
    main,
    banners,
    setRoute(route) {
      const onboarding = route === 'start';
      nav.hidden = onboarding;
      gear.hidden = onboarding;
      root.classList.toggle('is-onboarding', onboarding);
      const tab = TAB_OF[route] ?? route;
      for (const a of links) {
        if (a.dataset.route === tab) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
      if (route === 'einstellungen') gear.setAttribute('aria-current', 'page');
      else gear.removeAttribute('aria-current');
    },
  };
}
