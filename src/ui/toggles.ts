import { h, uid } from './dom';

export interface Option<T> {
  value: T;
  label: string;
}

/**
 * Knopfgruppe mit `aria-pressed`. Ein zweiter Tipp nimmt die Wahl zurück, solange `clearable` gilt.
 * Die Knöpfe werden an Ort und Stelle aktualisiert, damit der Fokus bleibt.
 */
export function toggleGroup<T>(opts: {
  labelledBy: string;
  options: Option<T>[];
  get: () => T | null | undefined;
  set: (value: T | null) => void;
  clearable: boolean;
  className?: string;
  key: string;
}): HTMLElement {
  const group = h('div', { class: `actions toggles${opts.className ? ` ${opts.className}` : ''}`, role: 'group', 'aria-labelledby': opts.labelledBy });
  const buttons = opts.options.map((o) =>
    h(
      'button',
      {
        type: 'button',
        class: 'button toggle',
        'data-key': opts.key,
        'data-value': String(o.value),
        onclick: () => {
          const current = opts.get();
          if (current === o.value) {
            if (opts.clearable) opts.set(null);
          } else {
            opts.set(o.value);
          }
          sync();
        },
      },
      o.label,
    ),
  );
  const sync = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(opts.get() === opts.options[i]!.value)));
  sync();
  group.append(...buttons);
  return group;
}

/** Eine Frage mit Antwortknöpfen; Name der Frage als Beschriftung der Gruppe. */
export function question(title: string, group: (labelId: string) => HTMLElement, extra: (Node | null)[] = []): HTMLElement {
  const id = uid('q');
  return h('div', { class: 'evening-item' }, h('p', { class: 'evening-item__title', id }, title), group(id), ...extra.filter((n): n is Node => n !== null));
}
