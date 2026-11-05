import type { Goal, Habit } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import { derive } from './derived';

export type HabitBadge = 'BUILDING' | 'INTEGRATED' | 'DRAFT' | 'PAUSED' | 'ARCHIVED';

export interface PlanHabit {
  habit: Habit;
  badge: HabitBadge;
}

export interface PlanView {
  goals: { goal: Goal; habits: PlanHabit[] }[];
}

export async function loadPlanView(ctx: AppContext): Promise<PlanView> {
  const data = await ctx.repo.loadLive();
  const derived = derive(data, today(ctx.clock));
  const badge = (h: Habit): HabitBadge =>
    h.status === 'ACTIVE' ? (derived.isIntegrated(h) ? 'INTEGRATED' : 'BUILDING') : h.status;

  return {
    goals: data.goals
      .filter((g) => g.status === 'ACTIVE')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((goal) => ({
        goal,
        habits: data.habits
          .filter((h) => h.goalId === goal.id && h.status !== 'ARCHIVED')
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((habit) => ({ habit, badge: badge(habit) })),
      })),
  };
}
