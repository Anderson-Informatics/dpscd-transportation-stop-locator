import { readMultipartFormData } from 'h3'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { $fetch } from 'ofetch'
import { jobs, type BusStop, type BusStopEntry } from './_jobs'
import { loadSchoolMap, saveSchoolMap, loadSchoolLocations, resolveSchoolName } from './_school-map'

const BATCH_SIZE = 1000

const ROOT = process.cwd()
const PUBLIC_DATA = resolve(ROOT, 'public/data')
const BUS_STOPS_FILE = resolve(PUBLIC_DATA, 'bus-stops.json')
const BACKUPS_DIR = resolve(PUBLIC_DATA, 'backups')

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

function nowStamp() {
  const d = new Date()
  return d.toISOString().replace(/[-:T]/g, '').split('.')[0]
}

function parseCsvLine(line: string) {
  return line.split(',').map(s => s.trim())
}

function readInputCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(Boolean)
  const rows: any[] = []
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i])
    if (parts.length < 7) continue
    const [school, pickupRoute, rawPickupStop, pickupTime, dropoffRoute, rawDropoffStop, dropoffTime] = parts
    const pickupStop = normalizeForGeocode(rawPickupStop)
    const pickupStopDesc = extractDescription(rawPickupStop)
    const dropoffStop = normalizeForGeocode(rawDropoffStop)
    const dropoffStopDesc = extractDescription(rawDropoffStop)
    rows.push({ school, pickupRoute, pickupStop, pickupStopDesc, pickupTime, dropoffRoute, dropoffStop, dropoffStopDesc, dropoffTime })
  }
  return rows
}

function normalizeForGeocode(stop: string) {
  return stop
    .replace(/@/g, ' & ')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractDescription(stop: string): string | null {
  const match = stop.match(/\(([^)]*)\)/)
  return match ? match[1].trim() : null
}

function buildStopIndex(rows: any[], schoolMap: Record<string, { schoolId: number | null, schoolName: string }>) {
  const index: Record<string, BusStop> = {}
  for (const row of rows) {
    const match = schoolMap[row.school]
    const base = {
      school: row.school,
      schoolId: match?.schoolId ?? null,
      schoolName: match?.schoolName ?? null
    }
    if (!row.pickupStop || !row.dropoffStop) continue
    if (row.pickupStop === row.dropoffStop) {
      ensureStop(index, row.pickupStop, row.pickupStopDesc).entries.push({
        ...base,
        pickupRoute: row.pickupRoute,
        pickupTime: row.pickupTime,
        dropoffRoute: row.dropoffRoute,
        dropoffTime: row.dropoffTime,
        type: 'Pickup & Dropoff'
      })
    } else {
      ensureStop(index, row.pickupStop, row.pickupStopDesc).entries.push({
        ...base,
        pickupRoute: row.pickupRoute,
        pickupTime: row.pickupTime,
        dropoffRoute: null,
        dropoffTime: null,
        type: 'Pickup'
      })
      ensureStop(index, row.dropoffStop, row.dropoffStopDesc).entries.push({
        ...base,
        pickupRoute: null,
        pickupTime: null,
        dropoffRoute: row.dropoffRoute,
        dropoffTime: row.dropoffTime,
        type: 'Dropoff'
      })
    }
  }
  return index
}

function ensureStop(index: Record<string, BusStop>, stop: string, description: string | null = null): BusStop {
  if (!index[stop]) index[stop] = { stop, description, lat: null, lng: null, entries: [] }
  if (description && !index[stop].description) index[stop].description = description
  return index[stop]
}

function parseCensusBatchResponse(csv: string) {
  const results: Record<string, { lat: number, lng: number } | null> = {}
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

async function geocodeBatch(stops: string[], job: { stage: string, progress: number }) {
  const results: Record<string, { lat: number, lng: number } | null> = {}
  const batches = Math.ceil(stops.length / BATCH_SIZE)
  for (let i = 0; i < stops.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const chunk = stops.slice(i, i + BATCH_SIZE)
    job.stage = `geocoding batch ${batchNum} of ${batches}`
    job.progress = 10 + Math.round((i / stops.length) * 80)
    const csv = buildBatchCsv(chunk)
    const blob = new Blob([csv], { type: 'text/csv' })
    const form = new FormData()
    form.append('benchmark', '4')
    form.append('vintage', 'Current_Current')
    form.append('addressFile', blob, 'addresses.csv')
    try {
      const res = await $fetch('https://geocoding.geo.census.gov/geocoder/locations/addressbatch', {
        method: 'POST',
        body: form,
        responseType: 'text',
        timeout: 120000
      })
      const chunkResults = parseCensusBatchResponse(res)
      for (let j = 0; j < chunk.length; j++) {
        const current = i + j + 1
        const stop = stops[i + j]
        const key = String(j)
        job.stage = `geocoding ${current} of ${stops.length} stops`
        job.progress = 10 + Math.round((current / stops.length) * 75)
        if (chunkResults[key] && isWithinAllowedArea(chunkResults[key].lat, chunkResults[key].lng)) {
          results[stop] = chunkResults[key]
        } else {
          results[stop] = await geocodeSingleLine(stop)
          if (results[stop]) await new Promise(r => setTimeout(r, 1100))
        }
      }
      if (i + BATCH_SIZE < stops.length) await new Promise(r => setTimeout(r, 2000))
    } catch (err: any) {
      console.error('Batch geocode error:', err)
      for (const stop of chunk) results[stop] = null
    }
  }

  const failed = stops.filter(stop => !results[stop])
  if (failed.length) {
    job.stage = `final retry for ${failed.length} stops`
    for (let k = 0; k < failed.length; k++) {
      const stop = failed[k]
      job.progress = 86 + Math.round(((k + 1) / failed.length) * 10)
      results[stop] = await geocodeSingleLine(stop)
      if (results[stop]) await new Promise(r => setTimeout(r, 1100))
    }
  }

  job.progress = 98
  return results
}

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

function isWithinAllowedArea(lat: number, lng: number) {
  return lat >= ALLOWED_BOUNDS.south && lat <= ALLOWED_BOUNDS.north && lng >= ALLOWED_BOUNDS.west && lng <= ALLOWED_BOUNDS.east
}

function squaredDistanceToDetroit(lat: number, lng: number) {
  return Math.pow(lat - DETROIT_CENTER[0], 2) + Math.pow(lng - DETROIT_CENTER[1], 2)
}

async function bestFromCandidates(lat: number, lng: number, candidates: Array<{ lat: number, lng: number }>) {
  if (!candidates.length) return null
  let best = null
  let bestDist = Infinity
  for (const c of candidates) {
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

async function geocodeNominatim(address: string) {
  try {
    const res = await $fetch('https://nominatim.openstreetmap.org/search', {
      query: {
        q: address,
        format: 'json',
        limit: 5,
        countrycodes: 'us',
        'accept-language': 'en-US'
      },
      headers: { 'User-Agent': 'DPSCD School Finder' },
      timeout: 8000
    }) as any
    if (!res || !res.length) return null
    return await bestFromCandidates(0, 0, res.map((r: any) => ({ lat: Number(r.lat), lng: Number(r.lon) })))
  } catch (err) {
    console.error('Nominatim fallback error:', err)
    return null
  }
}

async function geocodePhoton(address: string) {
  try {
    const res = await $fetch('https://photon.komoot.io/api/', {
      query: {
        q: address,
        limit: 5,
        lat: DETROIT_CENTER[0],
        lon: DETROIT_CENTER[1]
      },
      timeout: 10000
    }) as any
    const features = res?.features || []
    if (!features.length) return null
    const candidates = features.map((f: any) => {
      const [lng, lat] = f.geometry.coordinates
      return { lat, lng }
    })
    return await bestFromCandidates(0, 0, candidates)
  } catch (err) {
    console.error('Photon fallback error:', err)
    return null
  }
}

async function geocodeSingleLine(stop: string): Promise<{ lat: number, lng: number } | null> {
  const address = `${normalizeForGeocode(stop)}, Detroit, MI`
  const firstStreet = stop.split(' & ')[0]?.trim()

  try {
    const data = await $fetch('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress', {
      query: { address, benchmark: '4', format: 'json' },
      timeout: 10000
    }) as any
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

function computeDiff(oldStops: BusStop[], newStops: BusStop[]) {
  const oldMap = new Map(oldStops.map(s => [s.stop, s]))
  const newMap = new Map(newStops.map(s => [s.stop, s]))
  const removed: BusStop[] = []
  const added: BusStop[] = []
  const changed: BusStop[] = []
  const unchanged: BusStop[] = []
  const failed: string[] = newStops.filter(s => s.lat === null || s.lng === null).map(s => s.stop)
  for (const [stop, oldStop] of oldMap) {
    if (!newMap.has(stop)) removed.push(oldStop)
  }
  for (const [stop, newStop] of newMap) {
    const oldStop = oldMap.get(stop)
    if (!oldStop) {
      added.push(newStop)
      continue
    }
    const coordsChanged = oldStop.lat !== newStop.lat || oldStop.lng !== newStop.lng
    const metaChanged = JSON.stringify(oldStop.entries) !== JSON.stringify(newStop.entries)
    if (coordsChanged || metaChanged) {
      changed.push(newStop)
    } else {
      unchanged.push(newStop)
    }
  }
  return { removed, added, changed, unchanged, failed }
}

async function runJob(jobId: string, csvBuffer: Buffer, filename?: string) {
  const job = jobs.get(jobId)
  if (!job) return
  try {
    ensureDir(BACKUPS_DIR)
    if (existsSync(BUS_STOPS_FILE)) {
      const stamp = nowStamp()
      const backupPath = resolve(BACKUPS_DIR, `bus-stops_${stamp}.json`)
      writeFileSync(backupPath, readFileSync(BUS_STOPS_FILE))
      if (filename) {
        const csvBackupPath = resolve(BACKUPS_DIR, `CornerStopLookup_${stamp}.csv`)
        writeFileSync(csvBackupPath, csvBuffer)
      }
    }
    job.stage = 'reading and comparing'
    job.progress = 5
    const text = csvBuffer.toString('utf-8')
    const rows = readInputCsv(text)
    const allSchools = Array.from(new Set(rows.map(r => r.school).filter(Boolean)))
    job.stage = 'mapping school names'
    job.progress = 7
    const schoolMap = loadSchoolMap(PUBLIC_DATA)
    const locations = loadSchoolLocations(PUBLIC_DATA)
    const unmapped: string[] = []
    for (const raw of allSchools) {
      if (schoolMap[raw]) continue
      const match = resolveSchoolName(raw, locations)
      if (match) {
        schoolMap[raw] = match
      } else {
        unmapped.push(raw)
      }
    }
    saveSchoolMap(schoolMap, PUBLIC_DATA)
    const newIndex = buildStopIndex(rows, schoolMap)
    const oldStops: BusStop[] = existsSync(BUS_STOPS_FILE) ? JSON.parse(readFileSync(BUS_STOPS_FILE, 'utf-8')) : []
    const stops = Object.keys(newIndex)
    job.stage = `preparing ${stops.length} stops`
    const geocoded = await geocodeBatch(stops, job)
    for (const stop of stops) {
      const coords = geocoded[stop]
      if (coords) {
        newIndex[stop].lat = coords.lat
        newIndex[stop].lng = coords.lng
      }
    }
    const newStops = Object.values(newIndex)
    job.stage = 'computing diff'
    job.progress = 99
    const diff = computeDiff(oldStops, newStops)
    job.stage = 'writing bus-stops.json'
    job.progress = 100
    ensureDir(dirname(BUS_STOPS_FILE))
    writeFileSync(BUS_STOPS_FILE, JSON.stringify(newStops, null, 2))
    job.stage = 'done'
    job.progress = 100
    job.status = 'success'
    job.endedAt = Date.now()
    job.message = `Processed ${stops.length} stops.` + (unmapped.length ? ` ${unmapped.length} school names could not be mapped.` : '')
    job.diff = {
      removed: diff.removed.length,
      added: diff.added.length,
      changed: diff.changed.length,
      unchanged: diff.unchanged.length,
      failed: diff.failed.length,
      removedDetails: diff.removed.map(s => s.stop),
      addedDetails: diff.added.map(s => s.stop),
      changedDetails: diff.changed.map(s => s.stop),
      failedDetails: diff.failed
    }
  } catch (err: any) {
    job.status = 'error'
    job.stage = 'error'
    job.endedAt = Date.now()
    job.error = err.message || String(err)
  }
}

export default defineEventHandler(async (event) => {
  const password = useRuntimeConfig().busStopUpdatePassword
  const formData = await readMultipartFormData(event)
  let providedPassword = ''
  let fileBuffer: Buffer | undefined
  let filename: string | undefined
  if (formData) {
    for (const part of formData) {
      if (part.name === 'password') providedPassword = part.data.toString('utf-8')
      if (part.name === 'file') {
        fileBuffer = part.data
        filename = part.filename
      }
    }
  }
  if (password && providedPassword !== password) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid password' })
  }
  let csvBuffer: Buffer
  if (!fileBuffer) {
    const defaultPath = resolve(ROOT, 'CornerStopLookup.csv')
    if (!existsSync(defaultPath)) {
      throw createError({ statusCode: 400, statusMessage: 'No file uploaded and default CornerStopLookup.csv not found' })
    }
    csvBuffer = readFileSync(defaultPath)
    filename = 'CornerStopLookup.csv'
  } else {
    csvBuffer = fileBuffer
  }
  const jobId = randomUUID()
  const job = { id: jobId, status: 'running' as const, stage: 'uploading', progress: 0, startedAt: Date.now() }
  jobs.set(jobId, job)
  setTimeout(() => runJob(jobId, csvBuffer, filename).catch(console.error), 0)
  return { jobId }
})
