import { appConfig } from '../domain/app-config';
import type { LocalDate } from '../domain/local-date';
import { de } from '../i18n/de';
import { h } from './dom';
import { formatDayShort } from './format';

/** Auswahl des Tages: heute oder bis zu sieben Tage zurück. */
export function dayPicker(
  view: { today: LocalDate; day: LocalDate; days: readonly LocalDate[] },
  onPick: (day: LocalDate) => void,
): HTMLElement {
  return h(
    'details',
    { class: 'day-picker', open: view.day !== view.today },
    h('summary', { class: 'button link' }, de.today.pickDay),
    h('p', { class: 'hint' }, de.today.backfillHint(appConfig.checkInBackfillDays)),
    h(
      'ul',
      { 'aria-label': de.today.pickDayLabel },
      view.days.map((d) =>
        h(
          'li',
          null,
          h(
            'button',
            {
              type: 'button',
              class: 'button quiet',
              'aria-pressed': String(d === view.day),
              'data-day': d,
              onclick: () => onPick(d),
            },
            d === view.today ? de.today.todayOption : formatDayShort(d),
          ),
        ),
      ),
    ),
  );
}
