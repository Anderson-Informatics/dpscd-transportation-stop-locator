<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  lock: { type: Boolean, default: false }
})

const snap = ref('peek')
const sheetEl = ref(null)
const dragging = ref(false)
let startY = 0
let startTop = 0
let currentTop = 0
let raf = null

const CONTROL_H = 110
const PEEK_H = 96

const viewportH = ref(0)

function updateMetrics() {
  viewportH.value = window.innerHeight
}

const tops = computed(() => ({
  peek: viewportH.value - PEEK_H,
  half: Math.round(viewportH.value * 0.5),
  full: CONTROL_H
}))

const targetTop = computed(() => tops.value[snap.value])
const sheetTransform = computed(() => `translateY(${targetTop.value}px)`)

function snapTo(point) {
  if (props.lock && point !== 'peek') return
  snap.value = point
}

function startDrag(clientY) {
  dragging.value = true
  startY = clientY
  startTop = targetTop.value
  currentTop = startTop
}

function onPointerDown(e) {
  if (props.lock) return
  if (snap.value === 'full' && !e.target.closest('.bottom-sheet-handle')) return
  startDrag(e.clientY)
  ;(e.target).setPointerCapture?.(e.pointerId)
}

function onPointerMove(e) {
  if (!dragging.value) return
  e.preventDefault()
  currentTop = startTop + (e.clientY - startY)
  if (raf) cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    if (sheetEl.value) sheetEl.value.style.transform = `translateY(${currentTop}px)`
  })
}

let lastY = 0
let lastT = 0

function onPointerUp(e) {
  if (!dragging.value) return
  dragging.value = false
  const now = performance.now()
  const velocity = (e.clientY - lastY) / Math.max(now - lastT, 1)
  lastY = e.clientY
  lastT = now

  const order = ['peek', 'half', 'full']
  const currentIndex = order.indexOf(snap.value)
  const nearest = Object.entries(tops.value)
    .sort(([, a], [, b]) => Math.abs(currentTop - a) - Math.abs(currentTop - b))[0][0]

  let next = nearest
  if (Math.abs(velocity) > 0.5) {
    if (velocity < 0 && currentIndex < order.length - 1) {
      next = order[currentIndex + 1]
    } else if (velocity > 0 && currentIndex > 0) {
      next = order[currentIndex - 1]
    }
  }
  if (props.lock && next !== 'peek') next = 'peek'
  snap.value = next
  if (sheetEl.value) sheetEl.value.style.transform = ''
}

onMounted(() => {
  updateMetrics()
  window.addEventListener('resize', updateMetrics)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateMetrics)
})

defineExpose({ snapTo })
</script>

<template>
  <div
    ref="sheetEl"
    class="bottom-sheet"
    :class="[snap, { dragging }]"
    :style="{ transform: sheetTransform }"
    @pointerup="onPointerUp"
  >
    <div
      class="bottom-sheet-handle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
    >
      <div class="bottom-sheet-grab" />
      <div class="bottom-sheet-title">{{ title }}</div>
    </div>
    <div class="bottom-sheet-content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.bottom-sheet {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  height: 100dvh;
  background: #fff;
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  transition: transform 0.25s cubic-bezier(0.25, 1, 0.5, 1);
}

.bottom-sheet.dragging {
  transition: none;
}

.bottom-sheet-handle {
  flex-shrink: 0;
  padding: 0.5rem 1rem calc(0.5rem + env(safe-area-inset-bottom, 0px));
  border-bottom: 1px solid #e5e5e5;
  touch-action: none;
}

.bottom-sheet-grab {
  width: 40px;
  height: 5px;
  background: #c3c5cc;
  border-radius: 3px;
  margin: 0 auto 0.5rem;
}

.bottom-sheet-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--dpscd-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bottom-sheet-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 1rem 1rem;
}
</style>
