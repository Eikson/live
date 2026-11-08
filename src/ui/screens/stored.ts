import { de } from '../../i18n/de';
import { getPersistenceStatus } from '../../platform/storage';
import { h } from '../dom';
import { routeHref } from '../router';
import type { Screen } from '../screen';

/**
 * „Was wird gespeichert?“ (Abschnitt 7): wo die Daten liegen, was gespeichert wird und was nicht,
 * und ob der Browser dauerhaften Speicher zugesagt hat. Keine falschen Versprechen.
 */
export const storedScreen: Screen = async () => {
  const t = de.stored;
  const persistence = await getPersistenceStatus();
  return h(
    'section',
    { class: 'screen info' },
    h('h1', { tabindex: '-1' }, t.heading),
    h('h2', null, t.whereHeading),
    t.where.map((text) => h('p', null, text)),
    h('h2', null, t.whatHeading),
    h('ul', null, t.what.map((text) => h('li', null, text))),
    h('h2', null, t.notHeading),
    h('p', null, t.not),
    h('h2', null, t.statusHeading),
    h('p', { 'data-role': 'persistence', 'data-status': persistence }, t.status[persistence]),
    h('p', null, t.exportAdvice),
    h('p', null, h('a', { class: 'button', href: routeHref('daten') }, t.toData)),
  );
};
