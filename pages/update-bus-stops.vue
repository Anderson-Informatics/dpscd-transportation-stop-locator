<script setup>
import { ref, onUnmounted } from 'vue'

const password = ref('')
const file = ref(null)
const loading = ref(false)
const error = ref('')
const jobId = ref('')
const job = ref(null)
let pollTimer = null

function onFileChange(e) {
  file.value = e.target.files?.[0] || null
}

async function submit() {
  error.value = ''
  if (!password.value) {
    error.value = 'Password is required.'
    return
  }
  if (!file.value) {
    error.value = 'Please select a CSV file.'
    return
  }
  loading.value = true
  job.value = null
  jobId.value = ''
  try {
    const form = new FormData()
    form.append('password', password.value)
    form.append('file', file.value)
    const res = await $fetch('/api/build-bus-stops', {
      method: 'POST',
      body: form
    })
    jobId.value = res.jobId
    startPolling()
  } catch (err) {
    error.value = err?.data?.statusMessage || err.message || 'Upload failed'
    loading.value = false
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    if (!jobId.value) return
    try {
      const status = await $fetch('/api/build-bus-stops/status', {
        query: { jobId: jobId.value }
      })
      job.value = status
      if (status.status === 'success' || status.status === 'error') {
        loading.value = false
        clearInterval(pollTimer)
        pollTimer = null
      }
    } catch (err) {
      error.value = err?.data?.statusMessage || err.message || 'Status check failed'
      clearInterval(pollTimer)
      pollTimer = null
      loading.value = false
    }
  }, 1000)
}

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="admin">
    <header class="brand-header">
      <h1 class="brand-title">Update Bus Stop Data</h1>
    </header>
    <main class="form">
      <p class="muted">Upload a new <code>CornerStopLookup.csv</code> to rebuild <code>public/data/bus-stops.json</code>.</p>

      <form @submit.prevent="submit" class="upload-form">
        <div class="field">
          <label for="password">Password</label>
          <input id="password" v-model="password" type="password" autocomplete="off" />
        </div>
        <div class="field">
          <label for="file">CSV file</label>
          <input id="file" type="file" accept=".csv" @change="onFileChange" />
        </div>
        <button type="submit" :disabled="loading">{{ loading ? 'Processing…' : 'Process CSV' }}</button>
      </form>

      <p v-if="error" class="error">{{ error }}</p>

      <div v-if="job" class="status">
        <h2>Status: {{ job.status }}</h2>
        <div class="progress-wrap">
          <div class="progress-bar" :style="{ width: job.progress + '%' }"></div>
          <span class="stage">{{ job.stage }} ({{ job.progress }}%)</span>
        </div>
      </div>

      <div v-if="job?.diff" class="diff">
        <h2>Diff Summary</h2>
        <div class="counts">
          <div class="count removed">Removed: {{ job.diff.removed }}</div>
          <div class="count added">Added: {{ job.diff.added }}</div>
          <div class="count changed">Changed: {{ job.diff.changed }}</div>
          <div class="count unchanged">Unchanged: {{ job.diff.unchanged }}</div>
          <div class="count failed">Failed: {{ job.diff.failed }}</div>
        </div>

        <section v-if="job.diff.removedDetails.length" class="list">
          <h3>Removed ({{ job.diff.removedDetails.length }})</h3>
          <ul><li v-for="s in job.diff.removedDetails" :key="s">{{ s }}</li></ul>
        </section>
        <section v-if="job.diff.addedDetails.length" class="list">
          <h3>Added ({{ job.diff.addedDetails.length }})</h3>
          <ul><li v-for="s in job.diff.addedDetails" :key="s">{{ s }}</li></ul>
        </section>
        <section v-if="job.diff.changedDetails.length" class="list">
          <h3>Changed ({{ job.diff.changedDetails.length }})</h3>
          <ul><li v-for="s in job.diff.changedDetails" :key="s">{{ s }}</li></ul>
        </section>
        <section v-if="job.diff.failedDetails.length" class="list">
          <h3>Failed to geocode ({{ job.diff.failedDetails.length }})</h3>
          <ul><li v-for="s in job.diff.failedDetails" :key="s">{{ s }}</li></ul>
        </section>
      </div>

      <p v-if="job?.error" class="error">{{ job.error }}</p>

      <NuxtLink to="/" class="back">&larr; Back to School Finder</NuxtLink>
    </main>
  </div>
</template>

<style>
.admin {
  min-height: 100vh;
  background: #f9f9f9;
  color: var(--dpscd-text, #131313);
  font-family: 'Roboto', sans-serif;
}

.brand-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 1.25rem;
  background: var(--dpscd-primary, #0033CC);
  border-bottom: 4px solid var(--dpscd-secondary, #FFCC00);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
}

.brand-title {
  margin: 0;
  font-size: 1.25rem;
  color: #fff;
  letter-spacing: 0.05em;
}

.form {
  max-width: 720px;
  margin: 0 auto;
  padding: 1.5rem;
}

.muted {
  color: #555;
  margin-bottom: 1rem;
}

.upload-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

label {
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

input {
  padding: 0.55rem;
  border: 1px solid #c3c5cc;
  border-radius: 4px;
  font-size: 1rem;
}

button[type="submit"] {
  background: var(--dpscd-secondary, #FFCC00);
  color: var(--dpscd-text, #131313);
  border: 1px solid var(--dpscd-secondary, #FFCC00);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.75rem;
  border-radius: 4px;
  cursor: pointer;
}

button[type="submit"]:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  color: #c00;
  font-weight: 500;
}

.status {
  margin: 1.5rem 0;
  padding: 1rem;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
}

.progress-wrap {
  position: relative;
  height: 1.5rem;
  background: #e5e5e5;
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--dpscd-primary, #0033CC);
  transition: width 0.3s;
}

.stage {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

.diff {
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  padding: 1rem;
}

.counts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.count {
  padding: 0.5rem;
  border-radius: 4px;
  text-align: center;
  font-weight: 600;
}

.count.removed { background: #ffe0e0; color: #900; }
.count.added { background: #e0f3e0; color: #060; }
.count.changed { background: #fff4d9; color: #a60; }
.count.unchanged { background: #e9e9e9; color: #333; }
.count.failed { background: #f8e0ff; color: #609; }

.list {
  margin-top: 1rem;
}

.list h3 {
  margin: 0 0 0.25rem;
  font-size: 0.95rem;
}

.list ul {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  background: #f9f9f9;
}

.list li {
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid #e5e5e5;
  font-size: 0.85rem;
  color: #333;
}

.back {
  display: inline-block;
  margin-top: 1rem;
  color: var(--dpscd-primary, #0033CC);
  text-decoration: none;
  font-weight: 500;
}

.back:hover {
  text-decoration: underline;
}
</style>
