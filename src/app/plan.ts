import { appConfig } from '../domain/app-config';
import { needsCounterHint, type PredefinedCounterKind } from '../domain/evening';
import type { Goal, Habit } from '../domain/types';
import { today } from '../platform/clock';
import type { AppContext } from './context';
import { availablePredefined } from './counter-habits';
import { derive } from './derived';
import { taskListView, type TaskListView } from './tasks';

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
  /** Aktive Gegen-Habits (vordefinierte zuerst). */
  counters: PlanHabit[];
  /** Vordefinierte Gegen-Habits, die sich noch anlegen lassen. */
  predefinedAvailable: PredefinedCounterKind[];
  /** Mehr als 5 aktive Gegen-Habits. */
  counterHint: boolean;
  buildingCount: number;
  hasFreeSlot: boolean;
  /** Vorhaben: offene zuerst nach Dringlichkeit, dazu abgeschlossene. */
  tasks: TaskListView;
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
        ? habit.kind !== 'BUILD' || derived.buildingCount < appConfig.maxBuildingHabits || derived.isIntegrated(habit)
        : undefined;
    return { habit, badge, ...(goalTitle ? { goalTitle } : {}), ...(canResume !== undefined ? { canResume } : {}) };
  };
  const all = [...data.habits].sort(byCreated);
  const build = all.filter((h) => h.kind === 'BUILD');
  const counterRank = (h: Habit) => (h.kind === 'COUNTER_PROCRASTINATION' ? 0 : h.kind === 'COUNTER_AVOIDANCE' ? 1 : 2);
  const counters = all
    .filter((h) => h.kind !== 'BUILD' && h.status === 'ACTIVE')
    .sort((a, b) => counterRank(a) - counterRank(b) || byCreated(a, b));
  // Entwürfe, Pausiert und Archiviert sammeln normale Habits und Gegen-Habits.
  const withStatus = (status: Habit['status']) => all.filter((h) => h.status === status).map(item);

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
    counters: counters.map(item),
    predefinedAvailable: availablePredefined(data),
    counterHint: needsCounterHint(counters.length),
    buildingCount: derived.buildingCount,
    hasFreeSlot: derived.buildingCount < appConfig.maxBuildingHabits,
    tasks: taskListView(data.tasks, today(ctx.clock)),
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
