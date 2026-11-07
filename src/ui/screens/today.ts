import { recordCheckIn, type RecordCheckInInput } from '../../app/check-in';
import type { AppContext } from '../../app/context';
import { reenter, removeCheckIn } from '../../app/planning';
import { chooseHint, markHintShown, type HintChoice } from '../../app/hint';
import { loadTodayView, type TodayCard, type TodayView } from '../../app/today';
import { appConfig } from '../../domain/app-config';
import type { LocalDate } from '../../domain/local-date';
import type { ReviewWeek } from '../../domain/review';
import type { ReentryChoice } from '../../domain/reentry';
import type { BuildOutcome, CheckIn, Habit } from '../../domain/types';
import { de } from '../../i18n/de';
import { h, icon, icons, uid } from '../dom';
import { formatCue, formatDayMonth, formatDayShort, formatWeekdayShort } from '../format';
import { dismissReentry, isReentryDismissed } from '../../platform/ui-memory';
import { dayPicker } from '../day-picker';
import { navigate, routeHref } from '../router';
import type { Screen } from '../screen';

/** Texte für heute oder für einen nachgetragenen Tag. */
function textsFor(past: boolean) {
  const t = de.today;
  const buttons: { outcome: BuildOutcome; label: string; primary?: boolean }[] = [
    { outcome: 'DONE', label: t.done, primary: true },
    { outcome: 'ALTERNATIVE', label: t.alternative },
    { outcome: 'NOT_DONE', label: past ? t.past.notDone : t.notDone },
  ];
  const confirmation: Record<BuildOutcome, string> = {
    DONE: past ? t.past.confirmDone : t.confirmDone,
    ALTERNATIVE: t.confirmAlternative,
    NOT_DONE: past ? t.past.confirmNotDone : t.confirmNotDone,
  };
  return {
    label: past ? t.past.label : t.nextStep,
    notPlanned: past ? t.past.notPlanned : undefined,
    changeHint: past ? t.past.changeHint : t.changeHint,
    noteLabel: past ? t.past.noteLabel : t.noteLabel,
    buttons,
    confirmation,
  };
}

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
 * Eine Karte je aktivem Habit. Nach einer Aktion wird nur die Karte neu gezeichnet.
 * Während eine Speicherung läuft, sind alle Knöpfe der Karte gesperrt (Doppeltipp).
 * An nicht geplanten Tagen gibt es nur „Trotzdem gemacht“; der Eintrag lässt sich zurücknehmen.
 */
function habitCard(ctx: AppContext, initial: TodayCard, day: LocalDate, past: boolean): HTMLElement {
  const state: CardState = { card: initial, day, correcting: false, noteOpen: false, busy: false };
  const texts = textsFor(past);
  const titleId = uid('habit');
  const article = h('article', {
    class: `card habit-card${initial.planned ? '' : ' unplanned'}`,
    'aria-labelledby': titleId,
    'data-habit': initial.habit.id,
  });
  let focusAfterRender: 'confirmation' | 'note' | 'first-action' | undefined;

  async function run(action: () => Promise<boolean>) {
    if (state.busy) return;
    state.busy = true;
    state.error = undefined;
    state.message = undefined;
    render();
    try {
      if (!(await action())) state.error = de.errors.saveFailed;
    } catch {
      state.error = de.errors.saveFailed;
    } finally {
      state.busy = false;
      render();
    }
  }

  function save(input: Omit<RecordCheckInInput, 'habitId' | 'localDate'>, after?: (c: CheckIn) => void) {
    return run(async () => {
      const result = await recordCheckIn(ctx, { habitId: state.card.habit.id, localDate: state.day, ...input });
      if (!result.ok) return false;
      state.card = { ...state.card, checkIn: result.checkIn };
      after?.(result.checkIn);
      return true;
    });
  }

  function undo() {
    return run(async () => {
      const result = await removeCheckIn(ctx, { habitId: state.card.habit.id, localDate: state.day });
      if (!result.ok) return false;
      const { checkIn: _removed, ...rest } = state.card;
      state.card = rest;
      state.noteOpen = false;
      state.message = de.today.undone;
      focusAfterRender = 'first-action';
      return true;
    });
  }

  function outcomeButtons(current?: BuildOutcome): HTMLElement {
    return h(
      'div',
      { class: 'actions', role: 'group', 'aria-label': state.card.habit.actionText },
      texts.buttons.map((b) =>
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

  function anywayButton(): HTMLElement {
    return h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          class: 'button',
          disabled: state.busy,
          onclick: () => save({ outcome: 'DONE' }, () => (focusAfterRender = 'confirmation')),
        },
        de.today.doneAnyway,
      ),
    );
  }

  function recorded(checkIn: CheckIn): (HTMLElement | null)[] {
    const outcome = checkIn.outcome as BuildOutcome;
    const planned = state.card.planned;
    const confirmation = h(
      'p',
      { class: 'confirmation', tabindex: '-1', 'data-role': 'confirmation' },
      h('span', null, planned ? texts.confirmation[outcome] : de.today.confirmAnyway),
    );
    if (outcome !== 'NOT_DONE') {
      const mark = icon(icons.check, 20);
      confirmation.prepend(mark);
      confirmation.append(h('span', { class: 'visually-hidden' }, ` ${de.today.doneMark}`));
    }

    const followups = h('div', { class: 'followups' });
    if (outcome === 'DONE' && planned) {
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
      planned
        ? h(
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
          )
        : h('button', { type: 'button', class: 'button link', disabled: state.busy, onclick: () => void undo() }, de.today.undo),
    );
    return [
      confirmation,
      checkIn.note && !state.noteOpen ? h('p', { class: 'muted note-text', 'data-role': 'note-text' }, checkIn.note) : null,
      followups,
      state.correcting ? h('p', { class: 'hint' }, texts.changeHint) : null,
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
      h('label', { for: id }, texts.noteLabel),
      textarea,
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'submit', class: 'button', disabled: state.busy }, de.today.noteSave),
      ),
    );
  }

  function render() {
    const { habit, checkIn, planned, nextDate } = state.card;
    const label = planned
      ? texts.label
      : (texts.notPlanned ?? (nextDate ? de.today.notPlanned(formatWeekdayShort(nextDate)) : de.today.notPlannedNoNext));
    const children: (Node | null)[] = [
      h('p', { class: 'label', 'data-role': 'card-label' }, label),
      h('h2', { id: titleId }, habit.actionText),
      planned && habit.cue ? h('p', { class: 'detail' }, formatCue(habit.cue)) : null,
      planned && habit.minimumText ? h('p', { class: 'detail muted' }, de.today.minimum(habit.minimumText)) : null,
    ];
    if (checkIn) children.push(...recorded(checkIn));
    else children.push(planned ? outcomeButtons() : anywayButton());
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

/**
 * Wiedereinstieg nach einer längeren Pause ohne Angaben. Die Wahl wird sofort gespeichert;
 * „Kleiner machen“ und „Auslöser ändern“ führen danach ins Bearbeiten-Formular.
 */
function reentryCard(
  ctx: AppContext,
  reentry: { since: LocalDate; habits: Habit[] },
  done: (status: string | undefined) => void,
): HTMLElement {
  const t = de.reentry;
  const titleId = uid('reentry');
  const article = h('article', { class: 'card reentry', 'aria-labelledby': titleId, 'data-role': 'reentry' });
  let target = reentry.habits[0]!.id;
  let busy = false;
  let error: string | undefined;

  async function choose(choice: ReentryChoice) {
    if (busy) return;
    busy = true;
    error = undefined;
    render();
    const habitIds = reentry.habits.map((x) => x.id);
    let ok = false;
    try {
      ok = (await reenter(ctx, { habitIds, choice, targetId: target })).ok;
    } catch {
      ok = false;
    }
    busy = false;
    if (!ok) {
      error = de.errors.saveFailed;
      render();
      return;
    }
    if (choice === 'SMALLER' || choice === 'CHANGE_CUE') {
      navigate('gewohnheit-bearbeiten', { params: { id: target, fokus: choice === 'SMALLER' ? 'minimum' : 'cue' } });
      return;
    }
    const habit = reentry.habits.find((x) => x.id === target);
    done(choice === 'PAUSE' && habit ? t.paused(habit.actionText) : t.continued);
  }

  function render() {
    const choices: [ReentryChoice, string, boolean?][] = [
      ['CONTINUE', t.continue, true],
      ['SMALLER', t.smaller],
      ['CHANGE_CUE', t.changeCue],
      ['PAUSE', t.pause],
    ];
    const picker =
      reentry.habits.length > 1
        ? h(
            'fieldset',
            null,
            h('legend', null, t.habitLabel),
            h(
              'div',
              { class: 'choices' },
              reentry.habits.map((x) =>
                h(
                  'label',
                  { class: 'choice' },
                  h('input', {
                    type: 'radio',
                    name: 'reentry-habit',
                    value: x.id,
                    checked: x.id === target,
                    disabled: busy,
                    onchange: () => (target = x.id),
                  }),
                  h('span', null, x.actionText),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, reentry.habits[0]!.actionText);
    article.replaceChildren(
      h('p', { class: 'label', id: titleId }, t.label),
      h('p', null, t.welcome),
      h('p', null, t.question),
      picker,
      h(
        'div',
        { class: 'actions' },
        choices.map(([choice, label, primary]) =>
          h(
            'button',
            {
              type: 'button',
              class: `button${primary ? ' primary' : ''}`,
              'data-choice': choice,
              disabled: busy,
              onclick: () => void choose(choice),
            },
            label,
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'button link',
            'data-choice': 'DISMISS',
            disabled: busy,
            onclick: () => {
              dismissReentry(reentry.since);
              done(undefined);
            },
          },
          t.dismiss,
        ),
      ),
    );
    if (error) article.append(h('p', { class: 'form-error', role: 'alert' }, error));
  }

  render();
  return article;
}

/**
 * Hinweiskarte bei Mustern (Abschnitt 4.5). Beobachtung statt Urteil; jede Wahl blendet sie
 * 7 Tage aus. „Kleiner machen“ und „Auslöser ändern“ führen ins Bearbeiten-Formular.
 */
function hintCard(ctx: AppContext, hint: { habits: Habit[] }, done: (status: string | undefined) => void): HTMLElement {
  const t = de.hint;
  const titleId = uid('hint');
  const article = h('article', { class: 'card hint-card', 'aria-labelledby': titleId, 'data-role': 'hint' });
  let target = hint.habits[0]?.id;
  let busy = false;
  let error: string | undefined;

  async function choose(choice: HintChoice) {
    if (busy) return;
    busy = true;
    error = undefined;
    render();
    let ok = false;
    try {
      ok = (await chooseHint(ctx, choice, target)).ok;
    } catch {
      ok = false;
    }
    busy = false;
    if (!ok) {
      error = de.errors.saveFailed;
      render();
      return;
    }
    if ((choice === 'SMALLER' || choice === 'CHANGE_CUE') && target) {
      navigate('gewohnheit-bearbeiten', { params: { id: target, fokus: choice === 'SMALLER' ? 'minimum' : 'cue' } });
      return;
    }
    if (choice === 'EXCEPTIONS') {
      navigate('abend');
      return;
    }
    const habit = hint.habits.find((x) => x.id === target);
    done(choice === 'PAUSE' && habit ? de.reentry.paused(habit.actionText) : t.kept);
  }

  function render() {
    const withHabit: [HintChoice, string][] = [
      ['SMALLER', t.smaller],
      ['CHANGE_CUE', t.changeCue],
      ['PAUSE', t.pause],
    ];
    const choices: [HintChoice, string, boolean?][] = [
      ['KEEP', t.keep, true],
      ...(hint.habits.length > 0 ? withHabit : []),
      ['EXCEPTIONS', t.exceptions],
    ];
    const picker =
      hint.habits.length > 1
        ? h(
            'fieldset',
            null,
            h('legend', null, t.habitLabel),
            h(
              'div',
              { class: 'choices' },
              hint.habits.map((x) =>
                h(
                  'label',
                  { class: 'choice' },
                  h('input', {
                    type: 'radio',
                    name: 'hint-habit',
                    value: x.id,
                    checked: x.id === target,
                    disabled: busy,
                    onchange: () => (target = x.id),
                  }),
                  h('span', null, x.actionText),
                ),
              ),
            ),
          )
        : null;
    article.replaceChildren(
      h('p', { class: 'label', id: titleId }, t.label),
      h('p', null, t.text),
      h('p', null, t.question),
      ...(picker ? [picker] : []),
      h(
        'div',
        { class: 'actions' },
        choices.map(([choice, label, primary]) =>
          h(
            'button',
            {
              type: 'button',
              class: `button${primary ? ' primary' : ''}`,
              'data-choice': choice,
              disabled: busy,
              onclick: () => void choose(choice),
            },
            label,
          ),
        ),
      ),
    );
    if (error) article.append(h('p', { class: 'form-error', role: 'alert' }, error));
  }

  render();
  return article;
}

/** Ruhige Karte für den anstehenden Wochenrückblick. */
function reviewCard(week: ReviewWeek): HTMLElement {
  const t = de.review;
  return h(
    'div',
    { class: 'card review-card', 'data-role': 'review-card' },
    h('p', { class: 'label' }, t.cardLabel),
    h('p', null, t.cardText(formatDayMonth(week.from), formatDayMonth(week.to))),
    h('p', { class: 'muted' }, t.cardOptional),
    h('a', { class: 'button primary', href: routeHref('wochenrueckblick') }, t.cardOpen),
  );
}

/**
 * Zugang zum Abend-Check-in. Ab der eingestellten Uhrzeit als ruhige Karte (nicht neben der
 * Wiedereinstiegskarte), sonst als schlichter Link. Ein abgeschlossener Tag lässt sich ändern.
 */
function eveningEntry(view: TodayView, reentryShown: boolean): HTMLElement {
  const href = routeHref('abend', view.day === view.today ? undefined : { tag: view.day });
  if (view.dayClosed) {
    return h(
      'div',
      { class: 'evening-entry', 'data-role': 'evening-entry' },
      h('p', { class: 'muted' }, de.today.dayClosed),
      h('a', { class: 'button quiet', href }, de.today.changeEvening),
    );
  }
  if (view.eveningCard && !reentryShown) {
    return h(
      'div',
      { class: 'card evening-card', 'data-role': 'evening-card' },
      h('p', { class: 'label' }, de.today.eveningLabel),
      h('p', null, de.today.eveningQuestion),
      h('a', { class: 'button primary', href }, de.today.closeDay),
    );
  }
  return h('div', { class: 'evening-entry', 'data-role': 'evening-entry' }, h('a', { class: 'button quiet', href }, de.today.closeDay));
}

export const todayScreen: Screen = async ({ ctx }) => {
  const section = h('section', { class: 'screen' });

  async function show(day: LocalDate | undefined, focus: boolean, status?: string): Promise<void> {
    const view = await loadTodayView(ctx, day);
    const past = view.day !== view.today;
    const heading = h(
      'h1',
      { tabindex: '-1' },
      past ? de.today.backfillHeading : de.today.heading,
      h('span', { class: 'date-line' }, ` · ${formatDayShort(view.day)}`),
    );
    const nodes: Node[] = [heading];
    if (past) {
      nodes.push(
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            { type: 'button', class: 'button link', onclick: () => void show(undefined, true) },
            de.today.backToToday,
          ),
        ),
      );
    }

    const statusLine = h('p', { class: 'status-line', role: 'status', tabindex: '-1', 'data-role': 'today-status' }, status ?? '');
    nodes.push(statusLine);
    const reentryShown = Boolean(view.reentry && !isReentryDismissed(view.reentry.since));
    if (view.reentry && reentryShown) {
      nodes.push(
        reentryCard(ctx, view.reentry, (text) => {
          void show(undefined, false, text).then(() => {
            const target = text ? section.querySelector<HTMLElement>('[data-role="today-status"]') : section.querySelector('h1');
            target?.focus();
          });
        }),
      );
    }
    // Nie zwei Hinweiskarten gleichzeitig: der Wiedereinstieg hat Vorrang.
    const hintShown = Boolean(view.hint && !reentryShown);
    if (view.hint && hintShown) {
      void markHintShown(ctx).catch(() => undefined);
      nodes.push(
        hintCard(ctx, view.hint, (text) => {
          void show(undefined, false, text).then(() => {
            section.querySelector<HTMLElement>(text ? '[data-role="today-status"]' : 'h1')?.focus();
          });
        }),
      );
    }

    if (view.cards.length === 0) {
      nodes.push(
        past
          ? h('div', { class: 'card empty' }, h('p', null, de.today.past.emptyTitle))
          : h(
              'div',
              { class: 'card empty' },
              h('p', null, de.today.emptyTitle),
              h('p', { class: 'muted' }, de.today.emptyBody),
              h('a', { class: 'button', href: routeHref('plan') }, de.today.emptyLink),
            ),
      );
    } else {
      for (const card of view.cards) nodes.push(habitCard(ctx, card, view.day, past));
    }
    // Wochenrückblick nur, wenn keine andere Karte oben steht; die Abend-Karte weicht dann dem Link.
    const reviewShown = Boolean(view.review && !reentryShown && !hintShown);
    if (view.review && reviewShown) nodes.push(reviewCard(view.review));
    nodes.push(eveningEntry(view, reentryShown || hintShown || reviewShown));
    nodes.push(dayPicker(view, (d) => void show(d, true)));
    section.replaceChildren(...nodes);
    if (focus) heading.focus();
  }

  await show(undefined, false);
  return section;
};
