<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <section class="card-block">
      <h3>盾构机在场台数（与在场看板同源）</h3>
      <p v-if="shieldError" class="error-text">
        设备档案读取失败：{{ shieldError }}，未用旧数顶替，<button class="link" type="button" @click="reloadShields">重试</button>
      </p>
      <div v-else class="stat-row">
        <article v-for="item in shieldCards" :key="item.label" class="stat-card">
          <span class="stat-label">{{ item.label }}</span>
          <strong class="stat-value">{{ item.value }}</strong>
        </article>
      </div>
    </section>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { useShieldData } from '@/composables/useShieldData'
import { shieldKpi } from '@/data/shield'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])

const { rows: shieldRows, errorMessage: shieldError, reload: reloadShields } = useShieldData()
const shieldCards = computed(() => {
  const kpi = shieldKpi(shieldRows.value)
  return [
    { label: '在场盾构机', value: kpi.onSite },
    { label: '掘进中盾构机', value: kpi.boring },
    { label: '检修中盾构机', value: kpi.repair },
    { label: '待进场（在路上）', value: kpi.pending },
    { label: '已退场', value: kpi.exited },
  ]
})

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  void reloadShields()
}

onMounted(refresh)
</script>
