import { appConfig } from './app-config';
import type { AvoidanceItem } from './types';

export type AvoidanceLabelError = 'REQUIRED' | 'TOO_LONG' | 'DUPLICATE';

/**
 * Prüft einen Eintrag der persönlichen Ausweichliste. Doppelte Einträge (ohne Groß-/Kleinschreibung)
 * sind nicht erlaubt, ausgenommen der Eintrag selbst beim Umbenennen.
 */
export function normalizeAvoidanceLabel(
  label: string,
  items: readonly AvoidanceItem[],
  exceptId?: string,
): { ok: true; label: string } | { ok: false; error: AvoidanceLabelError } {
  const value = label.trim().replace(/\s+/g, ' ');
  if (!value) return { ok: false, error: 'REQUIRED' };
  if (value.length > appConfig.textLimits.short) return { ok: false, error: 'TOO_LONG' };
  const key = value.toLocaleLowerCase('de');
  if (items.some((i) => i.id !== exceptId && i.label.toLocaleLowerCase('de') === key)) {
    return { ok: false, error: 'DUPLICATE' };
  }
  return { ok: true, label: value };
}

/** Neue Einträge kommen ans Ende der Liste. */
export function nextAvoidanceOrder(items: readonly AvoidanceItem[]): number {
  return items.reduce((max, i) => Math.max(max, i.order), -1) + 1;
}

export function sortAvoidanceItems(items: readonly AvoidanceItem[]): AvoidanceItem[] {
  return [...items].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}
