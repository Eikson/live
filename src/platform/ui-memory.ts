/**
 * Unkritische Anzeige-Details in localStorage: welche Wiedereinstiegskarte ausgeblendet wurde.
 * Fehlt der Speicher (privater Modus), erscheint die Karte eben wieder. Kein Nutzerinhalt.
 */
const REENTRY_KEY = 'live-reentry-dismissed';

export function isReentryDismissed(since: string): boolean {
  try {
    return localStorage.getItem(REENTRY_KEY) === since;
  } catch {
    return false;
  }
}

export function dismissReentry(since: string): void {
  try {
    localStorage.setItem(REENTRY_KEY, since);
  } catch {
    // ohne Speicher: nur für diese Ansicht ausgeblendet
  }
}

/** "Später" beim Backup-Hinweis: für diesen Kalendertag ausgeblendet. */
const BACKUP_LATER_KEY = 'live-backup-later';

export function isBackupHintHiddenOn(day: string): boolean {
  try {
    return localStorage.getItem(BACKUP_LATER_KEY) === day;
  } catch {
    return false;
  }
}

export function hideBackupHintOn(day: string): void {
  try {
    localStorage.setItem(BACKUP_LATER_KEY, day);
  } catch {
    // ohne Speicher: nur für diese Ansicht ausgeblendet
  }
}

/** Beim Löschen aller Daten auch diese Anzeige-Details entfernen. */
export function clearUiMemory(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('live-')) localStorage.removeItem(key);
  } catch {
    // nichts zu tun
  }
}
