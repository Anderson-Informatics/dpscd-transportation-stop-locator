import { $fetch } from 'ofetch'

export default defineEventHandler(async (event) => {
  const { placeId } = getQuery(event)
  if (!placeId) return null

  const config = useRuntimeConfig()
  const apiKey = config.googleMapsApiKey
  if (!apiKey) return null

  try {
    const data = await $fetch('https://maps.googleapis.com/maps/api/place/details/json', {
      query: {
        place_id: String(placeId),
        key: apiKey,
        fields: 'formatted_address,geometry'
      }
    })
    const r = data?.result
    if (!r) return null
    return {
      name: r.formatted_address,
      lat: r.geometry.location.lat,
      lon: r.geometry.location.lng
    }
  } catch (err) {
    console.error('Google place details error:', err)
    return null
  }
})
