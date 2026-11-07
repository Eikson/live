/**
 * Kleiner DOM-Baukasten. Kinder vom Typ string werden immer als Textknoten eingefügt,
 * damit Nutzertexte nie als HTML interpretiert werden.
 */
export type Child = Node | string | null | undefined | false;

type AttrValue = string | number | boolean | null | undefined;
/** Event-Handler (`on…`) werden als Listener registriert, alles andere als Attribut. */
type Attrs = { [key: string]: AttrValue | ((event: never) => void) } & { class?: string };

type Handlers = { [K in keyof HTMLElementEventMap as `on${K}`]?: (event: HTMLElementEventMap[K]) => void };

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: (Attrs & Handlers) | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2), value as EventListener);
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: (Child | Child[])[]): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(el: Element): void {
  el.replaceChildren();
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Dekoratives Inline-Icon (aria-hidden). `paths` sind feste, nicht vom Nutzer stammende Pfade. */
export function icon(paths: string[], size = 24): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

export const icons = {
  gear: [
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  ],
  today: ['M12 3v2', 'M12 19v2', 'M3 12h2', 'M19 12h2', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'],
  plan: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  history: ['M3 3v18h18', 'M7 15l4-4 3 3 5-6'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
};

/** Verknüpft ein Feld mit einer Fehlermeldung (aria-describedby) oder entfernt sie. */
export function setFieldError(field: HTMLElement, messageEl: HTMLElement, message: string | undefined): void {
  messageEl.textContent = message ?? '';
  messageEl.hidden = !message;
  if (message) field.setAttribute('aria-invalid', 'true');
  else field.removeAttribute('aria-invalid');
}

let idCounter = 0;
export function uid(prefix = 'f'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

type SvgAttrs = Record<string, string | number | undefined>;

/** SVG-Element für Diagramme. Text nur als Kindknoten, nie als Markup. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: SvgAttrs = {},
  ...children: (SVGElement | string | null | undefined | false)[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) el.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}
