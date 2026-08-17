---
agent: devin-local
session: secretive-minibus
created: 2026-08-17T07:47:54Z
---
# Mobile & Tablet Support (Google-Maps-style) + PWA

Add a phone/tablet-portrait layout (compact top controls, full-bleed map, draggable bottom-sheet results) and PWA packaging to the **DPSCD Bus Stop Locator**, without altering any desktop behavior.

## Confirmed decisions

| Decision | Choice |
|---|---|
| Scope | Responsive + PWA |
| Code structure | Hybrid — extract presentational list/control components; leave all Leaflet + state in `index.vue` |
| Tab model | Bus-stop only (Schools tab removed) |
| Breakpoint | `< 1024px` gets mobile layout (phones + tablet portrait); iPad landscape keeps sidebar |
| Bottom sheet | Custom, no dependency |
| Touch model | Tap = select (no hover emulation) |
| Geolocation | "Use my location" button, mobile only |
| Offline | Precache shell + icons; `/data/**` StaleWhileRevalidate; tiles bounded CacheFirst |
| Legend | Already collapsible (user change) — mobile only needs height capping + sheet clearance |
| Mobile header | Hidden below 1024px; that ~48px goes to the map |
| Icon source | `public/DPSCD_Logo_White_NoTag.png` |

## Recent user changes already in the file

Accounted for in this plan:
- The Schools tab has been removed; the app now defaults to and only shows bus stops. `?tab=` is stripped on load, while `?school=` is still honored.
- The legend is now a collapsible control (`legendOpen`, `.legend.collapsed`) anchored bottom-left, styled to match `.leaflet-bar`, closed by default. My original "mobile legend chip" phase is largely done — no `MapLegend.vue` extraction needed.
- `busStopResults` gates the bus list on a location/school filter, so the default state shows all stops on the map but an empty list. The mobile sheet must therefore have a real empty/prompt state, not just a count.
- Additional animation hardening: `mapZooming` guard around the `marker.update()` safety net, display-preserving `setIcon` swap, and a `mapZooming` bail-out in `onBusStopEnter`. These reinforce the decision to leave the Leaflet code in place.

## Why hybrid structure

`pages/index.vue` holds ~600 lines of imperative Leaflet layer management whose correctness depends on `mapZooming` guards, `busStopsLayerDirty`/`busSchoolLayerDirty` deferred rebuilds, `marker.update()` safety nets, and `{ flush: 'post' }` watcher ordering. Moving that into a composable changes reactivity timing and is the most likely way to silently reintroduce the marker-stranding bugs already fixed. It stays put.

The results lists and search/filter controls are pure presentation and are exactly what mobile must reuse; duplicating them would drift. Those get extracted.

---

## Phase 1 — Foundation

### 1.1 `composables/useIsMobile.ts` (new)
```
matchMedia('(max-width: 1023px)') -> reactive isMobile, listener added onMounted, removed onUnmounted
```
`ssr: false` in `nuxt.config.ts`, so no hydration-mismatch risk. Export a shared singleton so all consumers agree.

### 1.2 Viewport / safe area — `nuxt.config.ts`
- viewport meta -> `width=device-width, initial-scale=1, viewport-fit=cover` (keep pinch-zoom enabled for a11y).
- Add `theme-color` = `#0033CC`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`.

### 1.3 Viewport-height fix — `pages/index.vue` CSS
`.app { height: 100vh }` collapses under mobile browser toolbars. Change to `height: 100vh; height: 100dvh;` — a no-op on desktop.

---

## Phase 2 — Component extraction (shared by both layouts)

New files under `components/`, props-in / emits-out only, **zero Leaflet imports**:

- `BusStopResults.vue` — nearby/all bus stops list incl. `stop-entries` markup. Props: `stops`, `selectedKey`, `visibleEntries`, `busStopKey`, `isMobile`. Emits: `select`, `hover-enter`, `hover-leave`, `select-school`.
- `BusStopControls.vue` — address form, radius slider, school select. Props: `v-model` bindings (`address`, `selectedBusSchool`, `busRadiusSlider`), `loading`, `schoolOptions`, `showGeolocate`. Emits: `search`, `geolocate`.

The legend is **not** extracted: it lives inside `.map-wrap` alongside the single shared `<l-map>`, so both layouts get it for free.

`index.vue` desktop `<aside class="panel">` is rewritten to compose these components. **This is the highest-regression-risk step** — the emitted markup/classes must be byte-identical so the existing CSS applies unchanged. Verify by diffing rendered DOM before/after.

Hover emits are simply not wired up in the mobile layout, so no `isMobile` branching is needed inside `BusStopResults` beyond suppressing `cursor`/hover CSS.

---

## Phase 3 — Mobile shell

### 3.1 `components/MobileShell.vue` (new)
Layout (top to bottom):
1. **No brand header** — `.brand-header` is `display: none` below 1024px; that space goes to the map. Branding lives in the PWA icon, splash screen, and `<title>`. The header markup is untouched, only hidden by a media query.
2. **Control bar** — search input + GPS button; filter chips ("School ▾", "Radius ▾") that open a small bottom-anchored popover containing the corresponding `BusStopControls` field. Floats over the map with a card shadow, top-anchored, respecting `env(safe-area-inset-top)`.
3. **Map** — fills the full viewport behind the control bar (the same single `<l-map>` instance from `index.vue`, teleported/slotted in; the map is *never* unmounted or duplicated).
4. **Bottom sheet** — overlays the map.

`index.vue` renders `<MobileShell v-if="isMobile">` / desktop markup `<template v-else>`, with the `<l-map>` passed through a slot so exactly one Leaflet instance exists in both cases. If slotting proves awkward with `@vue-leaflet/vue-leaflet` refs, fall back to keeping `<l-map>` in `index.vue` and using CSS Grid area swaps driven by a `mobile` class on `.app` — decided at implementation time, preferring whichever keeps `mapRef` stable.

### 3.2 `components/BottomSheet.vue` (new)
- Snap points: `peek` (~96px: grab handle + summary line), `half` (50vh), `full` (calc(100dvh - header - controlbar)).
- Drag: Pointer Events on the handle **and** the sheet header. `touch-action: none` on the drag zone only. Velocity-based snap (>0.5 px/ms flick advances one snap; otherwise nearest snap).
- Content scrolls only at `full`; drag-down from `full` when `scrollTop === 0` transitions to dragging the sheet.
- `transform: translateY()` + `will-change`, `transition` applied only when not actively dragging.
- Respects `env(safe-area-inset-bottom)`.
- Exposes `snapTo(point)` via `defineExpose` so `index.vue` can collapse it on selection.
- Sheet is a sibling of the map container, so map gestures are unaffected; no `L.DomEvent` plumbing needed.

### 3.3 Legend (mostly done)
The collapsible control you just added works as-is on mobile. Mobile-only CSS additions:
- Lift `bottom` above the peek sheet + `env(safe-area-inset-bottom)`; move with the sheet, or simply hide the legend when the sheet is above `peek`.
- Cap the expanded list at `max-height: 45dvh; overflow-y: auto` — 10 items in a single column will otherwise overrun a phone screen.
- Enlarge `.legend-toggle` hit area to 44×44 minimum.

### 3.4 Sheet content and empty states
The sheet header shows a one-line summary that doubles as the drag handle:
- Bus, no filter → "Tap the map or pick a school to list stops" (matches the new `busStopResults` gating — all stops still render on the map)
- Bus, filtered by school → "{school}"
- Bus, filtered by location → "Nearby Bus Stops"

When the list is empty the sheet is locked to `peek` so users can't drag open a blank panel.

---

## Phase 4 — Touch interaction model (`pages/index.vue`)

### 4.1 Neutralize hover paths on mobile
Add an early `if (isMobile.value) return` guard **inside** each handler rather than at the call site, so desktop code paths are untouched:
- `onBusStopEnter` / `onBusStopLeave`
- Bus-school marker `mouseover` / `mouseout` callbacks

The Schools-related hover handlers (`onClosestEnter` / `onClosestLeave`, `onNeighborhoodEnter` / `onNeighborhoodLeave`) are no longer reachable because the Schools list was removed; they can either be guarded or deleted during cleanup.

This prevents emulated touch-hover events from stranding `activeListTooltip` / `activeBoundaryTooltip` layers.

### 4.2 Tap-to-select
- **Bus stops:** `goToBusStop` already flies + opens the popup. Add: on mobile, `sheet.snapTo('peek')` first, then fly with sheet-aware offset.
- **School icons:** the existing `click` handler toggles `lockedSchoolName` and closes the popup. On mobile, open the popup *and* toggle the lock (hover preview no longer exists, so the card must come from the tap).

### 4.3 Sheet-aware map framing — new helper `flyToOnMobile(latLng, zoom)`
The peek sheet covers the lower ~96px and the control bar the upper ~110px. `map.flyTo` takes no padding, so:
1. compute `map.project(latLng, zoom)`,
2. shift Y by `(controlBarH - peekH) / 2`,
3. `map.flyTo(map.unproject(shiftedPoint, zoom), zoom)`.

Also thread mobile padding into the existing fit calls, guarded by `isMobile` so the desktop `padding: [40, 40]` literals are unchanged:
- `fitToDefaultView`
- `fitMapToContent`

### 4.4 Geolocation
Add `geolocate()` in `index.vue`: `navigator.geolocation.getCurrentPosition` -> `selectedLocation.value = [lat, lng]`, `address.value = ''`. Handle denial/timeout with an inline message (not `alert`). Button rendered only in `MobileShell`.

### 4.5 Layout-change invalidation
`watch(isMobile, () => nextTick(() => map.invalidateSize()))` — the map container size genuinely changes when crossing the breakpoint (rotation, desktop window resize).

### 4.6 Permanent school labels
The `permanent: true` short-name tooltips (line ~735) will crowd a phone screen. Tune on mobile only: hide labels below zoom 14 via a `zoomend` handler that toggles their `display`, reusing the existing element-toggling pattern in `updateBusSchoolMarkers`.

---

## Phase 5 — PWA

### 5.1 Module
`npm add -D @vite-pwa/nuxt@1.1.1` (published 2026-02-06, well-aged). Register in `nuxt.config.ts`.

### 5.2 Config
```
registerType: 'autoUpdate'
manifest: name 'DPSCD Bus Stop Locator', short_name 'Bus Stops',
          display 'standalone', theme_color '#0033CC', background_color '#ffffff',
          start_url '/', orientation 'any', icons 192/512 + 512 maskable
workbox:
  globPatterns: ['**/*.{js,css,html,svg,ico,woff2}']
  globIgnores:  ['**/data/**']            // never precache mutable data
  navigateFallbackDenylist: [/^\/api\//]
  runtimeCaching:
    - /\/data\/.*\.(json|geojson)$/        StaleWhileRevalidate, cache 'app-data'
    - basemaps.cartocdn.com                CacheFirst, 'map-tiles', maxEntries 400, 30d
    - fonts.googleapis.com / gstatic.com   CacheFirst, 1y
    - /^\/api\//                           NetworkOnly
devOptions: { enabled: false }
```
**Rationale for excluding `/data/**` from precache:** `bus-stops.json` and `school-name-map.json` are rewritten at runtime by `/api/build-bus-stops`. A build-time precache manifest would pin users to a stale snapshot permanently. StaleWhileRevalidate gives instant loads *and* picks up admin updates on the next visit.

### 5.3 Icons
Source: `public/DPSCD_Logo_White_NoTag.png` (1800×1351 RGBA, white-on-transparent) — well suited to a maskable icon composited on `#0033CC`.

Generate with ImageMagick (build-time one-off, results committed):
- `icon-192.png`, `icon-512.png` — logo contained on a `#0033CC` square, ~15% padding
- `icon-512-maskable.png` — same, ~25% padding so the logo survives Android's circular safe zone
- `apple-touch-icon.png` (180×180) — opaque background (iOS ignores transparency)
- `favicon.ico` (32/16)

**Header logo swap — approved.** The desktop header currently loads the logo from a remote `resources.finalsite.net` URL, which a service worker can't precache (broken offline, extra third-party request). `<img class="brand-logo" src>` in `pages/index.vue` (~line 1097) points at a local asset instead.

`.brand-logo` renders at 40px tall, so shipping the raw 1800×1351 / 55KB file is wasteful. Emit a display-sized `public/logo-header.png` (~2x, 107px tall, ~8KB) for the header and keep the full-resolution PNG as the icon-generation source. Visually identical to today.

**This is the only intentional desktop-visible change in the plan.**

### 5.4 Update prompt
With `autoUpdate`, add a small non-blocking "New version available — Reload" toast using `useRegisterSW`, so an admin's bus-stop rebuild + redeploy reaches open sessions.

---

## Files

**New**
- `public/logo-header.png` (display-sized header logo)
- `composables/useIsMobile.ts`
- `components/MobileShell.vue`
- `components/BottomSheet.vue`
- `components/BusStopControls.vue`
- `components/BusStopResults.vue`
- `public/icon-*.png`, `apple-touch-icon.png`

**Modified**
- `nuxt.config.ts` — PWA module + config, viewport/meta
- `pages/index.vue` — local header logo; compose extracted components; remove `activeTab` dead code; mobile branch; hover guards; tap-to-select; sheet-aware fly/fit; geolocate; `invalidateSize`; mobile CSS block
- `package.json` / lockfile — `@vite-pwa/nuxt`

**Untouched**
- `pages/update-bus-stops.vue`, all of `server/`, all data files

---

## Verification

No test infrastructure exists in this repo, so verification is build + manual.

- [ ] `npm run build` succeeds; `npm run preview` serves
- [ ] **Desktop regression pass** (1440px) — address search, map-click location, radius slider, school select, list-row hover tooltips, school-icon hover card + dim/highlight, click-to-lock + cancel banner, `?school=` deep link, marker positions correct after rapid school switching and slider drags (the previously-fixed animation bugs)
- [ ] Take before/after screenshots of the desktop sidebar to confirm the component extraction is pixel-identical
- [ ] **Mobile pass** at 390×844, 414×896, 768×1024 portrait, 1024×768 landscape (sidebar expected): sheet drag between all three snaps, flick velocity, scroll-vs-drag at full snap, tap result -> collapse + centered above sheet + popup visible, filter chips, GPS button, legend chip, safe-area insets on notched profiles
- [ ] Empty states: no filter shows all map markers + a prompt in the sheet, and the sheet stays locked at peek
- [ ] Legend expands without overflowing a 390×844 screen and clears the peek sheet
- [ ] Rotate device mid-session -> layout swaps and map re-fits without stranded markers
- [ ] **PWA:** Lighthouse PWA audit; install to home screen; DevTools > Application shows SW active, `data/` files served from `app-data` cache, `bus-stops.json` **not** in the precache manifest; offline reload works after one online visit; edit `bus-stops.json` on disk -> change appears within two loads
- [ ] `git diff` review that no desktop-only CSS rule was modified outside a `@media (max-width: 1023px)` block

## Risks / considerations

- **Component extraction is the main regression vector.** Mitigation: mechanical move of markup with zero restructuring, screenshot diff, and it can be committed separately from the mobile work so it's bisectable.
- **Sheet drag vs. map pan** — sheet is outside the map container, so no conflict; but `touch-action` must be scoped to the drag handle or in-sheet scrolling breaks on iOS.
- **`flyTo` offset math** must use the *destination* zoom in `project`/`unproject`, or the centering will be wrong at large zoom deltas.
- **Leaflet + service worker:** tile CacheFirst with an unbounded cache can consume hundreds of MB; the 400-entry / 30-day LRU is deliberate, and bulk tile scraping would violate CARTO's ToS (we only cache what the user actually viewed).
- **Marker density on phones:** ~1,750 bus stop markers plus ~110 school markers on a 390px screen. Current code already toggles visibility rather than removing layers, so perf should hold, but if the "All Bus Stops" view (no location filter) janks on a real phone, we may need to gate it behind a minimum zoom on mobile. Flagging as a possible follow-up rather than pre-solving it.
- **`ssr: false`** means no SEO/first-paint regression from any of this, but also means the PWA offline shell is a client-rendered blank until JS loads — acceptable here.

## Open items

None — all decisions confirmed.
