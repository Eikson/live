/**
 * Installations-Hinweis: merkt sich das `beforeinstallprompt`-Ereignis (nur Chromium),
 * damit die Anleitung einen Knopf anbieten kann. Ohne das Ereignis bleibt die Anleitung in Worten.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;

export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
  });
}

/** Läuft Live gerade als installierte App (eigenes Fenster ohne Adressleiste)? */
export function isInstalled(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

/** Öffnet den Installationsdialog des Browsers. Das Ereignis lässt sich nur einmal nutzen. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  try {
    await event.prompt();
    return (await event.userChoice).outcome === 'accepted';
  } catch {
    return false;
  }
}
