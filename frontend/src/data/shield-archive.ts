import { listRows } from './local-store'

// 设备档案：盾构机编号、型号、开挖直径、刀盘形式、维保单位的唯一权威来源。
// 在场看板、详情视图、掘进环次与运营概览里的台数都从这份档案取；
// 看板/详情与档案对不上时，一律以档案为准。

export type ShieldStatus = '待进场' | '调试中' | '掘进中' | '检修中' | '已退场'

export const SHIELD_STATUSES: ShieldStatus[] = ['待进场', '调试中', '掘进中', '检修中', '已退场']

export type ShieldMachine = {
  id: number
  盾构机编号: string
  盾构机型号: string
  开挖直径: string
  刀盘形式: string
  维保单位: string
  进场日期: string
  状态: ShieldStatus
  /** 进入当前状态的时间，停机/持续时长从这里算 */
  状态起始时间: string
  备注: string
  /** 档案记录版本，每次落库 +1，用于发现冲突 */
  档案版本: number
  更新时间: string
}

export type AppliedOp = {
  at: string
  result: { ok: boolean; message: string }
}

export type ShieldArchiveEnvelope = {
  schema: number
  /** 整卷修订号：每次成功落库 +1，提交后核对其是否被别处的写入顶掉 */
  revision: number
  /** 存量是否已按进场日期重排过（只重排一遍） */
  sortedByArrival: boolean
  records: ShieldMachine[]
  /** 已办过的提交单号：同一单号重复提交直接回头一次的结果 */
  appliedOps: Record<string, AppliedOp>
}

const STORAGE_KEY = 'shield-tunnel-construction:shield-archive'
const SCHEMA = 2

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowText(): string {
  return new Date().toISOString()
}

/** 老设备缺字段时补默认值，已退场的老机器也能进看板。 */
export function migrateRecord(raw: Partial<ShieldMachine> & { id: number }): ShieldMachine {
  const status = SHIELD_STATUSES.includes(raw.状态 as ShieldStatus) ? (raw.状态 as ShieldStatus) : '待进场'
  const arrival = typeof raw.进场日期 === 'string' && raw.进场日期 ? raw.进场日期 : '1970-01-01'
  return {
    id: raw.id,
    盾构机编号: raw.盾构机编号 || `SHIE-LEGACY-${raw.id}`,
    盾构机型号: raw.盾构机型号 || '未登记型号',
    开挖直径: raw.开挖直径 || '—',
    刀盘形式: raw.刀盘形式 || '未登记',
    维保单位: raw.维保单位 || '未登记维保单位',
    进场日期: arrival,
    状态: status,
    状态起始时间: raw.状态起始时间 || `${arrival}T08:00:00.000Z`,
    备注: raw.备注 || '',
    档案版本: typeof raw.档案版本 === 'number' ? raw.档案版本 : 1,
    更新时间: raw.更新时间 || nowText(),
  }
}

/** 存量按进场日期重排：日期早的在前，同日期按编号。 */
export function sortByArrival(records: ShieldMachine[]): ShieldMachine[] {
  return [...records].sort((a, b) => a.进场日期.localeCompare(b.进场日期) || a.id - b.id)
}

const SEED_ARCHIVE: ShieldMachine[] = [
  { id: 101, 盾构机编号: 'TBM-101', 盾构机型号: '中铁装备 CTE6440', 开挖直径: '6.44m', 刀盘形式: '复合式', 维保单位: '中铁工程装备集团', 进场日期: '2026-03-12', 状态: '掘进中', 状态起始时间: '2026-09-30T08:00:00.000Z', 备注: '', 档案版本: 1, 更新时间: '2026-09-30T08:00:00.000Z' },
  { id: 102, 盾构机编号: 'TBM-102', 盾构机型号: '海瑞克 S-885', 开挖直径: '6.28m', 刀盘形式: '土压平衡', 维保单位: '中铁工程装备集团', 进场日期: '2026-04-02', 状态: '掘进中', 状态起始时间: '2026-10-02T08:00:00.000Z', 备注: '', 档案版本: 1, 更新时间: '2026-10-02T08:00:00.000Z' },
  { id: 103, 盾构机编号: 'TBM-103', 盾构机型号: '中交天和 Φ6480', 开挖直径: '6.48m', 刀盘形式: '泥水平衡', 维保单位: '中交天和维保部', 进场日期: '2026-05-18', 状态: '调试中', 状态起始时间: '2026-09-20T08:00:00.000Z', 备注: '', 档案版本: 1, 更新时间: '2026-09-20T08:00:00.000Z' },
  { id: 104, 盾构机编号: 'TBM-104', 盾构机型号: '铁建重工 ZTE6250', 开挖直径: '6.25m', 刀盘形式: '复合式', 维保单位: '铁建重工售后中心', 进场日期: '2026-06-25', 状态: '检修中', 状态起始时间: '2026-08-11T08:00:00.000Z', 备注: '主驱动密封更换', 档案版本: 1, 更新时间: '2026-08-11T08:00:00.000Z' },
  { id: 105, 盾构机编号: 'TBM-105', 盾构机型号: '小松 TM634', 开挖直径: '6.34m', 刀盘形式: '土压平衡', 维保单位: '中铁工程装备集团', 进场日期: '2026-10-12', 状态: '待进场', 状态起始时间: '2026-09-28T08:00:00.000Z', 备注: '计划 10 月中旬进场', 档案版本: 1, 更新时间: '2026-09-28T08:00:00.000Z' },
  { id: 106, 盾构机编号: 'TBM-106', 盾构机型号: '铁建重工 ZTE6410', 开挖直径: '6.41m', 刀盘形式: '复合式', 维保单位: '铁建重工售后中心', 进场日期: '2026-11-01', 状态: '待进场', 状态起始时间: '2026-10-03T08:00:00.000Z', 备注: '计划 11 月初进场', 档案版本: 1, 更新时间: '2026-10-03T08:00:00.000Z' },
  // 已退场的老设备：档案字段不全，靠 migrateRecord 补默认，验证兼容。
  { id: 107, 盾构机编号: 'TBM-107', 盾构机型号: '', 开挖直径: '', 刀盘形式: '', 维保单位: '', 进场日期: '2024-05-10', 状态: '已退场', 状态起始时间: '2025-12-20T08:00:00.000Z', 备注: '老设备，档案待补录', 档案版本: 1, 更新时间: '2025-12-20T08:00:00.000Z' },
  { id: 108, 盾构机编号: 'TBM-108', 盾构机型号: '罗宾斯 MB264', 开挖直径: '6.20m', 刀盘形式: '', 维保单位: '', 进场日期: '2025-01-15', 状态: '已退场', 状态起始时间: '2026-02-10T08:00:00.000Z', 备注: '老设备，档案待补录', 档案版本: 1, 更新时间: '2026-02-10T08:00:00.000Z' },
  { id: 109, 盾构机编号: 'TBM-109', 盾构机型号: '中交天和 Φ6280', 开挖直径: '6.28m', 刀盘形式: '土压平衡', 维保单位: '中交天和维保部', 进场日期: '2026-08-19', 状态: '调试中', 状态起始时间: '2026-10-01T08:00:00.000Z', 备注: '', 档案版本: 1, 更新时间: '2026-10-01T08:00:00.000Z' },
  { id: 110, 盾构机编号: 'TBM-110', 盾构机型号: '中铁装备 CTE6830', 开挖直径: '6.83m', 刀盘形式: '泥水平衡', 维保单位: '中铁工程装备集团', 进场日期: '2026-09-06', 状态: '掘进中', 状态起始时间: '2026-10-04T08:00:00.000Z', 备注: '', 档案版本: 1, 更新时间: '2026-10-04T08:00:00.000Z' },
]

/** 老台账里「样例」之类的占位值不往档案里带。 */
function normalizeLegacyText(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim()
  if (!text || text.includes('样例')) {
    return fallback
  }
  return text
}

/** 把旧台账（local-store 里的 shield 行）中档案没有的机器并进来，老设备不丢。 */
function importLegacyLedger(records: ShieldMachine[]): ShieldMachine[] {
  const known = new Set(records.map((item) => item.盾构机编号))
  const merged = [...records]
  let nextId = merged.reduce((max, item) => Math.max(max, item.id), 0) + 1
  for (const row of listRows('shield')) {
    const code = String(row['盾构机编号'] ?? '').trim()
    if (!code || known.has(code)) {
      continue
    }
    known.add(code)
    merged.push(
      migrateRecord({
        id: nextId++,
        盾构机编号: code,
        盾构机型号: normalizeLegacyText(row['盾构机型号'], '未登记型号'),
        开挖直径: normalizeLegacyText(row['开挖直径'], '—'),
        刀盘形式: normalizeLegacyText(row['刀盘形式'], '未登记'),
        维保单位: normalizeLegacyText(row['维保单位'], '未登记维保单位'),
        进场日期: normalizeLegacyText(row['进场日期'], '1970-01-01'),
        状态: row.status as ShieldStatus,
        备注: '从旧台账迁入',
      }),
    )
  }
  return merged
}

function buildInitialEnvelope(): ShieldArchiveEnvelope {
  const records = sortByArrival(importLegacyLedger(clone(SEED_ARCHIVE)).map(migrateRecord))
  return { schema: SCHEMA, revision: 1, sortedByArrival: true, records, appliedOps: {} }
}

function migrateEnvelope(raw: Partial<ShieldArchiveEnvelope>): ShieldArchiveEnvelope {
  const records = Array.isArray(raw.records) ? raw.records.map((item) => migrateRecord(item)) : []
  const envelope: ShieldArchiveEnvelope = {
    schema: SCHEMA,
    revision: typeof raw.revision === 'number' ? raw.revision : 1,
    sortedByArrival: raw.sortedByArrival === true,
    records,
    appliedOps: raw.appliedOps && typeof raw.appliedOps === 'object' ? raw.appliedOps : {},
  }
  // 老卷没有重排标记：先并入旧台账，再把存量按进场日期重排一遍。
  const withLegacy = importLegacyLedger(envelope.records)
  envelope.records = envelope.sortedByArrival ? withLegacy : sortByArrival(withLegacy)
  envelope.sortedByArrival = true
  return envelope
}

export function readArchiveEnvelope(): ShieldArchiveEnvelope | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return buildInitialEnvelope()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const envelope = buildInitialEnvelope()
    writeArchiveEnvelope(envelope)
    return envelope
  }
  try {
    const envelope = migrateEnvelope(JSON.parse(raw) as Partial<ShieldArchiveEnvelope>)
    return envelope
  } catch {
    const envelope = buildInitialEnvelope()
    writeArchiveEnvelope(envelope)
    return envelope
  }
}

export function writeArchiveEnvelope(envelope: ShieldArchiveEnvelope): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope))
}

/** 取不到数据就重试，默认读 3 次；都失败返回 null，由调用方决定撤回或报错。 */
export function readArchiveWithRetry(times = 3): ShieldArchiveEnvelope | null {
  for (let attempt = 0; attempt < times; attempt += 1) {
    const envelope = readArchiveEnvelope()
    if (envelope) {
      return envelope
    }
  }
  return null
}

export function archiveStorageKey(): string {
  return STORAGE_KEY
}
