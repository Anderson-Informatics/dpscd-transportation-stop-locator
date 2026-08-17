import { $fetch } from 'ofetch'

export default defineEventHandler(async (event) => {
  const { q } = getQuery(event)
  if (!q) return []

  const raw = String(q).trim()
  const input = /detroit/i.test(raw) ? raw : `${raw}, Detroit, MI`
  const config = useRuntimeConfig()
  const apiKey = config.googleMapsApiKey

  // Try Google first if an API key is configured.
  if (apiKey) {
    try {
      const data = await $fetch('https://maps.googleapis.com/maps/api/geocode/json', {
        query: {
          address: input,
          key: apiKey
        }
      })
      const results = data?.results || []
      if (results.length) {
        return results.map((r: any) => ({
          name: r.formatted_address,
          lat: r.geometry.location.lat,
          lon: r.geometry.location.lng
        }))
      }
    } catch (err) {
      console.error('Google geocode error:', err)
    }
  }

  // Fallback to the Census geocoder.
  try {
    const data = await $fetch('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress', {
      query: {
        address: raw,
        benchmark: '4',
        format: 'json'
      }
    })
    const matches = data?.result?.addressMatches || []
    if (matches.length) {
      return matches.map((m: any) => ({
        name: m.matchedAddress,
        lat: Number(m.coordinates.y),
        lon: Number(m.coordinates.x)
      }))
    }
  } catch (err) {
    console.error('Census geocode error:', err)
  }

  return []
})
