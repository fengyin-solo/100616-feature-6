<template>
  <section class="page" data-module="shield">
    <header class="page-head">
      <div>
        <h2>盾构机台账管理</h2>
        <p class="page-desc">
          设备档案是全平台唯一权威来源：这里的台数与在场看板、环次在办清单取的是同一份。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn primary" to="/board">打开在场看板</RouterLink>
        <button class="btn" type="button" @click="exportRows">导出盾构机台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" class="data-row">
          <td v-for="column in columns" :key="column" @click="openDetail(row)">
            {{ row[column] === undefined || row[column] === '' ? '—' : row[column] }}
          </td>
          <td @click="openDetail(row)">{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="session.canChangeStatus">
              <button
                v-for="edge in availableActions(row.status)"
                :key="edge.action"
                class="link"
                type="button"
                @click="runAction(edge.action, row)"
              >
                {{ edge.action }}
              </button>
            </template>
            <span v-else class="muted">只读</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无盾构机台账数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条盾构机台账记录</span>
      <span v-if="actionMessage" :class="actionOk ? 'ok-text' : 'error-text'">{{ actionMessage }}</span>
    </footer>

    <ShieldDetailDrawer v-if="selectedId !== null" :id="selectedId" @close="selectedId = null" @changed="reload" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { downloadEntries, filterRows, moduleMeta } from '@/api/local-service'
import { actionsForStatus, changeShieldStatus } from '@/api/shield-service'
import { useShieldData } from '@/composables/useShieldData'
import { SHIELD_COLUMNS, shieldKpi } from '@/data/shield'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'
import ShieldDetailDrawer from '@/views/board/ShieldDetailDrawer.vue'

const meta = moduleMeta('shield')
const columns = ['盾构机编号', '盾构机型号', '开挖直径', '刀盘形式', '总推力', '进场日期', '维保单位', '停机开始', '设备状态']
const filterFields = columns.slice(0, 3)

const session = useSessionStore()
const { rows: snapshot, errorMessage, reload: reloadSnapshot } = useShieldData()

const filters = ref<Record<string, string>>({})
const selectedId = ref<number | null>(null)
const actionMessage = ref('')
const actionOk = ref(false)

const rows = computed(() => filterRows(snapshot.value, filters.value))
const total = computed(() => rows.value.length)

const stats = computed(() => {
  const kpi = shieldKpi(snapshot.value)
  return [
    { label: '在场盾构机', value: kpi.onSite },
    { label: '掘进中盾构机', value: kpi.boring },
    { label: '检修中盾构机', value: kpi.repair },
  ]
})

const statusSummary = computed(() =>
  SHIELD_COLUMNS.map((status) => ({
    status,
    count: snapshot.value.filter((row) => String(row.status) === status).length,
  })),
)

function availableActions(status: unknown) {
  return actionsForStatus(status)
}

function resetFilters() {
  filters.value = {}
}

function exportRows() {
  downloadEntries(meta.key)
}

function openDetail(row: EntryRow) {
  selectedId.value = Number(row.id)
}

function runAction(action: string, row: EntryRow) {
  const result = changeShieldStatus(Number(row.id), action, session.role, Number(row.rev ?? 0))
  actionOk.value = result.ok
  actionMessage.value = result.message
  if (result.ok) {
    // 提交后回列表核对：快照重读设备档案，不拿上一版顶。
    void reloadSnapshot()
  }
}

function reload() {
  void reloadSnapshot()
}
</script>
