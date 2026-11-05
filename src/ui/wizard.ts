import { appConfig } from '../domain/app-config';
import type { FieldError } from '../domain/planning';
import { de } from '../i18n/de';
import { append, h, setFieldError, uid } from './dom';

/** Fehlermeldung zu einem Feldfehler der Domain. */
export function message(error: FieldError | undefined, max: number = appConfig.textLimits.short): string | undefined {
  if (!error) return undefined;
  if (error === 'REQUIRED') return de.errors.required;
  if (error === 'TOO_LONG') return de.errors.tooLong(max);
  return de.errors.invalid;
}

export interface TextField {
  field: HTMLElement;
  input: HTMLInputElement | HTMLTextAreaElement;
  showError(msg: string | undefined): void;
}

/** Ein Textfeld mit Label, Hinweis und verknüpfter Fehlermeldung. */
export function textField(opts: {
  label: string;
  value: string;
  hint?: string;
  optional?: boolean;
  multiline?: boolean;
  /** Label nur für Screenreader, wenn die Überschrift die Frage schon stellt. */
  hiddenLabel?: boolean;
  max: number;
  name: string;
  onInput: (value: string) => void;
}): TextField {
  const id = uid(opts.name);
  const hintId = opts.hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ');
  const props = {
    id,
    name: opts.name,
    maxlength: opts.max,
    'aria-describedby': describedBy,
    oninput: (e: Event) => opts.onInput((e.target as HTMLInputElement | HTMLTextAreaElement).value),
  };
  const input = opts.multiline ? h('textarea', props) : h('input', { ...props, type: 'text', autocomplete: 'off' });
  input.value = opts.value;
  const error = h('p', { id: errorId, class: 'form-error', hidden: true });
  const label = h(
    'label',
    { for: id, class: opts.hiddenLabel ? 'visually-hidden' : undefined },
    opts.label,
    opts.optional ? h('span', { class: 'muted' }, ` (${de.common.optional})`) : null,
  );
  const field = h('div', { class: 'field' }, label, opts.hint ? h('p', { id: hintId, class: 'hint' }, opts.hint) : null, input, error);
  return { field, input, showError: (msg) => setFieldError(input, error, msg) };
}

/** Prüft den aktuellen Schritt; gibt das erste fehlerhafte Feld zurück. */
export type Check = () => HTMLElement | undefined;

export interface Wizard {
  root: HTMLElement;
  readonly step: number;
  readonly total: number;
  go(step: number): void;
  render(): void;
  /** Formular eines Schritts mit Fortschritt, Zurück und Weiter bzw. Abschluss. */
  frame(heading: string, body: (Node | null)[], check: Check, submitLabel?: string): HTMLElement;
  /**
   * Speichert; doppeltes Absenden ist gesperrt. Liefert `save` eine Schrittnummer,
   * springt der Assistent dorthin (Prüfung ist fehlgeschlagen).
   */
  save(run: () => Promise<number | void>): Promise<void>;
}

/**
 * Schritt-für-Schritt-Formular: Zurück ist immer möglich, der Fortschritt ist sichtbar.
 * `cancelHref` zeigt im ersten Schritt einen Abbrechen-Link (nicht im ersten Start).
 */
export function createWizard(opts: {
  total: number;
  view: (w: Wizard) => HTMLElement;
  finish: (w: Wizard) => Promise<void> | void;
  cancelHref?: string;
}): Wizard {
  let step = 1;
  let saving = false;
  let saveError: string | undefined;
  const root = h('section', { class: 'screen wizard' });

  const w: Wizard = {
    root,
    get step() {
      return step;
    },
    total: opts.total,
    go(next) {
      step = Math.min(opts.total, Math.max(1, next));
      saveError = undefined;
      w.render();
      root.querySelector<HTMLElement>('h1')?.focus();
    },
    render() {
      root.replaceChildren(opts.view(w));
    },
    frame(heading, body, check, submitLabel = de.common.next) {
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
          if (step < opts.total) w.go(step + 1);
          else void opts.finish(w);
        },
      });
      const back =
        step > 1
          ? h('button', { type: 'button', class: 'button quiet', onclick: () => w.go(step - 1), disabled: saving }, de.common.back)
          : opts.cancelHref
            ? h('a', { class: 'button quiet', href: opts.cancelHref }, de.common.cancel)
            : h('span');
      append(form, [
        h('p', { class: 'progress' }, de.common.stepOf(step, opts.total)),
        h('div', { class: 'progress-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${(step / opts.total) * 100}%` })),
        h('h1', { tabindex: '-1' }, heading),
        ...body.filter((n): n is Node => n !== null),
        saveError ? h('p', { class: 'form-error', role: 'alert' }, saveError) : null,
        h(
          'div',
          { class: 'actions split' },
          back,
          h('button', { type: 'submit', class: 'button primary', disabled: saving }, saving ? de.common.busy : submitLabel),
        ),
      ]);
      return form;
    },
    async save(run) {
      if (saving) return;
      saving = true;
      saveError = undefined;
      w.render();
      try {
        const target = await run();
        saving = false;
        if (typeof target === 'number') w.go(target);
      } catch {
        saving = false;
        saveError = de.errors.saveFailed;
        w.render();
      }
    },
  };
  return w;
}
