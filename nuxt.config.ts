export default defineNuxtConfig({
  ssr: false,
  css: ['leaflet/dist/leaflet.css'],
  devtools: { enabled: false },
  compatibilityDate: '2026-08-10',
  app: {
    head: {
      title: 'DPSCD Bus Stop Locator',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ]
    }
  },
  runtimeConfig: {
    busStopUpdatePassword: ''
  }
})
