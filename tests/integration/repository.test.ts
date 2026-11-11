import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { IdbRepository, isQuotaError } from '../../src/data/idb-repository';
import { migrations, type Migration } from '../../src/data/migrations';
import type { Goal } from '../../src/domain/types';
import { checkIn, event, makeHabit, NOW } from '../helpers';

let dbSeq = 0;
const open: IdbRepository[] = [];
async function repo(name = `test-${++dbSeq}`, extra: Parameters<typeof IdbRepository.open>[0] = {}) {
  const r = await IdbRepository.open({ name, ...extra });
  open.push(r);
  return r;
}
afterEach(() => {
  while (open.length) open.pop()!.close();
});

const goal = (id: string): Goal => ({ id, title: 'Mehr Bewegung', status: 'ACTIVE', createdAt: NOW, updatedAt: NOW });

describe('IdbRepository', () => {
  it('liefert Standard-Einstellungen bei leerer Datenbank', async () => {
    const r = await repo();
    const prefs = await r.getPreferences();
    expect(prefs.theme).toBe('system');
    expect(prefs.eveningCardFrom).toBe('18:00');
    expect(prefs.onboardingCompletedAt).toBeUndefined();
  });

  it('commit schreibt mehrere Stores in einer Transaktion', async () => {
    const r = await repo();
    const habit = makeHabit({ goalId: 'g1' });
    await r.commit({
      goals: [goal('g1')],
      habits: [habit],
      addHabitEvents: [event('h1', '2026-01-01', 'CREATED')],
      checkIns: [checkIn('h1', '2026-01-01', 'DONE')],
    });
    const data = await r.loadLive();
    expect(data.goals).toHaveLength(1);
    expect(data.habits[0]?.id).toBe('h1');
    expect(data.habitEvents).toHaveLength(1);
    expect(await r.getCheckIn('h1', '2026-01-01')).toMatchObject({ outcome: 'DONE' });
  });

  it('bricht bei einem Fehler die ganze Transaktion ab (alles oder nichts)', async () => {
    const r = await repo();
    const e = event('h1', '2026-01-01', 'CREATED');
    await r.commit({ addHabitEvents: [e] });
    // Ereignisse werden nur ergänzt: dieselbe ID noch einmal schlägt fehl.
    await expect(r.commit({ goals: [goal('g1')], habits: [makeHabit()], addHabitEvents: [e] })).rejects.toThrow();
    const data = await r.loadLive();
    expect(data.goals).toEqual([]);
    expect(data.habits).toEqual([]);
    expect(data.habitEvents).toHaveLength(1);
  });

  it('erlaubt pro Habit und Tag nur einen Check-in (eindeutiger Index)', async () => {
    const r = await repo();
    const a = checkIn('h1', '2026-01-01', 'DONE');
    const b = { ...a, id: 'other-id', outcome: 'NOT_DONE' as const };
    await r.commit({ checkIns: [a] });
    await expect(r.commit({ checkIns: [b] })).rejects.toThrow();
    const data = await r.loadLive();
    expect(data.checkIns.map((c) => c.id)).toEqual([a.id]);
  });

  it('Löschmarkierungen fallen aus dem Index und aus der lebenden Sicht', async () => {
    const r = await repo();
    const a = checkIn('h1', '2026-01-01', 'DONE');
    await r.commit({ checkIns: [a] });
    await r.commit({ checkIns: [{ id: a.id, deletedAt: NOW }] });
    expect(await r.getCheckIn('h1', '2026-01-01')).toBeUndefined();
    expect((await r.loadLive()).checkIns).toEqual([]);
    expect((await r.loadSnapshot()).checkIns).toEqual([{ id: a.id, deletedAt: NOW }]);
    // Danach ist ein neuer Eintrag für denselben Tag möglich.
    await r.commit({ checkIns: [{ ...a, id: 'neu' }] });
    expect(await r.getCheckIn('h1', '2026-01-01')).toMatchObject({ id: 'neu' });
  });

  it('parallele upsertCheckIn-Aufrufe sehen sich gegenseitig', async () => {
    const r = await repo();
    let created = 0;
    const update = (existing: ReturnType<typeof checkIn> | undefined) => {
      if (existing) return { ...existing, outcome: 'ALTERNATIVE' as const };
      created++;
      return { ...checkIn('h1', '2026-01-01', 'DONE'), id: `c-${created}` };
    };
    await Promise.all([
      r.upsertCheckIn('h1', '2026-01-01', update),
      r.upsertCheckIn('h1', '2026-01-01', update),
      r.upsertCheckIn('h1', '2026-01-01', update),
    ]);
    const data = await r.loadLive();
    expect(created).toBe(1);
    expect(data.checkIns).toHaveLength(1);
    expect(data.checkIns[0]?.outcome).toBe('ALTERNATIVE');
  });

  it('upsertCheckIn schreibt nichts, wenn das Update null liefert', async () => {
    const r = await repo();
    expect(await r.upsertCheckIn('h1', '2026-01-01', () => null)).toBeNull();
    expect((await r.loadLive()).checkIns).toEqual([]);
  });
});

describe('Migrationen', () => {
  // Die App steht bei Schema-Version 2 (Vorhaben); die künstliche Migration ist deshalb Version 3.
  const v3: Migration = async (_db, tx) => {
    // Künstliche Migration: neues Feld für alle Ziele.
    const store = tx.objectStore('goals');
    let cursor = await store.openCursor();
    while (cursor) {
      await cursor.update({ ...(cursor.value as object), migrated: true });
      cursor = await cursor.continue();
    }
  };

  it('hebt den Bestand auf eine künstliche v3 und behält die Daten', async () => {
    const name = `mig-${++dbSeq}`;
    const r1 = await IdbRepository.open({ name });
    await r1.commit({ goals: [goal('g1')] });
    r1.close();

    const r2 = await repo(name, { version: 3, migrations: { ...migrations, 3: v3 } });
    const goals = (await r2.loadSnapshot()).goals as (Goal & { migrated?: boolean })[];
    expect(goals).toEqual([expect.objectContaining({ id: 'g1', migrated: true })]);
    r2.close();

    const raw = await openDB(name);
    expect(raw.version).toBe(3);
    expect(await raw.get('meta', 'dbVersion')).toEqual({ key: 'dbVersion', value: 3 });
    raw.close();
  });

  it('eine fehlschlagende Migration lässt die Datenbank auf der alten Version', async () => {
    const name = `mig-${++dbSeq}`;
    const r1 = await IdbRepository.open({ name });
    await r1.commit({ goals: [goal('g1')] });
    r1.close();

    const broken: Migration = () => {
      throw new Error('kaputt');
    };
    await expect(IdbRepository.open({ name, version: 3, migrations: { ...migrations, 3: broken } })).rejects.toThrow();

    const again = await repo(name);
    expect((await again.loadLive()).goals).toHaveLength(1);
    again.close();
    const raw = await openDB(name);
    expect(raw.version).toBe(2);
    raw.close();
  });

  it('verweigert das Öffnen, wenn eine Migration fehlt', async () => {
    await expect(IdbRepository.open({ name: `mig-${++dbSeq}`, version: 3 })).rejects.toThrow('Migration 3 fehlt.');
  });

  it('hebt einen Bestand der Version 1 auf Version 2: Vorhaben kommen dazu, alles andere bleibt', async () => {
    const name = `mig-${++dbSeq}`;
    const old = await IdbRepository.open({ name, version: 1 });
    await old.commit({ goals: [goal('g1')] });
    old.close();

    const current = await repo(name);
    const snapshot = await current.loadSnapshot();
    expect(snapshot.goals).toEqual([expect.objectContaining({ id: 'g1' })]);
    expect(snapshot.tasks).toEqual([]);
    current.close();
    const raw = await openDB(name);
    expect(raw.version).toBe(2);
    expect([...raw.objectStoreNames]).toContain('tasks');
    raw.close();
  });
});

describe('Voller Gerätespeicher', () => {
  const quota = () => new DOMException('Der Speicher ist voll.', 'QuotaExceededError');

  it('erkennt QuotaExceededError, auch unter dem Firefox-Namen', () => {
    expect(isQuotaError(quota())).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError(new Error('anders'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it('meldet einen vollen Speicher, reicht den Fehler weiter und lässt den Bestand unverändert', async () => {
    let reported = 0;
    // Feste Uhr: Ohne gespeicherte Einstellungen setzt loadSnapshot den aktuellen Zeitpunkt ein.
    const now = () => new Date('2026-01-01T12:00:00Z');
    const r = await repo(undefined, { onQuotaExceeded: () => reported++, now });
    await r.commit({ goals: [goal('g1')] });
    const before = await r.loadSnapshot();

    const proto = IDBObjectStore.prototype;
    const original = proto.put;
    proto.put = function () {
      throw quota();
    };
    try {
      await expect(r.commit({ goals: [goal('g2')] })).rejects.toMatchObject({ name: 'QuotaExceededError' });
      await expect(r.upsertCheckIn('h1', '2026-01-01', () => checkIn('h1', '2026-01-01', 'DONE'))).rejects.toMatchObject({
        name: 'QuotaExceededError',
      });
    } finally {
      proto.put = original;
    }
    expect(reported).toBe(2);
    expect(await r.loadSnapshot()).toEqual(before);

    // Andere Fehler zählen nicht als voller Speicher.
    await expect(r.updateAll(() => { throw new Error('ungültig'); })).rejects.toThrow('ungültig');
    expect(reported).toBe(2);
  });
});
