import { completeReview, loadReviewView, skipReview, type ReviewHabit, type ReviewView } from '../../app/review';
import { appConfig } from '../../domain/app-config';
import { reviewSuggestions } from '../../domain/review';
import type { CueConsistency, Habit, ReviewDecision, WeeklyReviewEntry } from '../../domain/types';
import { de } from '../../i18n/de';
import { h, uid } from '../dom';
import { formatDayMonth, formatDayShort } from '../format';
import { routeHref } from '../router';
import type { Screen } from '../screen';
import { question, toggleGroup } from '../toggles';

const t = de.review;

const SCALE = [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }));
const CUES: CueConsistency[] = ['MOST', 'HALF', 'RARE'];
const DECISIONS: ReviewDecision[] = ['KEEP', 'SMALLER', 'CHANGE_CUE', 'PAUSE'];

/** Antwort in der kompakten Liste: „passt“ (KEEP), „anpassen“ oder eine Wahl aus dem Hinweis. */
type CompactChoice = ReviewDecision | 'ADJUST';

interface Draft {
  entries: Map<string, WeeklyReviewEntry & { auto: (number | null)[] }>;
  compact: Map<string, CompactChoice>;
}

function entryOf(draft: Draft, habitId: string) {
  let e = draft.entries.get(habitId);
  if (!e) draft.entries.set(habitId, (e = { habitId, auto: [null, null, null, null] }));
  return e;
}

/** Gespeichert wird nur, was ausgefüllt ist; Automatik nur vollständig. */
function entriesOf(draft: Draft): WeeklyReviewEntry[] {
  const ids = new Set([...draft.entries.keys(), ...draft.compact.keys()]);
  return [...ids].map((habitId) => {
    const { auto, ...rest } = draft.entries.get(habitId) ?? { habitId, auto: [] };
    const entry: WeeklyReviewEntry = { ...rest };
    if (auto.length === 4 && auto.every((v) => v !== null)) entry.automaticity = auto as [number, number, number, number];
    const compact = draft.compact.get(habitId);
    if (compact && compact !== 'ADJUST') entry.decision = compact;
    return entry;
  });
}

function weekText(view: ReviewView): [string, string] {
  return [formatDayMonth(view.week.from), formatDayMonth(view.week.to)];
}

export const reviewScreen: Screen = async ({ ctx }) => {
  const section = h('section', { class: 'screen review' });
  const view = await loadReviewView(ctx);
  const draft: Draft = { entries: new Map(), compact: new Map() };
  let busy = false;
  let error: string | undefined;
  let hintOpen = view.hint;
  let hintNote: string | undefined;
  const buildHabits = [...view.building.map((b) => b.habit), ...view.compact.filter((h) => h.kind === 'BUILD')];
  let hintTarget = buildHabits[0]?.id;

  const heading = () => h('h1', { tabindex: '-1' }, t.heading);

  function finalLinks(): HTMLElement {
    return h(
      'div',
      { class: 'actions' },
      h('a', { class: 'button primary', href: routeHref('heute') }, t.toToday),
    );
  }

  function notDueScreen(): void {
    const body: Node[] = [];
    if (view.state === 'OFF') {
      body.push(h('p', null, t.off), h('a', { class: 'button', href: routeHref('einstellungen') }, t.toSettings));
    } else {
      body.push(
        h('p', null, view.state === 'SKIPPED' ? t.skippedHeading : view.state === 'COMPLETED' ? t.savedHeading : t.none),
        view.state === 'NONE' ? h('p', { class: 'muted' }, t.noneHabits) : document.createTextNode(''),
        h('p', { class: 'muted' }, t.next(formatDayShort(view.nextDay))),
      );
    }
    section.replaceChildren(heading(), h('div', { class: 'card review-state', 'data-role': 'review-state' }, ...body), finalLinks());
  }

  function doneScreen(skipped: boolean, paused: readonly string[]): void {
    const byId = new Map(buildHabits.concat(view.compact).map((x) => [x.id, x]));
    const notes: Node[] = [];
    const links: Node[] = [];
    if (!skipped) {
      for (const id of paused) {
        const habit = byId.get(id);
        if (habit) notes.push(h('p', null, t.paused(habit.actionText)));
      }
      for (const entry of entriesOf(draft)) {
        const habit = byId.get(entry.habitId);
        if (!habit) continue;
        if (entry.decision === 'SMALLER')
          links.push(h('li', null, h('a', { href: routeHref('gewohnheit-bearbeiten', { id: habit.id, fokus: 'minimum' }) }, t.followUpSmaller(habit.actionText))));
        if (entry.decision === 'CHANGE_CUE')
          links.push(h('li', null, h('a', { href: routeHref('gewohnheit-bearbeiten', { id: habit.id, fokus: 'cue' }) }, t.followUpCue(habit.actionText))));
      }
      for (const [id, choice] of draft.compact) {
        const habit = byId.get(id);
        if (habit && choice === 'ADJUST')
          links.push(h('li', null, h('a', { href: routeHref('gewohnheit-bearbeiten', { id }) }, t.followUpAdjust(habit.actionText))));
      }
    }
    section.replaceChildren(
      heading(),
      h(
        'div',
        { class: 'card review-state', 'data-role': 'review-done' },
        h('p', null, h('strong', null, skipped ? t.skippedHeading : t.savedHeading)),
        ...notes,
        ...(links.length > 0 ? [h('p', null, t.followUpIntro), h('ul', { class: 'follow-ups' }, links)] : []),
        h('p', { class: 'muted' }, t.next(formatDayShort(view.nextDay))),
      ),
      finalLinks(),
    );
    section.querySelector<HTMLElement>('h1')?.focus();
  }

  async function submit(skip: boolean): Promise<void> {
    if (busy) return;
    busy = true;
    error = undefined;
    render();
    try {
      const result = skip ? await skipReview(ctx, view.week.weekStart) : await completeReview(ctx, view.week.weekStart, entriesOf(draft));
      busy = false;
      if (!result.ok) {
        error = t.notDue;
        render();
        section.querySelector<HTMLElement>('[data-role="review-error"]')?.focus();
        return;
      }
      doneScreen(skip, result.paused);
    } catch {
      busy = false;
      error = de.errors.saveFailed;
      render();
      section.querySelector<HTMLElement>('[data-role="review-error"]')?.focus();
    }
  }

  function textField(habitId: string, key: 'helpful' | 'difficult', label: string): HTMLElement {
    const id = uid('review-text');
    const area = h('textarea', {
      id,
      name: `${key}-${habitId}`,
      rows: 2,
      maxlength: appConfig.textLimits.long,
      oninput: (e) => (entryOf(draft, habitId)[key] = (e.target as HTMLTextAreaElement).value),
    });
    area.value = draft.entries.get(habitId)?.[key] ?? '';
    return h('div', { class: 'field' }, h('label', { for: id }, label), area);
  }

  function automaticityBlock(habit: Habit): HTMLElement {
    const stemId = uid('auto');
    const entry = entryOf(draft, habit.id);
    return h(
      'div',
      { class: 'review-automaticity', role: 'group', 'aria-labelledby': stemId, 'data-role': 'automaticity' },
      h('p', { class: 'evening-item__title', id: stemId }, t.automaticityStem(habit.actionText)),
      h('p', { class: 'hint' }, t.automaticityNote),
      t.automaticityItems.map((item, i) =>
        question(item, (id) =>
          toggleGroup({
            labelledBy: id,
            options: SCALE,
            get: () => entry.auto[i],
            set: (v) => (entry.auto[i] = v),
            clearable: true,
            className: 'rating',
            key: `auto-${i}`,
          }),
        ),
      ),
      h('p', { class: 'hint' }, t.automaticityScale),
    );
  }

  function suggestionsFor(b: ReviewHabit): string[] {
    const e = draft.entries.get(b.habit.id);
    return reviewSuggestions({
      habitId: b.habit.id,
      notTodayCount: b.notTodayCount,
      ...(e?.ease !== undefined ? { ease: e.ease } : {}),
      ...(e?.cueConsistency ? { cueConsistency: e.cueConsistency } : {}),
      enabled: view.preferences.suggestionsEnabled,
      snoozes: view.preferences.suggestionSnoozes,
      today: view.today,
    }).map((s) => t.suggestions[s.rule](s.value ?? 0));
  }

  function buildingCard(b: ReviewHabit): HTMLElement {
    const habit = b.habit;
    const entry = entryOf(draft, habit.id);
    const titleId = uid('review-habit');
    const suggestionBox = h('div', { class: 'review-suggestions', 'aria-live': 'polite', 'data-role': 'suggestions' });
    const updateSuggestions = () => {
      const texts = suggestionsFor(b);
      suggestionBox.replaceChildren(
        ...(texts.length > 0
          ? [h('p', { class: 'label' }, t.suggestionLabel), ...texts.map((s) => h('p', null, s)), h('p', { class: 'hint' }, t.suggestionNote)]
          : []),
      );
      suggestionBox.hidden = texts.length === 0;
    };
    updateSuggestions();
    return h(
      'article',
      { class: 'card review-habit', 'aria-labelledby': titleId, 'data-role': 'review-habit', 'data-habit': habit.id },
      h('h3', { id: titleId }, habit.actionText),
      textField(habit.id, 'helpful', t.helpful),
      textField(habit.id, 'difficult', t.difficult),
      question(
        t.ease,
        (id) =>
          toggleGroup({
            labelledBy: id,
            options: SCALE,
            get: () => entry.ease,
            set: (v) => {
              if (v === null) delete entry.ease;
              else entry.ease = v;
              updateSuggestions();
            },
            clearable: true,
            className: 'rating',
            key: 'ease',
          }),
        [h('p', { class: 'hint' }, t.easeScale)],
      ),
      question(t.cue, (id) =>
        toggleGroup({
          labelledBy: id,
          options: CUES.map((c) => ({ value: c, label: t.cueOptions[c] })),
          get: () => entry.cueConsistency,
          set: (v) => {
            if (v === null) delete entry.cueConsistency;
            else entry.cueConsistency = v;
            updateSuggestions();
          },
          clearable: true,
          key: 'cue',
        }),
      ),
      view.automaticity ? automaticityBlock(habit) : null,
      suggestionBox,
      question(t.decision, (id) =>
        toggleGroup({
          labelledBy: id,
          options: DECISIONS.map((d) => ({ value: d, label: t.decisions[d] })),
          get: () => entry.decision,
          set: (v) => {
            if (v === null) delete entry.decision;
            else entry.decision = v;
          },
          clearable: true,
          key: 'decision',
        }),
      ),
    );
  }

  function compactCard(): HTMLElement {
    const titleId = uid('review-compact');
    return h(
      'section',
      { class: 'card review-compact', 'aria-labelledby': titleId, 'data-role': 'review-compact' },
      h('h2', { id: titleId }, t.compactHeading),
      h(
        'ul',
        { class: 'review-compact__list' },
        view.compact.map((habit) => {
          const choice = draft.compact.get(habit.id);
          const labelId = uid('compact');
          const press = (value: CompactChoice) => {
            const current = draft.compact.get(habit.id);
            const pressed = value === 'KEEP' ? current === 'KEEP' : current !== undefined && current !== 'KEEP';
            if (pressed) draft.compact.delete(habit.id);
            else draft.compact.set(habit.id, value);
            render(`[data-habit="${habit.id}"] [data-choice="${value}"]`);
          };
          const adjusting = choice !== undefined && choice !== 'KEEP';
          return h(
            'li',
            { class: 'review-compact__item', 'data-habit': habit.id, 'data-role': 'compact-item' },
            h('p', { id: labelId }, habit.actionText),
            h(
              'div',
              { class: 'actions toggles', role: 'group', 'aria-labelledby': labelId },
              h(
                'button',
                { type: 'button', class: 'button toggle', 'aria-pressed': String(choice === 'KEEP'), 'data-choice': 'KEEP', onclick: () => press('KEEP') },
                t.compactFits,
              ),
              h(
                'button',
                { type: 'button', class: 'button toggle', 'aria-pressed': String(adjusting), 'data-choice': 'ADJUST', onclick: () => press('ADJUST') },
                t.compactAdjust,
              ),
            ),
            choice && choice !== 'KEEP' && choice !== 'ADJUST' ? h('p', { class: 'hint' }, t.compactChosen(t.decisions[choice])) : null,
            view.automaticity && habit.kind === 'BUILD' ? automaticityBlock(habit) : null,
          );
        }),
      ),
    );
  }

  /** Hinweis im Rückblick: erscheint immer, wenn die Bedingung in dieser Woche zutraf (Abschnitt 4.5). */
  function hintBlock(): HTMLElement {
    const titleId = uid('review-hint');
    const pick = (decision: Exclude<ReviewDecision, 'KEEP'>) => {
      const habit = buildHabits.find((x) => x.id === hintTarget);
      if (!habit) return;
      if (view.building.some((b) => b.habit.id === habit.id)) entryOf(draft, habit.id).decision = decision;
      else draft.compact.set(habit.id, decision);
      hintOpen = false;
      hintNote = t.hintPicked(habit.actionText, t.decisions[decision]);
      render(`[data-habit="${habit.id}"]`);
    };
    const picker =
      buildHabits.length > 1
        ? h(
            'fieldset',
            null,
            h('legend', null, de.hint.habitLabel),
            h(
              'div',
              { class: 'choices' },
              buildHabits.map((x) =>
                h(
                  'label',
                  { class: 'choice' },
                  h('input', { type: 'radio', name: 'review-hint-habit', value: x.id, checked: x.id === hintTarget, onchange: () => (hintTarget = x.id) }),
                  h('span', null, x.actionText),
                ),
              ),
            ),
          )
        : null;
    return h(
      'article',
      { class: 'card hint-card', 'aria-labelledby': titleId, 'data-role': 'review-hint' },
      h('p', { class: 'label', id: titleId }, de.hint.label),
      h('p', null, de.hint.text),
      h('p', null, de.hint.question),
      picker,
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'button primary',
            'data-choice': 'KEEP',
            onclick: () => {
              hintOpen = false;
              render('h1');
            },
          },
          de.hint.keep,
        ),
        buildHabits.length > 0
          ? [
              h('button', { type: 'button', class: 'button', 'data-choice': 'SMALLER', onclick: () => pick('SMALLER') }, de.hint.smaller),
              h('button', { type: 'button', class: 'button', 'data-choice': 'CHANGE_CUE', onclick: () => pick('CHANGE_CUE') }, de.hint.changeCue),
              h('button', { type: 'button', class: 'button', 'data-choice': 'PAUSE', onclick: () => pick('PAUSE') }, de.hint.pause),
            ]
          : null,
        h('a', { class: 'button', href: routeHref('abend') }, de.hint.exceptions),
      ),
    );
  }

  function render(focus?: string): void {
    const [from, to] = weekText(view);
    const nodes: (Node | null)[] = [
      heading(),
      h('p', { class: 'muted' }, t.intro(from, to)),
      hintOpen ? hintBlock() : null,
      hintNote ? h('p', { class: 'status-line', role: 'status' }, hintNote) : null,
    ];
    if (view.building.length > 0) {
      nodes.push(
        h(
          'section',
          { class: 'review-block', 'aria-labelledby': 'review-building' },
          h('h2', { id: 'review-building' }, t.buildingHeading),
          view.building.map(buildingCard),
        ),
      );
    }
    if (view.compact.length > 0) nodes.push(compactCard());
    nodes.push(
      h('p', { class: 'form-error', role: 'alert', tabindex: '-1', hidden: !error, 'data-role': 'review-error' }, error ?? ''),
      h(
        'div',
        { class: 'actions review-actions' },
        h('button', { type: 'button', class: 'button primary', disabled: busy, onclick: () => void submit(false) }, busy ? de.common.busy : t.finish),
        h('button', { type: 'button', class: 'button quiet', disabled: busy, onclick: () => void submit(true) }, t.skip),
      ),
    );
    section.replaceChildren(...nodes.filter((n): n is Node => n !== null));
    if (focus) section.querySelector<HTMLElement>(focus)?.focus();
  }

  if (view.state === 'DUE') render();
  else notDueScreen();
  return section;
};
