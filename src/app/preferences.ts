import type { Preferences, Theme } from '../domain/types';
import type { AppContext } from './context';

export async function updatePreferences(
  ctx: AppContext,
  patch: Partial<Omit<Preferences, 'id' | 'updatedAt'>>,
): Promise<Preferences> {
  const current = await ctx.repo.getPreferences();
  const next: Preferences = { ...current, ...patch, id: 'preferences', updatedAt: ctx.clock.now().toISOString() };
  await ctx.repo.commit({ preferences: next });
  return next;
}

export function setTheme(ctx: AppContext, theme: Theme): Promise<Preferences> {
  return updatePreferences(ctx, { theme });
}
