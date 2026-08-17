const BATCH_SIZE = 1000

const DETROIT_CENTER = [42.3314, -83.0458]

const HARDCODED_OVERRIDES: Record<string, { lat: number, lng: number }> = {
  'TELEGRAPH RD & FENKELL ST': { lat: 42.408529, lng: -83.276723 },
  'TRUMBULL ST & 1-94 ON RAMP S': { lat: 42.3553647, lng: -83.0804855 }
}

// Rough bounding box for Detroit + Highland Park + Hamtramck + River Rouge + Ecorse
const ALLOWED_BOUNDS = {
  north: 42.45,
  south: 42.24,
  east: -82.89,
  west: -83.31
}

// A full run measures at ~170s: two batch POSTs resolve ~94% of stops and only the
// remainder take the slow per-address path. Netlify kills a background function at
// 15 minutes, so we bail out well before that rather than dying mid-write.
const DEADLINE_MS = 11 * 60 * 1000

// If the batch geocoder is down, every stop falls through to the slow path and the run
// would need ~45 minutes. Measured fallback rate is ~6%, so 35% means something is broken.
const FALLBACK_ABORT_RATIO = 0.35

export type Coords = { lat: number, lng: number }

export class GeocodeAbort extends Error {}

export type ProgressReporter = (stage: string, progress: number) => void

export function normalizeForGeocode(stop: string) {
  return stop
    .replace(/@/g, ' & ')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractDescription(stop: string): string | null {
  const match = stop.match(/\(([^)]*)\)/)
  return match ? match[1].trim() : null
}

function isWithinAllowedArea(lat: number, lng: number) {
  return lat >= ALLOWED_BOUNDS.south && lat <= ALLOWED_BOUNDS.north && lng >= ALLOWED_BOUNDS.west && lng <= ALLOWED_BOUNDS.east
}

function squaredDistanceToDetroit(lat: number, lng: number) {
  return Math.pow(lat - DETROIT_CENTER[0], 2) + Math.pow(lng - DETROIT_CENTER[1], 2)
}

function bestFromCandidates(candidates: Coords[]) {
  if (!candidates.length) return null
  let best: Coords | null = null
  let bestDist = Infinity
  for (const c of candidates) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue
    if (!isWithinAllowedArea(c.lat, c.lng)) continue
    const d = squaredDistanceToDetroit(c.lat, c.lng)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  if (best && bestDist < 0.1) return best
  return null
}

async function fetchWithTimeout(url: string | URL, options: RequestInit = {}, timeout = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function parseCensusBatchResponse(csv: string) {
  const results: Record<string, Coords | null> = {}
  const lines = csv.split(/\r?\n/).filter(Boolean)
  for (const line of lines) {
    const fields = (line.match(/"([^"]*)"/g) || []).map(s => s.slice(1, -1))
    if (fields.length < 6) continue
    const id = fields[0]
    const match = fields[2]
    const coords = fields[5]
    if (match !== 'Match' || !coords) {
      results[id] = null
      continue
    }
    const [x, y] = coords.split(',')
    if (!x || !y) {
      results[id] = null
      continue
    }
    results[id] = { lat: Number(y), lng: Number(x) }
  }
  return results
}

function buildBatchCsv(stops: string[]) {
  let csv = 'id,street,city,state,zip\n'
  for (let i = 0; i < stops.length; i++) {
    const street = normalizeForGeocode(stops[i])
    csv += `${i},${street},Detroit,MI,\n`
  }
  return csv
}

async function geocodeNominatim(address: string) {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', address)
    url.searchParams.set('format', 'json')
    url.searchParams.set('limit', '5')
    url.searchParams.set('countrycodes', 'us')
    url.searchParams.set('accept-language', 'en-US')
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'DPSCD School Finder' } }, 8000)
    const json = await res.json() as any
    if (!json || !json.length) return null
    return bestFromCandidates(json.map((r: any) => ({ lat: Number(r.lat), lng: Number(r.lon) })))
  } catch (err) {
    console.error('Nominatim fallback error:', err)
    return null
  }
}

async function geocodePhoton(address: string) {
  try {
    const url = new URL('https://photon.komoot.io/api/')
    url.searchParams.set('q', address)
    url.searchParams.set('limit', '5')
    url.searchParams.set('lat', String(DETROIT_CENTER[0]))
    url.searchParams.set('lon', String(DETROIT_CENTER[1]))
    const res = await fetchWithTimeout(url, {}, 10000)
    const json = await res.json() as any
    const features = json?.features || []
    if (!features.length) return null
    const candidates = features.map((f: any) => {
      const [lng, lat] = f.geometry.coordinates
      return { lat, lng }
    })
    return bestFromCandidates(candidates)
  } catch (err) {
    console.error('Photon fallback error:', err)
    return null
  }
}

async function geocodeSingleLine(stop: string): Promise<Coords | null> {
  const address = `${normalizeForGeocode(stop)}, Detroit, MI`
  const firstStreet = stop.split(' & ')[0]?.trim()

  try {
    const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress')
    url.searchParams.set('address', address)
    url.searchParams.set('benchmark', '4')
    url.searchParams.set('format', 'json')
    const res = await fetchWithTimeout(url, {}, 10000)
    const data = await res.json() as any
    const matches = data?.result?.addressMatches || []
    if (matches.length) {
      const match = { lat: Number(matches[0].coordinates.y), lng: Number(matches[0].coordinates.x) }
      if (isWithinAllowedArea(match.lat, match.lng)) return match
    }
  } catch (err) {
    console.error('Single-line geocode error:', err)
  }

  const photonFull = await geocodePhoton(address)
  if (photonFull) return photonFull

  if (firstStreet && firstStreet !== stop) {
    const photonFirst = await geocodePhoton(`${firstStreet}, Detroit, MI`)
    if (photonFirst) return photonFirst
  }

  const nominatimFull = await geocodeNominatim(address)
  if (nominatimFull) return nominatimFull

  if (firstStreet && firstStreet !== stop) {
    const nominatimFirst = await geocodeNominatim(`${firstStreet}, Detroit, MI`)
    if (nominatimFirst) return nominatimFirst
  }

  if (HARDCODED_OVERRIDES[stop]) {
    return HARDCODED_OVERRIDES[stop]
  }

  return null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function geocodeStops(stops: string[], report: ProgressReporter): Promise<Record<string, Coords | null>> {
  const results: Record<string, Coords | null> = {}
  const batches = Math.ceil(stops.length / BATCH_SIZE)
  const startedAt = Date.now()
  const fallbackLimit = Math.ceil(stops.length * FALLBACK_ABORT_RATIO)
  let fallbacks = 0

  const checkBudget = () => {
    if (Date.now() - startedAt > DEADLINE_MS) {
      throw new GeocodeAbort('Geocoding exceeded its time budget and was stopped before the platform limit. The existing bus stop data was left unchanged. Please try again later.')
    }
    if (fallbacks > fallbackLimit) {
      throw new GeocodeAbort(`The Census batch geocoder returned no usable matches for ${fallbacks} of ${stops.length} stops, which would take far longer than the available time. The existing bus stop data was left unchanged. Please try again later.`)
    }
  }

  for (let i = 0; i < stops.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const chunk = stops.slice(i, i + BATCH_SIZE)
    report(`geocoding batch ${batchNum} of ${batches}`, 10 + Math.round((i / stops.length) * 80))
    const csv = buildBatchCsv(chunk)
    const blob = new Blob([csv], { type: 'text/csv' })
    const form = new FormData()
    form.append('benchmark', '4')
    form.append('vintage', 'Current_Current')
    form.append('addressFile', blob, 'addresses.csv')
    let chunkResults: Record<string, Coords | null> = {}
    try {
      const res = await fetchWithTimeout('https://geocoding.geo.census.gov/geocoder/locations/addressbatch', {
        method: 'POST',
        body: form
      }, 120000)
      chunkResults = parseCensusBatchResponse(await res.text())
    } catch (err: any) {
      console.error('Batch geocode error:', err)
    }
    for (let j = 0; j < chunk.length; j++) {
      const current = i + j + 1
      const stop = stops[i + j]
      const key = String(j)
      report(`geocoding ${current} of ${stops.length} stops`, 10 + Math.round((current / stops.length) * 75))
      const batchMatch = chunkResults[key]
      if (batchMatch && isWithinAllowedArea(batchMatch.lat, batchMatch.lng)) {
        results[stop] = batchMatch
        continue
      }
      fallbacks++
      checkBudget()
      results[stop] = await geocodeSingleLine(stop)
      if (results[stop]) await sleep(1100)
    }
    if (i + BATCH_SIZE < stops.length) await sleep(2000)
  }

  const failed = stops.filter(stop => !results[stop])
  if (failed.length) {
    report(`final retry for ${failed.length} stops`, 86)
    for (let k = 0; k < failed.length; k++) {
      const stop = failed[k]
      report(`final retry for ${failed.length} stops`, 86 + Math.round(((k + 1) / failed.length) * 10))
      checkBudget()
      results[stop] = await geocodeSingleLine(stop)
      if (results[stop]) await sleep(1100)
    }
  }

  report('geocoding complete', 98)
  return results
}
