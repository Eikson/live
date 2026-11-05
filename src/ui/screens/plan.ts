import { loadPlanView, type PlanHabit, type PlanView } from '../../app/plan';
import { activateHabit } from '../../app/planning';
import { appConfig } from '../../domain/app-config';
import { formatCopingPlan, formatIntention } from '../../domain/planning';
import { de } from '../../i18n/de';
import { h, uid, type Child } from '../dom';
import { formatCue, formatSchedule } from '../format';
import { routeHref } from '../router';
import type { Screen } from '../screen';

type Status = { text: string; error?: boolean };

function habitItem(item: PlanHabit, opts: { showGoal?: boolean; open?: boolean; actions?: Child[] } = {}): HTMLElement {
  const { habit, badge } = item;
  const rows: [string, Child | Child[]][] = [];
  if (opts.showGoal && item.goalTitle) rows.push([de.plan.goalOf, item.goalTitle]);
  if (habit.cue) rows.push([de.plan.cue, formatCue(habit.cue)]);
  if (habit.intention) rows.push([de.plan.intention, formatIntention(habit.intention)]);
  if (habit.minimumText) rows.push([de.plan.minimum, habit.minimumText]);
  if (habit.copingPlans.length > 0) {
    rows.push([de.plan.coping, habit.copingPlans.map((p) => h('span', { class: 'fact-line' }, formatCopingPlan(p)))]);
  }
  rows.push([de.plan.rhythm, formatSchedule(habit.schedule)]);
  rows.push([de.plan.weightLabel, String(habit.weight)]);

  return h(
    'li',
    { 'data-habit': habit.id },
    h(
      'details',
      { class: 'habit-item', open: opts.open },
      h(
        'summary',
        null,
        h('span', { class: 'habit-item__title' }, habit.actionText),
        h('span', { class: 'habit-item__meta' }, `${de.plan.weight(habit.weight)} · ${de.plan.status[badge]}`),
      ),
      h(
        'dl',
        { class: 'facts' },
        rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, ...(Array.isArray(v) ? v : [v]))]),
      ),
      opts.actions?.length ? h('div', { class: 'actions item-actions' }, opts.actions) : null,
    ),
  );
}

export const planScreen: Screen = async ({ ctx, params }) => {
  const section = h('section', { class: 'screen' });
  const saved = params.get('gespeichert');
  let status: Status | undefined;
  if (saved) {
    // Die Meldung gilt nur für diesen Aufruf; die Adresse wird ohne Parameter ersetzt.
    history.replaceState(null, '', routeHref('plan'));
  }

  async function fill(focusStatus: boolean): Promise<void> {
    const view = await loadPlanView(ctx);
    if (saved && !status) {
      const draft = view.drafts.some((d) => d.habit.id === saved);
      status = { text: draft ? de.plan.savedDraft : de.plan.savedActive };
    }
    section.replaceChildren(...build(view, saved, status, onActivate));
    if (focusStatus) section.querySelector<HTMLElement>('[data-role="plan-status"]')?.focus();
  }

  async function onActivate(habitId: string): Promise<void> {
    try {
      const result = await activateHabit(ctx, habitId);
      status = result.ok
        ? { text: de.plan.activated }
        : result.reason === 'BUILD_LIMIT_REACHED'
          ? { text: de.plan.activateBlocked(appConfig.maxBuildingHabits), error: true }
          : { text: de.errors.saveFailed, error: true };
    } catch {
      status = { text: de.errors.saveFailed, error: true };
    }
    await fill(true);
  }

  await fill(false);
  return section;
};

function build(
  view: PlanView,
  highlight: string | null,
  status: Status | undefined,
  onActivate: (habitId: string) => Promise<void>,
): Node[] {
  const nodes: Node[] = [
    h('h1', { tabindex: '-1' }, de.plan.heading),
    h(
      'p',
      {
        class: status?.error ? 'form-error' : 'status-line',
        role: 'status',
        tabindex: '-1',
        'data-role': 'plan-status',
      },
      status?.text ?? '',
    ),
  ];

  if (view.goals.length === 0) nodes.push(h('p', { class: 'muted' }, de.plan.empty));

  for (const { goal, habits } of view.goals) {
    const meta = [
      goal.why ? `${de.plan.why}: ${goal.why}` : undefined,
      goal.successSignal ? `${de.plan.successSignal}: ${goal.successSignal}` : undefined,
    ].filter((x): x is string => Boolean(x));
    nodes.push(
      h(
        'article',
        { class: 'card goal', 'data-goal': goal.id },
        h('h2', null, de.plan.goal(goal.title)),
        meta.map((m) => h('p', { class: 'muted' }, m)),
        habits.length > 0
          ? h('ul', { class: 'habit-list' }, habits.map((item) => habitItem(item, { open: item.habit.id === highlight })))
          : h('p', { class: 'muted' }, de.plan.noHabits),
        h(
          'a',
          {
            class: 'button quiet add-link',
            href: routeHref('gewohnheit-neu', { ziel: goal.id }),
            'aria-label': de.plan.addHabitFor(goal.title),
          },
          de.plan.addHabit,
        ),
      ),
    );
  }

  const blockedId = uid('activate-blocked');
  const draftActions = (item: PlanHabit): Child[] => {
    if (!view.hasFreeSlot) {
      return [h('p', { class: 'hint', id: blockedId }, de.plan.activateBlocked(appConfig.maxBuildingHabits))];
    }
    const button = h(
      'button',
      {
        type: 'button',
        class: 'button',
        onclick: () => {
          button.disabled = true;
          button.textContent = de.common.busy;
          void onActivate(item.habit.id);
        },
      },
      de.plan.activate,
    );
    return [button];
  };

  const groups: [string, string, PlanHabit[], ((item: PlanHabit) => Child[]) | undefined][] = [
    ['drafts', de.plan.drafts, view.drafts, draftActions],
    ['paused', de.plan.paused, view.paused, undefined],
    ['archived', de.plan.archived, view.archived, undefined],
  ];
  nodes.push(
    h(
      'div',
      { class: 'plan-groups' },
      groups.map(([key, label, items, actions]) =>
        h(
          'details',
          { class: 'card plan-group', 'data-group': key, open: items.some((i) => i.habit.id === highlight) },
          h('summary', null, `${label} (${items.length})`),
          items.length > 0
            ? h(
                'ul',
                { class: 'habit-list' },
                items.map((item) =>
                  habitItem(item, { showGoal: true, open: item.habit.id === highlight, actions: actions?.(item) }),
                ),
              )
            : h('p', { class: 'muted' }, de.plan.groupEmpty),
        ),
      ),
    ),
    h('a', { class: 'button', href: routeHref('ziel-neu'), 'aria-label': de.plan.addGoalLabel }, de.plan.addGoal),
  );
  return nodes;
}
