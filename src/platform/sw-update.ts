import { registerSW } from 'virtual:pwa-register';

/** Wie oft die App höchstens nach einer neuen Version fragt. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registriert den Service Worker. Eine neue Version wird erst nach Bestätigung aktiviert,
 * damit ein geöffnetes Formular nicht verloren geht. Nach einer neuen Version wird beim
 * Zurückkehren in die App und stündlich gefragt, aber nur mit Netz.
 */
export function setupServiceWorker(onUpdateAvailable: (reload: () => Promise<void>) => void): void {
  if (!('serviceWorker' in navigator)) return;
  let announced = false;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (announced) return;
      announced = true;
      onUpdateAvailable(() => update(true));
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      let lastCheck = Date.now();
      const check = (): void => {
        if (!navigator.onLine || Date.now() - lastCheck < CHECK_INTERVAL_MS) return;
        lastCheck = Date.now();
        // Ohne Netz oder bei einem Serverfehler bleibt einfach die aktuelle Version.
        registration.update().catch(() => undefined);
      };
      window.setInterval(check, CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}
