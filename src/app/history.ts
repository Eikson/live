import { addDays, dateRange, maxDate, minDate, startOfWeek, type LocalDate } from '../domain/local-date';
import { compareWindow, windowMean, type Comparison, type DailyValue } from '../domain/scoring/comparison';
import { isSufficient, windowAverage, type WindowAverage } from '../domain/scoring/corridor';
import { scoreValue } from '../domain/scoring/fulfillment';
import type { CheckIn, CueConsistency, Habit, HabitEvent, HabitKind, Task, WeeklyReview } from '../domain/types';
import { today as clockToday } from '../platform/clock';
import type { AppContext } from './context';
import { derive, type Derived } from './derived';
import { reviewValuesOf } from './review';
import { scoringContext } from './scoring';
import { automaticityMean } from '../domain/review';
import { taskMetrics, weekProof, type TaskMetrics } from '../domain/task';

/** Zeitraum der Diagramme: die letzten 12 Wochen. */
export const CHART_DAYS = 84;

export interface ChartDay {
  date: LocalDate;
  /** Tagesscore, nur an bewertbaren Tagen */
  score?: number;
  /** Ø28 mit Boden und Decke, sobald das Fenster mindestens 14 bewertbare Tage hat */
  avg?: { score: number; floor: number; ceiling: number };
}

export type MarkerKind = 'EXCEPTION' | 'REENTRY' | 'PLAN' | 'ARCHIVED';

export interface ChartMarker {
  date: LocalDate;
  kind: MarkerKind;
}

export interface WeekRow {
  /** Montag der Woche */
  from: LocalDate;
  /** Sonntag oder heute */
  to: LocalDate;
  /** Tage mit Wert in dieser Woche (bewertbare Tage bzw. Tage mit Befinden) */
  days: number;
  /** Ø28 am Ende der Woche; fehlt, solange das Fenster zu wenig Tage hat */
  avg?: { value: number; floor?: number; ceiling?: number };
}

export interface LevelView {
  current: WindowAverage;
  sufficient: boolean;
  comparison: Comparison;
  chart: ChartDay[];
  markers: ChartMarker[];
  weeks: WeekRow[];
}

export interface WellbeingDay {
  date: LocalDate;
  value?: number;
  avg?: number;
}

export interface WellbeingView {
  current: { days: number; mean: number; sufficient: boolean };
  comparison: Comparison;
  chart: WellbeingDay[];
  weeks: WeekRow[];
  /** Es gibt überhaupt Angaben zum Befinden */
  any: boolean;
}

/**
 * Kalender-Markierung. Gegen-Habits nutzen dieselben Symbole:
 * DONE = eingehalten, MINIMAL = teilweise, NOT_DONE = nicht eingehalten.
 */
export type CalendarMark =
  | 'DONE'
  | 'MINIMAL'
  | 'ALTERNATIVE'
  | 'NOT_DONE'
  | 'NO_ENTRY'
  | 'NOT_PLANNED'
  | 'EXCEPTION'
  | 'EXTRA'
  | 'OPEN';

export interface CalendarCounts {
  /** Geplante Tage bis heute ohne Ausnahmetage (heute nur mit Angabe) */
  planned: number;
  done: number;
  minimal: number;
  alternative: number;
  notDone: number;
  noEntry: number;
  /** „Trotzdem gemacht“ an nicht geplanten Tagen */
  extra: number;
  exception: number;
}

export interface CalendarHabit {
  habit: Habit;
  status: 'INTEGRATED' | 'BUILDING' | 'PAUSED';
  integratedSince?: LocalDate;
  marks: CalendarMark[];
  counts: CalendarCounts;
  /** Eigene Angaben aus abgeschlossenen Wochenrückblicken mit Wochenbeginn in diesem Monat */
  reviews: CalendarReview[];
}

export interface CalendarReview {
  weekStart: LocalDate;
  ease?: number;
  cueConsistency?: CueConsistency;
  /** Mittelwert der vier Automatik-Aussagen: deine Einschätzung, kein Messwert */
  automaticity?: number;
}

export type HistoryEventKind =
  | 'ACTIVATED'
  | 'REENTERED'
  | 'SMALLER'
  | 'ACTION_EDITED'
  | 'SCHEDULE_CHANGED'
  | 'WEIGHT_CHANGED'
  | 'PAUSED'
  | 'RESUMED'
  | 'ARCHIVED';

export interface HistoryEvent {
  date: LocalDate;
  kind: HistoryEventKind;
  habit: Habit;
}

export interface MonthView {
  /** YYYY-MM */
  month: string;
  days: LocalDate[];
  prev?: string;
  next?: string;
  habits: CalendarHabit[];
  exceptionDays: LocalDate[];
  events: HistoryEvent[];
}

export interface HistoryView {
  today: LocalDate;
  /** Es gibt mindestens ein aktiviertes Habit */
  hasHabits: boolean;
  level: LevelView;
  wellbeing: WellbeingView;
  month: MonthView;
  tasks: TaskHistoryView;
}

/** Kennzahlen der Vorhaben; getrennt vom Niveau und nie gespeichert. */
export interface TaskHistoryView {
  /** Es gibt mindestens ein Vorhaben, das nicht verworfen wurde. */
  hasTasks: boolean;
  metrics: TaskMetrics;
  /** Beleg für die laufende Woche (Montag bis heute) */
  week?: { started: number; onTime: number };
}

const PLAN_EVENTS: ReadonlySet<HabitEvent['type']> = new Set([
  'ACTIVATED',
  'EDITED',
  'SCHEDULE_CHANGED',
  'WEIGHT_CHANGED',
  'PAUSED',
  'RESUMED',
]);

/** Ältester Monat, der im Kalender erreichbar ist: der Monat der ersten Aktivierung. */
function firstActivation(habits: readonly Habit[]): LocalDate | undefined {
  let first: LocalDate | undefined;
  for (const h of habits) if (h.activatedOn && (!first || h.activatedOn < first)) first = h.activatedOn;
  return first;
}

function chartStart(today: LocalDate, first: LocalDate | undefined): LocalDate {
  const full = addDays(today, -(CHART_DAYS - 1));
  if (!first || first <= full) return full;
  // Mindestens zwei Wochen zeigen, damit das Diagramm lesbar bleibt.
  return minDate(first, addDays(today, -13));
}

function weekRows(from: LocalDate, today: LocalDate, row: (from: LocalDate, to: LocalDate) => WeekRow): WeekRow[] {
  const rows: WeekRow[] = [];
  for (let w = startOfWeek(from); w <= today; w = addDays(w, 7)) {
    rows.push(row(maxDate(w, from), minDate(addDays(w, 6), today)));
  }
  return rows.reverse();
}

function levelView(ctx: ReturnType<typeof scoringContext>, compareCtx: ReturnType<typeof scoringContext>, today: LocalDate, first: LocalDate | undefined, markers: ChartMarker[]): LevelView {
  const { scoreOf } = ctx;
  const current = windowAverage(scoreOf, today);
  const comparable: DailyValue = (d) => {
    const s = compareCtx.scoreOf(d);
    return s.evaluable ? s.score : undefined;
  };
  const from = chartStart(today, first);
  const avgOn = (d: LocalDate) => {
    const w = windowAverage(scoreOf, d);
    return isSufficient(w) ? { score: w.score, floor: w.floor, ceiling: w.ceiling } : undefined;
  };
  const chart = dateRange(from, today).map((date): ChartDay => {
    const s = scoreOf(date);
    const avg = avgOn(date);
    return { date, ...(s.evaluable ? { score: s.score } : {}), ...(avg ? { avg } : {}) };
  });
  const weeks = weekRows(from, today, (wFrom, wTo) => {
    const days = dateRange(wFrom, wTo).filter((d) => scoreOf(d).evaluable).length;
    const avg = avgOn(wTo);
    return {
      from: wFrom,
      to: wTo,
      days,
      ...(avg ? { avg: { value: avg.score, floor: avg.floor, ceiling: avg.ceiling } } : {}),
    };
  });
  return {
    current,
    sufficient: isSufficient(current),
    comparison: compareWindow(comparable, today, first),
    chart,
    markers: markers.filter((m) => m.date >= from && m.date <= today),
    weeks,
  };
}

function wellbeingView(wellbeingOn: DailyValue, records: { localDate: LocalDate }[], today: LocalDate): WellbeingView {
  let first: LocalDate | undefined;
  for (const r of records) if (wellbeingOn(r.localDate) !== undefined && (!first || r.localDate < first)) first = r.localDate;
  const current = windowMean(wellbeingOn, today);
  const from = chartStart(today, first);
  const avgOn = (d: LocalDate) => {
    const w = windowMean(wellbeingOn, d);
    return w.sufficient ? w.mean : undefined;
  };
  const chart = dateRange(from, today).map((date): WellbeingDay => {
    const value = wellbeingOn(date);
    const avg = avgOn(date);
    return { date, ...(value !== undefined ? { value } : {}), ...(avg !== undefined ? { avg } : {}) };
  });
  const weeks = weekRows(from, today, (wFrom, wTo) => {
    const avg = avgOn(wTo);
    return {
      from: wFrom,
      to: wTo,
      days: dateRange(wFrom, wTo).filter((d) => wellbeingOn(d) !== undefined).length,
      ...(avg !== undefined ? { avg: { value: avg } } : {}),
    };
  });
  return {
    current: { days: current.days, mean: current.mean, sufficient: current.sufficient },
    comparison: compareWindow(wellbeingOn, today, first),
    chart,
    weeks,
    any: first !== undefined,
  };
}

/** Markierung eines Tages im Kalender. Gegen-Habits über ihren Erfüllungswert. */
function markOf(kind: HabitKind, checkIn: CheckIn | undefined): CalendarMark | undefined {
  if (!checkIn) return undefined;
  if (kind === 'BUILD') {
    if (checkIn.outcome === 'DONE') return checkIn.minimal ? 'MINIMAL' : 'DONE';
    if (checkIn.outcome === 'ALTERNATIVE') return 'ALTERNATIVE';
    if (checkIn.outcome === 'NOT_DONE') return 'NOT_DONE';
    return undefined;
  }
  const v = scoreValue(kind, checkIn);
  if (v === undefined) return undefined;
  return v >= 1 ? 'DONE' : v > 0 ? 'MINIMAL' : 'NOT_DONE';
}

function calendarHabit(habit: Habit, derived: Derived, days: LocalDate[], today: LocalDate): Omit<CalendarHabit, 'reviews'> {
  const timeline = derived.timeline(habit);
  const checkIns = derived.checkInsOf(habit.id);
  const counts: CalendarCounts = { planned: 0, done: 0, minimal: 0, alternative: 0, notDone: 0, noEntry: 0, extra: 0, exception: 0 };
  const marks = days.map((d): CalendarMark => {
    if (d > today || !timeline.isActiveOn(d)) return 'NOT_PLANNED';
    const checkIn = checkIns.get(d);
    if (!timeline.isPlannedOn(d)) {
      const extra = markOf(habit.kind, checkIn);
      if (extra && extra !== 'NOT_DONE') {
        counts.extra++;
        return 'EXTRA';
      }
      return 'NOT_PLANNED';
    }
    if (derived.exceptionDays.has(d)) {
      counts.exception++;
      return 'EXCEPTION';
    }
    const mark = markOf(habit.kind, checkIn);
    if (!mark) {
      // Heute ist erst offen, nicht „kein Eintrag“.
      if (d === today) return 'OPEN';
      counts.planned++;
      counts.noEntry++;
      return 'NO_ENTRY';
    }
    counts.planned++;
    if (mark === 'DONE') counts.done++;
    else if (mark === 'MINIMAL') counts.minimal++;
    else if (mark === 'ALTERNATIVE') counts.alternative++;
    else counts.notDone++;
    return mark;
  });
  const integration = derived.integration(habit);
  const status = habit.status === 'PAUSED' ? 'PAUSED' : integration.integrated ? 'INTEGRATED' : 'BUILDING';
  return {
    habit,
    status,
    ...(status === 'INTEGRATED' && integration.integratedSince ? { integratedSince: integration.integratedSince } : {}),
    marks,
    counts,
  };
}

function calendarReviews(reviews: readonly WeeklyReview[], habitId: string, from: LocalDate, to: LocalDate): CalendarReview[] {
  return reviewValuesOf(reviews, habitId, from, to).map(({ weekStart, entry }) => ({
    weekStart,
    ...(entry.ease !== undefined ? { ease: entry.ease } : {}),
    ...(entry.cueConsistency ? { cueConsistency: entry.cueConsistency } : {}),
    ...(entry.automaticity ? { automaticity: automaticityMean(entry.automaticity) } : {}),
  }));
}

function changedFields(e: HabitEvent): string[] {
  const after = e.after;
  return after && typeof after === 'object' ? Object.keys(after) : [];
}

function historyEvents(habits: readonly Habit[], events: readonly HabitEvent[], from: LocalDate, to: LocalDate): HistoryEvent[] {
  const byId = new Map(habits.map((h) => [h.id, h]));
  const out: HistoryEvent[] = [];
  const smallerChosen = new Set(
    events.filter((e) => e.type === 'REENTERED' && e.after === 'SMALLER').map((e) => `${e.habitId}|${e.localDate}`),
  );
  for (const e of events) {
    if (e.localDate < from || e.localDate > to) continue;
    const habit = byId.get(e.habitId);
    if (!habit) continue;
    let kind: HistoryEventKind | undefined;
    switch (e.type) {
      case 'ACTIVATED':
      case 'REENTERED':
      case 'SCHEDULE_CHANGED':
      case 'WEIGHT_CHANGED':
      case 'PAUSED':
      case 'RESUMED':
      case 'ARCHIVED':
        kind = e.type;
        break;
      case 'EDITED': {
        const fields = changedFields(e);
        if (fields.includes('actionText') || fields.includes('minimumText')) {
          kind = smallerChosen.has(`${e.habitId}|${e.localDate}`) ? 'SMALLER' : 'ACTION_EDITED';
        }
        break;
      }
      default:
        break;
    }
    if (kind) out.push({ date: e.localDate, kind, habit });
  }
  return out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
}

function chartMarkers(events: readonly HabitEvent[], exceptionDays: ReadonlySet<LocalDate>): ChartMarker[] {
  const seen = new Set<string>();
  const out: ChartMarker[] = [];
  const add = (date: LocalDate, kind: MarkerKind) => {
    const key = `${date}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ date, kind });
  };
  for (const d of exceptionDays) add(d, 'EXCEPTION');
  for (const e of events) {
    if (e.type === 'REENTERED') add(e.localDate, 'REENTRY');
    else if (e.type === 'ARCHIVED') add(e.localDate, 'ARCHIVED');
    else if (PLAN_EVENTS.has(e.type)) add(e.localDate, 'PLAN');
  }
  return out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
}

function isMonth(value: string | undefined): value is string {
  return value !== undefined && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function monthOf(date: LocalDate): string {
  return date.slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function monthDays(month: string): LocalDate[] {
  const first = `${month}-01` as LocalDate;
  const last = addDays(`${shiftMonth(month, 1)}-01` as LocalDate, -1);
  return dateRange(first, last);
}

function monthView(habits: readonly Habit[], allEvents: readonly HabitEvent[], reviews: readonly WeeklyReview[], derived: Derived, today: LocalDate, requested: string | undefined): MonthView {
  const first = firstActivation(habits);
  const current = monthOf(today);
  const earliest = first ? monthOf(first) : current;
  let month = isMonth(requested) ? requested : current;
  if (month > current) month = current;
  if (month < earliest) month = earliest;
  const days = monthDays(month);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const shown = habits.filter(
    (h) => h.status !== 'ARCHIVED' && h.status !== 'DRAFT' && h.activatedOn !== undefined && h.activatedOn <= to,
  );
  return {
    month,
    days,
    ...(month > earliest ? { prev: shiftMonth(month, -1) } : {}),
    ...(month < current ? { next: shiftMonth(month, 1) } : {}),
    habits: shown.map((h) => ({ ...calendarHabit(h, derived, days, today), reviews: calendarReviews(reviews, h.id, from, to) })),
    exceptionDays: days.filter((d) => d <= today && derived.exceptionDays.has(d)),
    events: historyEvents(habits, allEvents, from, minDate(to, today)),
  };
}

function taskHistory(tasks: readonly Task[], today: LocalDate): TaskHistoryView {
  const week = weekProof(tasks, startOfWeek(today), today);
  return {
    hasTasks: tasks.some((t) => t.status !== 'DROPPED'),
    metrics: taskMetrics(tasks, today),
    ...(week ? { week } : {}),
  };
}

/**
 * Sicht für „Verlauf“: Niveau mit Korridor, Kalender, Ereignisse und Befinden.
 * Alles wird beim Laden aus den Rohdaten berechnet und nie gespeichert.
 * Einzelne Tage werden nie als Zahl ausgewiesen (US-10), nur als Punkt im Diagramm.
 */
export async function loadHistoryView(ctx: AppContext, month?: string): Promise<HistoryView> {
  const data = await ctx.repo.loadLive();
  const today = clockToday(ctx.clock);
  const derived = derive(data, today);
  const habits = data.habits.filter((h) => h.status !== 'DRAFT');
  const first = firstActivation(habits);
  const scoring = scoringContext(data, derived);
  const comparing = scoringContext(data, derived, { excludePaused: true });
  const markers = chartMarkers(data.habitEvents, derived.exceptionDays);
  return {
    today,
    hasHabits: first !== undefined,
    level: levelView(scoring, comparing, today, first, markers),
    wellbeing: wellbeingView(scoring.wellbeingOn, data.dayRecords, today),
    month: monthView(habits, data.habitEvents, data.weeklyReviews, derived, today, month),
    tasks: taskHistory(data.tasks, today),
  };
}
