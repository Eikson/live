import { de } from '../../i18n/de';
import { h } from '../dom';
import type { Screen } from '../screen';

export const historyScreen: Screen = async () =>
  h(
    'section',
    { class: 'screen' },
    h('h1', { tabindex: '-1' }, de.history.heading),
    h('p', { class: 'muted' }, de.history.placeholder),
  );
