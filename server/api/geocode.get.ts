import { $fetch } from 'ofetch'

export default defineEventHandler(async (event) => {
  const { q } = getQuery(event)
  if (!q) return []

  try {
    const data = await $fetch('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress', {
      query: {
        address: q,
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

  // Fallback to OpenStreetMap Nominatim for anything the Census geocoder misses
  try {
    const nom = await $fetch('https://nominatim.openstreetmap.org/search', {
      query: {
        q,
        format: 'json',
        limit: 5,
        countrycodes: 'us',
        'accept-language': 'en-US',
        viewbox: '-83.29,42.25,-82.91,42.45'
      },
      headers: {
        'User-Agent': 'DPSCD School Finder'
      }
    })
    return (nom || []).map((r: any) => ({
      name: r.display_name,
      lat: Number(r.lat),
      lon: Number(r.lon)
    }))
  } catch (err) {
    console.error('Nominatim fallback error:', err)
    return []
  }
})
