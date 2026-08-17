import { GeocodeAbort, extractDescription, geocodeStops, normalizeForGeocode } from './geocode'
import { loadSchoolLocations, resolveSchoolName, type SchoolMap } from './school-map'
import {
  deleteUpload,
  nowStamp,
  readBusStops,
  readSchoolMap,
  saveBackup,
  writeBusStops,
  writeJob,
  writeSchoolMap
} from './store'
import type { BusStop, Job } from './types'

// The job writes its progress to a blob that the admin page polls. Every stop would be
// a separate write, so updates are coalesced into at most one write per interval.
const PROGRESS_WRITE_INTERVAL = 1500

type CsvRow = {
  school: string
  pickupRoute: string
  pickupStop: string
  pickupStopDesc: string | null
  pickupTime: string
  dropoffRoute: string
  dropoffStop: string
  dropoffStopDesc: string | null
  dropoffTime: string
}

function parseCsvLine(line: string) {
  return line.split(',').map(s => s.trim())
}

function readInputCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean)
  const rows: CsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i])
    if (parts.length < 7) continue
    const [school, pickupRoute, rawPickupStop, pickupTime, dropoffRoute, rawDropoffStop, dropoffTime] = parts
    rows.push({
      school,
      pickupRoute,
      pickupStop: normalizeForGeocode(rawPickupStop),
      pickupStopDesc: extractDescription(rawPickupStop),
      pickupTime,
      dropoffRoute,
      dropoffStop: normalizeForGeocode(rawDropoffStop),
      dropoffStopDesc: extractDescription(rawDropoffStop),
      dropoffTime
    })
  }
  return rows
}

function ensureStop(index: Record<string, BusStop>, stop: string, description: string | null = null): BusStop {
  if (!index[stop]) index[stop] = { stop, description, lat: null, lng: null, entries: [] }
  if (description && !index[stop].description) index[stop].description = description
  return index[stop]
}

function buildStopIndex(rows: CsvRow[], schoolMap: SchoolMap) {
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

// Before the first successful run there is no blob yet, so fall back to the copy
// committed under public/data. Without this the first run would report every stop as
// newly added and would skip taking a backup.
async function readPreviousStops(baseUrl: string): Promise<BusStop[]> {
  const fromBlob = await readBusStops()
  if (fromBlob) return fromBlob
  try {
    const res = await fetch(new URL('/data/bus-stops.json', baseUrl))
    if (!res.ok) return []
    return await res.json() as BusStop[]
  } catch (err) {
    console.warn('Could not read the committed bus-stops.json:', (err as Error).message)
    return []
  }
}

export type RunBuildJobOptions = {
  jobId: string
  csv: string
  filename?: string
  baseUrl: string
}

export async function runBuildJob({ jobId, csv, filename, baseUrl }: RunBuildJobOptions) {
  const job: Job = {
    id: jobId,
    status: 'running',
    stage: 'starting',
    progress: 0,
    startedAt: Date.now()
  }

  let lastWrite = 0
  let pending: Promise<void> = Promise.resolve()

  const report = (stage: string, progress: number) => {
    job.stage = stage
    job.progress = progress
    const now = Date.now()
    if (now - lastWrite < PROGRESS_WRITE_INTERVAL) return
    lastWrite = now
    // Fire and forget: a dropped progress tick must never fail the run, and the next
    // tick supersedes it anyway.
    pending = writeJob({ ...job }).catch(err => console.error('Progress write failed:', err))
  }

  const finish = async () => {
    await pending.catch(() => {})
    await writeJob({ ...job })
  }

  try {
    report('reading and comparing', 5)
    const rows = readInputCsv(csv)
    if (!rows.length) {
      throw new Error('No usable rows found in the CSV. Expected the CornerStopLookup column layout.')
    }
    const oldStops = await readPreviousStops(baseUrl)

    if (oldStops.length) {
      const stamp = nowStamp()
      await saveBackup(stamp, oldStops, filename ? csv : undefined)
    }

    const allSchools = Array.from(new Set(rows.map(r => r.school).filter(Boolean)))
    report('mapping school names', 7)
    const schoolMap = await readSchoolMap()
    const locations = await loadSchoolLocations(baseUrl)
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
    await writeSchoolMap(schoolMap)

    const newIndex = buildStopIndex(rows, schoolMap)
    const stops = Object.keys(newIndex)
    report(`preparing ${stops.length} stops`, 10)
    const geocoded = await geocodeStops(stops, report)
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
    job.stage = 'writing bus stop data'
    await writeBusStops(newStops)

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
    job.error = err instanceof GeocodeAbort ? err.message : (err.message || String(err))
  }

  await finish()
  await deleteUpload(jobId).catch(() => {})
  return job
}
