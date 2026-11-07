import { createCounterHabit, type CounterKind } from '../../app/counter-habits';
import { loadPlanView } from '../../app/plan';
import { de } from '../../i18n/de';
import { h, uid } from '../dom';
import { createEditForm } from '../edit-form';
import { checkAll, emptyHabitDraft, habitTextPart, weightPart } from '../habit-steps';
import { navigate, routeHref } from '../router';
import type { Screen } from '../screen';

const t = de.counterNew;

/**
 * Neues Gegen-Habit: die noch freien vordefinierten (je höchstens einmal) oder ein eigenes.
 * Gegen-Habits sind sofort aktiv und erscheinen nur im Abend-Check-in.
 */
export const counterNewScreen: Screen = async ({ ctx }) => {
  const view = await loadPlanView(ctx);
  const kinds: CounterKind[] = [...view.predefinedAvailable, 'COUNTER_CUSTOM'];
  let kind: CounterKind = kinds[0]!;
  const d = emptyHabitDraft();

  const form = createEditForm({
    heading: t.heading,
    cancelHref: routeHref('plan'),
    view: (host) => {
      const legendId = uid('counter-kind');
      const choices = kinds.map((k) => {
        const hint = k === 'COUNTER_CUSTOM' ? undefined : t.predefinedHint[k];
        const hintId = hint ? uid('counter-hint') : undefined;
        return h(
          'label',
          { class: 'choice' },
          h('input', {
            type: 'radio',
            name: 'counter-kind',
            value: k,
            checked: kind === k,
            'aria-describedby': hintId,
            onchange: () => {
              kind = k;
              host.render();
              host.root.querySelector<HTMLElement>(`input[name="counter-kind"][value="${k}"]`)?.focus();
            },
          }),
          h(
            'span',
            null,
            k === 'COUNTER_CUSTOM' ? t.custom : (t.predefined[k] ?? k),
            hint ? h('span', { class: 'hint choice__hint', id: hintId }, hint) : null,
          ),
        );
      });
      const text = kind === 'COUNTER_CUSTOM' ? habitTextPart(d, 'actionText', { label: t.customLabel, hint: t.customHint }) : undefined;
      const weight = weightPart(d);
      const parts = text ? [text, weight] : [weight];
      return {
        nodes: [
          h(
            'fieldset',
            { 'aria-labelledby': legendId },
            h('legend', { id: legendId }, t.which),
            h('div', { class: 'choices' }, choices),
          ),
          ...(text?.nodes ?? []),
          ...weight.nodes,
          view.counterHint ? h('p', { class: 'hint' }, de.plan.counterHint) : null,
        ],
        check: () => checkAll(parts),
      };
    },
    save: async () => {
      const result = await createCounterHabit(ctx, {
        kind,
        weight: d.weight,
        ...(kind === 'COUNTER_CUSTOM' ? { actionText: d.actionText } : {}),
      });
      if (result.ok) {
        navigate('plan', { replace: true, params: { gespeichert: result.habitId, meldung: 'gegen-habit' } });
      } else if ('error' in result) {
        // Inzwischen anderswo angelegt: Der Plan zeigt den aktuellen Stand.
        navigate('plan', { replace: true });
      } else {
        throw new Error('invalid'); // Die Prüfung im Formular hat dasselbe schon abgefangen.
      }
    },
  });

  form.render();
  return form.root;
};
