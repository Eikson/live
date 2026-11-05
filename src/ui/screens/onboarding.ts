import { completeOnboarding } from '../../app/onboarding';
import { de } from '../../i18n/de';
import { h } from '../dom';
import {
  cueStep,
  emptyGoalDraft,
  emptyHabitDraft,
  goalInputOf,
  goalTextStep,
  habitInputOf,
  habitTextStep,
  planStep,
} from '../habit-steps';
import type { Screen } from '../screen';
import { createWizard } from '../wizard';

const t = de.onboarding;

export const onboardingScreen: Screen = async ({ ctx, onboardingDone }) => {
  const goal = emptyGoalDraft();
  const habit = emptyHabitDraft();

  const wizard = createWizard({
    total: 8,
    view: (w) => {
      switch (w.step) {
        case 1:
          return w.frame(t.welcome, [h('p', { class: 'muted' }, t.welcomeIntro)], () => undefined, t.start);
        case 2:
          return goalTextStep(w, goal, 'title', t.goalTitle, { hint: t.goalHint });
        case 3:
          return goalTextStep(w, goal, 'why', t.whyTitle, { optional: true, hint: t.optionalHint });
        case 4:
          return goalTextStep(w, goal, 'successSignal', t.successTitle, { optional: true, hint: t.optionalHint });
        case 5:
          return habitTextStep(w, habit, 'actionText', t.actionTitle, t.actionHint);
        case 6:
          return cueStep(w, habit);
        case 7:
          return habitTextStep(w, habit, 'minimumText', t.minimumTitle, t.minimumHint);
        default:
          return planStep(w, habit, { submitLabel: t.finish });
      }
    },
    finish: (w) =>
      w.save(async () => {
        const result = await completeOnboarding(ctx, { goal: goalInputOf(goal), habit: habitInputOf(habit) });
        if (result.ok) {
          onboardingDone();
          return;
        }
        // Sollte durch die Prüfung je Schritt nicht vorkommen; zurück zum ersten betroffenen Schritt.
        const g = result.goalErrors;
        const e = result.habitErrors;
        if (g.title) return 2;
        if (g.why) return 3;
        if (g.successSignal) return 4;
        if (e.actionText) return 5;
        if (e.cue || e.schedule) return 6;
        if (e.minimumText) return 7;
        return 8;
      }),
  });

  wizard.render();
  return wizard.root;
};
