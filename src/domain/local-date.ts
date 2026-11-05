/**
 * Lokaler Kalendertag als String `YYYY-MM-DD`.
 *
 * Alle Datumsrechnungen laufen auf diesen Strings (intern über UTC-Mitternacht),
 * nie über Millisekunden-Differenzen lokaler Zeitpunkte. Damit verschieben
 * Sommer-/Winterzeit und Zeitzonenwechsel keine bereits gespeicherten Tage.
 */
export type LocalDate = string & { readonly __brand?: 'LocalDate' };

/** 0 = Sonntag … 6 = Samstag (wie `Date#getDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** Kalendertag eines Zeitpunkts in der lokalen Zeitzone des Geräts. */
export function toLocalDate(instant: Date): LocalDate {
  return `${pad(instant.getFullYear(), 4)}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const m = PATTERN.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === mo - 1 && utc.getUTCDate() === d;
}

function toUtcMs(date: LocalDate): number {
  const m = PATTERN.exec(date);
  if (!m) throw new Error(`Ungültiges Datum: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): LocalDate {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const DAY_MS = 86_400_000;

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Anzahl Kalendertage von `from` bis `to` (positiv, wenn `to` später liegt). */
export function diffDays(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function weekdayOf(date: LocalDate): Weekday {
  return new Date(toUtcMs(date)).getUTCDay() as Weekday;
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b;
}

/** Alle Tage von `from` bis einschließlich `to`. Leer, wenn `from` > `to`. */
export function dateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Montag der Woche, in der `date` liegt. */
export function startOfWeek(date: LocalDate): LocalDate {
  const wd = weekdayOf(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

export function dayOfMonth(date: LocalDate): number {
  return Number(date.slice(8, 10));
}

/** 0 = Januar */
export function monthIndex(date: LocalDate): number {
  return Number(date.slice(5, 7)) - 1;
}
