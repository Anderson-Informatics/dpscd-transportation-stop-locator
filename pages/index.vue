<script setup>
import { ref, computed, watch, watchEffect, onMounted, nextTick } from 'vue'
import { LMap, LTileLayer, LMarker, LIcon, LPopup, LTooltip, LGeoJson } from '@vue-leaflet/vue-leaflet'
import * as L from 'leaflet'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import distance from '@turf/distance'
import centroid from '@turf/centroid'

const mapRef = ref(null)
const mobileShellRef = ref(null)
const center = ref([42.3314, -83.0458])
const zoom = ref(11)
const address = ref('')
const selectedGrade = ref('all')
const selectedLocation = ref(null)
const loading = ref(false)
const filtersOpen = ref(false)

const allSchools = ref([])
const boundaryLists = ref({ elementary: [], middle: [], high: [] })
const detroitBoundary = ref(null)
const neighborhood = ref({ elementary: null, middle: null, high: null })
const closest = ref([])
const schoolUrlMap = ref(new Map())
// Schools that are closed or phasing out — hidden from both tabs.
const excludedSchoolNames = ref(new Set())

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

const legendOpen = ref(false)

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

  const isExcluded = (p) => p?.Category === 'Phase-Out' || p?.status === 'Closed'

  const excludedCodes = new Set()
  const excludedNames = new Set()
  for (const s of schools.features) {
    if (!isExcluded(s.properties)) continue
    if (s.properties?.schoolCode) excludedCodes.add(s.properties.schoolCode)
    if (s.properties?.schoolName) excludedNames.add(s.properties.schoolName)
  }
  excludedSchoolNames.value = excludedNames

  allSchools.value = schools.features.filter(s => !isExcluded(s.properties))
  boundaryLists.value = {
    elementary: elem.features.filter(f => !excludedCodes.has(f.properties?.schoolCode)),
    middle: mid.features.filter(f => !excludedCodes.has(f.properties?.schoolCode)),
    high: high.features.filter(f => !excludedCodes.has(f.properties?.schoolCode))
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
  if (isMobile.value && filtersOpen.value) {
    filtersOpen.value = false
    return
  }
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

function geolocate() {
  if (!navigator.geolocation) return
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      selectedLocation.value = [pos.coords.latitude, pos.coords.longitude]
      address.value = ''
    },
    (err) => {
      console.error('Geolocation error:', err)
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  )
}

function flyTo(latLng, z = 16) {
  nextTick(() => {
    if (mapRef.value?.leafletObject) {
      mapRef.value.leafletObject.flyTo(latLng, z, { animate: true, duration: 1 })
    }
  })
}
// Shift the center up so the selected stop sits between the top control bar
// and the peeking bottom sheet on mobile.
function flyToOnMobile(map, latLng, zoom) {
  const point = map.project(latLng, zoom)
  const controlBarH = 110
  const peekH = 96
  point.y -= (controlBarH - peekH) / 2
  return map.unproject(point, zoom)
}

// 
// Two steps closer than the zoom that fits a 1-mile radius, so cross streets read.
function busStopDetailZoom(map, latLng) {
  const oneMile = L.latLng(latLng[0], latLng[1]).toBounds(1609.344 * 2)
  return Math.min(map.getMaxZoom() ?? 19, map.getBoundsZoom(oneMile) + 2)
}

function goToBusStop(s) {
  const map = mapRef.value?.leafletObject
  if (!map) return
  // Drop the transient hover tooltip and any popup left over from a previous stop.
  if (leaveTimer.value) {
    clearTimeout(leaveTimer.value)
    leaveTimer.value = null
  }
  activeListTooltip.value?.close()
  activeListTooltip.value = null
  map.closePopup()

  const key = busStopKey(s)
  selectedBusStopKey.value = key
  if (isMobile.value) mobileShellRef.value?.snapTo('peek')
  const target = [s.lat, s.lng]
  const z = busStopDetailZoom(map, target)
  const flyTarget = isMobile.value ? flyToOnMobile(map, target, z) : target
  map.flyTo(flyTarget, z, { animate: true, duration: 0.8 })

  // Re-open the popup only once the map has settled on the stop.
  const marker = busMarkerIndex.get(key)
  if (!marker) return
  marker.setPopupContent(busStopPopup(s))
  map.once('moveend', () => {
    if (selectedBusStopKey.value === key) marker.openPopup()
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
  if (activeTab.value !== 'schools') return
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
const { isMobile } = useIsMobile()
const activeTab = ref('bus-stops')
const busStops = ref([])
const busRadius = ref(selectedLocation.value ? 1 : 100000)
const selectedBusSchool = ref((route.query.school) || '')
const busLoading = ref(false)
const busIconUrl = '/SVG/Bus%20Stop.svg'
const busIcon = L.icon({
  iconUrl: busIconUrl,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -9]
})
const busIconHover = L.icon({
  iconUrl: busIconUrl,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12]
})

const homeIcon = L.icon({
  iconUrl: homeIconUrl,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -16]
})

let busStopsLayer = null
let busStopsLayerDirty = false
let mapZooming = false
let homeMarker = null
let busSchoolLayer = null
let busSchoolLayerDirty = false
const busMarkerIndex = new Map()
const busSchoolMarkerIndex = new Map()
let hoveredBusKey = null
const selectedBusStopKey = ref(null)
let hoveredSchoolName = null
const lockedSchoolName = ref(null)
const busSchoolShortNames = new Map()
const lockedSchoolShortName = computed(() => {
  const name = lockedSchoolName.value
  if (!name) return ''
  return busSchoolShortNames.get(name) || name
})
const BUS_DIM_OPACITY = 0.2

// Strip any legacy ?tab= query parameter on initial load.
if (route.query.tab !== undefined) {
  const next = { ...route.query }
  delete next.tab
  router.replace({ query: next })
}

watch(() => route.query.school, (school) => {
  if (school && typeof school === 'string') {
    selectedBusSchool.value = school
  } else if (school === undefined || school === null) {
    selectedBusSchool.value = ''
  }
})

watch(selectedBusSchool, (school, oldSchool) => {
  hoveredSchoolName = null
  lockedSchoolName.value = null
  const query = { ...route.query }
  if (school) {
    busRadius.value = 100000
    query.school = school
  } else {
    if (oldSchool) {
      busRadius.value = selectedLocation.value ? 1 : 100000
    }
    delete query.school
  }
  router.replace({ query })
})

watch(() => selectedLocation.value, (newLoc, oldLoc) => {
  hoveredSchoolName = null
  lockedSchoolName.value = null
  if (newLoc) {
    selectedBusSchool.value = ''
    busRadius.value = 1
  } else if (oldLoc) {
    busRadius.value = 100000
  }
})

// Like the markers, the radius circle is created once and only updated, so it is
// never added to the map mid-animation (which can leave it stranded or unstyled).
function drawBusRadiusCircle() {
  const map = mapRef.value?.leafletObject
  if (!map) return
  if (!busCircleLayer) {
    busCircleLayer = L.circle(selectedLocation.value || [0, 0], {
      radius: 0,
      color: '#0033CC',
      fill: false,
      weight: 2,
      dashArray: '5, 10',
      interactive: false
    }).addTo(map)
  }
  const show = activeTab.value === 'bus-stops' && !!selectedLocation.value && busRadius.value <= 2
  if (show) {
    busCircleLayer.setLatLng(selectedLocation.value)
    busCircleLayer.setRadius(busRadius.value * 1609.344)
  }
  busCircleLayer.setStyle({ opacity: show ? 0.9 : 0 })
}

onMounted(() => {
  if (activeTab.value === 'bus-stops') loadBusStops()
})

function fitMapToContent() {
  const map = mapRef.value?.leafletObject
  if (!map) return
  if (activeTab.value === 'schools') {
    const points = []
    if (selectedLocation.value) {
      points.push(selectedLocation.value)
      for (const s of closest.value) points.push([s.latLng[0], s.latLng[1]])
      for (const b of relevantBoundaries.value) {
        if (b.latLng) points.push([b.latLng[0], b.latLng[1]])
      }
    } else {
      for (const s of allSchools.value) {
        points.push([s.geometry.coordinates[1], s.geometry.coordinates[0]])
      }
    }
    if (points.length < 2) return
    const bounds = L.latLngBounds(points)
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 })
    return
  }
  if (activeTab.value !== 'bus-stops') return
  map.stop()
  if (selectedBusSchool.value && nearbyBusStops.value.length) {
    const points = nearbyBusStops.value.map((s) => [s.lat, s.lng])
    for (const s of nearbyBusStops.value) {
      for (const e of visibleEntries(s)) {
        const marker = e.schoolName && busSchoolMarkerIndex.get(e.schoolName)
        if (marker) points.push(marker.getLatLng())
      }
    }
    const bounds = L.latLngBounds(points)
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16, animate: true, duration: 0.8 })
    return
  }
  if (selectedLocation.value) {
    const [lat, lng] = selectedLocation.value
    const bounds = L.latLng(lat, lng).toBounds(busRadius.value * 1609.344 * 2)
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16, animate: true, duration: 0.8 })
    return
  }
  fitToDefaultView()
}

function onMapReady() {
  const map = mapRef.value?.leafletObject
  if (map) {
    const settle = () => {
      mapZooming = false
      if (busStopsLayerDirty) updateBusStopsLayer()
      if (busSchoolLayerDirty) updateBusSchoolMarkers()
    }
    map.on('zoomstart', () => { mapZooming = true })
    map.on('zoomend', settle)
    map.on('moveend', settle)
    // Re-evaluate school label visibility after zoom changes on mobile.
    map.on('zoomend', () => {
      if (isMobile.value) updateBusSchoolMarkers()
    })
  }
  drawBusRadiusCircle()
  updateHomeMarker()
  updateBusStopsLayer()
  updateBusSchoolMarkers()
  fitMapToContent()
}

// The home marker for the bus-stops tab is a plain Leaflet marker that is created
// once and only repositioned, so it is never added to the map mid zoom-animation
// (which would leave it stuck to the viewport instead of the map).
function updateHomeMarker() {
  const map = mapRef.value?.leafletObject
  if (!map) return
  if (!homeMarker) {
    homeMarker = L.marker(selectedLocation.value || [0, 0], { icon: homeIcon })
      .bindPopup('Selected location')
      .addTo(map)
  }
  const show = activeTab.value === 'bus-stops' && !!selectedLocation.value
  if (show) homeMarker.setLatLng(selectedLocation.value)
  const el = homeMarker.getElement()
  if (el) el.style.display = show ? '' : 'none'
}

// The school card closes on a short delay so the pointer can travel from the icon
// into the popup (to reach the Website link) without it disappearing.
let schoolPopupTimer = null

function cancelSchoolPopupClose() {
  if (!schoolPopupTimer) return
  clearTimeout(schoolPopupTimer)
  schoolPopupTimer = null
}

function scheduleSchoolPopupClose(marker) {
  cancelSchoolPopupClose()
  schoolPopupTimer = setTimeout(() => {
    schoolPopupTimer = null
    hoveredSchoolName = null
    marker.closePopup()
    applyBusHighlight()
  }, 250)
}

// Schools that have at least one bus stop in the current result set. Like the other
// bus-stop layers these markers are created once and only toggled, never re-added.
function updateBusSchoolMarkers() {
  const map = mapRef.value?.leafletObject
  if (!map) return
  // Adding markers while a zoom animation is running strands them at stale screen
  // positions, so defer the build until the map has settled.
  if (mapZooming && !busSchoolMarkerIndex.size) {
    busSchoolLayerDirty = true
    return
  }
  busSchoolLayerDirty = false
  if (!busSchoolLayer) busSchoolLayer = L.layerGroup().addTo(map)

  if (allSchools.value.length && !busSchoolMarkerIndex.size) {
    for (const f of allSchools.value) {
      const name = f.properties.schoolName
      if (!name) continue
      const [lng, lat] = f.geometry.coordinates
      const category = f.properties.Category || 'Unknown'
      const marker = L.marker([lat, lng], {
        icon: L.icon({
          iconUrl: iconUrl(category),
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          popupAnchor: [0, -15]
        })
      })
        // Hover info card: no autoPan so the map never shifts.
        .bindPopup(busSchoolPopup(f), {
          autoPan: false,
          closeButton: false,
          className: 'school-hover-popup'
        })
        .bindTooltip(f.properties.shortName || name, {
          permanent: true,
          direction: 'right',
          offset: [16, 0],
          className: 'school-label'
        })
        .on('mouseover', (ev) => {
          if (isMobile.value) return
          cancelSchoolPopupClose()
          hoveredSchoolName = name
          ev.target.openPopup()
          applyBusHighlight()
        })
        .on('mouseout', (ev) => {
          if (isMobile.value) return
          scheduleSchoolPopupClose(ev.target)
        })
        .on('click', (ev) => {
          cancelSchoolPopupClose()
          lockedSchoolName.value = lockedSchoolName.value === name ? null : name
          hoveredSchoolName = null
          ev.target.closePopup()
          applyBusHighlight()
        })
        // Moving the pointer into the card keeps it open; leaving it closes it.
        .on('popupopen', (ev) => {
          const el = ev.popup.getElement()
          if (!el || el.dataset.hoverBound) return
          el.dataset.hoverBound = '1'
          el.addEventListener('mouseenter', cancelSchoolPopupClose)
          el.addEventListener('mouseleave', () => scheduleSchoolPopupClose(ev.target))
        })
      busSchoolShortNames.set(name, f.properties.shortName || name)
      busSchoolMarkerIndex.set(name, marker)
      busSchoolLayer.addLayer(marker)
    }
  }

  // Safety net: recompute every icon position from its lat/lng in case any marker
  // was laid out while the map was mid-transition. Never do this during an
  // animation, or it writes transitional coordinates and causes the very bug it
  // is meant to repair.
  if (mapZooming) {
    busSchoolLayerDirty = true
  } else {
    for (const marker of busSchoolMarkerIndex.values()) marker.update()
  }

  const visible = new Set()
  if (activeTab.value === 'bus-stops' && selectedBusSchool.value) {
    // Only the selected school, even if its stops are shared with other schools.
    for (const s of nearbyBusStops.value) {
      for (const e of s.entries) {
        if (e.school === selectedBusSchool.value || e.schoolName === selectedBusSchool.value) {
          if (e.schoolName) visible.add(e.schoolName)
        }
      }
    }
  } else if (activeTab.value === 'bus-stops' && selectedLocation.value) {
    for (const s of nearbyBusStops.value) {
      for (const e of s.entries) {
        if (e.schoolName) visible.add(e.schoolName)
      }
    }
  }
  // A highlight can only stay armed while its school is actually on the map.
  if (lockedSchoolName.value && !visible.has(lockedSchoolName.value)) lockedSchoolName.value = null
  if (hoveredSchoolName && !visible.has(hoveredSchoolName)) hoveredSchoolName = null

  // Every visible school icon gets its short-name label.
  const mobileHideLabels = isMobile.value && map.getZoom() < 14
  for (const [name, marker] of busSchoolMarkerIndex) {
    const show = visible.has(name)
    const el = marker.getElement()
    if (el) el.style.display = show ? '' : 'none'
    const tip = marker.getTooltip()?.getElement()
    const isActive = hoveredSchoolName === name || lockedSchoolName.value === name
    if (tip) tip.style.display = (show && (!mobileHideLabels || isActive)) ? '' : 'none'
  }
  applyBusHighlight()
}

// Hovering a school icon (or clicking to lock it) fades everything that is not
// served by that school. Purely a style pass over the persistent markers, so it
// survives zooming and never touches the layer lifecycle.
function highlightedSchool() {
  return hoveredSchoolName || lockedSchoolName.value
}

function stopKeysForSchool(name) {
  const keys = new Set()
  for (const s of nearbyBusStops.value) {
    if (s.entries.some((e) => e.schoolName === name)) keys.add(busStopKey(s))
  }
  return keys
}

function clearBusHighlight() {
  if (!hoveredSchoolName && !lockedSchoolName.value) return
  hoveredSchoolName = null
  lockedSchoolName.value = null
  applyBusHighlight()
}

function applyBusHighlight() {
  const active = highlightedSchool()
  const keys = active ? stopKeysForSchool(active) : null
  const dim = (el, faded) => {
    if (el) el.style.opacity = faded ? String(BUS_DIM_OPACITY) : ''
  }
  for (const [key, marker] of busMarkerIndex) {
    dim(marker.getElement(), !!active && !keys.has(key))
  }
  for (const [name, marker] of busSchoolMarkerIndex) {
    const faded = !!active && name !== active
    dim(marker.getElement(), faded)
    dim(marker.getTooltip()?.getElement(), faded)
  }
}

function busSchoolPopup(f) {
  const p = f.properties
  const url = lookupUrl(f)
  const parts = [`<strong>${p.schoolName}</strong>`]
  if (p.address) parts.push(p.address)
  if (p.telephone) parts.push(p.telephone)
  if (p.Category) parts.push(p.Category)
  if (url) parts.push(`<a href="${url}" target="_blank" rel="noopener">Website</a>`)
  return parts.join('<br/>')
}

watch(allSchools, updateBusSchoolMarkers, { flush: 'post' })

watch([activeTab, selectedLocation, selectedBusSchool, busStops, excludedSchoolNames, busRadius, lockedSchoolName], () => {
  drawBusRadiusCircle()
  updateHomeMarker()
  updateBusStopsLayer()
  updateBusSchoolMarkers()
  fitMapToContent()
}, { flush: 'post' })

watch(isMobile, () => {
  nextTick(() => mapRef.value?.leafletObject?.invalidateSize())
})

async function loadBusStops() {
  if (busStops.value.length) return
  busLoading.value = true
  try {
    const res = await fetch('/api/bus-stops')
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    busStops.value = await res.json()
  } catch (err) {
    console.error('Bus stops load error:', err)
    alert('Could not load bus stop data: ' + (err?.message || 'unknown'))
  } finally {
    busLoading.value = false
  }
}

// Bus data can reference schools that are now closed or phasing out; drop those
// entries (and any stop left with no entries) so both tabs stay consistent.
const activeBusStops = computed(() => {
  const excluded = excludedSchoolNames.value
  if (!excluded.size) return busStops.value
  const result = []
  for (const stop of busStops.value) {
    const entries = stop.entries.filter((e) => !excluded.has(e.schoolName))
    if (entries.length) result.push({ ...stop, entries })
  }
  return result
})

const busSchoolOptions = computed(() => {
  const map = new Map()
  for (const stop of activeBusStops.value) {
    for (const e of stop.entries) {
      map.set(e.school, e.schoolName || e.school)
    }
  }
  return Array.from(map, ([raw, name]) => ({ raw, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const busStopsWithDistance = computed(() => {
  if (!activeBusStops.value.length) return []
  let stops = activeBusStops.value
    .filter((s) => s.lat !== null && s.lng !== null)
    .map((s) => ({ ...s, distance: null }))
  if (selectedBusSchool.value) {
    stops = stops.filter((s) => s.entries.some((e) => e.schoolName === selectedBusSchool.value || e.school === selectedBusSchool.value))
  }
  if (selectedLocation.value) {
    const [lat, lng] = selectedLocation.value
    stops = stops.map((s) => {
      const dist = distance([lng, lat], [s.lng, s.lat], { units: 'miles' })
      return { ...s, distance: dist }
    })
  }
  return stops
})

const nearbyBusStops = computed(() => {
  let stops = busStopsWithDistance.value
  if (selectedLocation.value) {
    stops = stops.filter((s) => s.distance <= busRadius.value)
      .sort((a, b) => a.distance - b.distance)
  }
  return stops
})

// The map shows every stop in the default state, but listing all ~1,750 of them
// is not useful, so the sidebar stays empty until a location or school narrows it.
const busStopResults = computed(() => {
  if (!selectedLocation.value && !selectedBusSchool.value) return []
  return nearbyBusStops.value
})

// Summary shown in the mobile bottom sheet header.
const sheetTitle = computed(() => {
  if (selectedBusSchool.value) return selectedBusSchool.value
  if (selectedLocation.value) return 'Nearby Bus Stops'
  return 'Tap the map or pick a school to list stops'
})

const hasActiveFilter = computed(() =>
  !!selectedLocation.value || !!selectedBusSchool.value || !!lockedSchoolName.value
)

function busStopKey(s) {
  return `${s.stop}|${s.lat}|${s.lng}`
}

function updateBusStopsLayer() {
  const map = mapRef.value?.leafletObject
  if (!map) return
  if (mapZooming) {
    busStopsLayerDirty = true
    return
  }
  busStopsLayerDirty = false
  if (!busStopsLayer) {
    busStopsLayer = L.layerGroup().addTo(map)
  }
  // Markers are created once and never removed; visibility is toggled via CSS
  // so Leaflet always keeps their positions in sync with the map.
  for (const s of activeBusStops.value) {
    if (s.lat === null || s.lng === null) continue
    const key = busStopKey(s)
    if (busMarkerIndex.has(key)) continue
    const marker = L.marker([s.lat, s.lng], { icon: busIcon })
      // autoPan off so opening a popup never fights an in-flight flyTo.
      .bindPopup(busStopPopup(s), { autoPan: false })
      .on('click', () => {
        const active = highlightedSchool()
        if (active && !s.entries.some((e) => e.schoolName === active)) clearBusHighlight()
      })
    busMarkerIndex.set(key, marker)
    busStopsLayer.addLayer(marker)
  }

  setHoveredBusMarker(null)
  const visible = new Map()
  if (activeTab.value === 'bus-stops') {
    for (const s of nearbyBusStops.value) visible.set(busStopKey(s), s)
  }
  // A stop that dropped out of the results can no longer be the selected one.
  if (selectedBusStopKey.value && !visible.has(selectedBusStopKey.value)) {
    selectedBusStopKey.value = null
  }
  for (const [key, marker] of busMarkerIndex) {
    const el = marker.getElement()
    if (!el) continue
    const stop = visible.get(key)
    if (stop) {
      el.style.display = ''
      marker.setPopupContent(busStopPopup(stop))
    } else {
      el.style.display = 'none'
    }
  }
}

function setHoveredBusMarker(key) {
  if (hoveredBusKey === key) return
  // setIcon() builds a fresh DOM element, so inline styles must be re-applied.
  const swapIcon = (marker, icon, zIndex) => {
    const display = marker.getElement()?.style.display ?? ''
    marker.setIcon(icon)
    marker.setZIndexOffset(zIndex)
    const el = marker.getElement()
    if (el) el.style.display = display
  }
  const prev = hoveredBusKey ? busMarkerIndex.get(hoveredBusKey) : null
  if (prev) swapIcon(prev, busIcon, 0)
  hoveredBusKey = key
  const next = key ? busMarkerIndex.get(key) : null
  if (next) swapIcon(next, busIconHover, 1000)
  // The swap also drops any dimming, so re-apply the highlight styles.
  if (prev || next) applyBusHighlight()
}

function setBusSchool(school) {
  selectedBusSchool.value = school
}

// Clear every active filter and return to the default city-wide view.
function reset() {
  selectedLocation.value = null
  address.value = ''
  selectedBusSchool.value = ''
  lockedSchoolName.value = null
  hoveredSchoolName = null
  selectedBusStopKey.value = null
  activeListTooltip.value?.close()
  activeListTooltip.value = null
  const query = { ...route.query }
  delete query.school
  router.replace({ query })
  fitToDefaultView()
}

function onBusStopEnter(s) {
  if (isMobile.value) return
  if (leaveTimer.value) {
    clearTimeout(leaveTimer.value)
    leaveTimer.value = null
  }
  const map = mapRef.value?.leafletObject
  if (!map) return
  setHoveredBusMarker(busStopKey(s))
  activeListTooltip.value?.close()
  activeListTooltip.value = null
  // Adding a tooltip layer mid-animation strands it in the viewport.
  if (mapZooming) return
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
  if (isMobile.value) return
  if (leaveTimer.value) clearTimeout(leaveTimer.value)
  leaveTimer.value = setTimeout(() => {
    setHoveredBusMarker(null)
    if (activeListTooltip.value) {
      activeListTooltip.value.close()
      activeListTooltip.value = null
    }
    leaveTimer.value = null
  }, 50)
}

// When a school filter is active, only that school's entries are relevant.
function visibleEntries(s) {
  if (!selectedBusSchool.value) return s.entries
  const filtered = s.entries.filter((e) => e.school === selectedBusSchool.value || e.schoolName === selectedBusSchool.value)
  return filtered.length ? filtered : s.entries
}

function busStopName(s) {
  return s.description ? `${s.stop} (${s.description})` : s.stop
}

function busStopTooltip(s) {
  const parts = [`<strong>${busStopName(s)}</strong>`]
  if (s.distance !== null && s.distance !== undefined) {
    parts.push(`${s.distance.toFixed(2)} miles`)
  }
  for (const e of visibleEntries(s)) {
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
  const parts = [`<strong>${busStopName(s)}</strong>`]
  if (s.distance !== null && s.distance !== undefined) {
    parts.push(`${s.distance.toFixed(2)} miles`)
  }
  for (const e of visibleEntries(s)) {
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
          src="/logo-header.png"
          alt="Detroit Public Schools Community District"
        />
      </a>
      <h1 class="brand-title">DPSCD Bus Stop Locator</h1>
    </header>

    <div class="content" :class="{ mobile: isMobile }">
      <aside v-if="!isMobile" class="panel">
        <p class="muted">Find bus stops near you.</p>
        <div class="bus-stops">
          <BusStopControls
            v-model:address="address"
            v-model:selected-school="selectedBusSchool"
            v-model:radius="busRadius"
            :loading="loading"
            :school-options="busSchoolOptions"
            :selected-location="selectedLocation"
            :show-geolocate="false"
            @search="searchAddress"
          />

          <p v-if="!selectedLocation" class="hint">All bus stops are shown. Click the map or search an address to filter by radius.</p>

          <BusStopResults
            :stops="busStopResults"
            :selected-key="selectedBusStopKey"
            :visible-entries="visibleEntries"
            :bus-stop-key="busStopKey"
            :selected-school="selectedBusSchool"
            :selected-location="selectedLocation"
            @select="goToBusStop"
            @hover-enter="onBusStopEnter"
            @hover-leave="onBusStopLeave"
            @select-school="setBusSchool"
          />
        </div>
      </aside>

      <main class="map-wrap">
        <button
          v-if="hasActiveFilter"
          class="reset-view"
          type="button"
          @click="reset"
        >
          Reset
        </button>

        <button
          v-if="lockedSchoolName"
          class="cancel-highlight"
          type="button"
          @click="clearBusHighlight()"
        >
          Click to Cancel Highlighting Stops for {{ lockedSchoolShortName }}
        </button>

        <l-map
          ref="mapRef"
          :zoom="zoom"
          :center="center"
          style="height: 100%; width: 100%"
          @click="onMapClick"
          @ready="onMapReady"
        >
          <l-tile-layer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution="&copy; OpenStreetMap contributors, &copy; CARTO"
          />

          <l-geo-json
            v-if="detroitBoundary"
            :geojson="detroitBoundary"
            :options-style="detroitBoundaryStyle"
          />

        </l-map>

        <MobileShell
          v-if="isMobile"
          ref="mobileShellRef"
          v-model:address="address"
          v-model:selected-school="selectedBusSchool"
          v-model:radius="busRadius"
          v-model:filters-open="filtersOpen"
          :title="sheetTitle"
          :loading="loading"
          :school-options="busSchoolOptions"
          :selected-location="selectedLocation"
          :empty="!busStopResults.length"
          :can-reset="hasActiveFilter"
          :locked-school-name="lockedSchoolName"
          :locked-school-short-name="lockedSchoolShortName"
          @search="searchAddress"
          @geolocate="geolocate"
          @reset="reset"
          @clear-highlight="clearBusHighlight"
        >
          <BusStopResults
            :stops="busStopResults"
            :selected-key="selectedBusStopKey"
            :visible-entries="visibleEntries"
            :bus-stop-key="busStopKey"
            :selected-school="selectedBusSchool"
            :selected-location="selectedLocation"
            :is-mobile="true"
            @select="goToBusStop"
            @hover-enter="onBusStopEnter"
            @hover-leave="onBusStopLeave"
            @select-school="setBusSchool"
          />
        </MobileShell>

        <div class="legend" :class="{ collapsed: !legendOpen }">
          <button
            class="legend-toggle"
            type="button"
            :aria-expanded="legendOpen"
            aria-controls="legend-items"
            @click="legendOpen = !legendOpen"
          >
            <span class="legend-title">School Types</span>
            <span class="legend-caret" aria-hidden="true">{{ legendOpen ? '▾' : '▸' }}</span>
          </button>
          <ul v-show="legendOpen" id="legend-items">
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
  height: 100dvh;
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

input[type="range"] {
  padding: 0;
  accent-color: var(--dpscd-primary);
  cursor: pointer;
}

input[type="range"]:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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

.closest-row.stop-selected {
  background: #eaf0ff;
  border-left: 4px solid var(--dpscd-primary);
  padding-left: 0.5rem;
}

.closest-row.stop-selected strong {
  color: var(--dpscd-primary);
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

/* Matches the Leaflet zoom control (.leaflet-bar): square 4px corners,
   solid white, same drop shadow and touch border. */
.legend {
  position: absolute;
  left: 10px;
  bottom: 10px;
  max-width: calc(100% - 20px);
  background: #fff;
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  z-index: 1000;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.65);
  pointer-events: none;
}

.leaflet-touch .legend {
  border: 2px solid rgba(0, 0, 0, 0.2);
  background-clip: padding-box;
}

.legend.collapsed {
  padding: 0.35rem 0.6rem;
}

.legend-toggle,
.legend li {
  pointer-events: auto;
}

.legend-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  margin: 0 0 0.25rem;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 0.85rem;
  font-family: 'Lora', serif;
  color: var(--dpscd-primary);
}

.legend.collapsed .legend-toggle {
  margin: 0;
}

.legend-title {
  font-weight: 700;
}

.legend-caret {
  font-size: 0.7rem;
  line-height: 1;
}

.legend ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(140px, 1fr));
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

.school-label {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--dpscd-primary);
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--dpscd-primary);
  box-shadow: none;
  white-space: nowrap;
}

.school-label::before {
  display: none;
}

.school-hover-popup .leaflet-popup-content {
  font-size: 0.85rem;
  margin: 0.6rem 0.75rem;
}

.school-hover-popup a {
  color: var(--dpscd-primary);
  font-weight: 500;
}

.reset-view {
  position: absolute;
  top: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: var(--dpscd-secondary);
  color: var(--dpscd-text);
  border: 1px solid var(--dpscd-primary);
  border-radius: 4px;
  padding: 0.5rem 0.9rem;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}

.reset-view:hover,
.reset-view:focus {
  background: #fff;
  color: var(--dpscd-primary);
}

.cancel-highlight {
  position: absolute;
  top: 3.25rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  background: var(--dpscd-secondary);
  color: var(--dpscd-text);
  border: 1px solid var(--dpscd-primary);
  border-radius: 4px;
  padding: 0.5rem 0.9rem;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}

.cancel-highlight:hover,
.cancel-highlight:focus {
  background: #fff;
  color: var(--dpscd-primary);
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

@media (max-width: 1023px) {
  .brand-header {
    display: none;
  }

  .content.mobile {
    display: block;
    position: relative;
    height: 100dvh;
  }

  .content.mobile .panel {
    display: none;
  }

  .content.mobile .map-wrap {
    position: absolute;
    inset: 0;
    z-index: 0;
  }

  .content.mobile .reset-view {
    top: 6.5rem;
    z-index: 1001;
  }

  .content.mobile .legend,
  .content.mobile .reset-view,
  .content.mobile .cancel-highlight {
    display: none;
  }
}
</style>