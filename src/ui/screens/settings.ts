import { setTheme } from '../../app/preferences';
import type { Theme } from '../../domain/types';
import { de } from '../../i18n/de';
import { applyTheme } from '../../platform/theme';
import { h } from '../dom';
import type { Screen } from '../screen';

const THEMES: Theme[] = ['system', 'light', 'dark'];

export const settingsScreen: Screen = async ({ ctx }) => {
  const prefs = await ctx.repo.getPreferences();
  const status = h('p', { class: 'form-error', role: 'alert', hidden: true });

  const options = THEMES.map((theme) =>
    h(
      'label',
      { class: 'choice' },
      h('input', {
        type: 'radio',
        name: 'theme',
        value: theme,
        checked: prefs.theme === theme,
        onchange: async () => {
          applyTheme(theme);
          try {
            await setTheme(ctx, theme);
            status.hidden = true;
          } catch {
            status.textContent = de.errors.saveFailed;
            status.hidden = false;
          }
        },
      }),
      h('span', null, de.settings.themes[theme]),
    ),
  );

  return h(
    'section',
    { class: 'screen' },
    h('h1', { tabindex: '-1' }, de.settings.heading),
    h('fieldset', { class: 'card segmented' }, h('legend', null, de.settings.appearance), options),
    status,
    h('p', { class: 'muted' }, de.settings.later),
  );
};
