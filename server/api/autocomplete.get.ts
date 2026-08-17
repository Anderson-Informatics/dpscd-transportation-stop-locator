import { $fetch } from 'ofetch'

export default defineEventHandler(async (event) => {
  const { input } = getQuery(event)
  if (!input) return []

  const config = useRuntimeConfig()
  const apiKey = config.googleMapsApiKey
  if (!apiKey) return []

  try {
    const data = await $fetch('https://maps.googleapis.com/maps/api/place/autocomplete/json', {
      query: {
        input: String(input),
        key: apiKey,
        components: 'country:us',
        location: '42.3314,-83.0458',
        radius: 120000,
        strictbounds: 'true',
        types: 'address'
      }
    })
    const predictions = data?.predictions || []
    return predictions.map((p: any) => ({
      description: p.description,
      place_id: p.place_id,
      main_text: p.structured_formatting?.main_text || p.description
    }))
  } catch (err) {
    console.error('Google autocomplete error:', err)
    return []
  }
})
