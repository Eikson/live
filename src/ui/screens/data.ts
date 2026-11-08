import {
  ImportError,
  exportBackup,
  importMerge,
  importReplace,
  markBackupDone,
  readBackupFile,
  unlockBackup,
  type ReadResult,
} from '../../app/backup';
import type { EncryptedBackupFile } from '../../domain/backup-schema';
import { de } from '../../i18n/de';
import { APP_VERSION } from '../../platform/app-version';
import { canShareFiles, downloadText, pickedFile, shareText } from '../../platform/files';
import { h, uid } from '../dom';
import { formatDate, formatInstantDate } from '../format';
import { routeHref } from '../router';
import type { Screen } from '../screen';

const MIN_PASSWORD = 8;
type Ready = Extract<ReadResult, { kind: 'ready' }>;

/**
 * Datenhoheit (Abschnitt 7): Export (optional verschlüsselt) und Import mit Vorschau,
 * „Zusammenführen“ oder „Ersetzen“. Nach einem Import lädt die App neu, damit jede Ansicht
 * den neuen Bestand zeigt.
 */
export const dataScreen: Screen = async ({ ctx, params }) => {
  const t = de.data;
  const prefs = await ctx.repo.getPreferences();

  const done = params.get('import');
  const status = h(
    'p',
    { class: 'status-line', role: 'status', tabindex: '-1', 'data-role': 'data-status' },
    done === 'ersetzt' ? t.replaced : done === 'zusammengefuehrt' ? t.merged : '',
  );
  const error = h('p', { class: 'form-error', role: 'alert', tabindex: '-1', 'data-role': 'data-error', hidden: true });

  function showError(text: string): void {
    status.textContent = '';
    error.textContent = text;
    error.hidden = false;
    error.focus();
  }
  function showStatus(text: string): void {
    error.hidden = true;
    status.textContent = text;
    status.focus();
  }

  // ---------- Export ----------
  const lastBackup = h(
    'p',
    { class: 'muted', 'data-role': 'last-backup' },
    prefs.lastBackupAt ? t.lastBackup(formatInstantDate(prefs.lastBackupAt)) : t.noBackup,
  );
  const pw1Id = uid('export-password');
  const pw2Id = uid('export-password-repeat');
  const pw1 = h('input', { id: pw1Id, type: 'password', name: 'password', autocomplete: 'new-password', minlength: MIN_PASSWORD });
  const pw2 = h('input', { id: pw2Id, type: 'password', name: 'passwordRepeat', autocomplete: 'new-password' });
  const passwords = h(
    'div',
    { class: 'password-fields', hidden: true },
    h('div', { class: 'field' }, h('label', { for: pw1Id }, t.password), pw1),
    h('div', { class: 'field' }, h('label', { for: pw2Id }, t.passwordRepeat), pw2),
    h('p', { class: 'hint' }, t.passwordHint),
  );
  const encrypt = h('input', {
    type: 'checkbox',
    name: 'encrypt',
    onchange: () => {
      passwords.hidden = !encrypt.checked;
      if (encrypt.checked) pw1.focus();
    },
  });
  const share = canShareFiles();
  const exportLabel = share ? t.share : t.download;
  const exportButton = h(
    'button',
    { type: 'button', class: 'button primary', 'data-action': 'export', onclick: () => void runExport() },
    exportLabel,
  );

  async function runExport(): Promise<void> {
    let password: string | undefined;
    if (encrypt.checked) {
      if (pw1.value.length < MIN_PASSWORD) return showError(t.passwordShort);
      if (pw1.value !== pw2.value) return showError(t.passwordMismatch);
      password = pw1.value;
    }
    exportButton.disabled = true;
    exportButton.textContent = t.working;
    try {
      const file = await exportBackup(ctx, APP_VERSION, password === undefined ? {} : { password });
      if (share) {
        const result = await shareOrDownload(file.fileName, file.text);
        if (result === 'cancelled') return showStatus(t.exportCancelled);
      } else {
        downloadText(file.fileName, file.text);
      }
      await markBackupDone(ctx);
      lastBackup.textContent = t.lastBackup(formatInstantDate(ctx.clock.now().toISOString()));
      pw1.value = '';
      pw2.value = '';
      showStatus(t.exported(file.fileName));
    } catch {
      showError(t.exportFailed);
    } finally {
      exportButton.disabled = false;
      exportButton.textContent = exportLabel;
    }
  }

  const exportSection = h(
    'fieldset',
    { class: 'card', 'data-role': 'export' },
    h('legend', null, t.exportHeading),
    h('p', { class: 'hint' }, t.exportPersonal),
    h('label', { class: 'choice' }, encrypt, h('span', null, t.encrypt)),
    passwords,
    h('div', { class: 'actions' }, exportButton),
    lastBackup,
  );

  // ---------- Import ----------
  const fileId = uid('import-file');
  const fileInput = h('input', {
    id: fileId,
    type: 'file',
    name: 'importFile',
    accept: '.json,application/json',
    onchange: () => void chooseFile(),
  });
  const step = h('div', { class: 'import-step', 'data-role': 'import-step' });

  function importErrorText(e: unknown): string {
    return e instanceof ImportError ? t.errors[e.code] : t.importFailed;
  }

  async function chooseFile(): Promise<void> {
    const file = fileInput.files?.[0];
    step.replaceChildren();
    if (!file) return;
    error.hidden = true;
    status.textContent = '';
    try {
      const result = await readBackupFile(pickedFile(file));
      if (result.kind === 'needs-password') showUnlock(result.envelope);
      else showPreview(result);
    } catch (e) {
      showError(importErrorText(e));
    }
  }

  function showUnlock(envelope: EncryptedBackupFile): void {
    const id = uid('import-password');
    const input = h('input', { id, type: 'password', name: 'importPassword', autocomplete: 'current-password' });
    const button = h('button', { type: 'submit', class: 'button primary' }, t.unlock);
    const form = h(
      'form',
      {
        class: 'card',
        'data-role': 'import-unlock',
        onsubmit: async (event: Event) => {
          event.preventDefault();
          button.disabled = true;
          button.textContent = t.working;
          try {
            showPreview(await unlockBackup(envelope, input.value));
          } catch (e) {
            showError(importErrorText(e));
          } finally {
            button.disabled = false;
            button.textContent = t.unlock;
          }
        },
      },
      h('p', null, t.unlockIntro),
      h('div', { class: 'field' }, h('label', { for: id }, t.password), input),
      h('div', { class: 'actions' }, button),
    );
    step.replaceChildren(form);
    input.focus();
  }

  function showPreview(ready: Ready): void {
    error.hidden = true;
    const s = ready.summary;
    const heading = h('h2', { tabindex: '-1' }, t.previewHeading);
    const bar = h('div', { class: 'import-actions' });
    const card = h(
      'div',
      { class: 'card', 'data-role': 'import-preview' },
      heading,
      h('p', null, t.previewExportedAt(formatInstantDate(s.exportedAt))),
      h('p', null, t.previewCounts(s.goals, s.habits, s.checkIns)),
      h('p', { class: 'muted' }, s.from && s.to ? t.previewRange(formatDate(s.from), formatDate(s.to)) : t.previewNoCheckIns),
      bar,
    );

    const busy = (on: boolean) => bar.querySelectorAll('button').forEach((b) => (b.disabled = on));

    async function run(
      kind: 'zusammengefuehrt' | 'ersetzt',
      action: () => Promise<void>,
      fallback: () => string = () => t.importFailed,
    ): Promise<void> {
      busy(true);
      try {
        await action();
      } catch (e) {
        busy(false);
        return showError(e instanceof ImportError ? importErrorText(e) : fallback());
      }
      // Neu laden, damit alle Ansichten (und der Erststart-Status) den neuen Bestand sehen.
      history.replaceState(null, '', routeHref('daten', { import: kind }));
      location.reload();
    }

    const merge = () => run('zusammengefuehrt', () => importMerge(ctx, ready.backup));
    const replace = () => {
      // Scheitert es vor dem Speichern der Sicherheitskopie, nennt die Meldung genau das.
      let safetySaved = false;
      return run(
        'ersetzt',
        () =>
          importReplace(ctx, ready.backup, APP_VERSION, async (copy) => {
            downloadText(copy.fileName, copy.text);
            safetySaved = true;
          }),
        () => (safetySaved ? t.importFailed : t.safetyFailed),
      );
    };

    function showChoices(): void {
      bar.replaceChildren(
        h(
          'div',
          { class: 'import-choice' },
          h('button', { type: 'button', class: 'button primary', 'data-action': 'merge', onclick: () => void merge() }, t.merge),
          h('p', { class: 'hint' }, t.mergeHint),
        ),
        h(
          'div',
          { class: 'import-choice' },
          h('button', { type: 'button', class: 'button', 'data-action': 'replace', onclick: askReplace }, t.replace),
          h('p', { class: 'hint' }, t.replaceHint),
        ),
      );
    }

    function askReplace(): void {
      const question = h('p', { class: 'confirm-text', tabindex: '-1', 'data-role': 'confirm' }, t.replaceQuestion);
      bar.replaceChildren(
        h(
          'div',
          { class: 'confirm' },
          question,
          h(
            'div',
            { class: 'actions' },
            h(
              'button',
              { type: 'button', class: 'button primary', 'data-action': 'replace-confirm', onclick: () => void replace() },
              t.replaceConfirm,
            ),
            h('button', { type: 'button', class: 'button quiet', onclick: showChoices }, t.cancel),
          ),
        ),
      );
      question.focus();
    }

    showChoices();
    step.replaceChildren(card);
    heading.focus();
  }

  const importSection = h(
    'fieldset',
    { class: 'card', 'data-role': 'import' },
    h('legend', null, t.importHeading),
    h('p', null, t.importIntro),
    h('div', { class: 'field' }, h('label', { for: fileId }, t.chooseFile), fileInput),
    step,
  );

  return h(
    'section',
    { class: 'screen' },
    h('h1', { tabindex: '-1' }, t.heading),
    h('p', null, t.intro),
    status,
    error,
    exportSection,
    importSection,
    h('p', null, h('a', { class: 'button link', href: routeHref('gespeichert') }, t.toStored)),
  );
};

/** Teilen; lehnt der Browser das Teilen ab (z. B. weil die Geste zu lange her ist), wird heruntergeladen. */
async function shareOrDownload(fileName: string, text: string): Promise<'shared' | 'cancelled' | 'downloaded'> {
  try {
    return await shareText(fileName, text);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotAllowedError') {
      downloadText(fileName, text);
      return 'downloaded';
    }
    throw e;
  }
}
