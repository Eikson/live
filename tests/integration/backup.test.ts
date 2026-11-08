import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteAllData,
  exportBackup,
  importMerge,
  importReplace,
  markBackupDone,
  readBackupFile,
  unlockBackup,
  type ExportedFile,
  type ReadResult,
} from '../../src/app/backup';
import { recordCheckIn } from '../../src/app/check-in';
import type { AppContext } from '../../src/app/context';
import { completeOnboarding } from '../../src/app/onboarding';
import { loadTodayView } from '../../src/app/today';
import { IdbRepository } from '../../src/data/idb-repository';
import type { Snapshot } from '../../src/domain/snapshot';
import { fixedClock } from '../../src/platform/clock';
import { counterIds } from '../helpers';

let dbSeq = 0;
const open: IdbRepository[] = [];
let ctx: AppContext & { clock: ReturnType<typeof fixedClock> };

async function newContext(start = '2026-11-05T09:00:00+01:00', device = 'a') {
  const clock = fixedClock(start);
  const repo = await IdbRepository.open({ name: `backup-${++dbSeq}`, now: () => clock.now() });
  open.push(repo);
  return { repo, clock, newId: counterIds(device) };
}

beforeEach(async () => {
  ctx = await newContext();
});
afterEach(() => {
  for (const repo of open.splice(0)) repo.close();
});

async function onboard(c: AppContext, title = 'Mehr Bewegung'): Promise<string> {
  const r = await completeOnboarding(c, {
    goal: { title },
    habit: { actionText: '10 Minuten spazieren', minimumText: '2 Minuten vor die Tür', cue: { type: 'ROUTINE', description: 'Nach dem Mittagessen' } },
  });
  if (!r.ok) throw new Error('Onboarding fehlgeschlagen');
  return r.habitId;
}

const asFile = (f: ExportedFile) => ({ size: f.text.length, text: async () => f.text });
async function ready(f: ExportedFile, password?: string) {
  const read: ReadResult = await readBackupFile(asFile(f));
  if (read.kind === 'ready') return read;
  return unlockBackup(read.envelope, password ?? '');
}
/** Vergleichbare Sicht ohne Einstellungen, deren Zeitstempel sich beim Import bewusst ändern. */
const contentOf = ({ preferences: _p, ...rest }: Snapshot) => rest;

describe('Export und Import', () => {
  it('Export, alles löschen, Ersetzen: der Bestand ist wieder da', async () => {
    const habitId = await onboard(ctx);
    await recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'DONE', note: 'Am Fluss' });
    const before = await ctx.repo.loadSnapshot();
    const file = await exportBackup(ctx, '0.1.0');
    expect(file.fileName).toBe('live-backup-2026-11-05.json');

    await deleteAllData(ctx);
    const fresh = await newContext('2026-11-06T09:00:00+01:00');
    expect((await fresh.repo.getPreferences()).onboardingCompletedAt).toBeUndefined();

    const copies: ExportedFile[] = [];
    await importReplace(fresh, (await ready(file)).backup, '0.1.0', async (copy) => void copies.push(copy));
    expect(copies[0]!.fileName).toBe('live-sicherheitskopie-2026-11-06.json');

    const after = await fresh.repo.loadSnapshot();
    expect(contentOf(after)).toEqual(contentOf(before));
    expect(after.preferences.onboardingCompletedAt).toBe(before.preferences.onboardingCompletedAt);
    // Der eingespielte Stand liegt als Datei vor und zählt als Export.
    expect(after.preferences.lastBackupAt).toBe(new Date('2026-11-05T09:00:00+01:00').toISOString());
    const view = await loadTodayView(fresh);
    expect(view.cards.map((c) => c.habit.actionText)).toEqual(['10 Minuten spazieren']);
  });

  it('verschlüsselter Export lässt sich nur mit dem Passwort einspielen', async () => {
    await onboard(ctx);
    const file = await exportBackup(ctx, '0.1.0', { password: 'ein-langes-passwort', iterations: 1000 });
    expect(file.fileName).toBe('live-backup-2026-11-05-verschluesselt.json');
    expect(file.text).not.toContain('Mehr Bewegung');
    const read = await readBackupFile(asFile(file));
    expect(read.kind).toBe('needs-password');
    if (read.kind !== 'needs-password') return;
    await expect(unlockBackup(read.envelope, 'falsch-falsch')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    expect((await unlockBackup(read.envelope, 'ein-langes-passwort')).summary).toMatchObject({ goals: 1, habits: 1 });
  });

  it('Zusammenführen: Einträge beider Geräte bleiben, der neuere Stand gewinnt', async () => {
    // Gerät A
    const habitId = await onboard(ctx);
    await recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'DONE' });
    const fromA = await exportBackup(ctx, '0.1.0');

    // Gerät B: eigener Bestand, eigener Check-in
    const b = await newContext('2026-11-06T09:00:00+01:00', 'b');
    const otherHabit = await onboard(b, 'Ruhiger schlafen');
    await recordCheckIn(b, { habitId: otherHabit, localDate: '2026-11-06', outcome: 'DONE' });

    await importMerge(b, (await ready(fromA)).backup);
    const merged = await b.repo.loadSnapshot();
    expect(merged.goals.map((g) => ('title' in g ? g.title : '')).sort()).toEqual(['Mehr Bewegung', 'Ruhiger schlafen']);
    expect(merged.checkIns).toHaveLength(2);

    // Zweimal dieselbe Datei ändert nichts.
    await importMerge(b, (await ready(fromA)).backup);
    expect(await b.repo.loadSnapshot()).toEqual(merged);
  });

  it('scheitert die Sicherheitskopie, bleibt beim Ersetzen alles unverändert', async () => {
    const habitId = await onboard(ctx);
    await recordCheckIn(ctx, { habitId, localDate: '2026-11-05', outcome: 'DONE' });
    const before = await ctx.repo.loadSnapshot();
    const other = await newContext(undefined, 'b');
    await onboard(other, 'Etwas anderes');
    const file = await exportBackup(other, '0.1.0');

    await expect(
      importReplace(ctx, (await ready(file)).backup, '0.1.0', async () => {
        throw new Error('kein Speicherplatz');
      }),
    ).rejects.toThrow('kein Speicherplatz');
    expect(await ctx.repo.loadSnapshot()).toEqual(before);
  });

  it('ein Fehler mitten im Schreiben hinterlässt keinen Teilbestand', async () => {
    await onboard(ctx);
    const before = await ctx.repo.loadSnapshot();
    const broken = structuredClone(before);
    // Ein Datensatz ohne Schlüssel lässt das Schreiben scheitern, nachdem die Stores geleert wurden.
    broken.checkIns.push({ habitId: 'x' } as never);
    await expect(ctx.repo.replaceAll(broken)).rejects.toBeDefined();
    expect(await ctx.repo.loadSnapshot()).toEqual(before);

    await expect(
      ctx.repo.updateAll(() => {
        throw new Error('ungültig');
      }),
    ).rejects.toThrow('ungültig');
    expect(await ctx.repo.loadSnapshot()).toEqual(before);
  });

  it('Export setzt den Zeitpunkt des letzten Exports erst nach dem Speichern', async () => {
    await onboard(ctx);
    await exportBackup(ctx, '0.1.0');
    expect((await ctx.repo.getPreferences()).lastBackupAt).toBeUndefined();
    await markBackupDone(ctx);
    expect((await ctx.repo.getPreferences()).lastBackupAt).toBe(new Date('2026-11-05T09:00:00+01:00').toISOString());
  });
});

describe('Backup-Hinweis auf Heute', () => {
  it('erscheint mehr als 14 Tage nach dem letzten Export und verschwindet nach einem neuen', async () => {
    await onboard(ctx);
    await markBackupDone(ctx);
    ctx.clock.set('2026-11-19T09:00:00+01:00');
    expect((await loadTodayView(ctx)).backupDue).toBe(false);
    ctx.clock.set('2026-11-20T09:00:00+01:00');
    const view = await loadTodayView(ctx);
    expect(view.backupDue).toBe(true);
    expect(view.hasBackup).toBe(true);
    await markBackupDone(ctx);
    expect((await loadTodayView(ctx)).backupDue).toBe(false);
  });
});

describe('Alle Daten löschen', () => {
  it('entfernt die Datenbank vollständig, auch Löschmarkierungen', async () => {
    await onboard(ctx);
    await deleteAllData(ctx);
    const reopened = await IdbRepository.open({ name: `backup-${dbSeq}`, now: () => ctx.clock.now() });
    open.push(reopened);
    const s = await reopened.loadSnapshot();
    expect([s.goals, s.habits, s.checkIns, s.habitEvents, s.weeklyReviews]).toEqual([[], [], [], [], []]);
    expect(s.preferences.onboardingCompletedAt).toBeUndefined();
  });
});
