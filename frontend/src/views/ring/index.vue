<template>
  <section class="page" data-module="ring">
    <header class="page-head">
      <div>
        <h2>掘进环次管理</h2>
        <p class="page-desc">维护掘进环，围绕环号、起始里程、掘进速度、总推力做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记掘进环</button>
        <button class="btn" type="button" @click="exportRows">导出掘进环次清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="card-block">
      <h3>掘进在办清单（在场盾构机，取自设备档案）</h3>
      <p v-if="shieldError" class="error-text">
        在场盾构机读取失败：{{ shieldError }}，未展示旧数据，<button class="link" type="button" @click="reloadShields">重试</button>
      </p>
      <table v-else class="data-table compact">
        <thead>
          <tr>
            <th>盾构机编号</th>
            <th>盾构机型号</th>
            <th>开挖直径</th>
            <th>维保单位</th>
            <th>设备状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in activeShields" :key="String(item.id)">
            <td>{{ item['盾构机编号'] }}</td>
            <td>{{ item['盾构机型号'] }}</td>
            <td>{{ item['开挖直径'] || '—' }}</td>
            <td>{{ item['维保单位'] || '—' }}</td>
            <td>{{ item.status }}</td>
          </tr>
          <tr v-if="!activeShields.length">
            <td colspan="5" class="empty-state">设备档案里当前没有掘进中的在场盾构机</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5" class="muted small">
              在办 {{ activeShields.length }} 台 · 在场 {{ kpi.onSite }} 台，与盾构机在场看板同源同数。
            </td>
          </tr>
        </tfoot>
      </table>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

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
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无掘进环次数据，可先登记掘进环</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条掘进环次记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useShieldData } from '@/composables/useShieldData'
import { activeBoringShields, shieldKpi } from '@/data/shield'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('ring')
const columns = ["环号", "起始里程", "掘进速度", "总推力", "刀盘扭矩", "出土方量", "掘进班组", "环次状态"]
const actions = ["开始掘进", "确认完成", "申请纠偏"]
const statuses = ["待掘进", "掘进中", "已贯通", "已纠偏"]
const stats = [{"label": "本月掘进环数", "value": 0}, {"label": "平均掘进速度", "value": 0}, {"label": "纠偏环数", "value": 0}]

// 在办清单：直接从设备档案派生，盾构机状态一改，订阅推送过来即更新，不存在两个数。
const { rows: shieldRows, errorMessage: shieldError, reload: reloadShields } = useShieldData()
const activeShields = computed(() => activeBoringShields(shieldRows.value))
const kpi = computed(() => shieldKpi(shieldRows.value))

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '掘进环登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '掘进环次列表读取失败'
  }
}

onMounted(reload)
</script>
