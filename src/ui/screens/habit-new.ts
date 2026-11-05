import { loadHabitWizardContext } from '../../app/plan';
import { createHabit } from '../../app/planning';
import { appConfig } from '../../domain/app-config';
import { de } from '../../i18n/de';
import { h } from '../dom';
import { cueStep, emptyHabitDraft, habitInputOf, habitTextStep, planStep } from '../habit-steps';
import { navigate, routeHref } from '../router';
import type { Screen } from '../screen';
import { createWizard } from '../wizard';

const t = de.onboarding;

/**
 * „+ Gewohnheit“ zu einem Ziel: Handlung, Auslöser und Rhythmus, Minimalversion, Plan.
 * Ist kein Platz im Aufbau frei, wird sie als Entwurf gespeichert; der Plan-Schritt sagt das vorher.
 */
export const habitNewScreen: Screen = async ({ ctx, params }) => {
  const info = await loadHabitWizardContext(ctx, params.get('ziel') ?? '');
  if (!info) {
    return h(
      'section',
      { class: 'screen' },
      h('h1', { tabindex: '-1' }, de.habitNew.goalMissing),
      h('a', { class: 'button', href: routeHref('plan') }, de.today.emptyLink),
    );
  }

  const habit = emptyHabitDraft();
  const context = de.habitNew.forGoal(info.goal.title);

  const wizard = createWizard({
    total: 4,
    cancelHref: routeHref('plan'),
    view: (w) => {
      switch (w.step) {
        case 1:
          return habitTextStep(w, habit, 'actionText', t.actionTitle, t.actionHint, context);
        case 2:
          return cueStep(w, habit);
        case 3:
          return habitTextStep(w, habit, 'minimumText', t.minimumTitle, t.minimumHint);
        default:
          return info.hasFreeSlot
            ? planStep(w, habit, { submitLabel: de.habitNew.finish })
            : planStep(w, habit, {
                submitLabel: de.habitNew.finishDraft,
                note: de.habitNew.draftNote(appConfig.maxBuildingHabits),
              });
      }
    },
    finish: (w) =>
      w.save(async () => {
        const result = await createHabit(ctx, { goalId: info.goal.id, habit: habitInputOf(habit) });
        if (result.ok) {
          navigate('plan', { replace: true, params: { gespeichert: result.habitId } });
          return;
        }
        if ('error' in result) {
          navigate('plan', { replace: true });
          return;
        }
        const e = result.errors;
        if (e.actionText) return 1;
        if (e.cue || e.schedule) return 2;
        if (e.minimumText) return 3;
        return 4;
      }),
  });

  wizard.render();
  return wizard.root;
};
