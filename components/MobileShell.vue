<script setup>
import { ref, computed } from 'vue'

const address = defineModel('address', { default: '' })
const selectedSchool = defineModel('selectedSchool', { default: '' })
const radius = defineModel('radius', { default: 100000 })

const props = defineProps({
  title: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  schoolOptions: { type: Array, default: () => [] },
  selectedLocation: { type: Array, default: null },
  empty: { type: Boolean, default: false },
  showGeolocate: { type: Boolean, default: true },
  canReset: { type: Boolean, default: false },
  lockedSchoolName: { type: String, default: '' },
  lockedSchoolShortName: { type: String, default: '' }
})

const emits = defineEmits(['search', 'geolocate', 'reset', 'clear-highlight'])
const bottomSheetRef = ref(null)
const showFilters = ref(false)
const addressInput = ref(null)

const activeSchoolLabel = computed(() => selectedSchool.value || 'All schools')
const activeRadiusLabel = computed(() => {
  if (!props.selectedLocation || selectedSchool.value) return 'Show All'
  return radius.value === 1 ? '1 mi' : `${radius.value} mi`
})

function onSearch() {
  emits('search')
  addressInput.value?.blur()
}

function snapTo(point) {
  bottomSheetRef.value?.snapTo(point)
}

defineExpose({ snapTo })
</script>

<template>
  <div class="mobile-shell">
    <div class="mobile-control-bar">
      <form class="mobile-search" @submit.prevent="onSearch">
        <input
          ref="addressInput"
          v-model="address"
          type="text"
          placeholder="Search address..."
          aria-label="Search address"
        />
        <button
          v-if="showGeolocate"
          type="button"
          class="geolocate-btn"
          aria-label="Use my location"
          @click="emits('geolocate')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        </button>
        <button :disabled="!address.trim() || loading" type="submit">Search</button>
      </form>

      <div class="mobile-chips">
        <button class="mobile-chip" :class="{ active: showFilters }" @click="showFilters = !showFilters">
          Filters
        </button>
        <button class="mobile-chip" @click="showFilters = !showFilters">
          {{ activeSchoolLabel }} ▾
        </button>
        <button class="mobile-chip" @click="showFilters = !showFilters">
          {{ activeRadiusLabel }} ▾
        </button>
      </div>

      <div v-if="showFilters" class="mobile-filters">
        <BusStopControls
          v-model:address="address"
          v-model:selected-school="selectedSchool"
          v-model:radius="radius"
          :show-search="false"
          :loading="loading"
          :school-options="schoolOptions"
          :selected-location="selectedLocation"
          :show-geolocate="false"
          @search="emits('search')"
        />

        <button
          v-if="lockedSchoolName"
          class="mobile-action mobile-cancel"
          type="button"
          @click="emits('clear-highlight')"
        >
          Click to Cancel Highlighting Stops for {{ lockedSchoolShortName }}
        </button>

        <button
          v-if="canReset"
          class="mobile-action mobile-reset"
          type="button"
          @click="emits('reset')"
        >
          Reset
        </button>
      </div>
    </div>

    <BottomSheet
      ref="bottomSheetRef"
      :title="title"
      :lock="empty"
    >
      <slot />
    </BottomSheet>
  </div>
</template>

<style scoped>
.mobile-shell {
  position: fixed;
  inset: 0;
  z-index: 1000;
  pointer-events: none;
}

.mobile-control-bar {
  position: absolute;
  top: calc(0.5rem + env(safe-area-inset-top, 0px));
  left: 0.5rem;
  right: 0.5rem;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  padding: 0.5rem;
  pointer-events: auto;
}

.mobile-search {
  display: flex;
  gap: 0.4rem;
}

.mobile-search input {
  flex: 1;
  min-width: 0;
  padding: 0.55rem;
  border: 1px solid #c3c5cc;
  border-radius: 4px;
  font-size: 1rem;
  font-family: 'Roboto', sans-serif;
}

.mobile-search button {
  padding: 0.55rem 0.75rem;
  background: var(--dpscd-secondary);
  color: var(--dpscd-text);
  border: 1px solid var(--dpscd-secondary);
  border-radius: 4px;
  font-weight: 700;
  cursor: pointer;
}

.mobile-search button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.geolocate-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border: 1px solid #c3c5cc;
  color: var(--dpscd-primary);
  min-width: 40px;
}

.mobile-chips {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.5rem;
}

.mobile-chip {
  padding: 0.3rem 0.6rem;
  border: 1px solid #e5e5e5;
  border-radius: 999px;
  background: #f9f9f9;
  color: var(--dpscd-text);
  font-size: 0.85rem;
  cursor: pointer;
}

.mobile-chip.active,
.mobile-chip:hover,
.mobile-chip:focus {
  background: #e5e5e5;
  border-color: var(--dpscd-primary);
  color: var(--dpscd-primary);
}

.mobile-filters {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #e5e5e5;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.mobile-action {
  display: block;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--dpscd-primary);
  border-radius: 4px;
  background: var(--dpscd-secondary);
  color: var(--dpscd-text);
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
}

.mobile-action:hover,
.mobile-action:focus {
  background: #fff;
  color: var(--dpscd-primary);
}
</style>
