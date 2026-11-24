import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'push-sw.js', 'voice-worklet.js'],
      manifest: {
        id: '/',
        name: 'Agent Control',
        short_name: 'Agent',
        description: 'Chat, MCP, providers e controle do agente claude-zap',
        lang: 'pt-BR',
        start_url: '/#/chat',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f2f2f7',
        theme_color: '#f2f2f7',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: '/pwa-64.png', sizes: '64x64', type: 'image/png' },
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
        shortcuts: [
          { name: 'Chat', url: '/#/chat', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
          { name: 'MCP', url: '/#/mcp', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // App shell only: API calls (incl. the SSE stream) always go to the network.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['splash/**'],
        importScripts: ['/push-sw.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:3001' } },
});
