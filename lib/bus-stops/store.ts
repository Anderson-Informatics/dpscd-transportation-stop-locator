import { getStore, type Store } from '@netlify/blobs'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BusStop, Job } from './types'
import type { SchoolMap } from './school-map'

// On Netlify this data lives in Blobs: function containers are read-only apart from
// /tmp and are destroyed after each request, so anything that must outlive a single
// invocation cannot go on disk. In local development there is no Blobs environment, so
// the same operations fall back to the repo checkout under public/data - which is also
// how the committed fallback copy of bus-stops.json gets refreshed.

const DATA_STORE = 'bus-stop-data'
const JOB_STORE = 'bus-stop-jobs'

export const BUS_STOPS_KEY = 'bus-stops.json'
export const SCHOOL_MAP_KEY = 'school-name-map.json'
export const BUS_STOPS_CACHE_TAG = 'bus-stops'

const BACKUP_KEEP = 10

const PUBLIC_DATA = resolve(process.cwd(), 'public/data')
const BACKUPS_DIR = resolve(PUBLIC_DATA, 'backups')

// Job records and uploads are keyed by id and only need to outlive the request that
// created them. In development everything runs in one long-lived process, so a map is
// equivalent to the blob store and avoids littering the checkout.
const localJobs = new Map<string, Job>()
const localUploads = new Map<string, string>()

let blobsAvailable: boolean | null = null

function useBlobs() {
  if (blobsAvailable === null) {
    try {
      getStore({ name: DATA_STORE })
      blobsAvailable = true
    } catch {
      blobsAvailable = false
    }
  }
  return blobsAvailable
}

// True when running on Netlify, where the rebuild has to be handed to a background
// function; locally the job can just run in the dev server process.
export function isBlobBacked() {
  return useBlobs()
}

// Reads are cheap and tolerate a moment of staleness; the CDN caches them anyway.
const dataStore = (): Store => getStore({ name: DATA_STORE })

// Job records are polled by the admin page within a second of being written, and each
// poll may land on a different container, so eventual consistency is not enough here.
const jobStore = (): Store => getStore({ name: JOB_STORE, consistency: 'strong' })

export function nowStamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').split('.')[0]
}

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

function readLocalJson<T>(file: string): T | null {
  const path = resolve(PUBLIC_DATA, file)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

export async function readBusStops(): Promise<BusStop[] | null> {
  if (!useBlobs()) return readLocalJson<BusStop[]>(BUS_STOPS_KEY)
  const raw = await dataStore().get(BUS_STOPS_KEY, { type: 'json' })
  return (raw as BusStop[]) ?? null
}

export async function writeBusStops(stops: BusStop[]) {
  if (!useBlobs()) {
    ensureDir(PUBLIC_DATA)
    writeFileSync(resolve(PUBLIC_DATA, BUS_STOPS_KEY), JSON.stringify(stops, null, 2))
    return
  }
  await dataStore().setJSON(BUS_STOPS_KEY, stops)
  await purgeBusStopCache()
}

export async function readSchoolMap(): Promise<SchoolMap> {
  if (!useBlobs()) return readLocalJson<SchoolMap>(SCHOOL_MAP_KEY) ?? {}
  const raw = await dataStore().get(SCHOOL_MAP_KEY, { type: 'json' })
  return (raw as SchoolMap) ?? {}
}

export async function writeSchoolMap(map: SchoolMap) {
  if (!useBlobs()) {
    ensureDir(PUBLIC_DATA)
    writeFileSync(resolve(PUBLIC_DATA, SCHOOL_MAP_KEY), JSON.stringify(map, null, 2))
    return
  }
  await dataStore().setJSON(SCHOOL_MAP_KEY, map)
}

export async function saveBackup(stamp: string, busStops: unknown, csv?: string) {
  if (!useBlobs()) {
    ensureDir(BACKUPS_DIR)
    writeFileSync(resolve(BACKUPS_DIR, `bus-stops_${stamp}.json`), JSON.stringify(busStops, null, 2))
    if (csv) writeFileSync(resolve(BACKUPS_DIR, `CornerStopLookup_${stamp}.csv`), csv)
    return
  }
  const store = dataStore()
  await store.setJSON(`backups/bus-stops_${stamp}.json`, busStops)
  if (csv) await store.set(`backups/CornerStopLookup_${stamp}.csv`, csv)
  await pruneBlobBackups()
}

// Blob backups would otherwise grow without bound; keep the most recent of each kind.
// Local backups under public/data are left alone - they are committed to the repo, so
// deleting them is the caller's decision, not this module's.
async function pruneBlobBackups() {
  const store = dataStore()
  const { blobs } = await store.list({ prefix: 'backups/' })
  const keys = blobs.map(b => b.key)
  for (const group of [keys.filter(k => k.endsWith('.json')), keys.filter(k => k.endsWith('.csv'))]) {
    // Keys embed a sortable timestamp, so lexical order is chronological.
    for (const key of group.sort().slice(0, -BACKUP_KEEP)) await store.delete(key)
  }
}

export async function readJob(jobId: string): Promise<Job | null> {
  if (!useBlobs()) return localJobs.get(jobId) ?? null
  const raw = await jobStore().get(`${jobId}.json`, { type: 'json' })
  return (raw as Job) ?? null
}

export async function writeJob(job: Job) {
  if (!useBlobs()) {
    localJobs.set(job.id, job)
    return
  }
  await jobStore().setJSON(`${job.id}.json`, job)
}

export async function putUpload(jobId: string, csv: string) {
  if (!useBlobs()) {
    localUploads.set(jobId, csv)
    return
  }
  await jobStore().set(`${jobId}.csv`, csv)
}

export async function getUpload(jobId: string): Promise<string | null> {
  if (!useBlobs()) return localUploads.get(jobId) ?? null
  return await jobStore().get(`${jobId}.csv`, { type: 'text' })
}

export async function deleteUpload(jobId: string) {
  if (!useBlobs()) {
    localUploads.delete(jobId)
    return
  }
  await jobStore().delete(`${jobId}.csv`)
}

// Serving bus stops through a function on every page load would be slow and wasteful, so
// /api/bus-stops is edge-cached under a tag that gets invalidated whenever data changes.
async function purgeBusStopCache() {
  try {
    const { purgeCache } = await import('@netlify/functions')
    await purgeCache({ tags: [BUS_STOPS_CACHE_TAG] })
  } catch (err) {
    console.warn('Cache purge skipped:', (err as Error).message)
  }
}
