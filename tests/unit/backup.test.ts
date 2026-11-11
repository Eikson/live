import { describe, expect, it } from 'vitest';
import { ImportError, readBackupFile, unlockBackup } from '../../src/app/backup';
import {
  BackupError,
  backupSummary,
  createBackup,
  parseBackupObject,
  parseBackupText,
  validateSnapshot,
  type BackupFile,
} from '../../src/domain/backup-schema';
import { backupReminderDue } from '../../src/domain/backup-reminder';
import { defaultPreferences } from '../../src/domain/preferences';
import { sampleSnapshot } from '../backup-fixture';
import { encryptText, PBKDF2_ITERATIONS } from '../../src/platform/crypto';
import type { Snapshot } from '../../src/domain/snapshot';
import { NOW } from '../helpers';

const backup = (data: Snapshot = sampleSnapshot()): BackupFile => createBackup(data, NOW, '0.1.0');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const fileOf = (text: string) => ({ size: text.length, text: async () => text });

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof BackupError) return e.code;
    throw e;
  }
  return undefined;
}

describe('Exportformat', () => {
  it('enthält Format, Version, Zeitpunkt, App-Version und alle Stores', () => {
    const file = JSON.parse(JSON.stringify(backup())) as Record<string, unknown>;
    expect(file).toMatchObject({ format: 'live-backup', formatVersion: 2, exportedAt: NOW, appVersion: '0.1.0' });
    expect(Object.keys(file.data as object).sort()).toEqual(
      ['avoidanceItems', 'checkIns', 'dayRecords', 'goals', 'habitEvents', 'habits', 'preferences', 'tasks', 'weeklyReviews'].sort(),
    );
  });

  it('übersteht den Weg über JSON unverändert (auch Löschmarkierungen und Texte mit Zeichen wie <b>)', () => {
    const parsed = parseBackupText(JSON.stringify(backup()));
    expect(parsed.kind).toBe('plain');
    if (parsed.kind === 'plain') expect(parsed.backup.data).toEqual(sampleSnapshot());
  });

  it('Vorschau zählt nur lebende Datensätze und nennt den Zeitraum der Check-ins', () => {
    expect(backupSummary(backup())).toEqual({
      exportedAt: NOW,
      goals: 1,
      habits: 1,
      checkIns: 2,
      tasks: 0,
      from: '2026-01-01',
      to: '2026-01-03',
    });
  });
});

describe('Importprüfung', () => {
  it('lehnt beschädigte Dateien (kein JSON) ab', () => {
    expect(codeOf(() => parseBackupText('{"format":"live-backup", "formatV'))).toBe('NOT_JSON');
  });

  it('lehnt fremde Formate ab', () => {
    expect(codeOf(() => parseBackupText('[1,2,3]'))).toBe('UNKNOWN_FORMAT');
    expect(codeOf(() => parseBackupText('{"format":"anderes"}'))).toBe('UNKNOWN_FORMAT');
  });

  it('lehnt neuere Formatversionen ab', () => {
    const file = { ...clone(backup()), formatVersion: 3 };
    expect(codeOf(() => parseBackupObject(file))).toBe('NEWER_VERSION');
  });

  it('migriert ältere Versionen schrittweise', () => {
    // Angenommen, Version 3 hat „goals“ umbenannt: eine ältere Datei wird beim Lesen angepasst.
    const old = clone(backup()) as unknown as Record<string, unknown>;
    const data = old.data as Record<string, unknown>;
    const v0 = { ...old, data: { ...data, ziele: data.goals, goals: undefined } };
    const migrations = {
      3: (f: Record<string, unknown>) => {
        const d = f.data as Record<string, unknown>;
        return { ...f, data: { ...d, goals: d.ziele } };
      },
    };
    const parsed = parseBackupObject(v0, { currentVersion: 3, migrations });
    expect(parsed.kind === 'plain' && parsed.backup.formatVersion).toBe(3);
    expect(parsed.kind === 'plain' && parsed.backup.data.goals).toEqual(sampleSnapshot().goals);
    // Fehlt eine Migration, wird die Datei nicht halb gelesen.
    expect(codeOf(() => parseBackupObject(v0, { currentVersion: 3, migrations: {} }))).toBe('INVALID');
  });

  it('liest Dateien der Version 1 ohne Vorhaben und ergänzt eine leere Liste', () => {
    const old = clone(backup()) as unknown as Record<string, unknown>;
    const { tasks: _tasks, ...data } = old.data as Record<string, unknown>;
    const parsed = parseBackupObject({ ...old, formatVersion: 1, data });
    expect(parsed.kind === 'plain' && parsed.backup.formatVersion).toBe(2);
    expect(parsed.kind === 'plain' && parsed.backup.data.tasks).toEqual([]);
    // In Version 2 gehört der Store dazu: fehlt er, ist die Datei ungültig.
    expect(codeOf(() => parseBackupObject({ ...old, data }))).toBe('INVALID');
  });

  it('lehnt ungültige Daten ab', () => {
    const cases: ((d: Record<string, any>) => void)[] = [
      (d) => (d.goals[0].title = 42),
      (d) => (d.habits[0].kind = 'IRGENDWAS'),
      (d) => (d.checkIns[0].localDate = '2026-13-01'),
      (d) => (d.checkIns[0].outcome = 'YES'), // passt nicht zu einem normalen Habit
      (d) => (d.checkIns[1].localDate = d.checkIns[0].localDate), // zwei Check-ins für denselben Tag
      (d) => (d.checkIns[0].habitId = 'gibt-es-nicht'),
      (d) => (d.habits[0].goalId = 'gibt-es-nicht'),
      (d) => (d.habitEvents[0].habitId = 'h-alt'), // Ereignis eines gelöschten Habits
      (d) => (d.weeklyReviews[0].entries[0].habitId = 'gibt-es-nicht'),
      (d) => (d.goals[0].title = 'x'.repeat(5001)),
      (d) => (d.preferences.theme = 'pink'),
      (d) => delete d.checkIns,
    ];
    for (const change of cases) {
      const file = clone(backup()) as unknown as { data: Record<string, any> };
      change(file.data);
      expect(codeOf(() => parseBackupObject(file)), change.toString()).toBe('INVALID');
    }
  });

  it('übernimmt nur bekannte Felder', () => {
    const file = clone(backup()) as unknown as { data: Record<string, any> };
    file.data.goals[0].score = 99;
    file.data.extra = [1];
    const parsed = parseBackupObject(file);
    expect(parsed.kind === 'plain' && parsed.backup.data.goals[0]).not.toHaveProperty('score');
    expect(parsed.kind === 'plain' && parsed.backup.data).not.toHaveProperty('extra');
  });

  it('zu große Dateien werden vor dem Lesen abgelehnt', async () => {
    let read = false;
    const huge = { size: 20 * 1024 * 1024 + 1, text: async () => ((read = true), '{}') };
    await expect(readBackupFile(huge)).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(read).toBe(false);
  });

  it('validateSnapshot liefert eine bereinigte Kopie', () => {
    const data = sampleSnapshot();
    expect(validateSnapshot(clone(data))).toEqual(data);
  });
});

describe('Verschlüsselter Export', () => {
  it('Roundtrip mit dem richtigen Passwort; die Hülle verrät keine Inhalte', async () => {
    const plain = JSON.stringify(backup());
    const envelope = await encryptText(plain, 'richtig-langes-passwort', 1000);
    const text = JSON.stringify(envelope);
    expect(text).not.toContain('Mehr Bewegung');
    expect(envelope).toMatchObject({ format: 'live-backup-encrypted', formatVersion: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256' } });

    const read = await readBackupFile(fileOf(text));
    expect(read.kind).toBe('needs-password');
    if (read.kind !== 'needs-password') return;
    const ready = await unlockBackup(read.envelope, 'richtig-langes-passwort');
    expect(ready.backup.data).toEqual(sampleSnapshot());
    expect(ready.summary.checkIns).toBe(2);
  });

  it('falsches Passwort ergibt eine verständliche Meldung statt Datenmüll', async () => {
    const envelope = await encryptText(JSON.stringify(backup()), 'richtig-langes-passwort', 1000);
    await expect(unlockBackup(envelope, 'falsches-passwort')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    await expect(unlockBackup(envelope, 'falsches-passwort')).rejects.toBeInstanceOf(ImportError);
  });

  it('veränderte Chiffretexte werden erkannt', async () => {
    const envelope = await encryptText(JSON.stringify(backup()), 'richtig-langes-passwort', 1000);
    const tampered = { ...envelope, ciphertext: `A${envelope.ciphertext.slice(1)}` };
    if (tampered.ciphertext === envelope.ciphertext) tampered.ciphertext = `B${envelope.ciphertext.slice(1)}`;
    await expect(unlockBackup(tampered, 'richtig-langes-passwort')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
  });

  it('nutzt im Betrieb 600 000 Iterationen', async () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    const envelope = await encryptText('{}', 'richtig-langes-passwort');
    expect(envelope.kdf.iterations).toBe(600_000);
  });

  it('lehnt unplausible Hüllen ab', () => {
    const base = { format: 'live-backup-encrypted', formatVersion: 1, cipher: { name: 'AES-GCM', iv: 'AAAA' }, ciphertext: 'AAAA' };
    expect(codeOf(() => parseBackupObject({ ...base, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1e9, salt: 'AAAA' } }))).toBe(
      'INVALID',
    );
    expect(codeOf(() => parseBackupObject({ ...base, kdf: { name: 'scrypt', hash: 'SHA-256', iterations: 1000, salt: 'AAAA' } }))).toBe(
      'INVALID',
    );
    expect(codeOf(() => parseBackupObject({ ...base, formatVersion: 2 }))).toBe('NEWER_VERSION');
  });
});

describe('Backup-Hinweis', () => {
  const prefs = (patch: object) => ({ ...defaultPreferences(NOW), ...patch });

  it('erscheint erst, wenn der letzte Export mehr als 14 Tage zurückliegt', () => {
    const p = prefs({ lastBackupAt: '2026-01-01T10:00:00.000Z' });
    expect(backupReminderDue(p, '2026-01-15')).toBe(false);
    expect(backupReminderDue(p, '2026-01-16')).toBe(true);
  });

  it('ohne Export zählt der erste Start', () => {
    const p = prefs({ onboardingCompletedAt: '2026-01-01T10:00:00.000Z' });
    expect(backupReminderDue(p, '2026-01-15')).toBe(false);
    expect(backupReminderDue(p, '2026-01-16')).toBe(true);
  });

  it('lässt sich abschalten', () => {
    const p = prefs({ lastBackupAt: '2026-01-01T10:00:00.000Z', backupReminderEnabled: false });
    expect(backupReminderDue(p, '2026-03-01')).toBe(false);
  });
});
