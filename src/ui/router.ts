/** Hash-Routing: funktioniert offline und unter einem Unterpfad (GitHub Pages) ohne Server-Konfiguration. */
export type Route =
  | 'heute'
  | 'plan'
  | 'verlauf'
  | 'einstellungen'
  | 'start'
  | 'ziel-neu'
  | 'gewohnheit-neu'
  | 'ziel-bearbeiten'
  | 'gewohnheit-bearbeiten'
  | 'abend'
  | 'gegen-habit-neu'
  | 'ausweichliste'
  | 'info'
  | 'wochenrueckblick'
  | 'daten'
  | 'gespeichert';

const ROUTES: readonly Route[] = [
  'heute',
  'plan',
  'verlauf',
  'einstellungen',
  'start',
  'ziel-neu',
  'gewohnheit-neu',
  'ziel-bearbeiten',
  'gewohnheit-bearbeiten',
  'abend',
  'gegen-habit-neu',
  'ausweichliste',
  'info',
  'wochenrueckblick',
  'daten',
  'gespeichert',
];

export type RouteParams = Record<string, string>;

export function parseRoute(hash: string): Route | undefined {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : undefined;
}

/** Parameter nach „?“, z. B. `#/gewohnheit-neu?ziel=abc`. */
export function parseParams(hash: string): URLSearchParams {
  const i = hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : '');
}

export function routeHref(route: Route, params?: RouteParams): string {
  const query = params ? new URLSearchParams(params).toString() : '';
  return `#/${route}${query ? `?${query}` : ''}`;
}

export function navigate(route: Route, { replace = false, params }: { replace?: boolean; params?: RouteParams } = {}): void {
  const href = routeHref(route, params);
  if (location.hash === href) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (replace) {
    history.replaceState(null, '', href);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = href;
  }
}
