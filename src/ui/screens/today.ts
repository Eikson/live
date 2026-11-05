import { recordCheckIn, type RecordCheckInInput } from '../../app/check-in';
import type { AppContext } from '../../app/context';
import { loadTodayView, type TodayCard } from '../../app/today';
import { appConfig } from '../../domain/app-config';
import type { LocalDate } from '../../domain/local-date';
import type { BuildOutcome, CheckIn } from '../../domain/types';
import { de } from '../../i18n/de';
import { h, icon, icons, uid } from '../dom';
import { formatCue, formatDayShort } from '../format';
import { routeHref } from '../router';
import type { Screen } from '../screen';

const OUTCOME_BUTTONS: { outcome: BuildOutcome; label: string; primary?: boolean }[] = [
  { outcome: 'DONE', label: de.today.done, primary: true },
  { outcome: 'ALTERNATIVE', label: de.today.alternative },
  { outcome: 'NOT_DONE', label: de.today.notDone },
];

const CONFIRMATION: Record<BuildOutcome, string> = {
  DONE: de.today.confirmDone,
  ALTERNATIVE: de.today.confirmAlternative,
  NOT_DONE: de.today.confirmNotDone,
};

interface CardState {
  card: TodayCard;
  day: LocalDate;
  correcting: boolean;
  noteOpen: boolean;
  busy: boolean;
  message?: string;
  error?: string;
}

/**
 * Eine Karte je geplantem Habit. Nach einer Aktion wird nur die Karte neu gezeichnet.
 * Während eine Speicherung läuft, sind alle Knöpfe der Karte gesperrt (Doppeltipp).
 */
function habitCard(ctx: AppContext, initial: TodayCard, day: LocalDate): HTMLElement {
  const state: CardState = { card: initial, day, correcting: false, noteOpen: false, busy: false };
  const titleId = uid('habit');
  const article = h('article', { class: 'card habit-card', 'aria-labelledby': titleId, 'data-habit': initial.habit.id });
  let focusAfterRender: 'confirmation' | 'note' | 'first-action' | undefined;

  async function save(input: Omit<RecordCheckInInput, 'habitId' | 'localDate'>, after?: (c: CheckIn) => void) {
    if (state.busy) return;
    state.busy = true;
    state.error = undefined;
    state.message = undefined;
    render();
    try {
      const result = await recordCheckIn(ctx, { habitId: state.card.habit.id, localDate: state.day, ...input });
      if (result.ok) {
        state.card = { ...state.card, checkIn: result.checkIn };
        after?.(result.checkIn);
      } else {
        state.error = de.errors.saveFailed;
      }
    } catch {
      state.error = de.errors.saveFailed;
    } finally {
      state.busy = false;
      render();
    }
  }

  function outcomeButtons(current?: BuildOutcome): HTMLElement {
    return h(
      'div',
      { class: 'actions', role: 'group', 'aria-label': state.card.habit.actionText },
      OUTCOME_BUTTONS.map((b) =>
        h(
          'button',
          {
            type: 'button',
            class: `button${b.primary ? ' primary' : ''}`,
            disabled: state.busy,
            'aria-pressed': current ? String(current === b.outcome) : undefined,
            onclick: () =>
              save({ outcome: b.outcome }, () => {
                state.correcting = false;
                focusAfterRender = 'confirmation';
              }),
          },
          b.label,
        ),
      ),
    );
  }

  function recorded(checkIn: CheckIn): (HTMLElement | null)[] {
    const outcome = checkIn.outcome as BuildOutcome;
    const confirmation = h(
      'p',
      { class: 'confirmation', tabindex: '-1', 'data-role': 'confirmation' },
      h('span', null, CONFIRMATION[outcome]),
    );
    if (outcome !== 'NOT_DONE') {
      const mark = icon(icons.check, 20);
      confirmation.prepend(mark);
      confirmation.append(h('span', { class: 'visually-hidden' }, ` ${de.today.doneMark}`));
    }

    const followups = h('div', { class: 'followups' });
    if (outcome === 'DONE') {
      followups.append(
        h(
          'label',
          { class: 'choice' },
          h('input', {
            type: 'checkbox',
            checked: checkIn.minimal,
            disabled: state.busy,
            onchange: (e) => save({ minimal: (e.target as HTMLInputElement).checked }),
          }),
          h('span', null, de.today.wasMinimal),
        ),
      );
    }
    followups.append(
      h(
        'button',
        {
          type: 'button',
          class: 'button link',
          'aria-expanded': String(state.noteOpen),
          disabled: state.busy,
          onclick: () => {
            state.noteOpen = !state.noteOpen;
            state.message = undefined;
            focusAfterRender = state.noteOpen ? 'note' : undefined;
            render();
          },
        },
        de.today.note,
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'button link',
          'aria-expanded': String(state.correcting),
          disabled: state.busy,
          onclick: () => {
            state.correcting = !state.correcting;
            focusAfterRender = state.correcting ? 'first-action' : undefined;
            render();
          },
        },
        de.today.change,
      ),
    );
    return [
      confirmation,
      checkIn.note && !state.noteOpen ? h('p', { class: 'muted note-text', 'data-role': 'note-text' }, checkIn.note) : null,
      followups,
      state.correcting ? h('p', { class: 'hint' }, de.today.changeHint) : null,
      state.correcting ? outcomeButtons(outcome) : null,
      state.noteOpen ? noteForm(checkIn) : null,
    ];
  }

  function noteForm(checkIn: CheckIn): HTMLElement {
    const id = uid('note');
    const textarea = h('textarea', {
      id,
      name: 'note',
      maxlength: appConfig.textLimits.note,
      'data-role': 'note',
    });
    textarea.value = checkIn.note ?? '';
    return h(
      'form',
      {
        class: 'note-form',
        onsubmit: (e) => {
          e.preventDefault();
          const value = textarea.value.trim();
          void save({ note: value ? value : null }, () => {
            state.noteOpen = false;
            state.message = de.today.noteSaved;
          });
        },
      },
      h('label', { for: id }, de.today.noteLabel),
      textarea,
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'submit', class: 'button', disabled: state.busy }, de.today.noteSave),
      ),
    );
  }

  function render() {
    const { habit, checkIn } = state.card;
    const children: (Node | null)[] = [
      h('p', { class: 'label' }, de.today.nextStep),
      h('h2', { id: titleId }, habit.actionText),
      habit.cue ? h('p', { class: 'detail' }, formatCue(habit.cue)) : null,
      habit.minimumText ? h('p', { class: 'detail muted' }, de.today.minimum(habit.minimumText)) : null,
    ];
    if (checkIn) children.push(...recorded(checkIn));
    else children.push(outcomeButtons());
    children.push(
      h(
        'p',
        { class: state.error ? 'form-error' : 'status-line', role: 'status', 'aria-live': 'polite' },
        state.error ?? state.message ?? (state.busy ? de.common.busy : ''),
      ),
    );
    article.replaceChildren(...children.filter((c): c is Node => c !== null));

    const target = focusAfterRender;
    focusAfterRender = undefined;
    if (target === 'confirmation') article.querySelector<HTMLElement>('[data-role="confirmation"]')?.focus();
    else if (target === 'note') article.querySelector<HTMLElement>('[data-role="note"]')?.focus();
    else if (target === 'first-action') article.querySelector<HTMLElement>('.actions button')?.focus();
  }

  render();
  return article;
}

export const todayScreen: Screen = async ({ ctx }) => {
  const view = await loadTodayView(ctx);
  const section = h(
    'section',
    { class: 'screen' },
    h(
      'h1',
      { tabindex: '-1' },
      de.today.heading,
      h('span', { class: 'date-line' }, ` · ${formatDayShort(view.today)}`),
    ),
  );

  if (view.cards.length === 0) {
    section.append(
      h(
        'div',
        { class: 'card empty' },
        h('p', null, de.today.emptyTitle),
        h('p', { class: 'muted' }, de.today.emptyBody),
        h('a', { class: 'button', href: routeHref('plan') }, de.today.emptyLink),
      ),
    );
    return section;
  }

  for (const card of view.cards) section.append(habitCard(ctx, card, view.today));
  return section;
};
