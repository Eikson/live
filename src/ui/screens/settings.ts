import { setTheme, updatePreferences } from '../../app/preferences';
import type { Weekday } from '../../domain/local-date';
import type { Preferences, Theme } from '../../domain/types';
import { de } from '../../i18n/de';
import { applyTheme } from '../../platform/theme';
import { h, uid } from '../dom';
import { WEEK_ORDER } from '../format';
import { routeHref } from '../router';
import type { Screen } from '../screen';

const THEMES: Theme[] = ['system', 'light', 'dark'];

export const settingsScreen: Screen = async ({ ctx }) => {
  const prefs = await ctx.repo.getPreferences();
  const status = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const saved = h('p', { class: 'status-line', role: 'status', 'data-role': 'settings-status' });

  async function save(patch: Partial<Omit<Preferences, 'id' | 'updatedAt'>>): Promise<void> {
    try {
      await updatePreferences(ctx, patch);
      status.hidden = true;
      saved.textContent = de.settings.saved;
    } catch {
      saved.textContent = '';
      status.textContent = de.errors.saveFailed;
      status.hidden = false;
    }
  }

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

  const weekdayId = uid('review-weekday');
  const weekday = h(
    'select',
    {
      id: weekdayId,
      name: 'reviewWeekday',
      disabled: !prefs.reviewEnabled,
      onchange: (e) => void save({ reviewWeekday: Number((e.target as HTMLSelectElement).value) as Weekday }),
    },
    WEEK_ORDER.map((d) => h('option', { value: d, selected: prefs.reviewWeekday === d }, de.date.weekdaysLong[d])),
  );
  const suggestions = h('input', {
    type: 'checkbox',
    name: 'suggestionsEnabled',
    checked: prefs.suggestionsEnabled,
    disabled: !prefs.reviewEnabled,
    onchange: (e) => void save({ suggestionsEnabled: (e.target as HTMLInputElement).checked }),
  });
  const review = h(
    'fieldset',
    { class: 'card settings-review' },
    h('legend', null, de.settings.review),
    h(
      'label',
      { class: 'choice' },
      h('input', {
        type: 'checkbox',
        name: 'reviewEnabled',
        checked: prefs.reviewEnabled,
        onchange: (e) => {
          const on = (e.target as HTMLInputElement).checked;
          weekday.disabled = !on;
          suggestions.disabled = !on;
          void save({ reviewEnabled: on });
        },
      }),
      h('span', null, de.settings.reviewEnabled),
    ),
    h('div', { class: 'field' }, h('label', { for: weekdayId }, de.settings.reviewWeekday), weekday),
    h('label', { class: 'choice' }, suggestions, h('span', null, de.settings.suggestionsEnabled)),
    h('p', { class: 'hint' }, de.settings.suggestionsHint),
  );

  return h(
    'section',
    { class: 'screen' },
    h('h1', { tabindex: '-1' }, de.settings.heading),
    h('fieldset', { class: 'card segmented' }, h('legend', null, de.settings.appearance), options),
    review,
    status,
    saved,
    h('p', { class: 'muted' }, de.settings.later),
    h('p', null, h('a', { class: 'button link', href: routeHref('info') }, de.settings.info)),
  );
};
