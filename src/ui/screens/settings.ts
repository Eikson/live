import { deleteAllData } from '../../app/backup';
import type { AppContext } from '../../app/context';
import { setTheme, updatePreferences } from '../../app/preferences';
import { backupReminderDue } from '../../domain/backup-reminder';
import { toLocalDate, type Weekday } from '../../domain/local-date';
import type { Preferences, Theme } from '../../domain/types';
import { de } from '../../i18n/de';
import { applyTheme } from '../../platform/theme';
import { clearUiMemory } from '../../platform/ui-memory';
import { h, uid } from '../dom';
import { formatInstantDate, WEEK_ORDER } from '../format';
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

  const eveningId = uid('evening-from');
  const evening = h(
    'fieldset',
    { class: 'card' },
    h('legend', null, de.settings.evening),
    h(
      'div',
      { class: 'field' },
      h('label', { for: eveningId }, de.settings.eveningFrom),
      h('input', {
        id: eveningId,
        type: 'time',
        name: 'eveningCardFrom',
        value: prefs.eveningCardFrom,
        onchange: (e) => {
          const value = (e.target as HTMLInputElement).value;
          if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) void save({ eveningCardFrom: value });
        },
      }),
    ),
    h('p', { class: 'hint' }, de.settings.eveningHint),
  );

  const today = toLocalDate(ctx.clock.now());
  const data = h(
    'fieldset',
    { class: 'card', 'data-role': 'settings-data' },
    h('legend', null, de.settings.data),
    h(
      'p',
      { class: 'muted', 'data-role': 'last-backup' },
      prefs.lastBackupAt ? de.settings.lastBackup(formatInstantDate(prefs.lastBackupAt)) : de.settings.noBackup,
    ),
    backupReminderDue(prefs, today) ? h('p', { 'data-role': 'backup-due' }, de.settings.backupDue) : null,
    h('p', null, h('a', { class: 'button', href: routeHref('daten') }, de.settings.toData)),
    h(
      'label',
      { class: 'choice' },
      h('input', {
        type: 'checkbox',
        name: 'backupReminderEnabled',
        checked: prefs.backupReminderEnabled,
        onchange: (e) => void save({ backupReminderEnabled: (e.target as HTMLInputElement).checked }),
      }),
      h('span', null, de.settings.backupReminder),
    ),
    h('p', null, h('a', { class: 'button link', href: routeHref('gespeichert') }, de.settings.toStored)),
  );

  return h(
    'section',
    { class: 'screen' },
    h('h1', { tabindex: '-1' }, de.settings.heading),
    h('fieldset', { class: 'card segmented' }, h('legend', null, de.settings.appearance), options),
    review,
    evening,
    data,
    status,
    saved,
    h('p', null, h('a', { class: 'button link', href: routeHref('installieren') }, de.settings.install)),
    h('p', null, h('a', { class: 'button link', href: routeHref('info') }, de.settings.info)),
    deleteAllSection(ctx),
  );
};

/** „Alle Daten löschen“: nur nach Eingabe von „löschen“. Danach startet die App neu beim Erststart. */
function deleteAllSection(ctx: AppContext): HTMLElement {
  const t = de.settings;
  const inputId = uid('delete-all');
  const input = h('input', { id: inputId, type: 'text', name: 'deleteConfirm', autocomplete: 'off', spellcheck: 'false' });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const button = h(
    'button',
    {
      type: 'button',
      class: 'button',
      'data-action': 'delete-all',
      onclick: async () => {
        if (input.value.trim().toLocaleLowerCase('de') !== t.deleteAllWord) {
          error.textContent = t.deleteAllMismatch;
          error.hidden = false;
          input.focus();
          return;
        }
        button.disabled = true;
        try {
          await deleteAllData(ctx);
        } catch {
          button.disabled = false;
          error.textContent = t.deleteAllFailed;
          error.hidden = false;
          return;
        }
        clearUiMemory();
        history.replaceState(null, '', routeHref('start'));
        location.reload();
      },
    },
    t.deleteAllButton,
  );
  return h(
    'fieldset',
    { class: 'card', 'data-role': 'delete-all' },
    h('legend', null, t.deleteAll),
    h('p', null, t.deleteAllBody),
    h('div', { class: 'field' }, h('label', { for: inputId }, t.deleteAllLabel), input),
    error,
    h('div', { class: 'actions' }, button),
  );
}
