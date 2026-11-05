/** Hash-Routing: funktioniert offline und unter einem Unterpfad (GitHub Pages) ohne Server-Konfiguration. */
export type Route = 'heute' | 'plan' | 'verlauf' | 'einstellungen' | 'start';

const ROUTES: readonly Route[] = ['heute', 'plan', 'verlauf', 'einstellungen', 'start'];

export function parseRoute(hash: string): Route | undefined {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return (ROUTES as readonly string[]).includes(name) ? (name as Route) : undefined;
}

export function routeHref(route: Route): string {
  return `#/${route}`;
}

export function navigate(route: Route, { replace = false } = {}): void {
  const href = routeHref(route);
  if (location.hash === href) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else if (replace) {
    history.replaceState(null, '', href);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = href;
  }
}
