import { loadEditableHabit } from '../../app/plan';
import { updateHabit } from '../../app/planning';
import { de } from '../../i18n/de';
import { h, uid } from '../dom';
import { createEditForm } from '../edit-form';
import {
  checkAll,
  copingPart,
  cuePart,
  habitDraftOf,
  habitInputOf,
  habitTextPart,
  intentionPart,
  weightPart,
} from '../habit-steps';
import { navigate, routeHref } from '../router';
import type { Screen } from '../screen';

const t = de.onboarding;

/** Felder, die `fokus` ansteuern kann (z. B. vom Wiedereinstieg aus). */
const FOCUS_SELECTOR: Record<string, string> = {
  minimum: 'input[name="minimumText"]',
  cue: 'input[name="cueType"]:checked',
};

/**
 * Gewohnheit bearbeiten: kompaktes Formular. Der vorherige Stand landet im Änderungsprotokoll,
 * Rhythmus und Gewicht gelten ab heute.
 */
export const habitEditScreen: Screen = async ({ ctx, params }) => {
  const item = await loadEditableHabit(ctx, params.get('id') ?? '');
  if (!item) {
    return h(
      'section',
      { class: 'screen' },
      h('h1', { tabindex: '-1' }, de.habitEdit.missing),
      h('a', { class: 'button', href: routeHref('plan') }, de.today.emptyLink),
    );
  }

  const { habit } = item;
  const d = habitDraftOf(habit);
  const focus = params.get('fokus') ?? '';

  const form = createEditForm({
    heading: de.habitEdit.heading,
    cancelHref: routeHref('plan'),
    view: (host) => {
      const action = habitTextPart(d, 'actionText', { label: t.actionTitle, hint: t.actionHint });
      const cue = cuePart(host, d);
      const intention = intentionPart(host, d);
      const minimum = habitTextPart(d, 'minimumText', { label: t.minimumTitle, hint: t.minimumHint });
      const coping = copingPart(host, d);
      const weight = weightPart(d);
      const cueTitleId = uid('cue-title');
      const intentionTitleId = uid('intention-title');
      return {
        nodes: [
          item.goalTitle ? h('p', { class: 'muted' }, de.habitEdit.forGoal(item.goalTitle)) : null,
          focus === 'minimum' ? h('p', { class: 'card notice' }, de.habitEdit.smaller) : null,
          ...action.nodes,
          h('section', { 'aria-labelledby': cueTitleId }, h('h2', { id: cueTitleId }, t.cueTitle), ...cue.nodes),
          h(
            'section',
            { 'aria-labelledby': intentionTitleId },
            h('h2', { id: intentionTitleId }, de.habitEdit.intentionTitle, h('span', { class: 'muted' }, ` (${de.common.optional})`)),
            h('p', { class: 'hint' }, de.habitEdit.intentionHint),
            ...intention.nodes,
          ),
          ...minimum.nodes,
          ...coping.nodes,
          ...weight.nodes,
          h('p', { class: 'hint', 'data-role': 'edit-note' }, de.habitEdit.fromToday),
        ],
        check: () => checkAll([action, cue, intention, minimum, coping, weight]),
      };
    },
    save: async () => {
      const result = await updateHabit(ctx, habit.id, habitInputOf(d));
      if (result.ok) {
        navigate('plan', { replace: true, params: { gespeichert: habit.id, meldung: result.changed ? 'bearbeitet' : 'unveraendert' } });
      } else if ('error' in result) {
        navigate('plan', { replace: true });
      } else {
        throw new Error('invalid'); // Die Prüfung im Formular hat dasselbe schon abgefangen.
      }
    },
  });

  form.render();
  const selector = FOCUS_SELECTOR[focus];
  if (selector) {
    // Nach dem Fokus auf die Überschrift durch den Rahmen.
    window.setTimeout(() => form.root.querySelector<HTMLElement>(selector)?.focus(), 0);
  }
  return form.root;
};
