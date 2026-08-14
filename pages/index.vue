<script setup>
import { ref, computed, watch, watchEffect, onMounted, nextTick } from 'vue'
import { LMap, LTileLayer, LMarker, LIcon, LPopup, LTooltip, LGeoJson } from '@vue-leaflet/vue-leaflet'
import * as L from 'leaflet'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import distance from '@turf/distance'
import centroid from '@turf/centroid'

const mapRef = ref(null)
const center = ref([42.3314, -83.0458])
const zoom = ref(11)
const address = ref('')
const selectedGrade = ref('all')
const selectedLocation = ref(null)
const loading = ref(false)

const allSchools = ref([])
const boundaryLists = ref({ elementary: [], middle: [], high: [] })
const detroitBoundary = ref(null)
const neighborhood = ref({ elementary: null, middle: null, high: null })
const closest = ref([])
const schoolUrlMap = ref(new Map())

const homeIconUrl = '/SVG/Home.svg'
const hoveredIndex = ref(null)
const activeListTooltip = ref(null)
const leaveTimer = ref(null)
let busCircleLayer = null
const hoveredBoundary = ref(null)
const boundaryLayers = ref({})
const activeBoundaryTooltip = ref(null)
const boundaryLeaveTimer = ref(null)

const gradeOptions = [
  { value: 'all', label: 'All Schools' },
  { value: 'PK', label: 'PreK (PK)' },
  { value: 'K-5', label: 'Elementary (K–5)' },
  { value: '6-8', label: 'Middle (6–8)' },
  { value: '9-12', label: 'High (9–12)' }
]

const gradeFilter = {
  all: () => true,
  PK: s => s.properties.PK === 1,
  'K-5': s => s.properties.K === 1 || s.properties.F1 === 1 || s.properties.F2 === 1 || s.properties.F3 === 1 || s.properties.F4 === 1 || s.properties.F5 === 1,
  '6-8': s => s.properties.F6 === 1 || s.properties.F7 === 1 || s.properties.F8 === 1,
  '9-12': s => s.properties.F9 === 1 || s.properties.F10 === 1 || s.properties.F11 === 1 || s.properties.F12 === 1
}

const categoryIcons = {
  'Elementary': 'Elementary.svg',
  'Elementary-Middle': 'Elementary-Middle.svg',
  'Middle School': 'Middle.svg',
  'High School': 'High.svg',
  'K-12/Other': 'K12 Other.svg',
  'Montessori': 'Montessori.svg',
  'Early Childhood': 'Early Childhood.svg',
  'Exceptional Student Education': 'Alternative ESE.svg',
  'Alternative': 'Alternative.svg',
  'Career & Technical Center': 'CTE.svg',
  'Unknown': 'Alternative.svg'
}

const legendItems = [
  { name: 'Elementary', category: 'Elementary' },
  { name: 'Elementary-Middle', category: 'Elementary-Middle' },
  { name: 'Middle School', category: 'Middle School' },
  { name: 'High School', category: 'High School' },
  { name: 'K-12/Other', category: 'K-12/Other' },
  { name: 'Montessori', category: 'Montessori' },
  { name: 'Early Childhood', category: 'Early Childhood' },
  { name: 'Exception Student Education', category: 'Exceptional Student Education' },
  { name: 'Alternative', category: 'Alternative' },
  { name: 'Career & Technical Center', category: 'Career & Technical Center' }
]

const gradeLabel = computed(() => gradeOptions.find(g => g.value === selectedGrade.value)?.label)

function iconUrl(category) {
  const file = categoryIcons[category] || categoryIcons['Unknown']
  return `/SVG/${encodeURIComponent(file)}`
}

function lookupUrl(s) {
  return s.properties?.url
    || schoolUrlMap.value.get(s.properties.schoolCode)
    || schoolUrlMap.value.get(s.properties.schoolName)
    || schoolUrlMap.value.get(s.properties.shortName)
    || null
}

function tooltipContent(s) {
  const url = lookupUrl(s)
  const parts = [`<strong>${s.properties.schoolName}</strong>`]
  if (s.properties.address) parts.push(s.properties.address)
  if (s.properties.telephone) parts.push(s.properties.telephone)
  if (s.properties.Category) parts.push(s.properties.Category)
  if (url) parts.push(`<a href="${url}" target="_blank" rel="noopener" class="tooltip-link">Website</a>`)
  return parts.join('<br/>')
}

function tooltipContentClosest(s) {
  const parts = [`<strong>${s.schoolName}</strong>`]
  if (s.address) parts.push(s.address)
  if (s.telephone) parts.push(s.telephone)
  if (s.category) parts.push(s.category)
  if (s.url) parts.push(`<a href="${s.url}" target="_blank" rel="noopener" class="tooltip-link">Website</a>`)
  return parts.join('<br/>')
}

onMounted(async () => {
  const [schools, elem, mid, high, detroit] = await Promise.all([
    $fetch('/data/School_Locations_2026-27.geojson'),
    $fetch('/data/Elementary_2026-27.geojson'),
    $fetch('/data/Middle_2026-27.geojson'),
    $fetch('/data/High_School_2026-27.geojson'),
    $fetch('/data/Detroit_Boundary.geojson')
  ])

  const phaseOutCodes = new Set()
  for (const s of schools.features) {
    if (s.properties?.Category === 'Phase-Out' && s.properties?.schoolCode) {
      phaseOutCodes.add(s.properties.schoolCode)
    }
  }

  allSchools.value = schools.features.filter(s => s.properties?.Category !== 'Phase-Out')
  boundaryLists.value = {
    elementary: elem.features.filter(f => !phaseOutCodes.has(f.properties?.schoolCode)),
    middle: mid.features.filter(f => !phaseOutCodes.has(f.properties?.schoolCode)),
    high: high.features.filter(f => !phaseOutCodes.has(f.properties?.schoolCode))
  }

  const urls = new Map()
  const add = (f) => {
    const p = f.properties
    if (p.url) {
      if (p.schoolCode) urls.set(p.schoolCode, p.url)
      if (p.schoolName) urls.set(p.schoolName, p.url)
      if (p.shortName) urls.set(p.shortName, p.url)
    }
  }
  boundaryLists.value.elementary.forEach(add)
  boundaryLists.value.middle.forEach(add)
  boundaryLists.value.high.forEach(add)
  schoolUrlMap.value = urls
  detroitBoundary.value = detroit
  await nextTick()
  fitToDefaultView()
})

watch(() => [selectedLocation.value, selectedGrade.value, allSchools.value, boundaryLists.value], computeResults)

function onMapClick(e) {
  selectedLocation.value = [e.latlng.lat, e.latlng.lng]
}

async function searchAddress() {
  if (!address.value.trim()) return
  loading.value = true
  try {
    const raw = address.value.trim()
    const q = /detroit/i.test(raw) ? raw : `${raw}, Detroit, MI`
    const results = await $fetch('/api/geocode', {
      query: { q }
    })
    const match = results?.find(r => /Detroit/i.test(r.name))
    if (match) {
      selectedLocation.value = [match.lat, match.lon]
    } else if (results && results.length) {
      selectedLocation.value = [results[0].lat, results[0].lon]
    } else {
      alert('That address was not found. The geocoders do not cover every address. Try a nearby major street or click the map.')
    }
  } catch (err) {
    console.error(err)
    alert('Could not reach the address search service. Try again later or click the map.')
  } finally {
    loading.value = false
  }
}

function flyTo(latLng, z = 16) {
  center.value = latLng
  zoom.value = z
  nextTick(() => {
    if (mapRef.value?.leafletObject) {
      mapRef.value.leafletObject.flyTo(latLng, z, { animate: true, duration: 1 })
    }
  })
}

function onClosestEnter(s, i) {
  hoveredIndex.value = i
  if (leaveTimer.value) {
    clearTimeout(leaveTimer.value)
    leaveTimer.value = null
  }
  const map = mapRef.value?.leafletObject
  if (!map) return
  activeListTooltip.value?.close()
  activeListTooltip.value = L.tooltip({
    className: 'school-tooltip',
    direction: 'top',
    offset: [0, -10]
  })
    .setLatLng(s.latLng)
    .setContent(tooltipContentClosest(s))
    .openOn(map)
}

function onClosestLeave() {
  hoveredIndex.value = null
  if (leaveTimer.value) clearTimeout(leaveTimer.value)
  leaveTimer.value = setTimeout(() => {
    if (!hoveredIndex.value && activeListTooltip.value) {
      activeListTooltip.value.close()
      activeListTooltip.value = null
    }
    leaveTimer.value = null
  }, 50)
}

function onNeighborhoodEnter(b) {
  hoveredBoundary.value = b.level
  if (boundaryLeaveTimer.value) {
    clearTimeout(boundaryLeaveTimer.value)
    boundaryLeaveTimer.value = null
  }
  const map = mapRef.value?.leafletObject
  if (!map) return
  activeBoundaryTooltip.value?.close()
  activeBoundaryTooltip.value = L.tooltip({
    className: 'school-tooltip',
    direction: 'top',
    offset: [0, -10]
  })
    .setLatLng(b.latLng)
    .setContent(tooltipContentClosest(b))
    .openOn(map)
}

function onNeighborhoodLeave() {
  hoveredBoundary.value = null
  if (boundaryLeaveTimer.value) clearTimeout(boundaryLeaveTimer.value)
  boundaryLeaveTimer.value = setTimeout(() => {
    if (!hoveredBoundary.value && activeBoundaryTooltip.value) {
      activeBoundaryTooltip.value.close()
      activeBoundaryTooltip.value = null
    }
    boundaryLeaveTimer.value = null
  }, 50)
}

function computeResults() {
  if (!selectedLocation.value || !allSchools.value.length) {
    neighborhood.value = { elementary: null, middle: null, high: null }
    closest.value = []
    return
  }
  const [lat, lng] = selectedLocation.value
  const pt = [lng, lat]

  const byCode = new Map(allSchools.value.map(s => [s.properties.schoolCode, s]))
  const byName = new Map(allSchools.value.map(s => [s.properties.schoolName, s]))
  const byShort = new Map(allSchools.value.map(s => [s.properties.shortName, s]))

  const find = (list, level) => {
    const f = list.find(b => booleanPointInPolygon(pt, b.geometry))
    if (!f) return null
    const p = f.properties
    const matched = byCode.get(p.schoolCode) || byName.get(p.schoolName) || byShort.get(p.shortName)

    let latLng
    if (matched) {
      const [mlng, mlat] = matched.geometry.coordinates
      latLng = [mlat, mlng]
    } else if (p.lat && p.lon) {
      latLng = [parseFloat(p.lat), parseFloat(p.lon)]
    } else {
      const c = centroid(f.geometry).geometry.coordinates
      latLng = [c[1], c[0]]
    }

    const category = matched?.properties?.Category || 'Unknown'
    const schoolName = matched?.properties?.schoolName || p.schoolName || p.NAME || p.shortName
    const addressText = matched?.properties?.address || p.address
    const telephone = matched?.properties?.telephone || p.telephone
    const url = p.url || (matched ? lookupUrl(matched) : null)

    return {
      level,
      feature: f,
      schoolName,
      address: addressText,
      telephone,
      category,
      url,
      latLng
    }
  }

  neighborhood.value = {
    elementary: find(boundaryLists.value.elementary, 'elementary'),
    middle: find(boundaryLists.value.middle, 'middle'),
    high: find(boundaryLists.value.high, 'high')
  }

  const filter = gradeFilter[selectedGrade.value]
  closest.value = allSchools.value
    .filter(filter)
    .map(s => {
      const [slng, slat] = s.geometry.coordinates
      const dist = distance([lng, lat], [slng, slat], { units: 'miles' })
      const category = s.properties.Category || 'Unknown'
      return {
        ...s.properties,
        latLng: [slat, slng],
        distance: dist,
        category,
        url: lookupUrl(s)
      }
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10)

  fitToResults()
}

function getBoundaryPoints(feature) {
  const points = []
  const geom = feature.geometry
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) {
      for (const [lng, lat] of ring) points.push([lat, lng])
    }
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      for (const ring of poly) {
        for (const [lng, lat] of ring) points.push([lat, lng])
      }
    }
  }
  return points
}

function fitToResults() {
  if (!selectedLocation.value) return
  const map = mapRef.value?.leafletObject
  if (!map) return
  const points = [selectedLocation.value]
  for (const b of relevantBoundaries.value) {
    points.push(b.latLng)
    points.push(...getBoundaryPoints(b.feature))
  }
  for (const s of closest.value) points.push(s.latLng)
  if (points.length < 2) return
  const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)))
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
}

function fitToDefaultView() {
  if (selectedLocation.value) return
  const map = mapRef.value?.leafletObject
  if (!map) return
  const points = []
  for (const s of allSchools.value) {
    const [lng, lat] = s.geometry.coordinates
    points.push([lat, lng])
  }
  for (const level of Object.keys(boundaryLists.value)) {
    for (const f of boundaryLists.value[level]) {
      points.push(...getBoundaryPoints(f))
    }
  }
  if (detroitBoundary.value) {
    for (const f of detroitBoundary.value.features) {
      points.push(...getBoundaryPoints(f))
    }
  }
  if (points.length < 2) return
  const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)))
  map.fitBounds(bounds, { padding: [40, 40] })
}

const relevantBoundaries = computed(() => Object.values(neighborhood.value).filter(Boolean))

const detroitBoundaryStyle = {
  color: '#999',
  weight: 1.5,
  fillOpacity: 0,
  opacity: 0.9
}

function boundaryColor(level) {
  if (level === 'elementary') return '#00a8de'
  if (level === 'middle') return '#5da73c'
  if (level === 'high') return '#1b51a3'
  return '#0033CC'
}

function boundaryOptions(level) {
  return {
    style: {
      color: '#0033CC',
      weight: 3,
      fillOpacity: 0.08,
      opacity: 1
    }
  }
}

function setBoundaryLayer(el, level) {
  if (el) boundaryLayers.value[level] = el
}

function applyBoundaryStyle(level, hover) {
  const layer = boundaryLayers.value[level]?.leafletObject
  if (!layer) return
  layer.setStyle({
    color: hover ? boundaryColor(level) : '#0033CC',
    weight: hover ? 8 : 3,
    fillOpacity: hover ? 0.45 : 0.08,
    opacity: hover ? 1 : 0.9
  })
}

watch(hoveredBoundary, (newLevel, oldLevel) => {
  if (oldLevel) applyBoundaryStyle(oldLevel, false)
  if (newLevel) applyBoundaryStyle(newLevel, true)
})

const route = useRoute()
const router = useRouter()
const activeTab = ref(route.query.tab === 'bus-stops' ? 'bus-stops' : 'schools')
const busStops = ref([])
const busRadius = ref(selectedLocation.value ? 1 : 100000)
const selectedBusSchool = ref((route.query.school) || '')
const busLoading = ref(false)
const busHoveredStop = ref(null)
const busIconUrl = '/SVG/Bus%20Stop.svg'

const busIconSize = computed(() => {
  const z = zoom.value
  if (z <= 12) return [16, 16]
  if (z <= 14) return [20, 20]
  return [24, 24]
})
const busIconAnchor = computed(() => [busIconSize.value[0] / 2, busIconSize.value[1] / 2])
const busIconHoverSize = computed(() => [Math.round(busIconSize.value[0] * 1.33), Math.round(busIconSize.value[1] * 1.33)])
const busIconHoverAnchor = computed(() => [busIconHoverSize.value[0] / 2, busIconHoverSize.value[1] / 2])

const busIcon = computed(() => L.icon({
  iconUrl: busIconUrl,
  iconSize: busIconSize.value,
  iconAnchor: busIconAnchor.value,
  popupAnchor: [0, -Math.round(busIconSize.value[1] / 2)]
}))
const busIconHover = computed(() => L.icon({
  iconUrl: busIconUrl,
  iconSize: busIconHoverSize.value,
  iconAnchor: busIconHoverAnchor.value,
  popupAnchor: [0, -Math.round(busIconHoverSize.value[1] / 2)]
}))

watch(() => route.query, (q) => {
  activeTab.value = q.tab === 'bus-stops' ? 'bus-stops' : 'schools'
  if (q.school && typeof q.school === 'string') {
    selectedBusSchool.value = q.school
  } else {
    selectedBusSchool.value = ''
  }
}, { immediate: true })

watch(activeTab, (tab) => {
  if (tab === 'bus-stops') loadBusStops()
  router.replace({ query: { ...route.query, tab } })
})

watch(selectedBusSchool, (school) => {
  const query = { ...route.query, tab: activeTab.value }
  if (school) query.school = school
  else delete query.school
  router.replace({ query })
})

watch(selectedLocation, (newLoc, oldLoc) => {
  if (newLoc && !oldLoc) busRadius.value = 1
  else if (!newLoc && oldLoc) busRadius.value = 100000
})

watchEffect(() => {
  const map = mapRef.value?.leafletObject
  if (!map) return
  if (busCircleLayer) {
    map.removeLayer(busCircleLayer)
    busCircleLayer = null
  }
  if (activeTab.value !== 'bus-stops' || !selectedLocation.value) return
  const [lat, lng] = selectedLocation.value
  busCircleLayer = L.circle([lat, lng], {
    radius: busRadius.value * 1609.344,
    color: '#0033CC',
    fill: false,
    weight: 2,
    dashArray: '5, 10'
  }).addTo(map)
})

onMounted(() => {
  if (activeTab.value === 'bus-stops') loadBusStops()
})

function fitMapToContent() {
  const map = mapRef.value?.leafletObject
  if (!map) return
  const points = []
  if (selectedLocation.value) {
    const [lat, lng] = selectedLocation.value
    points.push([lat, lng])
  }
  if (activeTab.value === 'schools') {
    if (selectedLocation.value) {
      for (const s of closest.value) points.push([s.latLng[0], s.latLng[1]])
      for (const b of relevantBoundaries.value) {
        if (b.latLng) points.push([b.latLng[0], b.latLng[1]])
      }
    } else {
      for (const s of allSchools.value) {
        points.push([s.geometry.coordinates[1], s.geometry.coordinates[0]])
      }
    }
  } else if (activeTab.value === 'bus-stops') {
    for (const s of nearbyBusStops.value) points.push([s.lat, s.lng])
    const [lat, lng] = selectedLocation.value || []
    if (lat !== undefined && lng !== undefined) points.push([lat, lng])
  }
  if (points.length === 1) {
    map.flyTo(points[0], 16)
    return
  }
  if (points.length < 2) {
    if (selectedLocation.value) map.flyTo(selectedLocation.value, 15)
    return
  }
  const bounds = L.latLngBounds(points)
  map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16, animate: false })
}

watchEffect(fitMapToContent)

async function loadBusStops() {
  if (busStops.value.length) return
  busLoading.value = true
  try {
    const res = await fetch('/data/bus-stops.json')
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    busStops.value = await res.json()
    await nextTick()
    fitMapToContent()
  } catch (err) {
    console.error('Bus stops load error:', err)
    alert('Could not load bus stop data: ' + (err?.message || 'unknown'))
  } finally {
    busLoading.value = false
  }
}

const busSchoolOptions = computed(() => {
  const map = new Map()
  for (const stop of busStops.value) {
    for (const e of stop.entries) {
      map.set(e.school, e.schoolName || e.school)
    }
  }
  return Array.from(map, ([raw, name]) => ({ raw, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const nearbyBusStops = computed(() => {
  if (!busStops.value.length) return []
  let stops = busStops.value
    .filter((s) => s.lat !== null && s.lng !== null)
    .map((s) => ({ ...s, distance: null }))
  if (selectedBusSchool.value) {
    stops = stops.filter((s) => s.entries.some((e) => e.schoolName === selectedBusSchool.value || e.school === selectedBusSchool.value))
  }
  if (selectedLocation.value) {
    const [lat, lng] = selectedLocation.value
    stops = stops
      .map((s) => {
        const dist = distance([lng, lat], [s.lng, s.lat], { units: 'miles' })
        return { ...s, distance: dist }
      })
      .filter((s) => s.distance <= busRadius.value)
      .sort((a, b) => a.distance - b.distance)
  }
  return stops
})

function setBusSchool(school) {
  activeTab.value = 'bus-stops'
  selectedBusSchool.value = school
}

function onBusStopEnter(s) {
  busHoveredStop.value = s.stop
  if (leaveTimer.value) {
    clearTimeout(leaveTimer.value)
    leaveTimer.value = null
  }
  const map = mapRef.value?.leafletObject
  if (!map) return
  activeListTooltip.value?.close()
  activeListTooltip.value = L.tooltip({
    className: 'school-tooltip',
    direction: 'top',
    offset: [0, -10]
  })
    .setLatLng([s.lat, s.lng])
    .setContent(busStopTooltip(s))
    .openOn(map)
}

function onBusStopLeave() {
  busHoveredStop.value = null
  if (leaveTimer.value) clearTimeout(leaveTimer.value)
  leaveTimer.value = setTimeout(() => {
    if (busHoveredStop.value === null && activeListTooltip.value) {
      activeListTooltip.value.close()
      activeListTooltip.value = null
    }
    leaveTimer.value = null
  }, 50)
}

function busStopTooltip(s) {
  const parts = [`<strong>${s.stop}</strong>`]
  if (s.distance !== null && s.distance !== undefined) {
    parts.push(`${s.distance.toFixed(2)} miles`)
  }
  for (const e of s.entries) {
    let line = e.school
    if (e.type === 'Pickup') {
      line += ` — Pickup route ${e.pickupRoute} @ ${e.pickupTime}`
    } else if (e.type === 'Dropoff') {
      line += ` — Dropoff route ${e.dropoffRoute} @ ${e.dropoffTime}`
    } else {
      line += ` — Route ${e.pickupRoute} — Pickup ${e.pickupTime}, Dropoff ${e.dropoffTime}`
    }
    parts.push(line)
  }
  return parts.join('<br/>')
}

function busStopPopup(s) {
  const parts = [`<strong>${s.stop}</strong>`]
  if (s.distance !== null && s.distance !== undefined) {
    parts.push(`${s.distance.toFixed(2)} miles`)
  }
  for (const e of s.entries) {
    let line = e.school
    if (e.type === 'Pickup') {
      line += ` — Pickup route ${e.pickupRoute} @ ${e.pickupTime}`
    } else if (e.type === 'Dropoff') {
      line += ` — Dropoff route ${e.dropoffRoute} @ ${e.dropoffTime}`
    } else {
      line += ` — Pickup route ${e.pickupRoute} @ ${e.pickupTime}, Dropoff @ ${e.dropoffTime}`
    }
    parts.push(line)
  }
  return parts.join('<br/>')
}
</script>

<template>
  <div class="app">
    <header class="brand-header">
      <a
        class="brand-link"
        href="https://www.detroitk12.org/"
        target="_blank"
        rel="noopener"
      >
        <img
          class="brand-logo"
          src="https://resources.finalsite.net/images/f_auto,q_auto,t_image_size_2/v1759325653/detroitk12org/s9zv8kfabfwpje1emanh/DPSCDLogoNoTag-White-RGB-HEX.png"
          alt="Detroit Public Schools Community District"
        />
      </a>
      <h1 class="brand-title">DPSCD School Locator</h1>
    </header>

    <div class="content">
      <aside class="panel">
        <nav class="tabs">
          <button
            :class="['tab', { active: activeTab === 'schools' }]"
            @click="activeTab = 'schools'"
          >Schools</button>
          <button
            :class="['tab', { active: activeTab === 'bus-stops' }]"
            @click="activeTab = 'bus-stops'"
          >Bus Stops</button>
        </nav>

        <p v-if="activeTab === 'schools'" class="muted">Find your neighborhood school and other schools near you.</p>
        <p v-if="activeTab === 'bus-stops'" class="muted">Find bus stops near you.</p>
        <div v-if="activeTab === 'schools'">

        <form class="search" @submit.prevent="searchAddress">
          <label for="address">Address</label>
          <input id="address" v-model="address" placeholder="123 Main St" type="text" />
          <button :disabled="!address.trim() || loading" type="submit">
            {{ loading ? 'Searching…' : 'Search' }}
          </button>
        </form>

        <div class="field">
          <label for="grade">Grade level</label>
          <select id="grade" v-model="selectedGrade">
            <option v-for="g in gradeOptions" :key="g.value" :value="g.value">
              {{ g.label }}
            </option>
          </select>
        </div>

        <p v-if="!selectedLocation" class="hint">Click the map or search an address to set your location.</p>

        <section v-if="selectedLocation" class="results">
          <h2>Neighborhood Schools</h2>
          <ul class="cards">
            <li
              v-for="b in relevantBoundaries"
              :key="b.level"
              class="card"
              :class="b.level"
              @click="flyTo(b.latLng)"
              @mouseenter="onNeighborhoodEnter(b)"
              @mouseleave="onNeighborhoodLeave()"
            >
              <span class="level-tag">{{ b.level }}</span>
              <strong>{{ b.schoolName }}</strong>
              <span v-if="b.address">{{ b.address }}</span>
              <span v-if="b.telephone">{{ b.telephone }}</span>
              <div class="tags">
                <span class="tag category">
                  <img class="tag-icon" :src="iconUrl(b.category)" :alt="b.category" />
                  {{ b.category }}
                </span>
              </div>
              <a v-if="b.url" :href="b.url" target="_blank" rel="noopener" class="card-link">
                Website
              </a>
            </li>
          </ul>

          <h2>10 Closest {{ gradeLabel }} Schools</h2>
          <ol v-if="closest.length" class="cards ranked">
            <li
              v-for="(s, i) in closest"
              :key="i"
              class="closest-row"
              @click="flyTo(s.latLng)"
              @mouseenter="onClosestEnter(s, i)"
              @mouseleave="onClosestLeave"
            >
              <strong>{{ s.schoolName }}</strong>
              <span v-if="s.address">{{ s.address }}</span>
              <div class="tags">
                <span class="tag category">
                  <img class="tag-icon" :src="iconUrl(s.category)" :alt="s.category" />
                  {{ s.category }}
                </span>
                <span class="tag">{{ s.distance.toFixed(2) }} miles</span>
              </div>
              <a v-if="s.url" :href="s.url" target="_blank" rel="noopener" class="card-link">
                Website
              </a>
            </li>
          </ol>
          <p v-else class="muted">No schools found for this grade level.</p>
        </section>
        </div>

        <div v-if="activeTab === 'bus-stops'" class="bus-stops">
          <form class="search" @submit.prevent="searchAddress">
            <label for="busAddress">Address</label>
            <input id="busAddress" v-model="address" placeholder="123 Main St" type="text" />
            <button :disabled="!address.trim() || loading" type="submit">
              {{ loading ? 'Searching…' : 'Search' }}
            </button>
          </form>

          <div class="field">
            <label for="busRadius">Radius</label>
            <select id="busRadius" v-model="busRadius">
              <option v-for="r in [0.25, 0.5, 1, 1.5, 2]" :key="r" :value="r">{{ r }} miles</option>
              <option :value="100000">Show All</option>
            </select>
          </div>

          <div class="field">
            <label for="busSchool">School</label>
            <select id="busSchool" v-model="selectedBusSchool">
              <option value="">All schools</option>
              <option v-for="s in busSchoolOptions" :key="s.raw" :value="s.raw">{{ s.name }}</option>
            </select>
          </div>

          <p v-if="!selectedLocation" class="hint">All bus stops are shown. Click the map or search an address to filter by radius.</p>

          <section v-if="nearbyBusStops.length" class="results">
            <h2>{{ selectedBusSchool ? selectedBusSchool : (selectedLocation ? 'Nearby Bus Stops' : 'All Bus Stops') }}</h2>
            <ol class="cards ranked">
              <li
                v-for="(s, i) in nearbyBusStops"
                :key="`b-${i}`"
                class="closest-row"
                @click="flyTo([s.lat, s.lng])"
                @mouseenter="onBusStopEnter(s)"
                @mouseleave="onBusStopLeave"
              >
                <strong>{{ s.stop }}</strong>
                <span v-if="s.distance != null" class="tag">{{ s.distance.toFixed(2) }} miles</span>
                <ul class="stop-entries">
                  <li v-for="(e, j) in s.entries" :key="j" class="stop-entry">
                    <div class="entry-line entry-school">
                      <button class="link-btn" @click.stop="setBusSchool(e.school)">{{ e.school }}</button>
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
          <p v-else-if="selectedLocation" class="muted">No bus stops found within the selected radius.</p>
          <p v-else class="muted">No bus stops found.</p>
        </div>
      </aside>

      <main class="map-wrap">
        <l-map
          ref="mapRef"
          :zoom="zoom"
          :center="center"
          style="height: 100%; width: 100%"
          @click="onMapClick"
          @ready="fitMapToContent"
        >
          <l-tile-layer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution="&copy; OpenStreetMap contributors, &copy; CARTO"
          />

          <l-geo-json
            v-if="activeTab === 'schools'"
            v-for="b in relevantBoundaries"
            :key="b.level"
            :ref="el => setBoundaryLayer(el, b.level)"
            :geojson="b.feature"
            :options="boundaryOptions(b.level)"
          />

          <l-geo-json
            v-if="detroitBoundary"
            :geojson="detroitBoundary"
            :options-style="detroitBoundaryStyle"
          />

          <l-marker
            v-if="selectedLocation"
            :lat-lng="selectedLocation"
          >
            <l-icon
              :icon-url="homeIconUrl"
              :icon-size="[32, 32]"
              :icon-anchor="[16, 16]"
            />
            <l-popup>Selected location</l-popup>
          </l-marker>

          <l-marker
            v-if="activeTab === 'schools'"
            v-for="b in relevantBoundaries"
            :key="`n-${b.level}`"
            :lat-lng="b.latLng"
            :z-index-offset="hoveredBoundary === b.level ? 1000 : 0"
          >
            <l-icon
              :icon-url="iconUrl(b.category)"
              :icon-size="hoveredBoundary === b.level ? [40, 40] : [30, 30]"
              :icon-anchor="hoveredBoundary === b.level ? [20, 20] : [15, 15]"
            />
            <l-popup>
              <strong>{{ b.schoolName }}</strong><br />
              {{ b.address }}<br v-if="b.address" />
              {{ b.telephone }}<br v-if="b.telephone" />
              {{ b.category }}<br />
              <a v-if="b.url" :href="b.url" target="_blank" rel="noopener">Website</a>
            </l-popup>
          </l-marker>

          <l-marker
            v-if="activeTab === 'schools'"
            v-for="(s, i) in closest"
            :key="`c-${i}`"
            :lat-lng="s.latLng"
            :z-index-offset="hoveredIndex === i ? 1000 : 0"
          >
            <l-icon
              :icon-url="iconUrl(s.category)"
              :icon-size="hoveredIndex === i ? [36, 36] : [24, 24]"
              :icon-anchor="hoveredIndex === i ? [18, 18] : [12, 12]"
            />
            <l-popup>
              <strong>{{ s.schoolName }}</strong><br />
              {{ s.address }}<br v-if="s.address" />
              {{ s.distance.toFixed(2) }} miles<br />
              {{ s.category }}<br />
              <a v-if="s.url" :href="s.url" target="_blank" rel="noopener">Website</a>
            </l-popup>
          </l-marker>

          <template v-if="activeTab === 'schools' && !selectedLocation">
            <l-marker
              v-for="(s, i) in allSchools"
              :key="`all-${i}`"
              :lat-lng="[s.geometry.coordinates[1], s.geometry.coordinates[0]]"
            >
              <l-icon
                :icon-url="iconUrl(s.properties.Category)"
                :icon-size="[20, 20]"
                :icon-anchor="[10, 10]"
              />
              <l-tooltip
                :content="tooltipContent(s)"
                :options="{ interactive: true, direction: 'top', className: 'school-tooltip' }"
              />
            </l-marker>
          </template>

          <template v-if="activeTab === 'bus-stops'">
            <l-marker
              v-for="s in nearbyBusStops"
              :key="s.stop"
              :lat-lng="[s.lat, s.lng]"
              :z-index-offset="busHoveredStop === s.stop ? 1000 : 0"
              :icon="busHoveredStop === s.stop ? busIconHover : busIcon"
            >
              <l-popup><span v-html="busStopPopup(s)"></span></l-popup>
            </l-marker>
          </template>
        </l-map>

        <div class="legend">
          <h4>School Types</h4>
          <ul>
            <li v-for="item in legendItems" :key="item.category">
              <img class="legend-icon" :src="iconUrl(item.category)" :alt="item.name" />
              {{ item.name }}
            </li>
          </ul>
        </div>
      </main>
    </div>
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&family=Roboto:ital,wght@0,300;0,400;0,500;0,700;1,400&display=swap');

:root {
  --dpscd-primary: #0033CC;
  --dpscd-primary-dark: #00228a;
  --dpscd-secondary: #FFCC00;
  --dpscd-text: #131313;
  --dpscd-gray: #373737;
}

html,
body,
#__nuxt {
  height: 100%;
  margin: 0;
  font-family: 'Roboto', sans-serif;
  color: var(--dpscd-text);
}

h1, h2, h3, h4 {
  font-family: 'Lora', serif;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.brand-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 1.25rem;
  background: var(--dpscd-primary);
  border-bottom: 4px solid var(--dpscd-secondary);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
  z-index: 10;
}

.brand-link {
  display: flex;
  align-items: center;
  text-decoration: none;
}

.brand-logo {
  height: 40px;
  width: auto;
}

.brand-title {
  margin: 0;
  font-size: 1.25rem;
  color: #fff;
  font-family: 'Roboto', sans-serif;
  letter-spacing: 0.05em;
}

.content {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.panel {
  width: 380px;
  flex-shrink: 0;
  padding: 1.25rem;
  overflow-y: auto;
  background: #fff;
  border-right: 1px solid #e5e5e5;
}

.map-wrap {
  flex: 1;
  position: relative;
}

h2 {
  margin: 1.5rem 0 0.5rem;
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--dpscd-primary);
}

.muted {
  color: var(--dpscd-gray);
  font-size: 0.9rem;
  margin: 0.25rem 0 1rem;
}

.search,
.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
}

label {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--dpscd-text);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

input,
select,
button {
  padding: 0.55rem;
  border: 1px solid #c3c5cc;
  border-radius: 4px;
  font-size: 1rem;
  font-family: 'Roboto', sans-serif;
}

input:focus,
select:focus {
  outline: 2px solid var(--dpscd-primary);
  border-color: var(--dpscd-primary);
}

button[type="submit"] {
  background: var(--dpscd-secondary);
  color: var(--dpscd-text);
  border: 1px solid var(--dpscd-secondary);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: 0.2s all;
}

button[type="submit"]:hover,
button[type="submit"]:focus {
  background: transparent;
  color: var(--dpscd-primary);
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  color: var(--dpscd-gray);
}

.hint,
.selected {
  font-size: 0.9rem;
  margin: 0.75rem 0;
  color: var(--dpscd-gray);
}

.selected {
  color: var(--dpscd-text);
  font-weight: 500;
}

.cards {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.card {
  display: flex;
  flex-direction: column;
  padding: 0.75rem;
  border-radius: 4px;
  border: 1px solid #e5e5e5;
  background: #f9f9f9;
  cursor: pointer;
  transition: background 0.15s;
}

.card:hover {
  background: #f0f0f0;
}

.card strong {
  color: var(--dpscd-text);
}

.level-tag {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--dpscd-gray);
  margin-bottom: 0.15rem;
}

.card > span {
  color: var(--dpscd-gray);
  font-size: 0.85rem;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.4rem;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  background: #e5e5e5;
  color: var(--dpscd-gray);
  font-size: 0.75rem;
  text-transform: capitalize;
  width: fit-content;
}

.tag-icon {
  width: 1rem;
  height: 1rem;
  display: inline-block;
}

.card-link {
  margin-top: 0.4rem;
  font-size: 0.85rem;
  color: var(--dpscd-primary);
  text-decoration: none;
  font-weight: 500;
}

.card-link:hover {
  text-decoration: underline;
}

.card.elementary {
  border-left: 4px solid #00a8de;
}

.card.middle {
  border-left: 4px solid #5da73c;
}

.card.high {
  border-left: 4px solid #1b51a3;
}

ol.ranked {
  counter-reset: rank;
  gap: 0;
}

.closest-row {
  display: block;
  padding: 0.6rem 0.25rem;
  border-bottom: 1px solid #e5e5e5;
  border-radius: 0;
  background: transparent;
  cursor: pointer;
  transition: background 0.15s;
}

.closest-row:hover,
.closest-row:focus {
  background: #f5f5f5;
}

.closest-row strong {
  color: var(--dpscd-text);
}

.closest-row > span {
  display: block;
  color: var(--dpscd-gray);
  font-size: 0.85rem;
}

.closest-row .tags {
  margin-top: 0.3rem;
}

ol.ranked .closest-row::before {
  counter-increment: rank;
  content: counter(rank) '. ';
  font-weight: 700;
  color: var(--dpscd-primary);
}

.legend {
  position: absolute;
  left: 0.5rem;
  right: 0.5rem;
  bottom: 0.5rem;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid #e5e5e5;
  border-radius: 4px 4px 0 0;
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  z-index: 1000;
  box-shadow: 0 -2px 6px rgba(0, 0, 0, 0.08);
  pointer-events: none;
}

.legend h4,
.legend li {
  pointer-events: auto;
}

.legend h4 {
  margin: 0 0 0.25rem;
  font-size: 0.85rem;
  color: var(--dpscd-primary);
  font-family: 'Lora', serif;
}

.legend ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.25rem 1rem;
}

.legend li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.legend-icon {
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
}

.school-tooltip {
  font-size: 0.85rem;
}

.school-tooltip a.tooltip-link {
  color: var(--dpscd-primary);
  text-decoration: none;
  font-weight: 500;
}

.school-tooltip a.tooltip-link:hover {
  text-decoration: underline;
}

.tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  border-bottom: 2px solid #e5e5e5;
}

.tab {
  flex: 1;
  padding: 0.5rem;
  background: #f0f0f0;
  border: none;
  border-bottom: 3px solid transparent;
  border-radius: 4px 4px 0 0;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  transition: 0.2s;
}

.tab:hover,
.tab.active {
  background: #e5e5e5;
  border-bottom-color: var(--dpscd-primary, #0033CC);
  color: var(--dpscd-primary, #0033CC);
}

.stop-entries {
  list-style: none;
  padding: 0.25rem 0 0;
  margin: 0;
}

.stop-entry {
  padding: 0.2rem 0;
  font-size: 0.8rem;
  color: var(--dpscd-gray, #373737);
}

.entry-line {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.entry-meta {
  margin-top: 0.15rem;
}

.entry-route {
  color: var(--dpscd-gray, #373737);
  font-size: 0.75rem;
  white-space: nowrap;
}

.link-btn {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  color: var(--dpscd-primary, #0033CC);
  font-size: 0.8rem;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  text-align: left;
  text-transform: none;
  letter-spacing: normal;
}

.link-btn:hover {
  text-decoration: underline;
}

.entry-type {
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.entry-type.pickup { background: #d1e7ff; color: #0033CC; }
.entry-type.dropoff { background: #ffe7d1; color: #a64400; }
.entry-type.both { background: #e7d1ff; color: #6600a6; }

.time {
  color: var(--dpscd-gray, #373737);
  font-size: 0.75rem;
}

.time-sep {
  color: #999;
  font-size: 0.75rem;
}
</style>