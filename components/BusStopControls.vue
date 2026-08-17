<script setup>
import { computed, ref, watch } from 'vue'

const address = defineModel('address', { default: '' })
const selectedSchool = defineModel('selectedSchool', { default: '' })
const radius = defineModel('radius', { default: 100000 })

const props = defineProps({
  loading: { type: Boolean, default: false },
  schoolOptions: { type: Array, default: () => [] },
  selectedLocation: { type: Array, default: null },
  showGeolocate: { type: Boolean, default: false },
  showSearch: { type: Boolean, default: true },
  suggestions: { type: Array, default: () => [] }
})

const emits = defineEmits(['search', 'geolocate', 'select-suggestion'])

const addressInput = ref(null)
const activeSuggestion = ref(-1)

watch(() => props.suggestions, () => {
  activeSuggestion.value = -1
})

function onSuggestionKeydown(e) {
  if (!props.suggestions.length) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeSuggestion.value = (activeSuggestion.value + 1) % props.suggestions.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeSuggestion.value = (activeSuggestion.value - 1 + props.suggestions.length) % props.suggestions.length
  } else if (e.key === 'Enter' && activeSuggestion.value >= 0) {
    e.preventDefault()
    emits('select-suggestion', props.suggestions[activeSuggestion.value])
    activeSuggestion.value = -1
  } else if (e.key === 'Escape') {
    activeSuggestion.value = -1
  }
}

function onSearch() {
  emits('search')
  addressInput.value?.blur()
}

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
  <form v-if="showSearch" class="search" @submit.prevent="onSearch">
    <label for="busAddress">Address</label>
    <input
      id="busAddress"
      ref="addressInput"
      v-model="address"
      placeholder="123 Main St"
      type="text"
      autocomplete="off"
      aria-autocomplete="none"
      @keydown="onSuggestionKeydown"
    />
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
    <ul v-if="suggestions.length" class="suggestions">
      <li
        v-for="(s, i) in suggestions"
        :key="s.place_id"
        class="suggestion"
        :class="{ active: activeSuggestion === i }"
        @click="emits('select-suggestion', s)"
      >
        <span class="suggestion-main">{{ s.main_text }}</span>
        <span class="suggestion-desc">{{ s.description }}</span>
      </li>
    </ul>
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

<style scoped>
.search {
  position: relative;
}

.suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  background: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  max-height: 180px;
  overflow-y: auto;
}

.suggestion {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
}

.suggestion:last-child {
  border-bottom: none;
}

.suggestion:hover,
.suggestion:focus,
.suggestion.active {
  background: var(--dpscd-primary);
  color: #fff;
}

.suggestion.active .suggestion-desc,
.suggestion:hover .suggestion-desc,
.suggestion:focus .suggestion-desc {
  color: rgba(255, 255, 255, 0.85);
}

.suggestion-main {
  display: block;
  font-weight: 700;
  font-size: 0.9rem;
}

.suggestion-desc {
  display: block;
  font-size: 0.75rem;
  color: #666;
}
</style>
