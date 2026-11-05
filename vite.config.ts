import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Für GitHub Pages später z. B. LIVE_BASE=/live/ setzen (siehe docs/entscheidungen.md).
const base = process.env.LIVE_BASE ?? '/';

export default defineConfig({
  base,
  build: { target: 'es2022', sourcemap: true },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Live',
        short_name: 'Live',
        description: 'Private App für Gewohnheiten und nächste Schritte.',
        lang: 'de',
        dir: 'ltr',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F5F0E8',
        theme_color: '#1D6B67',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
});
