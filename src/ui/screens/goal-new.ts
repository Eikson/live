import { createGoal } from '../../app/planning';
import { de } from '../../i18n/de';
import { emptyGoalDraft, goalInputOf, goalTextStep } from '../habit-steps';
import { navigate, routeHref } from '../router';
import type { Screen } from '../screen';
import { createWizard } from '../wizard';

const t = de.onboarding;

/** „+ Ziel“: Titel, Warum, Erfolgszeichen. Danach geht es direkt zur ersten Gewohnheit. */
export const goalNewScreen: Screen = async ({ ctx }) => {
  const goal = emptyGoalDraft();
  const context = de.goalNew.heading;

  const wizard = createWizard({
    total: 3,
    cancelHref: routeHref('plan'),
    view: (w) => {
      switch (w.step) {
        case 1:
          return goalTextStep(w, goal, 'title', t.goalTitle, { hint: t.goalHint, context });
        case 2:
          return goalTextStep(w, goal, 'why', t.whyTitle, { optional: true, hint: t.optionalHint, context });
        default:
          return goalTextStep(
            w,
            goal,
            'successSignal',
            t.successTitle,
            { optional: true, hint: t.optionalHint, context },
            de.goalNew.finish,
          );
      }
    },
    finish: (w) =>
      w.save(async () => {
        const result = await createGoal(ctx, goalInputOf(goal));
        if (!result.ok) return result.errors.title ? 1 : result.errors.why ? 2 : 3;
        navigate('gewohnheit-neu', { replace: true, params: { ziel: result.goalId } });
      }),
  });

  wizard.render();
  return wizard.root;
};
