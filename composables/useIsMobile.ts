import { ref, onMounted, onUnmounted } from 'vue'

const isMobile = ref(false)
let mql: MediaQueryList | null = null

function onChange(e: MediaQueryListEvent) {
  isMobile.value = e.matches
}

export function useIsMobile() {
  onMounted(() => {
    if (typeof window === 'undefined' || mql) return
    mql = window.matchMedia('(max-width: 1023px)')
    isMobile.value = mql.matches
    mql.addEventListener('change', onChange)
  })

  // The listener is shared (singleton), so we do not remove it on unmount;
  // that keeps all consumers seeing the same breakpoint state.

  return { isMobile }
}
