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
