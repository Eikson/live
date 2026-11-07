/**
 * Nur für die Entwicklung (seed.html, nicht Teil des Builds): ersetzt den gesamten Bestand
 * durch deterministische Testdaten relativ zu heute. Gedacht zum Prüfen von Score und Verlauf.
 */
import { IdbRepository } from '../data/idb-repository';
import type { Snapshot } from '../data/repository';
import { addDays, dateRange, toLocalDate, weekdayOf, type LocalDate } from '../domain/local-date';
import { defaultPreferences } from '../domain/preferences';
import type {
  CheckIn,
  CheckInOutcome,
  DayRecord,
  Goal,
  Habit,
  HabitEvent,
  HabitEventType,
  HabitKind,
  Schedule,
} from '../domain/types';

export type SeedVariant = 'ruhig' | 'muster';

/** Kleiner deterministischer Zufallsgenerator (mulberry32). */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSeed(today: LocalDate, variant: SeedVariant): Snapshot {
  const rnd = random(20261107);
  const start = addDays(today, -200);
  let counter = 0;
  const id = (prefix: string) => `${prefix}-${(++counter).toString().padStart(4, '0')}`;
  const at = (date: LocalDate, hour = 20) => `${date}T${String(hour).padStart(2, '0')}:00:00.000Z`;
  const nowIso = at(today, 8);

  const goal: Goal = {
    id: 'goal-ruhe',
    title: 'Mehr Ruhe im Alltag',
    why: 'Abends weniger gehetzt sein',
    status: 'ACTIVE',
    createdAt: at(start, 9),
    updatedAt: at(start, 9),
  };

  const events: HabitEvent[] = [];
  const event = (habitId: string, date: LocalDate, type: HabitEventType, before?: unknown, after?: unknown) => {
    events.push({ id: id('ev'), habitId, localDate: date, at: at(date, 18), type, before, after });
  };

  const habit = (
    key: string,
    kind: HabitKind,
    actionText: string,
    minimumText: string | undefined,
    schedule: Schedule,
    activatedOn: LocalDate,
  ): Habit => {
    const h: Habit = {
      id: `habit-${key}`,
      goalId: goal.id,
      kind,
      actionText,
      ...(minimumText ? { minimumText } : {}),
      ...(kind === 'BUILD' ? { cue: { type: 'ROUTINE' as const, description: 'Nach dem Abendessen' } } : {}),
      copingPlans: [],
      schedule,
      weight: 1,
      status: 'ACTIVE',
      activatedOn,
      createdAt: at(activatedOn, 9),
      updatedAt: at(activatedOn, 9),
    };
    event(h.id, activatedOn, 'CREATED');
    event(h.id, activatedOn, 'ACTIVATED', 'DRAFT', 'ACTIVE');
    return h;
  };

  const MO_MI_FR: Schedule = { type: 'WEEKDAYS', days: [1, 3, 5] };
  const MO_FR: Schedule = { type: 'WEEKDAYS', days: [1, 2, 3, 4, 5] };

  const lesen = habit('lesen', 'BUILD', '10 Minuten lesen', '1 Seite lesen', { type: 'DAILY' }, start);
  const dehnen = habit('dehnen', 'BUILD', 'Dehnen', '1 Übung', { type: 'DAILY' }, addDays(start, 10));
  const gehen = habit('gehen', 'BUILD', 'Spazieren gehen', 'Einmal um den Block', MO_MI_FR, addDays(start, 21));
  const handy = habit('handy', 'COUNTER_PROCRASTINATION', 'Handy erst nach dem Frühstück', undefined, { type: 'DAILY' }, addDays(start, 40));
  const wasser = habit('wasser', 'BUILD', 'Ein Glas Wasser am Morgen', 'Ein Schluck', { type: 'DAILY' }, addDays(today, -60));

  // Dehnen: nach 60 Tagen archiviert (fällt rückwirkend aus Score und Diagramm).
  const archivedOn = addDays(start, 70);
  dehnen.status = 'ARCHIVED';
  event(dehnen.id, archivedOn, 'ARCHIVED', 'ACTIVE', 'ARCHIVED');

  // Spazieren: Rhythmus nach drei Monaten von Mo/Mi/Fr auf Mo–Fr.
  const scheduleOn = addDays(start, 90);
  gehen.schedule = MO_FR;
  event(gehen.id, scheduleOn, 'SCHEDULE_CHANGED', MO_MI_FR, MO_FR);

  // Wasser: seit 20 Tagen pausiert (zählt im Hauptwert bis dahin, im Vergleich gar nicht).
  const pausedOn = addDays(today, -20);
  wasser.status = 'PAUSED';
  event(wasser.id, pausedOn, 'PAUSED', 'ACTIVE', 'PAUSED');

  // Eine Woche ohne Angaben, danach Wiedereinstieg mit „Kleiner machen“ für Spazieren.
  const gapFrom = addDays(start, 130);
  const gapTo = addDays(start, 136);
  const reentryOn = addDays(gapTo, 1);
  for (const h of [lesen, gehen, handy]) event(h.id, reentryOn, 'REENTERED', undefined, h === gehen ? 'SMALLER' : 'CONTINUE');
  event(gehen.id, reentryOn, 'EDITED', { minimumText: 'Einmal um den Block' }, { minimumText: 'Bis zur Haustür und zurück' });
  gehen.minimumText = 'Bis zur Haustür und zurück';

  // Ausnahmetage: eine Urlaubswoche und zwei Krankheitstage.
  const exceptions = new Map<LocalDate, DayRecord['exception']>();
  for (const d of dateRange(addDays(start, 100), addDays(start, 106))) exceptions.set(d, { reason: 'VACATION' });
  for (const d of [addDays(today, -35), addDays(today, -34)]) exceptions.set(d, { reason: 'SICK' });

  const habits = [lesen, dehnen, gehen, handy, wasser];
  const activeOn = (h: Habit, d: LocalDate): boolean => {
    if (!h.activatedOn || d < h.activatedOn) return false;
    if (h === dehnen && d >= archivedOn) return false;
    if (h === wasser && d >= pausedOn) return false;
    return true;
  };
  const plannedOn = (h: Habit, d: LocalDate): boolean => {
    if (!activeOn(h, d)) return false;
    const schedule = h === gehen ? (d < scheduleOn ? MO_MI_FR : MO_FR) : h.schedule;
    return schedule.type === 'DAILY' || schedule.days.includes(weekdayOf(d));
  };

  const patternFrom = addDays(today, -6);
  const checkIns: CheckIn[] = [];
  const dayRecords: DayRecord[] = [];

  for (const d of dateRange(start, addDays(today, -1))) {
    const inGap = d >= gapFrom && d <= gapTo;
    const exception = exceptions.get(d);
    const pattern = variant === 'muster' && d >= patternFrom;
    // Phasen: anfangs wechselhaft, dann stabiler; in der Variante „muster“ eine schwache letzte Woche.
    const age = Math.max(0, Math.min(1, (d < addDays(start, 60) ? 0.4 : 0.85) + (rnd() - 0.5) * 0.2));
    if (inGap) continue;

    if (exception) {
      dayRecords.push({ localDate: d, exception, closedAt: at(d, 21), updatedAt: at(d, 21) });
      continue;
    }

    // An einzelnen Tagen fehlt eine Angabe (Lücke, zählt nicht als 0).
    const skipDay = rnd() < 0.05;
    for (const h of habits) {
      if (!activeOn(h, d) || skipDay) continue;
      const planned = plannedOn(h, d);
      const r = rnd();
      let outcome: CheckInOutcome;
      let minimal = false;
      if (!planned) {
        // Gelegentlich „Trotzdem gemacht“ an nicht geplanten Tagen (zählt nie).
        if (h.kind !== 'BUILD' || r > 0.15) continue;
        outcome = 'DONE';
      } else if (h.kind === 'COUNTER_PROCRASTINATION') {
        const ok = pattern ? 0.2 : 0.55 + age * 0.35;
        outcome = r < ok ? 'NO' : r < ok + 0.15 ? 'PARTIAL' : 'YES';
      } else {
        const ok = pattern ? 0.15 : 0.5 + age * 0.4;
        if (r < ok) {
          outcome = 'DONE';
          minimal = rnd() < 0.2;
        } else if (r < ok + 0.05) {
          outcome = 'ALTERNATIVE';
        } else {
          outcome = 'NOT_DONE';
        }
      }
      checkIns.push({
        id: id('ci'),
        habitId: h.id,
        localDate: d,
        outcome,
        minimal,
        unplanned: !planned,
        createdAt: at(d, 20),
        updatedAt: at(d, 20),
      });
    }

    // Befinden an den meisten Tagen; vor sechs Monaten etwas niedriger als jetzt.
    if (rnd() < 0.85) {
      const base = d < addDays(start, 60) ? 2.6 : 3.4;
      const clamp = (v: number) => Math.max(1, Math.min(5, Math.round(v)));
      dayRecords.push({
        localDate: d,
        mood: clamp(base + (rnd() - 0.5) * 2.4),
        energy: clamp(base + (rnd() - 0.5) * 2.4),
        closedAt: at(d, 21),
        updatedAt: at(d, 21),
      });
    }
  }

  return {
    preferences: { ...defaultPreferences(nowIso), onboardingCompletedAt: at(start, 9) },
    goals: [goal],
    habits,
    habitEvents: events,
    checkIns,
    dayRecords,
    avoidanceItems: [],
    weeklyReviews: [],
  };
}

async function run(variant: SeedVariant, status: HTMLElement): Promise<void> {
  status.textContent = 'Schreibe Testdaten …';
  const repo = await IdbRepository.open();
  try {
    const snapshot = buildSeed(toLocalDate(new Date()), variant);
    await repo.replaceAll(snapshot);
    status.textContent = `Fertig: ${snapshot.habits.length} Gewohnheiten, ${snapshot.checkIns.length} Angaben, ${snapshot.dayRecords.length} Tageseinträge.`;
  } finally {
    repo.close();
  }
}

if (typeof document !== 'undefined') {
  const status = document.getElementById('status');
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-variant]')) {
    button.addEventListener('click', () => {
      if (!status) return;
      if (!confirm('Alle Daten in Live werden ersetzt. Fortfahren?')) return;
      run(button.dataset.variant as SeedVariant, status).catch((e: unknown) => {
        status.textContent = `Fehler: ${String(e)}`;
      });
    });
  }
}
