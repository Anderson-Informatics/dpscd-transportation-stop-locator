import { runBuildJob } from '../../lib/bus-stops/job'
import { getUpload, writeJob } from '../../lib/bus-stops/store'

// Background functions get 15 minutes of execution instead of the 10 seconds a
// synchronous function gets, which is what this ~3 minute geocoding run needs. The
// `-background` filename suffix is what marks it as one.
export default async (req: Request) => {
  let jobId = ''
  try {
    const secret = process.env.NUXT_BUS_STOP_UPDATE_PASSWORD || ''
    if (secret && req.headers.get('x-build-secret') !== secret) {
      console.error('Rejected background invocation with bad secret')
      return
    }

    const body = await req.json() as { jobId?: string, filename?: string }
    jobId = body.jobId || ''
    if (!jobId) {
      console.error('Background invocation without a jobId')
      return
    }

    const csv = await getUpload(jobId)
    if (!csv) {
      await writeJob({
        id: jobId,
        status: 'error',
        stage: 'error',
        progress: 0,
        startedAt: Date.now(),
        endedAt: Date.now(),
        error: 'The uploaded CSV could not be found. Please try uploading it again.'
      })
      return
    }

    await runBuildJob({
      jobId,
      csv,
      filename: body.filename,
      baseUrl: new URL(req.url).origin
    })
  } catch (err: any) {
    // Netlify retries a background function that throws, twice, which would mean three
    // concurrent runs racing to write the same blob. Swallow everything and record it
    // on the job instead.
    console.error('Background job failed:', err)
    if (jobId) {
      await writeJob({
        id: jobId,
        status: 'error',
        stage: 'error',
        progress: 0,
        startedAt: Date.now(),
        endedAt: Date.now(),
        error: err?.message || String(err)
      }).catch(() => {})
    }
  }
}
