import {
  BackupError,
  backupSummary,
  createBackup,
  parseBackupText,
  validateSnapshot,
  type BackupFile,
  type BackupSummary,
  type EncryptedBackupFile,
} from '../domain/backup-schema';
import { appConfig } from '../domain/app-config';
import { mergeSnapshots } from '../domain/merge';
import { today } from '../platform/clock';
import { decryptText, encryptText, PBKDF2_ITERATIONS } from '../platform/crypto';
import type { AppContext } from './context';
import { updatePreferences } from './preferences';

/**
 * Datenhoheit (Abschnitt 7): Export, Import mit „Ersetzen“ oder „Zusammenführen“, Alles löschen.
 * Beide Importwege sind transaktional – vollständig oder gar nicht.
 */
export type ImportErrorCode = 'TOO_LARGE' | 'NOT_JSON' | 'UNKNOWN_FORMAT' | 'NEWER_VERSION' | 'INVALID' | 'WRONG_PASSWORD';

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ImportError';
  }
}

export interface ExportedFile {
  fileName: string;
  text: string;
}

export interface ExportOptions {
  password?: string;
  /** Nur für Tests kleiner; im Betrieb immer 600 000. */
  iterations?: number;
  /** Dateiname-Präfix, z. B. für die Sicherheitskopie. */
  prefix?: string;
}

/** Erzeugt die vollständige Exportdatei (offline, ohne Netzwerk). */
export async function exportBackup(ctx: AppContext, appVersion: string, options: ExportOptions = {}): Promise<ExportedFile> {
  const data = await ctx.repo.loadSnapshot();
  const backup = createBackup(data, ctx.clock.now().toISOString(), appVersion);
  const text = JSON.stringify(backup, null, 2);
  const day = today(ctx.clock);
  const prefix = options.prefix ?? 'live-backup';
  if (options.password === undefined) return { fileName: `${prefix}-${day}.json`, text };
  const envelope = await encryptText(text, options.password, options.iterations ?? PBKDF2_ITERATIONS);
  return { fileName: `${prefix}-${day}-verschluesselt.json`, text: JSON.stringify(envelope, null, 2) };
}

/** Nach erfolgreichem Teilen oder Herunterladen: Zeitpunkt des letzten Backups merken. */
export async function markBackupDone(ctx: AppContext): Promise<void> {
  await updatePreferences(ctx, { lastBackupAt: ctx.clock.now().toISOString() });
}

export type ReadResult =
  | { kind: 'needs-password'; envelope: EncryptedBackupFile }
  | { kind: 'ready'; backup: BackupFile; summary: BackupSummary };

export interface FileLike {
  size: number;
  text(): Promise<string>;
}

/** Prüft Größe, Format, Version und Daten. Verschlüsselte Dateien brauchen danach `unlockBackup`. */
export async function readBackupFile(file: FileLike): Promise<ReadResult> {
  if (file.size > appConfig.import.maxFileBytes) throw new ImportError('TOO_LARGE');
  return parse(await file.text(), true);
}

export async function unlockBackup(
  envelope: EncryptedBackupFile,
  password: string,
): Promise<Extract<ReadResult, { kind: 'ready' }>> {
  let text: string;
  try {
    text = await decryptText(envelope, password);
  } catch {
    throw new ImportError('WRONG_PASSWORD');
  }
  const result = parse(text, false);
  if (result.kind !== 'ready') throw new ImportError('INVALID', 'doppelt verschlüsselt');
  return result;
}

function parse(text: string, allowEncrypted: boolean): ReadResult {
  try {
    const parsed = parseBackupText(text);
    if (parsed.kind === 'encrypted') {
      if (!allowEncrypted) throw new ImportError('INVALID', 'doppelt verschlüsselt');
      return { kind: 'needs-password', envelope: parsed.envelope };
    }
    return { kind: 'ready', backup: parsed.backup, summary: backupSummary(parsed.backup) };
  } catch (error) {
    if (error instanceof BackupError) throw new ImportError(error.code, error.message);
    throw error;
  }
}

/**
 * Ersetzen: zuerst eine Sicherheitskopie des aktuellen Bestands ausgeben (`saveSafetyCopy`).
 * Scheitert das, bleibt alles unverändert. Danach wird der Bestand in einer Transaktion ersetzt.
 */
export async function importReplace(
  ctx: AppContext,
  backup: BackupFile,
  appVersion: string,
  saveSafetyCopy: (file: ExportedFile) => Promise<void>,
): Promise<void> {
  const safety = await exportBackup(ctx, appVersion, { prefix: 'live-sicherheitskopie' });
  await saveSafetyCopy(safety);
  const prefs = backup.data.preferences;
  // Der eingespielte Stand liegt als Datei vor: Das gilt als Backup zum Exportzeitpunkt.
  const lastBackupAt =
    prefs.lastBackupAt && Date.parse(prefs.lastBackupAt) > Date.parse(backup.exportedAt)
      ? prefs.lastBackupAt
      : backup.exportedAt;
  await ctx.repo.replaceAll({ ...backup.data, preferences: { ...prefs, lastBackupAt } });
}

/** Zusammenführen in einer Transaktion. Ist das Ergebnis nicht stimmig, wird nichts geschrieben. */
export async function importMerge(ctx: AppContext, backup: BackupFile): Promise<void> {
  await ctx.repo.updateAll((local) => {
    const merged = mergeSnapshots(local, backup.data);
    try {
      return validateSnapshot(merged);
    } catch (error) {
      if (error instanceof BackupError) throw new ImportError('INVALID', error.message);
      throw error;
    }
  });
}

/** Entfernt die komplette Datenbank (auch Löschmarkierungen). Danach lädt die App neu. */
export async function deleteAllData(ctx: AppContext): Promise<void> {
  await ctx.repo.destroy();
}
