export default defineNuxtConfig({
  ssr: false,
  css: ['leaflet/dist/leaflet.css'],
  devtools: { enabled: false },
  compatibilityDate: '2026-08-10',
  app: {
    head: {
      title: 'DPSCD Bus Stop Locator',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0033CC' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }
      ]
    }
  },
  modules: [
    '@vite-pwa/nuxt'
  ],
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: 'DPSCD Bus Stop Locator',
      short_name: 'Bus Stops',
      description: 'Find bus stops near Detroit Public Schools Community District locations.',
      display: 'standalone',
      theme_color: '#0033CC',
      background_color: '#ffffff',
      start_url: '/',
      orientation: 'any',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,ico,woff2}'],
      globIgnores: ['**/data/**'],
      navigateFallbackDenylist: [/^\/api\//],
      runtimeCaching: [
        {
          urlPattern: /\/data\/.*\.(json|geojson)$/,
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'app-data' }
        },
        {
          urlPattern: /^https:\/\/[a-zA-Z0-9-]+\.basemaps\.cartocdn\.com\//,
          handler: 'CacheFirst',
          options: {
            cacheName: 'map-tiles',
            expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 }
          }
        },
        {
          urlPattern: /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//,
          handler: 'CacheFirst',
          options: {
            cacheName: 'fonts',
            expiration: { maxAgeSeconds: 60 * 60 * 24 * 365 }
          }
        },
        {
          urlPattern: /^\/api\//,
          handler: 'NetworkOnly'
        }
      ]
    },
    devOptions: { enabled: false }
  },
  runtimeConfig: {
    busStopUpdatePassword: '',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || ''
  }
})
