<template>
  <div class="drawer-mask" @click.self="emit('close')">
    <aside class="drawer-panel">
      <header class="drawer-head">
        <div>
          <h3>{{ current?.['盾构机编号'] ?? '盾构机详情' }}</h3>
          <p class="page-desc">详情以设备档案为准；档案与看板对不上时，这里展示的就是最新档案。</p>
        </div>
        <button class="btn ghost" type="button" @click="emit('close')">关闭</button>
      </header>

      <p v-if="!current" class="empty-state">设备档案里取不到这台机器，可能已被删除。</p>
      <template v-else>
        <div class="drawer-status">
          <span class="status-tag" :class="`tag-${current.status}`">{{ current.status }}</span>
          <span v-if="current.status !== '掘进中'" class="muted">
            已停机 {{ days(current) }} 天（自 {{ stoppageStart(current) }}）
          </span>
          <span v-else class="muted">正在掘进</span>
        </div>

        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ current[field] === undefined || current[field] === '' ? '—' : current[field] }}</dd>
          </template>
        </dl>

        <section class="drawer-block">
          <h4>状态流转</h4>
          <p v-if="!session.canChangeStatus" class="muted">当前账号（{{ roleName }}）只能查看，不能改状态。</p>
          <div v-else class="action-row">
            <button
              v-for="edge in actions"
              :key="edge.action"
              class="btn"
              :disabled="busy"
              type="button"
              @click="changeStatus(edge.action)"
            >
              {{ edge.action }} → {{ edge.target }}
            </button>
          </div>
        </section>

        <section class="drawer-block">
          <h4>设备档案</h4>
          <p v-if="!session.canEditArchive" class="muted">
            刀盘形式与维保单位只有设备管理员可修改，当前账号（{{ roleName }}）为只读。
          </p>
          <form v-else class="archive-form" @submit.prevent="saveArchive">
            <label v-for="field in editableFields" :key="field" class="filter-item">
              <span>{{ field }}</span>
              <input v-model="form[field]" :placeholder="`请输入${field}`" />
            </label>
            <button class="btn primary" type="submit" :disabled="busy">保存档案</button>
          </form>
        </section>

        <footer class="drawer-foot">
          <span v-if="message" :class="resultOk ? 'ok-text' : 'error-text'">{{ message }}</span>
          <span class="muted">档案版本号 {{ Number(current.rev ?? 0) }}</span>
        </footer>
      </template>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import { useShieldData } from '@/composables/useShieldData'
import {
  actionsForStatus,
  changeShieldStatus,
  updateShieldArchive,
} from '@/api/shield-service'
import { fieldText, stoppageDays, stoppageStart } from '@/data/shield'
import { ROLES, useSessionStore } from '@/stores/session'

const props = defineProps<{ id: number }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const session = useSessionStore()
const { rows } = useShieldData()

const detailFields = [
  '盾构机编号',
  '盾构机型号',
  '开挖直径',
  '刀盘形式',
  '总推力',
  '进场日期',
  '维保单位',
  '停机开始',
]
const editableFields = ['刀盘形式', '维保单位'] as const

const current = computed(() => rows.value.find((row) => Number(row.id) === props.id) ?? null)
const actions = computed(() => (current.value ? actionsForStatus(current.value.status) : []))
const roleName = computed(() => ROLES.find((item) => item.key === session.role)?.name ?? '')

const form = reactive<Record<string, string>>({ 刀盘形式: '', 维保单位: '' })
const busy = ref(false)
const message = ref('')
const resultOk = ref(false)

watch(
  current,
  (row) => {
    if (row) {
      form['刀盘形式'] = fieldText(row, '刀盘形式')
      form['维保单位'] = fieldText(row, '维保单位')
      message.value = ''
    }
  },
  { immediate: true },
)

function days(row: typeof current.value): number {
  return row ? stoppageDays(row) : 0
}

function changeStatus(action: string) {
  if (!current.value || busy.value) {
    return
  }
  busy.value = true
  // 连着点两回按头一回：版本号在提交后就变，第二回要么被幂等接住，要么被冲突挡住。
  const expectedRev = Number(current.value.rev ?? 0)
  const result = changeShieldStatus(Number(current.value.id), action, session.role, expectedRev)
  busy.value = false
  resultOk.value = result.ok
  message.value = result.message
  if (result.ok) {
    emit('changed')
  }
}

function saveArchive() {
  if (!current.value || busy.value) {
    return
  }
  busy.value = true
  const expectedRev = Number(current.value.rev ?? 0)
  const result = updateShieldArchive(
    Number(current.value.id),
    { 刀盘形式: form['刀盘形式'], 维保单位: form['维保单位'] },
    session.role,
    expectedRev,
  )
  busy.value = false
  resultOk.value = result.ok
  message.value = result.message
  if (result.ok) {
    emit('changed')
  } else if (result.conflicts?.length && current.value) {
    // 冲突以设备档案为准：表单立刻回填档案最新值，不用旧版顶着。
    for (const conflict of result.conflicts) {
      form[conflict.field] = String(conflict.current)
    }
  }
}
</script>
