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
import { createWizard, type Wizard } from '../wizard';

const t = de.onboarding;

export const onboardingScreen: Screen = async ({ ctx, onboardingDone }) => {
  const goal = emptyGoalDraft();
  const habit = emptyHabitDraft();
  /** Die beiden vordefinierten Gegen-Habits gleich mit anlegen (letzter Schritt, freiwillig). */
  let counters = false;

  const wizard = createWizard({
    total: 9,
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
        case 8:
          return planStep(w, habit, { submitLabel: de.common.next });
        default:
          return w.frame(
            t.countersTitle,
            [
              h('p', null, t.countersBody),
              h('p', { class: 'hint' }, t.countersHint),
              h(
                'div',
                { class: 'actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'button quiet',
                    'data-role': 'counters-later',
                    onclick: () => {
                      counters = false;
                      void finish(w);
                    },
                  },
                  t.countersLater,
                ),
              ),
            ],
            () => {
              counters = true;
              return undefined;
            },
            t.countersSetup,
          );
      }
    },
    finish: (w) => finish(w),
  });

  function finish(w: Wizard): Promise<void> {
    return w.save(async () => {
      const result = await completeOnboarding(ctx, { goal: goalInputOf(goal), habit: habitInputOf(habit), counters });
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
    });
  }

  wizard.render();
  return wizard.root;
};
