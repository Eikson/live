import { appConfig } from '../domain/app-config';
import type { Goal, Habit } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import { derive } from './derived';

export type HabitBadge = 'BUILDING' | 'INTEGRATED' | 'DRAFT' | 'PAUSED' | 'ARCHIVED';

export interface PlanHabit {
  habit: Habit;
  badge: HabitBadge;
  /** Titel des Ziels, für Listen außerhalb der Zielgruppe (Entwürfe, Pausiert, Archiviert). */
  goalTitle?: string;
  /** Nur bei pausierten Habits: Fortsetzen ist möglich (Platz frei oder bereits integriert). */
  canResume?: boolean;
}

export interface PlanView {
  /** Aktive Ziele mit ihren laufenden Habits. */
  goals: { goal: Goal; habits: PlanHabit[] }[];
  drafts: PlanHabit[];
  paused: PlanHabit[];
  archived: PlanHabit[];
  buildingCount: number;
  hasFreeSlot: boolean;
}

const byCreated = (a: { createdAt: string }, b: { createdAt: string }) => a.createdAt.localeCompare(b.createdAt);

export async function loadPlanView(ctx: AppContext): Promise<PlanView> {
  const data = await ctx.repo.loadLive();
  const derived = derive(data, today(ctx.clock));
  const goalTitles = new Map(data.goals.map((g) => [g.id, g.title]));
  const item = (habit: Habit): PlanHabit => {
    const badge: HabitBadge =
      habit.status === 'ACTIVE' ? (derived.isIntegrated(habit) ? 'INTEGRATED' : 'BUILDING') : habit.status;
    const goalTitle = habit.goalId ? goalTitles.get(habit.goalId) : undefined;
    const canResume =
      habit.status === 'PAUSED'
        ? derived.buildingCount < appConfig.maxBuildingHabits || derived.isIntegrated(habit)
        : undefined;
    return { habit, badge, ...(goalTitle ? { goalTitle } : {}), ...(canResume !== undefined ? { canResume } : {}) };
  };
  const build = data.habits.filter((h) => h.kind === 'BUILD').sort(byCreated);
  const withStatus = (status: Habit['status']) => build.filter((h) => h.status === status).map(item);

  return {
    goals: data.goals
      .filter((g) => g.status === 'ACTIVE')
      .sort(byCreated)
      .map((goal) => ({
        goal,
        habits: build.filter((h) => h.goalId === goal.id && h.status === 'ACTIVE').map(item),
      })),
    drafts: withStatus('DRAFT'),
    paused: withStatus('PAUSED'),
    archived: withStatus('ARCHIVED'),
    buildingCount: derived.buildingCount,
    hasFreeSlot: derived.buildingCount < appConfig.maxBuildingHabits,
  };
}

export interface HabitWizardContext {
  goal: Goal;
  /** Ist kein Platz frei, wird das neue Habit als Entwurf gespeichert. */
  hasFreeSlot: boolean;
}

/** Was der Assistent für „+ Gewohnheit“ vorab braucht. */
export async function loadHabitWizardContext(ctx: AppContext, goalId: string): Promise<HabitWizardContext | undefined> {
  const data = await ctx.repo.loadLive();
  const goal = data.goals.find((g) => g.id === goalId && g.status === 'ACTIVE');
  if (!goal) return undefined;
  const { buildingCount } = derive(data, today(ctx.clock));
  return { goal, hasFreeSlot: buildingCount < appConfig.maxBuildingHabits };
}

/** Ein Ziel zum Bearbeiten. */
export async function loadGoal(ctx: AppContext, goalId: string): Promise<Goal | undefined> {
  const data = await ctx.repo.loadLive();
  return data.goals.find((g) => g.id === goalId);
}

/** Ein Habit zum Bearbeiten; archivierte Habits lassen sich nicht mehr bearbeiten. */
export async function loadEditableHabit(ctx: AppContext, habitId: string): Promise<PlanHabit | undefined> {
  const data = await ctx.repo.loadLive();
  const habit = data.habits.find((h) => h.id === habitId && h.status !== 'ARCHIVED');
  if (!habit) return undefined;
  const goalTitle = data.goals.find((g) => g.id === habit.goalId)?.title;
  const badge: HabitBadge = habit.status === 'ACTIVE' ? 'BUILDING' : habit.status;
  return { habit, badge, ...(goalTitle ? { goalTitle } : {}) };
}
