<template>
  <section class="page board-page">
    <header class="page-head">
      <div>
        <h2>盾构机在场看板</h2>
        <p class="page-desc">
          在场 {{ kpi.onSite }} 台 · 路上（待进场）{{ kpi.pending }} 台 · 已退场 {{ kpi.exited }} 台；
          台数全部取自设备档案，和台账、环次在办清单是同一份。
        </p>
      </div>
      <div class="page-actions">
        <span class="role-chip">{{ roleName }} · 权限：{{ permissionHint }}</span>
        <button class="btn" type="button" :disabled="loading" @click="reload">
          {{ loading ? '读取中…' : '重新读取' }}
        </button>
      </div>
    </header>

    <p v-if="errorMessage" class="board-banner error">
      取不到设备数据：{{ errorMessage }}
      <template v-if="stale">下面展示的是上一版成功读到的旧快照，数字以设备档案为准。</template>
      <button class="link" type="button" @click="reload">重试</button>
    </p>

    <section class="unit-overview card-block">
      <h3>按维保单位汇总（在场口径：调试中 / 掘进中 / 检修中）</h3>
      <table class="data-table compact">
        <thead>
          <tr>
            <th>维保单位</th>
            <th v-for="column in summaryColumns" :key="column">{{ column }}</th>
            <th>合计</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in unitRows" :key="item.unit">
            <td>{{ item.unit }}</td>
            <td>{{ item.pending }}</td>
            <td>{{ item.onSite - item.boring - item.repair }}</td>
            <td class="strong">{{ item.boring }}</td>
            <td>{{ item.exited }}</td>
            <td>{{ item.repair }}</td>
            <td>{{ item.total }}</td>
          </tr>
          <tr v-if="!unitRows.length">
            <td :colspan="summaryColumns.length + 2" class="empty-state">设备档案为空</td>
          </tr>
        </tbody>
      </table>
    </section>

    <div class="board-columns" :class="{ 'repair-open': repairOpen }">
      <section v-for="column in boardColumns" :key="column" class="board-column" :class="`col-${column}`">
        <header class="column-head" @click="column === '检修中' && (repairOpen = !repairOpen)">
          <span class="column-title">{{ column }}</span>
          <span class="column-count">{{ groups[column]?.length ?? 0 }}</span>
          <button
            v-if="column === '检修中'"
            class="link collapse-toggle"
            type="button"
            @click.stop="repairOpen = !repairOpen"
          >
            {{ repairOpen ? '收起' : '展开' }}
          </button>
        </header>
        <div v-show="column !== '检修中' || repairOpen" class="column-body">
          <button
            v-for="row in groups[column] ?? []"
            :key="String(row.id)"
            class="machine-card"
            type="button"
            @click="openDetail(row)"
          >
            <span class="machine-no">{{ row['盾构机编号'] }}</span>
            <span class="machine-model">{{ row['盾构机型号'] }}</span>
            <span class="machine-line">开挖直径：{{ row['开挖直径'] || '—' }}</span>
            <span class="machine-line">维保单位：{{ row['维保单位'] || '—' }}</span>
            <span class="machine-foot">
              <span v-if="column !== '掘进中'">停机 {{ dayText(row) }}</span>
              <span v-else>正在掘进</span>
            </span>
          </button>
          <p v-if="!(groups[column]?.length)" class="empty-state small">暂无设备</p>
        </div>
      </section>
    </div>

    <ShieldDetailDrawer v-if="selectedId !== null" :id="selectedId" @close="selectedId = null" @changed="onChanged" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useShieldData } from '@/composables/useShieldData'
import ShieldDetailDrawer from './ShieldDetailDrawer.vue'
import {
  SHIELD_COLUMNS,
  normalizeStatus,
  overviewByUnit,
  shieldKpi,
  sortByStoppage,
  stoppageDays,
  type ShieldStatus,
} from '@/data/shield'
import { useSessionStore, ROLES } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const session = useSessionStore()
const { rows, loading, errorMessage, stale, reload } = useShieldData()

const summaryColumns = ['待进场', '调试中', '掘进中', '已退场', '检修中']
const boardColumns = SHIELD_COLUMNS
const repairOpen = ref(false)
const selectedId = ref<number | null>(null)

const roleName = computed(() => ROLES.find((item) => item.key === session.role)?.name ?? '')
const permissionHint = computed(() => {
  if (session.canEditArchive) {
    return '可改档案 / 状态'
  }
  return session.canChangeStatus ? '可改状态，档案只读' : '只读'
})

const kpi = computed(() => shieldKpi(rows.value))
const unitRows = computed(() => overviewByUnit(rows.value))

const groups = computed<Record<ShieldStatus, EntryRow[]>>(() => {
  const buckets = Object.fromEntries(SHIELD_COLUMNS.map((column) => [column, [] as EntryRow[]])) as Record<
    ShieldStatus,
    EntryRow[]
  >
  for (const row of rows.value) {
    buckets[normalizeStatus(row.status)].push(row)
  }
  for (const column of SHIELD_COLUMNS) {
    buckets[column] = sortByStoppage(buckets[column])
  }
  return buckets
})

function dayText(row: EntryRow): string {
  const days = stoppageDays(row)
  if (days <= 0) {
    return '不足 1 天'
  }
  return `${days} 天`
}

function openDetail(row: EntryRow) {
  selectedId.value = Number(row.id)
}

function onChanged() {
  // 状态一改，整份快照重读：环次在办清单与其他页面订阅同一份，自动跟着变。
  void reload()
}
</script>
