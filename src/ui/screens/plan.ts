import { loadPlanView, type PlanHabit } from '../../app/plan';
import { formatIntention } from '../../domain/planning';
import { de } from '../../i18n/de';
import { h } from '../dom';
import { formatCue } from '../format';
import type { Screen } from '../screen';

function habitItem({ habit, badge }: PlanHabit): HTMLElement {
  const rows: [string, string | undefined][] = [
    [de.plan.cue, habit.cue ? formatCue(habit.cue) : undefined],
    [de.plan.intention, habit.intention ? formatIntention(habit.intention) : undefined],
    [de.plan.minimum, habit.minimumText],
    [de.plan.rhythm, habit.schedule.type === 'DAILY' ? de.plan.daily : undefined],
  ];
  return h(
    'li',
    null,
    h(
      'details',
      { class: 'habit-item' },
      h(
        'summary',
        null,
        h('span', { class: 'habit-item__title' }, habit.actionText),
        h('span', { class: 'habit-item__meta' }, `${de.plan.weight(habit.weight)} · ${de.plan.status[badge]}`),
      ),
      h(
        'dl',
        { class: 'facts' },
        rows.filter(([, v]) => v).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v ?? '')]),
      ),
    ),
  );
}

export const planScreen: Screen = async ({ ctx }) => {
  const view = await loadPlanView(ctx);
  const section = h('section', { class: 'screen' }, h('h1', { tabindex: '-1' }, de.plan.heading));

  if (view.goals.length === 0) section.append(h('p', { class: 'muted' }, de.plan.empty));

  for (const { goal, habits } of view.goals) {
    const meta = [
      goal.why ? `${de.plan.why}: ${goal.why}` : undefined,
      goal.successSignal ? `${de.plan.successSignal}: ${goal.successSignal}` : undefined,
    ].filter((x): x is string => Boolean(x));
    section.append(
      h(
        'article',
        { class: 'card goal' },
        h('h2', null, de.plan.goal(goal.title)),
        meta.map((m) => h('p', { class: 'muted' }, m)),
        h('ul', { class: 'habit-list' }, habits.map(habitItem)),
      ),
    );
  }
  section.append(h('p', { class: 'muted small' }, de.plan.laterNote));
  return section;
};
