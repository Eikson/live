/**
 * Bittet den Browser, die Daten dieser App nicht automatisch zu räumen.
 * Das Ergebnis ist nur ein Hinweis; ein Backup per Export bleibt wichtig.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export type PersistenceStatus = 'persisted' | 'not-persisted' | 'unknown';

/** Hat der Browser zugesagt, die Daten nicht automatisch zu räumen? Nur zur Anzeige. */
export async function getPersistenceStatus(): Promise<PersistenceStatus> {
  try {
    if (!navigator.storage?.persisted) return 'unknown';
    return (await navigator.storage.persisted()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unknown';
  }
}
