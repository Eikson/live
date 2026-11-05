import { loadGoal } from '../../app/plan';
import { updateGoal } from '../../app/planning';
import { appConfig } from '../../domain/app-config';
import { normalizeGoalInput } from '../../domain/planning';
import { de } from '../../i18n/de';
import { h } from '../dom';
import { createEditForm } from '../edit-form';
import { goalInputOf, type GoalDraft } from '../habit-steps';
import { navigate, routeHref } from '../router';
import type { Screen } from '../screen';
import { message, textField } from '../wizard';

const t = de.onboarding;

/** Ziel bearbeiten: Titel, Warum und Woran-ich-es-merke auf einem Bildschirm. */
export const goalEditScreen: Screen = async ({ ctx, params }) => {
  const goal = await loadGoal(ctx, params.get('id') ?? '');
  if (!goal) {
    return h(
      'section',
      { class: 'screen' },
      h('h1', { tabindex: '-1' }, de.goalEdit.missing),
      h('a', { class: 'button', href: routeHref('plan') }, de.today.emptyLink),
    );
  }

  const d: GoalDraft = { title: goal.title, why: goal.why ?? '', successSignal: goal.successSignal ?? '' };
  const fields: [keyof GoalDraft, string, number, boolean][] = [
    ['title', de.goalEdit.title, appConfig.textLimits.short, false],
    ['why', t.whyTitle, appConfig.textLimits.long, true],
    ['successSignal', t.successTitle, appConfig.textLimits.long, true],
  ];

  const form = createEditForm({
    heading: de.goalEdit.heading,
    cancelHref: routeHref('plan'),
    view: () => {
      const built = fields.map(([name, label, max, optional]) => ({
        name,
        max,
        f: textField({ label, value: d[name], max, name, optional, multiline: optional, onInput: (v) => (d[name] = v) }),
      }));
      return {
        nodes: built.map((b) => b.f.field),
        check: () => {
          const errors = normalizeGoalInput(goalInputOf(d)).errors;
          let first: HTMLElement | undefined;
          for (const { name, max, f } of built) {
            const msg = message(errors[name], max);
            f.showError(msg);
            if (msg) first ??= f.input;
          }
          return first;
        },
      };
    },
    save: async () => {
      const result = await updateGoal(ctx, goal.id, goalInputOf(d));
      if (result.ok) navigate('plan', { replace: true, params: { meldung: 'ziel' } });
      else if ('error' in result) navigate('plan', { replace: true });
      else throw new Error('invalid');
    },
  });

  form.render();
  return form.root;
};
