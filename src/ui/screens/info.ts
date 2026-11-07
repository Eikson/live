import { de } from '../../i18n/de';
import { h } from '../dom';
import { routeHref } from '../router';
import type { Screen } from '../screen';

/** Infoseite: was Live ist und nicht ist, Datenhaltung, Bedeutung der Werte. Ohne Krisenkontakte (Spezifikation). */
export const infoScreen: Screen = async () =>
  h(
    'section',
    { class: 'screen info' },
    h('h1', { tabindex: '-1' }, de.info.heading),
    de.info.sections.map((s) => h('section', { class: 'card' }, h('h2', null, s.title), s.body.map((p) => h('p', null, p)))),
    h('p', null, h('a', { class: 'button link', href: routeHref('verlauf') }, de.info.back)),
  );
