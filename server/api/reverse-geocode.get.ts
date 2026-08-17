import { $fetch } from 'ofetch'

export default defineEventHandler(async (event) => {
  const { lat, lon } = getQuery(event)
  if (!lat || !lon) return { name: '' }

  try {
    const r = await $fetch('https://nominatim.openstreetmap.org/reverse', {
      query: {
        format: 'json',
        lat: String(lat),
        lon: String(lon),
        zoom: 18,
        addressdetails: 1
      },
      headers: {
        'User-Agent': 'DPSCD School Finder'
      }
    })
    return {
      name: r?.display_name || '',
      lat: Number(r?.lat || lat),
      lon: Number(r?.lon || lon)
    }
  } catch (err) {
    console.error('Reverse geocode error:', err)
    return { name: '' }
  }
})
