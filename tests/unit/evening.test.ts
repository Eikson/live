import { describe, expect, it } from 'vitest';
import { nextAvoidanceOrder, normalizeAvoidanceLabel, sortAvoidanceItems } from '../../src/domain/avoidance';
import { applyDayRecordChange, isEveningCardTime, isRating, needsCounterHint } from '../../src/domain/evening';
import type { AvoidanceItem, DayRecord } from '../../src/domain/types';
import { NOW } from '../helpers';

const LATER = '2026-01-02T08:00:00.000Z';

describe('Tagesdatensatz', () => {
  it('Stimmung und Energie: nur ganze Zahlen 1–5', () => {
    expect([1, 3, 5].every(isRating)).toBe(true);
    expect([0, 6, 2.5, '3', null].some(isRating)).toBe(false);
    expect(applyDayRecordChange(undefined, '2026-01-01', { mood: 6 }, NOW)).toEqual({ ok: false, error: 'INVALID_RATING' });
  });

  it('Abschließen setzt closedAt; übersprungene Werte fehlen', () => {
    const r = applyDayRecordChange(undefined, '2026-01-01', { mood: 4, energy: null, close: true }, NOW);
    expect(r).toEqual({ ok: true, record: { localDate: '2026-01-01', mood: 4, closedAt: NOW, updatedAt: NOW } });
  });

  it('erneutes Abschließen überschreibt Werte und behält den Ausnahmetag', () => {
    const existing: DayRecord = {
      localDate: '2026-01-01',
      mood: 2,
      energy: 2,
      exception: { reason: 'SICK' },
      closedAt: NOW,
      updatedAt: NOW,
    };
    const r = applyDayRecordChange(existing, '2026-01-01', { mood: null, energy: 3, close: true }, LATER);
    expect(r).toEqual({
      ok: true,
      record: { localDate: '2026-01-01', energy: 3, exception: { reason: 'SICK' }, closedAt: LATER, updatedAt: LATER },
    });
  });

  it('Ausnahmetag mit Grund und Notiz; Aufheben ohne weitere Angaben leert den Datensatz', () => {
    const set = applyDayRecordChange(undefined, '2026-01-01', { exception: { reason: 'VACATION', note: '  Ostsee ' } }, NOW);
    expect(set).toEqual({
      ok: true,
      record: { localDate: '2026-01-01', exception: { reason: 'VACATION', note: 'Ostsee' }, updatedAt: NOW },
    });
    const record = (set as { record: DayRecord }).record;
    expect(applyDayRecordChange(record, '2026-01-01', { exception: null }, LATER)).toEqual({ ok: true, record: undefined });
  });

  it('lehnt unbekannte Gründe und zu lange Notizen ab', () => {
    expect(applyDayRecordChange(undefined, '2026-01-01', { exception: { reason: 'X' as 'SICK' } }, NOW)).toEqual({
      ok: false,
      error: 'INVALID_REASON',
    });
    expect(
      applyDayRecordChange(undefined, '2026-01-01', { exception: { reason: 'OTHER', note: 'x'.repeat(1001) } }, NOW),
    ).toEqual({ ok: false, error: 'NOTE_TOO_LONG' });
  });
});

describe('Abend-Karte und Hinweis', () => {
  it('erscheint ab der eingestellten Uhrzeit', () => {
    expect(isEveningCardTime(17 * 60 + 59, '18:00')).toBe(false);
    expect(isEveningCardTime(18 * 60, '18:00')).toBe(true);
    expect(isEveningCardTime(20 * 60, '20:30')).toBe(false);
    expect(isEveningCardTime(18 * 60, 'kaputt')).toBe(true);
  });

  it('weicher Hinweis erst bei mehr als 5 Gegen-Habits', () => {
    expect(needsCounterHint(5)).toBe(false);
    expect(needsCounterHint(6)).toBe(true);
  });
});

describe('Ausweichliste', () => {
  const item = (id: string, label: string, order: number): AvoidanceItem => ({
    id,
    label,
    active: true,
    order,
    createdAt: NOW,
    updatedAt: NOW,
  });
  const items = [item('a', 'Scrollen', 1), item('b', 'Aufräumen statt Aufgabe', 0)];

  it('prüft Pflicht, Länge und Dubletten (ohne Groß-/Kleinschreibung)', () => {
    expect(normalizeAvoidanceLabel('  Nachrichten   lesen ', items)).toEqual({ ok: true, label: 'Nachrichten lesen' });
    expect(normalizeAvoidanceLabel('   ', items)).toEqual({ ok: false, error: 'REQUIRED' });
    expect(normalizeAvoidanceLabel('x'.repeat(121), items)).toEqual({ ok: false, error: 'TOO_LONG' });
    expect(normalizeAvoidanceLabel('scrollen', items)).toEqual({ ok: false, error: 'DUPLICATE' });
    expect(normalizeAvoidanceLabel('SCROLLEN', items, 'a')).toEqual({ ok: true, label: 'SCROLLEN' });
  });

  it('sortiert nach Reihenfolge, neue Einträge kommen ans Ende', () => {
    expect(sortAvoidanceItems(items).map((i) => i.id)).toEqual(['b', 'a']);
    expect(nextAvoidanceOrder(items)).toBe(2);
    expect(nextAvoidanceOrder([])).toBe(0);
  });
});
