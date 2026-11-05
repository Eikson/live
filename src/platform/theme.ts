import type { Theme } from '../domain/types';

/** Spiegel des Farbmodus in localStorage, nur damit beim Start nichts aufblitzt. Kein Nutzerinhalt. */
const KEY = 'live-theme';

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // privater Modus: ohne Spiegel weiter
  }
}

export function applyCachedTheme(): void {
  try {
    const cached = localStorage.getItem(KEY);
    if (cached === 'light' || cached === 'dark') document.documentElement.dataset.theme = cached;
  } catch {
    // ignorieren
  }
}
