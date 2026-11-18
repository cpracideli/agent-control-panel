import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Agent Control',
        short_name: 'Agent',
        description: 'Chat, MCP, providers e controle do agente claude-zap',
        lang: 'pt-BR',
        start_url: '/#/chat',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b0f17',
        theme_color: '#2563eb',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Chat', url: '/#/chat', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
          { name: 'MCP', url: '/#/mcp', icons: [{ src: 'pwa-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        // App shell only: API calls (incl. the SSE stream) always go to the network.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:3001' } },
});
