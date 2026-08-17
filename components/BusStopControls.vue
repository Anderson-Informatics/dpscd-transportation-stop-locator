<script setup>
import { computed } from 'vue'

const address = defineModel('address', { default: '' })
const selectedSchool = defineModel('selectedSchool', { default: '' })
const radius = defineModel('radius', { default: 100000 })

const props = defineProps({
  loading: { type: Boolean, default: false },
  schoolOptions: { type: Array, default: () => [] },
  selectedLocation: { type: Array, default: null },
  showGeolocate: { type: Boolean, default: false },
  showSearch: { type: Boolean, default: true }
})

const emits = defineEmits(['search', 'geolocate'])

const radiusLabel = computed(() => {
  if (props.selectedSchool) return 'Show All'
  if (!props.selectedLocation) return 'Show All'
  return radius.value === 1 ? '1 mile' : `${radius.value} miles`
})

const sliderValue = computed({
  get() {
    const v = radius.value
    if (v > 2) return 2
    return Math.max(v, 0.5)
  },
  set(v) {
    radius.value = v
  }
})
</script>

<template>
  <form v-if="showSearch" class="search" @submit.prevent="emits('search')">
    <label for="busAddress">Address</label>
    <input id="busAddress" v-model="address" placeholder="123 Main St" type="text" />
    <button
      v-if="showGeolocate"
      type="button"
      class="geolocate-btn"
      @click="emits('geolocate')"
    >
      Use my location
    </button>
    <button :disabled="!address.trim() || loading" type="submit">
      {{ loading ? 'Searching…' : 'Search' }}
    </button>
  </form>

  <div class="field">
    <label for="busRadius">Radius: {{ radiusLabel }}</label>
    <input
      id="busRadius"
      v-model.number="sliderValue"
      type="range"
      min="0.5"
      max="2"
      step="0.25"
      :disabled="!!selectedSchool || !selectedLocation"
    />
  </div>

  <div class="field">
    <label for="busSchool">School</label>
    <select id="busSchool" v-model="selectedSchool">
      <option value="">All schools</option>
      <option v-for="s in schoolOptions" :key="s.raw" :value="s.raw">{{ s.name }}</option>
    </select>
  </div>
</template>
