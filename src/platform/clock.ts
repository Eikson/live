import { toLocalDate, type LocalDate } from '../domain/local-date';

/** Injizierbare Uhr. In Unit-Tests fest, in E2E-Tests über `page.clock` gesteuert. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string | Date): Clock & { set(next: string | Date): void } {
  let current = new Date(iso);
  return {
    now: () => new Date(current),
    set(next) {
      current = new Date(next);
    },
  };
}

export function today(clock: Clock): LocalDate {
  return toLocalDate(clock.now());
}

/** Minuten seit lokaler Mitternacht. */
export function minutesOfDay(clock: Clock): number {
  const d = clock.now();
  return d.getHours() * 60 + d.getMinutes();
}
