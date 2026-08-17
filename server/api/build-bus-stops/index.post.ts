import { readMultipartFormData } from 'h3'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runBuildJob } from '../../../lib/bus-stops/job'
import { isBlobBacked, putUpload, writeJob } from '../../../lib/bus-stops/store'

const BACKGROUND_FUNCTION = '/.netlify/functions/build-bus-stops-background'

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

  let csv: string
  if (fileBuffer) {
    csv = fileBuffer.toString('utf-8')
  } else {
    // Only reachable in local development; a deployed function has no repo checkout.
    const defaultPath = resolve(process.cwd(), 'CornerStopLookup.csv')
    if (!existsSync(defaultPath)) {
      throw createError({ statusCode: 400, statusMessage: 'No file uploaded and default CornerStopLookup.csv not found' })
    }
    csv = readFileSync(defaultPath, 'utf-8')
    filename = 'CornerStopLookup.csv'
  }

  const jobId = randomUUID()
  await putUpload(jobId, csv)
  await writeJob({
    id: jobId,
    status: 'running',
    stage: 'queued',
    progress: 0,
    startedAt: Date.now()
  })

  const origin = process.env.URL || getRequestURL(event).origin

  if (!isBlobBacked()) {
    // The dev server is a single long-lived process, so the job can run in it directly.
    setTimeout(() => runBuildJob({ jobId, csv, filename, baseUrl: origin }).catch(console.error), 0)
    return { jobId }
  }

  // A deployed function is frozen as soon as it responds and is capped well below the
  // several minutes this rebuild needs, so the work is handed to a background function.
  const res = await fetch(new URL(BACKGROUND_FUNCTION, origin), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-build-secret': password || ''
    },
    body: JSON.stringify({ jobId, filename })
  })
  if (!res.ok && res.status !== 202) {
    // Otherwise the job record would sit at "queued" forever and the page would poll it.
    const error = `Could not start the rebuild job (${res.status})`
    await writeJob({
      id: jobId,
      status: 'error',
      stage: 'error',
      progress: 0,
      startedAt: Date.now(),
      endedAt: Date.now(),
      error
    })
    throw createError({ statusCode: 502, statusMessage: error })
  }

  return { jobId }
})
