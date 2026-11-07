import {
  addAvoidanceItem,
  deleteAvoidanceItem,
  loadAvoidanceList,
  moveAvoidanceItem,
  renameAvoidanceItem,
  setAvoidanceItemActive,
} from '../../app/counter-habits';
import type { AvoidanceLabelError } from '../../domain/avoidance';
import { appConfig } from '../../domain/app-config';
import type { AvoidanceItem } from '../../domain/types';
import { de } from '../../i18n/de';
import { append, h, uid } from '../dom';
import { routeHref } from '../router';
import type { Screen } from '../screen';

const t = de.avoidance;

type Status = { text: string; error?: boolean };

function labelError(error: AvoidanceLabelError | 'NOT_FOUND'): string {
  if (error === 'DUPLICATE') return t.duplicate;
  if (error === 'TOO_LONG') return de.errors.tooLong(appConfig.textLimits.short);
  if (error === 'REQUIRED') return de.errors.required;
  return de.errors.saveFailed;
}

/** Ein Textfeld mit Knopf in einer Zeile; Fehler stehen darunter und sind verknüpft. */
function inlineForm(opts: {
  label: string;
  hint?: string;
  name: string;
  value: string;
  error: string | undefined;
  submit: string;
  busy: boolean;
  onInput: (value: string) => void;
  onSubmit: () => void;
  extra?: Node;
}): HTMLElement {
  const id = uid(opts.name);
  const hintId = opts.hint ? `${id}-hint` : undefined;
  const errorId = `${id}-error`;
  const input = h('input', {
    id,
    type: 'text',
    name: opts.name,
    autocomplete: 'off',
    maxlength: appConfig.textLimits.short,
    'aria-describedby': [hintId, errorId].filter(Boolean).join(' '),
    'aria-invalid': opts.error ? 'true' : undefined,
    oninput: (e) => opts.onInput((e.target as HTMLInputElement).value),
  });
  input.value = opts.value;
  return h(
    'form',
    {
      class: 'inline-form',
      novalidate: true,
      onsubmit: (e) => {
        e.preventDefault();
        opts.onSubmit();
      },
    },
    h('label', { for: id }, opts.label),
    opts.hint ? h('p', { id: hintId, class: 'hint' }, opts.hint) : null,
    h(
      'div',
      { class: 'inline-form__row' },
      input,
      h('button', { type: 'submit', class: 'button', disabled: opts.busy }, opts.submit),
      opts.extra ?? null,
    ),
    h('p', { id: errorId, class: 'form-error', hidden: !opts.error }, opts.error ?? ''),
  );
}

/**
 * Die persönliche Ausweichliste: hinzufügen, umbenennen, sortieren, ausblenden, löschen.
 * Es gibt keine vorgegebenen Einträge.
 */
export const avoidanceListScreen: Screen = async ({ ctx }) => {
  const section = h('section', { class: 'screen avoidance-list' });
  let list = await loadAvoidanceList(ctx);
  let status: Status | undefined;
  let busy = false;
  let addText = '';
  let addError: string | undefined;
  let editing: { id: string; text: string; error?: string } | undefined;
  let confirming: string | undefined;

  /** Führt eine Änderung aus, lädt neu und setzt den Fokus auf das gewünschte Element. */
  async function perform(action: () => Promise<Status | undefined>, focus: () => string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const result = await action();
      if (result) status = result;
      list = await loadAvoidanceList(ctx);
    } catch {
      status = { text: de.errors.saveFailed, error: true };
    }
    busy = false;
    render();
    section.querySelector<HTMLElement>(focus())?.focus();
  }

  const statusSelector = '[data-role="avoidance-status"]';
  const itemSelector = (id: string, action: string) => `[data-item="${id}"] [data-action="${action}"]`;

  function itemRow(item: AvoidanceItem, index: number, peers: AvoidanceItem[]): HTMLElement {
    const named = (label: string, action: string) => ({ 'aria-label': `${label}: ${item.label}`, 'data-action': action });
    const button = (label: string, action: string, run: () => void, disabled = false) =>
      h('button', { type: 'button', class: 'button quiet', disabled: busy || disabled, ...named(label, action), onclick: run }, label);

    if (editing?.id === item.id) {
      const current = editing;
      return h(
        'li',
        { class: 'avoidance-item', 'data-item': item.id },
        inlineForm({
          label: t.renameLabel(item.label),
          name: 'avoidance-rename',
          value: current.text,
          error: current.error,
          submit: de.common.save,
          busy,
          onInput: (v) => (current.text = v),
          onSubmit: () =>
            void perform(
              async () => {
                const result = await renameAvoidanceItem(ctx, item.id, current.text);
                if (!result.ok) {
                  current.error = labelError(result.error);
                  return undefined;
                }
                editing = undefined;
                return { text: t.renamed };
              },
              () => (editing ? 'input[name="avoidance-rename"]' : itemSelector(item.id, 'rename')),
            ),
          extra: h(
            'button',
            {
              type: 'button',
              class: 'button quiet',
              onclick: () => {
                editing = undefined;
                render();
                section.querySelector<HTMLElement>(itemSelector(item.id, 'rename'))?.focus();
              },
            },
            de.common.cancel,
          ),
        }),
      );
    }

    if (confirming === item.id) {
      return h(
        'li',
        { class: 'avoidance-item', 'data-item': item.id },
        h('p', { class: 'avoidance-item__label' }, item.label),
        h(
          'div',
          { class: 'confirm' },
          h('p', { class: 'confirm-text', tabindex: '-1', 'data-role': 'confirm' }, t.deleteQuestion),
          h(
            'div',
            { class: 'actions' },
            h(
              'button',
              {
                type: 'button',
                class: 'button',
                disabled: busy,
                ...named(de.plan.confirmDelete, 'delete-confirm'),
                onclick: () =>
                  void perform(async () => {
                    confirming = undefined;
                    return (await deleteAvoidanceItem(ctx, item.id)).ok ? { text: t.deleted } : { text: de.errors.saveFailed, error: true };
                  }, () => statusSelector),
              },
              de.plan.confirmDelete,
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'button quiet',
                onclick: () => {
                  confirming = undefined;
                  render();
                  section.querySelector<HTMLElement>(itemSelector(item.id, 'delete'))?.focus();
                },
              },
              de.common.cancel,
            ),
          ),
        ),
      );
    }

    const move = (direction: -1 | 1) => () =>
      void perform(
        async () => ((await moveAvoidanceItem(ctx, item.id, direction)).ok ? { text: t.moved } : undefined),
        () => itemSelector(item.id, direction < 0 ? 'up' : 'down'),
      );
    const actions = item.active
      ? [
          button(t.rename, 'rename', () => {
            editing = { id: item.id, text: item.label };
            confirming = undefined;
            render();
            section.querySelector<HTMLElement>('input[name="avoidance-rename"]')?.focus();
          }),
          button(t.up, 'up', move(-1), index === 0),
          button(t.down, 'down', move(1), index === peers.length - 1),
          button(t.hide, 'hide', () =>
            void perform(
              async () => ((await setAvoidanceItemActive(ctx, item.id, false)).ok ? { text: t.hiddenDone } : undefined),
              () => statusSelector,
            ),
          ),
        ]
      : [
          button(t.show, 'show', () =>
            void perform(
              async () => ((await setAvoidanceItemActive(ctx, item.id, true)).ok ? { text: t.shownDone } : undefined),
              () => statusSelector,
            ),
          ),
        ];
    actions.push(
      button(de.plan.delete, 'delete', () => {
        confirming = item.id;
        editing = undefined;
        render();
        section.querySelector<HTMLElement>('[data-role="confirm"]')?.focus();
      }),
    );
    return h(
      'li',
      { class: 'avoidance-item', 'data-item': item.id },
      h('p', { class: 'avoidance-item__label' }, item.label),
      h('div', { class: 'actions item-actions' }, actions),
    );
  }

  function render(): void {
    const hiddenOpen = list.hidden.some((i) => i.id === editing?.id || i.id === confirming);
    section.replaceChildren();
    append(section, [
      h('h1', { tabindex: '-1' }, t.heading),
      h('p', { class: 'muted' }, t.intro),
      h(
        'p',
        { class: status?.error ? 'form-error' : 'status-line', role: 'status', tabindex: '-1', 'data-role': 'avoidance-status' },
        status?.text ?? '',
      ),
      h(
        'div',
        { class: 'card' },
        inlineForm({
          label: t.addLabel,
          hint: t.addHint,
          name: 'avoidance-label',
          value: addText,
          error: addError,
          submit: t.add,
          busy,
          onInput: (v) => (addText = v),
          onSubmit: () =>
            void perform(
              async () => {
                const result = await addAvoidanceItem(ctx, addText);
                if (!result.ok) {
                  addError = labelError(result.error);
                  return undefined;
                }
                addText = '';
                addError = undefined;
                return { text: t.added };
              },
              () => 'input[name="avoidance-label"]',
            ),
        }),
      ),
      list.active.length > 0
        ? h('ul', { class: 'card avoidance-items', 'data-role': 'active-items' }, list.active.map((i, n) => itemRow(i, n, list.active)))
        : h('p', { class: 'muted' }, t.empty),
      list.hidden.length > 0
        ? h(
            'details',
            { class: 'card plan-group', 'data-group': 'hidden', open: hiddenOpen },
            h('summary', null, `${t.hidden} (${list.hidden.length})`),
            h('p', { class: 'hint' }, t.hiddenHint),
            h('ul', { class: 'avoidance-items' }, list.hidden.map((i, n) => itemRow(i, n, list.hidden))),
          )
        : null,
      h('a', { class: 'button quiet', href: routeHref('plan') }, t.backToPlan),
    ]);
  }

  render();
  return section;
};
