import { de } from '../../i18n/de';
import { h } from '../dom';

/** Wird gezeigt, wenn IndexedDB nicht verfügbar ist (z. B. privater Modus mit blockiertem Speicher). */
export function renderStorageError(): HTMLElement {
  return h(
    'main',
    { class: 'content error-screen', id: 'main' },
    h('h1', null, de.errors.storageTitle),
    h('p', null, de.errors.storageBody),
    h('button', { type: 'button', class: 'button', onclick: () => location.reload() }, de.errors.retry),
  );
}
