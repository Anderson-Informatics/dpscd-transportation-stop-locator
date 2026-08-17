import { readJob } from '../../../lib/bus-stops/store'

export default defineEventHandler(async (event) => {
  const { jobId } = getQuery(event)
  if (!jobId || typeof jobId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Missing jobId' })
  }
  // Job state lives in Blobs rather than in memory: each poll can land on a different
  // function container, so an in-process Map would report a missing job at random.
  const job = await readJob(jobId)
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  return job
})
