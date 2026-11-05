import { de } from '../i18n/de';
import { append, h } from './dom';
import type { FormHost } from './habit-steps';
import type { Check } from './wizard';

/**
 * Kompaktes Formular zum Bearbeiten: alle Felder auf einem Bildschirm, Speichern und Abbrechen.
 * `render` baut das Formular neu auf; die Eingaben liegen im Entwurf des Aufrufers.
 */
export function createEditForm(opts: {
  heading: string;
  cancelHref: string;
  view: (host: FormHost) => { nodes: (Node | null)[]; check: Check };
  /** Speichert; ein Fehler zeigt eine Meldung, die Eingaben bleiben erhalten. */
  save: () => Promise<void>;
}): FormHost {
  let saving = false;
  let saveError: string | undefined;
  const root = h('section', { class: 'screen wizard' });

  const host: FormHost = {
    root,
    render() {
      const { nodes, check } = opts.view(host);
      const form = h('form', {
        class: 'wizard',
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          if (saving) return;
          const invalid = check();
          if (invalid) {
            invalid.focus();
            return;
          }
          void submit();
        },
      });
      append(form, [
        h('h1', { tabindex: '-1' }, opts.heading),
        ...nodes.filter((n): n is Node => n !== null),
        saveError ? h('p', { class: 'form-error', role: 'alert' }, saveError) : null,
        h(
          'div',
          { class: 'actions split' },
          h('a', { class: 'button quiet', href: opts.cancelHref }, de.common.cancel),
          h('button', { type: 'submit', class: 'button primary', disabled: saving }, saving ? de.common.busy : de.common.save),
        ),
      ]);
      root.replaceChildren(form);
    },
  };

  async function submit(): Promise<void> {
    saving = true;
    saveError = undefined;
    host.render();
    try {
      await opts.save(); // navigiert bei Erfolg weiter
    } catch {
      saving = false;
      saveError = de.errors.saveFailed;
      host.render();
    }
  }

  return host;
}
