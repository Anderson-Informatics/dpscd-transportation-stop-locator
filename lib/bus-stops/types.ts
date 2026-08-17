export type BusStopEntry = {
  school: string
  schoolId: number | null
  schoolName: string | null
  pickupRoute: string | null
  pickupTime: string | null
  dropoffRoute: string | null
  dropoffTime: string | null
  type: 'Pickup' | 'Dropoff' | 'Pickup & Dropoff'
}

export type BusStop = {
  stop: string
  description: string | null
  lat: number | null
  lng: number | null
  entries: BusStopEntry[]
}

export type Diff = {
  removed: BusStop[]
  added: BusStop[]
  changed: BusStop[]
  unchanged: BusStop[]
  failed: string[]
}

export type Job = {
  id: string
  status: 'running' | 'success' | 'error'
  stage: string
  progress: number
  startedAt: number
  endedAt?: number
  message?: string
  diff?: {
    removed: number
    added: number
    changed: number
    unchanged: number
    failed: number
    removedDetails: string[]
    addedDetails: string[]
    changedDetails: string[]
    failedDetails: string[]
  }
  error?: string
}
