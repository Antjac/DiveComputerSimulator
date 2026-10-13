import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  // three.js (~580 kB) lives in its own chunk, loaded only when the 3D view is opened.
  build: { chunkSizeWarningLimit: 700 },
  plugins: [
    // Installable and fully offline: the service worker precaches every file of the build
    // (including the lazy three.js chunk and the embedded fonts); the app has no network dependency.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Dive Computer Simulator',
        short_name: 'DiveSim',
        description: 'Simulateur pédagogique d’ordinateurs de plongée / Educational dive computer simulator',
        lang: 'fr',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0e5a86',
        theme_color: '#0e5a86',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
