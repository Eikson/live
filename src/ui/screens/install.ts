import { de } from '../../i18n/de';
import { canPromptInstall, isInstalled, promptInstall } from '../../platform/install';
import { h } from '../dom';
import { routeHref } from '../router';
import type { Screen } from '../screen';

/** Anleitung „App installieren“ (Abschnitt 6.7). Der Knopf erscheint nur, wenn der Browser ihn anbietet. */
export const installScreen: Screen = async () => {
  const t = de.install;
  let button: HTMLButtonElement | null = null;
  if (!isInstalled() && canPromptInstall()) {
    button = h(
      'button',
      {
        type: 'button',
        class: 'button primary',
        onclick: async () => {
          button!.disabled = true;
          await promptInstall();
          button!.hidden = true;
        },
      },
      t.button,
    );
  }
  return h(
    'section',
    { class: 'screen info' },
    h('h1', { tabindex: '-1' }, t.heading),
    h('p', null, t.intro),
    isInstalled() ? h('p', { 'data-role': 'installed' }, t.installed) : null,
    button ? h('p', null, button) : null,
    h('h2', null, t.androidHeading),
    h('ol', null, t.android.map((step) => h('li', null, step))),
    h('h2', null, t.desktopHeading),
    h('ol', null, t.desktop.map((step) => h('li', null, step))),
    h('h2', null, t.notesHeading),
    h('ul', null, t.notes.map((note) => h('li', null, note))),
    h('p', null, h('a', { class: 'button link', href: routeHref('einstellungen') }, t.back)),
  );
};
