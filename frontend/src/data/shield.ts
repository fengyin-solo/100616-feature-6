import type { EntryRow } from './types'

// 看板栏目顺序：检修中整栏收在右端。
export const SHIELD_COLUMNS = ['待进场', '调试中', '掘进中', '已退场', '检修中'] as const
export type ShieldStatus = (typeof SHIELD_COLUMNS)[number]

// 状态流转图：只允许图上的边，页面不自己判断能点哪个。
export const SHIELD_TRANSITIONS: Record<string, { action: string; target: ShieldStatus }[]> = {
  待进场: [{ action: '办理进场', target: '调试中' }],
  调试中: [
    { action: '开始调试', target: '掘进中' },
    { action: '安排检修', target: '检修中' },
    { action: '办理退场', target: '已退场' },
  ],
  掘进中: [
    { action: '安排检修', target: '检修中' },
    { action: '办理退场', target: '已退场' },
  ],
  检修中: [
    { action: '检修完成', target: '掘进中' },
    { action: '办理退场', target: '已退场' },
  ],
  已退场: [],
}

// 已退场兼容老设备：未知/空状态一律归到已退场，绝不在看板上凭空多一台。
const KNOWN_STATUSES = new Set<string>(SHIELD_COLUMNS)

export function normalizeStatus(value: unknown): ShieldStatus {
  const text = String(value ?? '').trim()
  return KNOWN_STATUSES.has(text) ? (text as ShieldStatus) : '已退场'
}

// 在场口径：调试、掘进、检修三类算在场；待进场还没到，已退场已经走。
// 全应用（看板、台账、环次在办清单、运营概览）都用这一个函数，不允许再各算各的。
export function isOnSite(status: unknown): boolean {
  const text = normalizeStatus(status)
  return text === '调试中' || text === '掘进中' || text === '检修中'
}

export function fieldText(row: EntryRow, field: string): string {
  const value = row[field]
  return value === undefined || value === null ? '' : String(value).trim()
}

// 停机开始：进入非掘进状态的那天。存量数据缺这一列时用进场日期兜底，再不行按最早处理。
export function stoppageStart(row: EntryRow): string {
  if (normalizeStatus(row.status) === '掘进中') {
    return ''
  }
  const recorded = fieldText(row, '停机开始')
  if (recorded) {
    return recorded
  }
  const enter = fieldText(row, '进场日期')
  return enter || '2025-01-01'
}

function dayStart(value: string): number {
  if (!value) {
    return Number.POSITIVE_INFINITY
  }
  const [year, month, day] = value.split('-').map((part) => Number(part))
  const time = new Date(year || 1970, (month || 1) - 1, day || 1).getTime()
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY
}

// 停机天数：掘进中算 0；日期缺失/非法也不抛错，按 0 处理并放到同档末尾。
export function stoppageDays(row: EntryRow, today: Date = new Date()): number {
  if (normalizeStatus(row.status) === '掘进中') {
    return 0
  }
  const start = stoppageStart(row)
  const from = dayStart(start)
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (!Number.isFinite(from) || from > now) {
    return 0
  }
  return Math.round((now - from) / 86400000)
}

// 栏内排序：停机久的靠前；停机天数相同时（含掘进中）按进场早的靠前兜底。
export type ShieldRow = Readonly<EntryRow>

export function sortByStoppage(rows: readonly ShieldRow[], today: Date = new Date()): EntryRow[] {
  return [...rows].sort((a, b) => {
    const diff = stoppageDays(b, today) - stoppageDays(a, today)
    if (diff !== 0) {
      return diff
    }
    const aEnter = dayStart(fieldText(a, '进场日期'))
    const bEnter = dayStart(fieldText(b, '进场日期'))
    if (aEnter !== bEnter) {
      return aEnter - bEnter
    }
    return fieldText(a, '盾构机编号').localeCompare(fieldText(b, '盾构机编号'))
  })
}

export type ShieldKpi = {
  onSite: number
  boring: number
  repair: number
  pending: number
  exited: number
}

// 所有台数只从设备档案（shield 表）派生——这就是「同一份」。
export function shieldKpi(rows: readonly ShieldRow[]): ShieldKpi {
  const kpi: ShieldKpi = { onSite: 0, boring: 0, repair: 0, pending: 0, exited: 0 }
  for (const row of rows) {
    const status = normalizeStatus(row.status)
    if (status === '掘进中') {
      kpi.boring += 1
    } else if (status === '检修中') {
      kpi.repair += 1
    } else if (status === '待进场') {
      kpi.pending += 1
    } else if (status === '已退场') {
      kpi.exited += 1
    }
    if (isOnSite(status)) {
      kpi.onSite += 1
    }
  }
  return kpi
}

export type UnitOverview = {
  unit: string
  onSite: number
  boring: number
  repair: number
  pending: number
  exited: number
  total: number
}

// 各栏上方那份按维保单位汇总的台数概览。
export function overviewByUnit(rows: readonly ShieldRow[]): UnitOverview[] {
  const map = new Map<string, UnitOverview>()
  for (const row of rows) {
    const unit = fieldText(row, '维保单位') || '未指定单位'
    const status = normalizeStatus(row.status)
    let item = map.get(unit)
    if (!item) {
      item = { unit, onSite: 0, boring: 0, repair: 0, pending: 0, exited: 0, total: 0 }
      map.set(unit, item)
    }
    item.total += 1
    if (isOnSite(status)) {
      item.onSite += 1
    }
    if (status === '掘进中') {
      item.boring += 1
    } else if (status === '检修中') {
      item.repair += 1
    } else if (status === '待进场') {
      item.pending += 1
    } else if (status === '已退场') {
      item.exited += 1
    }
  }
  return [...map.values()].sort((a, b) => b.onSite - a.onSite || b.total - a.total || a.unit.localeCompare(b.unit))
}

// 环次页「在办清单」读到的在场掘进盾构机：直接来自设备档案，数量不可能和看板是两个数。
export function activeBoringShields(rows: readonly ShieldRow[]): EntryRow[] {
  return sortByStoppage(rows.filter((row) => normalizeStatus(row.status) === '掘进中'))
}
