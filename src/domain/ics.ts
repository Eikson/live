import { appConfig } from './app-config';
import { addDays } from './local-date';
import type { Task } from './types';

/**
 * Kalendereintrag (iCalendar, RFC 5545) für den geplanten Start eines Vorhabens. Live schickt
 * keine Benachrichtigungen; der Eintrag holt den Startzeitpunkt in den eigenen Kalender.
 * Rein und ohne Browser-APIs. Zeiten sind „floating“, also in der Ortszeit des Geräts.
 */
function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/[;,]/g, (c) => `\\${c}`);
}

/** Zeilen über 75 Oktette werden umbrochen; die Fortsetzung beginnt mit einem Leerzeichen. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const compactDate = (date: string) => date.replace(/-/g, '');

function utcStamp(iso: string): string {
  return `${new Date(iso).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/** Ende eines Termins, der um `time` beginnt und `minutes` dauert (kann in den Folgetag reichen). */
function endOf(date: string, time: string, minutes: number): string {
  const total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  const day = addDays(date, Math.floor(total / 1440));
  const rest = total % 1440;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${compactDate(day)}T${pad(Math.floor(rest / 60))}${pad(rest % 60)}00`;
}

export interface IcsTexts {
  /** Titel des Termins, z. B. „Start: Steering-Deck“ */
  summary: (title: string) => string;
  /** Beschreibung mit erstem Schritt und Deadline */
  description: (task: Task) => string;
}

export function taskIcs(task: Task, createdAt: string, texts: IcsTexts): string {
  const time = task.plannedStartTime;
  const when = time
    ? [
        `DTSTART:${compactDate(task.plannedStart)}T${time.replace(':', '')}00`,
        `DTEND:${endOf(task.plannedStart, time, appConfig.tasks.startWindowMinutes)}`,
      ]
    : [`DTSTART;VALUE=DATE:${compactDate(task.plannedStart)}`, `DTEND;VALUE=DATE:${compactDate(addDays(task.plannedStart, 1))}`];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Live//Vorhaben//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${task.id}@live`,
    `DTSTAMP:${utcStamp(createdAt)}`,
    // Verschieben erzeugt eine neuere Fassung desselben Termins.
    `SEQUENCE:${task.deferrals.length}`,
    ...when,
    `SUMMARY:${escapeText(texts.summary(task.title))}`,
    `DESCRIPTION:${escapeText(texts.description(task))}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Dateiname ohne Sonderzeichen, z. B. `live-start-steering-deck.ics`. */
export function icsFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `live-start-${slug || 'vorhaben'}.ics`;
}
