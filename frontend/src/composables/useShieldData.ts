import { onMounted, onUnmounted, readonly, ref } from 'vue'

import { loadRows, subscribe } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 全平台只有这一份盾构机快照：看板、台账、环次在办清单、运营概览都从这里派生，
// 谁也不许自己再数一遍，因此任何页面读到的台数都不可能对不上。
const rows = ref<EntryRow[]>([])
const loading = ref(false)
const loaded = ref(false)
const stale = ref(false)
const errorMessage = ref('')
const loadedAt = ref<Date | null>(null)

let inflight: Promise<void> | null = null

async function fetchOnce(): Promise<void> {
  // 已经有一版在飞就复用，不发第二趟；连着点两回刷新也按头一趟回来。
  if (inflight) {
    return inflight
  }
  loading.value = true
  inflight = loadRows('shield')
    .then((fresh) => {
      rows.value = fresh
      loaded.value = true
      stale.value = false
      errorMessage.value = ''
      loadedAt.value = new Date()
    })
    .catch((error: unknown) => {
      // 取不到数据不拿上一版顶替：标出错误；如果已有历史快照，会明确标注是旧快照。
      errorMessage.value = error instanceof Error ? error.message : '盾构机数据读取失败'
      stale.value = loaded.value
      loaded.value = !stale.value ? false : loaded.value
    })
    .finally(() => {
      loading.value = false
      inflight = null
    })
  return inflight
}

export function useShieldData() {
  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    if (!loaded.value) {
      void fetchOnce()
    }
    // 任一处落库（含其他标签页）都重新取数，台数跟着一起变。
    unsubscribe = subscribe(() => {
      void fetchOnce()
    })
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  return {
    rows: readonly(rows),
    loading: readonly(loading),
    loaded: readonly(loaded),
    stale: readonly(stale),
    errorMessage: readonly(errorMessage),
    loadedAt: readonly(loadedAt),
    reload: fetchOnce,
  }
}
