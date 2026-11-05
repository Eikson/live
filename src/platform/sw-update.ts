import { registerSW } from 'virtual:pwa-register';

/**
 * Registriert den Service Worker. Eine neue Version wird erst nach Bestätigung aktiviert,
 * damit ein geöffnetes Formular nicht verloren geht.
 */
export function setupServiceWorker(onUpdateAvailable: (reload: () => Promise<void>) => void): void {
  if (!('serviceWorker' in navigator)) return;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      onUpdateAvailable(() => update(true));
    },
  });
}
