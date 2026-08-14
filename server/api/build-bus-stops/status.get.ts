import { jobs } from './_jobs'

export default defineEventHandler(async (event) => {
  const { jobId } = getQuery(event)
  if (!jobId || typeof jobId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Missing jobId' })
  }
  const job = jobs.get(jobId)
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'Job not found' })
  }
  return job
})
