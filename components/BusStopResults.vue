<script setup>
import { computed } from 'vue'

const props = defineProps({
  stops: { type: Array, default: () => [] },
  selectedKey: { type: String, default: null },
  visibleEntries: { type: Function, required: true },
  busStopKey: { type: Function, required: true },
  selectedSchool: { type: String, default: '' },
  selectedLocation: { type: Array, default: null },
  isMobile: { type: Boolean, default: false }
})

const emits = defineEmits(['select', 'hover-enter', 'hover-leave', 'select-school'])

function stopName(s) {
  return s.description ? `${s.stop} (${s.description})` : s.stop
}

const showLocationEmpty = computed(() => !props.stops.length && !!props.selectedLocation && !props.selectedSchool)
const showSchoolEmpty = computed(() => !props.stops.length && !!props.selectedSchool)
const listTitle = computed(() => (props.selectedSchool ? props.selectedSchool : 'Nearby Bus Stops'))
</script>

<template>
  <section v-if="stops.length" class="results">
    <h2 v-if="!isMobile">{{ listTitle }}</h2>
    <ol class="cards ranked">
      <li
        v-for="(s, i) in stops"
        :key="`b-${i}`"
        class="closest-row"
        :class="{ 'stop-selected': busStopKey(s) === selectedKey }"
        @click="emits('select', s)"
        @mouseenter="emits('hover-enter', s)"
        @mouseleave="emits('hover-leave')"
      >
        <strong>{{ stopName(s) }}</strong>
        <span v-if="s.distance != null" class="tag">{{ s.distance.toFixed(2) }} miles</span>
        <ul class="stop-entries">
          <li v-for="(e, j) in visibleEntries(s)" :key="j" class="stop-entry">
            <div class="entry-line entry-school">
              <button class="link-btn" @click.stop="emits('select-school', e.school)">{{ e.school }}</button>
              <span class="entry-route">— Route {{ e.type === 'Dropoff' ? e.dropoffRoute : e.pickupRoute }}</span>
            </div>
            <div class="entry-line entry-meta">
              <span v-if="e.type === 'Pickup'" class="entry-type pickup">Pickup</span>
              <span v-else-if="e.type === 'Dropoff'" class="entry-type dropoff">Dropoff</span>
              <span v-else class="entry-type both">Pickup & Dropoff</span>
              <span v-if="e.pickupTime" class="time">{{ e.pickupTime }}</span>
              <span v-if="e.pickupTime && e.dropoffTime" class="time-sep"> / </span>
              <span v-if="e.dropoffTime" class="time">{{ e.dropoffTime }}</span>
            </div>
          </li>
        </ul>
      </li>
    </ol>
  </section>
  <p v-else-if="showLocationEmpty" class="muted">No bus stops found within the selected radius.</p>
  <p v-else-if="showSchoolEmpty" class="muted">No bus stops found for this school.</p>
</template>
