<template>
  <section class="page" data-module="shield-board">
    <header class="page-head">
      <div>
        <h2>盾构机在场看板</h2>
        <p class="page-desc">
          按设备状态分列，停机时间长的排在前面，检修中收在右端；台数与详情以设备档案为准。
        </p>
      </div>
      <div class="page-actions">
        <span class="role-badge" :class="{ readonly: !isAdmin }">
          当前角色：{{ store.role }}{{ isAdmin ? '' : '（只读）' }}
        </span>
        <button class="btn" type="button" @click="reload">刷新看板</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">在场盾构机</span>
        <strong class="stat-value">{{ board.presence.在场 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">还在路上（待进场）</span>
        <strong class="stat-value">{{ board.presence.在路上 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">掘进中</span>
        <strong class="stat-value">{{ board.presence.掘进中 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检修中</span>
        <strong class="stat-value">{{ board.presence.检修中 }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span class="legend-item unit-summary-title">维保单位台数概览</span>
      <span v-for="unit in board.unitSummary" :key="unit.维保单位" class="legend-item">
        {{ unit.维保单位 }}：{{ unit.台数 }} 台
      </span>
    </p>

    <div class="board-row">
      <section v-for="column in board.columns" :key="column.status" class="board-column">
        <header class="board-column-head">{{ column.status }} · {{ column.machines.length }} 台</header>
        <article
          v-for="machine in column.machines"
          :key="machine.id"
          class="machine-card"
          :class="{ active: detail?.id === machine.id }"
          @click="openDetail(machine.id)"
        >
          <strong class="machine-code">{{ machine.盾构机编号 }}</strong>
          <dl class="machine-fields">
            <div><dt>型号</dt><dd>{{ machine.盾构机型号 }}</dd></div>
            <div><dt>开挖直径</dt><dd>{{ machine.开挖直径 }}</dd></div>
            <div><dt>维保单位</dt><dd>{{ machine.维保单位 }}</dd></div>
          </dl>
          <span class="stop-badge">{{ stopLabel(machine) }}</span>
        </article>
        <p v-if="!column.machines.length" class="empty-state">暂无</p>
      </section>

      <aside class="board-column maintenance-column" :class="{ collapsed: !maintenanceOpen }">
        <header class="board-column-head clickable" @click="maintenanceOpen = !maintenanceOpen">
          检修中 · {{ board.maintenance.length }} 台（{{ maintenanceOpen ? '收起' : '展开' }}）
        </header>
        <template v-if="maintenanceOpen">
          <article
            v-for="machine in board.maintenance"
            :key="machine.id"
            class="machine-card maintenance"
            :class="{ active: detail?.id === machine.id }"
            @click="openDetail(machine.id)"
          >
            <strong class="machine-code">{{ machine.盾构机编号 }}</strong>
            <dl class="machine-fields">
              <div><dt>型号</dt><dd>{{ machine.盾构机型号 }}</dd></div>
              <div><dt>开挖直径</dt><dd>{{ machine.开挖直径 }}</dd></div>
              <div><dt>维保单位</dt><dd>{{ machine.维保单位 }}</dd></div>
            </dl>
            <span class="stop-badge">{{ stopLabel(machine) }}</span>
          </article>
          <p v-if="!board.maintenance.length" class="empty-state">暂无</p>
        </template>
      </aside>
    </div>

    <div v-if="detail" class="drawer-mask" @click.self="closeDetail">
      <aside class="drawer">
        <header class="drawer-head">
          <h3>{{ detail.盾构机编号 }} · 设备档案详情</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <p class="drawer-note">详情直接读设备档案；与看板数字对不上时以档案为准。</p>
        <dl class="detail-fields">
          <div><dt>盾构机编号</dt><dd>{{ detail.盾构机编号 }}</dd></div>
          <div><dt>当前状态</dt><dd>{{ detail.状态 }}（{{ stopLabel(detail) }}）</dd></div>
          <div><dt>进场日期</dt><dd>{{ detail.进场日期 }}</dd></div>
          <div>
            <dt>盾构机型号</dt>
            <dd>
              <input v-if="isAdmin" v-model="editForm.盾构机型号" />
              <template v-else>{{ detail.盾构机型号 }}</template>
            </dd>
          </div>
          <div>
            <dt>开挖直径</dt>
            <dd>
              <input v-if="isAdmin" v-model="editForm.开挖直径" />
              <template v-else>{{ detail.开挖直径 }}</template>
            </dd>
          </div>
          <div>
            <dt>刀盘形式</dt>
            <dd>
              <input v-if="isAdmin" v-model="editForm.刀盘形式" />
              <template v-else>{{ detail.刀盘形式 }}</template>
            </dd>
          </div>
          <div>
            <dt>维保单位</dt>
            <dd>
              <input v-if="isAdmin" v-model="editForm.维保单位" />
              <template v-else>{{ detail.维保单位 }}</template>
            </dd>
          </div>
          <div>
            <dt>备注</dt>
            <dd>
              <input v-if="isAdmin" v-model="editForm.备注" />
              <template v-else>{{ detail.备注 || '—' }}</template>
            </dd>
          </div>
        </dl>
        <div v-if="isAdmin" class="drawer-actions">
          <button class="btn primary" type="button" :disabled="mutating" @click="submitEdit">
            保存档案修改
          </button>
          <button
            v-for="item in detailActions"
            :key="item.action"
            class="btn"
            type="button"
            :disabled="mutating"
            @click="submitStatus(item.action)"
          >
            {{ item.action }}
          </button>
        </div>
        <p v-else class="drawer-note">项目账号只能查看；刀盘形式与维保单位仅设备管理员可改。</p>
      </aside>
    </div>

    <footer class="page-foot">
      <span>共 {{ board.presence.总数 }} 台 · 档案修订号 {{ board.revision }}</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import {
  availableActions,
  changeMachineStatus,
  loadBoard,
  loadMachineDetail,
  onArchiveChange,
  stopDays,
  updateMachine,
  type MutationResult,
  type ShieldBoard,
} from '@/api/shield-board-service'
import type { ShieldMachine } from '@/data/shield-archive'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const isAdmin = computed(() => store.isDeviceAdmin)

const emptyBoard: ShieldBoard = {
  columns: [],
  maintenance: [],
  unitSummary: [],
  presence: { 总数: 0, 在场: 0, 在路上: 0, 掘进中: 0, 调试中: 0, 检修中: 0, 已退场: 0, 待进场: 0, 在场编号: [] },
  revision: 0,
}

const board = ref<ShieldBoard>(emptyBoard)
const detail = ref<ShieldMachine | null>(null)
const maintenanceOpen = ref(false)
const message = ref('')
const messageOk = ref(true)
const mutating = ref(false)

const editForm = reactive({
  盾构机型号: '',
  开挖直径: '',
  刀盘形式: '',
  维保单位: '',
  备注: '',
})

const detailActions = computed(() => (detail.value ? availableActions(detail.value.状态) : []))

function stopLabel(machine: ShieldMachine): string {
  const days = stopDays(machine)
  if (machine.状态 === '掘进中') {
    return `本轮掘进已 ${days} 天`
  }
  if (machine.状态 === '已退场') {
    return `退场 ${days} 天`
  }
  return `停置 ${days} 天`
}

function reload() {
  board.value = loadBoard()
}

function openDetail(id: number) {
  // 详情一律回档案重取，保证和看板同源、以档案为准。
  const found = loadMachineDetail(id)
  if (!found) {
    messageOk.value = false
    message.value = '设备档案里取不到这台机器，请刷新看板重试'
    return
  }
  detail.value = found
  editForm.盾构机型号 = found.盾构机型号
  editForm.开挖直径 = found.开挖直径
  editForm.刀盘形式 = found.刀盘形式
  editForm.维保单位 = found.维保单位
  editForm.备注 = found.备注
}

function closeDetail() {
  detail.value = null
}

function newOpId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `op-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 一笔提交的入口：连着点两回仍按头一回，提交完回档案核对一遍再刷新。 */
function runMutation(mutate: (opId: string) => MutationResult) {
  if (mutating.value) {
    return
  }
  mutating.value = true
  try {
    const result = mutate(newOpId())
    messageOk.value = result.ok
    message.value = result.message
    reload()
    if (detail.value) {
      const fresh = loadMachineDetail(detail.value.id)
      if (fresh) {
        detail.value = fresh
      } else {
        closeDetail()
      }
    }
  } finally {
    mutating.value = false
  }
}

function submitEdit() {
  if (!detail.value) {
    return
  }
  const id = detail.value.id
  runMutation((opId) =>
    updateMachine(
      id,
      {
        盾构机型号: editForm.盾构机型号,
        开挖直径: editForm.开挖直径,
        刀盘形式: editForm.刀盘形式,
        维保单位: editForm.维保单位,
        备注: editForm.备注,
      },
      opId,
      store.role,
    ),
  )
}

function submitStatus(action: string) {
  if (!detail.value) {
    return
  }
  const id = detail.value.id
  runMutation((opId) => changeMachineStatus(id, action, opId, store.role))
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
  reload()
  // 别处改了档案（比如其他页面提交），看板跟着刷新，两处取的是同一份。
  unsubscribe = onArchiveChange(reload)
})

onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>
