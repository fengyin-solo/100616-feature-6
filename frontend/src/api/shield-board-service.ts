import {
  migrateRecord,
  readArchiveWithRetry,
  sortByArrival,
  writeArchiveEnvelope,
  type ShieldArchiveEnvelope,
  type ShieldMachine,
  type ShieldStatus,
} from '@/data/shield-archive'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 看板服务：所有盾构机台数、状态流转、档案修改都走这里。
// 约定：设备档案是唯一权威来源；冲突时以档案里已落库的内容为准，过期写入直接拒掉。

export type Role = '设备管理员' | '项目账号'

export type MutationResult = { ok: boolean; message: string }

export type BoardColumn = { status: ShieldStatus; machines: ShieldMachine[] }

export type ShieldPresence = {
  总数: number
  在场: number
  在路上: number
  掘进中: number
  调试中: number
  检修中: number
  已退场: number
  待进场: number
  在场编号: string[]
}

export type ShieldBoard = {
  columns: BoardColumn[]
  maintenance: ShieldMachine[]
  unitSummary: { 维保单位: string; 台数: number }[]
  presence: ShieldPresence
  revision: number
}

/** 只有设备管理员能改刀盘形式与维保单位；项目账号只能查看。 */
const ADMIN_ONLY_FIELDS = ['刀盘形式', '维保单位'] as const
const EDITABLE_FIELDS = ['盾构机型号', '开挖直径', '刀盘形式', '维保单位', '备注'] as const
type EditableField = (typeof EDITABLE_FIELDS)[number]

export type MachinePatch = Partial<Pick<ShieldMachine, EditableField>>

const STATUS_FLOW: Record<ShieldStatus, { action: string; to: ShieldStatus }[]> = {
  待进场: [{ action: '办理进场', to: '调试中' }],
  调试中: [
    { action: '开始掘进', to: '掘进中' },
    { action: '转检修', to: '检修中' },
  ],
  掘进中: [
    { action: '转检修', to: '检修中' },
    { action: '办理退场', to: '已退场' },
  ],
  检修中: [{ action: '结束检修', to: '调试中' }],
  已退场: [],
}

export function availableActions(status: ShieldStatus): { action: string; to: ShieldStatus }[] {
  return STATUS_FLOW[status] ?? []
}

const listeners = new Set<() => void>()

/** 档案有提交成功的改动时通知各页面刷新（掘进环次、运营概览等）。 */
export function onArchiveChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyArchiveChange(): void {
  for (const listener of listeners) {
    listener()
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowText(): string {
  return new Date().toISOString()
}

/** 停机/持续时长（天）：从进入当前状态算起，越久的排在越前。 */
export function stopDays(machine: ShieldMachine, now: number = Date.now()): number {
  const start = Date.parse(machine.状态起始时间)
  if (Number.isNaN(start)) {
    return 0
  }
  return Math.max(0, Math.floor((now - start) / 86400000))
}

function byStopLongest(a: ShieldMachine, b: ShieldMachine): number {
  return Date.parse(a.状态起始时间) - Date.parse(b.状态起始时间) || a.id - b.id
}

function buildPresence(records: ShieldMachine[]): ShieldPresence {
  const count = (status: ShieldStatus) => records.filter((item) => item.状态 === status).length
  const 调试中 = count('调试中')
  const 掘进中 = count('掘进中')
  const 检修中 = count('检修中')
  return {
    总数: records.length,
    待进场: count('待进场'),
    调试中,
    掘进中,
    检修中,
    已退场: count('已退场'),
    在路上: count('待进场'),
    在场: 调试中 + 掘进中 + 检修中,
    在场编号: records
      .filter((item) => item.状态 === '调试中' || item.状态 === '掘进中' || item.状态 === '检修中')
      .map((item) => item.盾构机编号),
  }
}

/** 在场看板：按状态分列，检修中单独收在右端；列内停机久的在前。 */
export function loadBoard(): ShieldBoard {
  const envelope = readArchiveWithRetry()
  const records = envelope ? envelope.records : []
  const columnOf = (status: ShieldStatus): BoardColumn => ({
    status,
    machines: records.filter((item) => item.状态 === status).sort(byStopLongest),
  })
  const units = new Map<string, number>()
  for (const machine of records) {
    units.set(machine.维保单位, (units.get(machine.维保单位) ?? 0) + 1)
  }
  return {
    columns: [columnOf('待进场'), columnOf('调试中'), columnOf('掘进中'), columnOf('已退场')],
    maintenance: records.filter((item) => item.状态 === '检修中').sort(byStopLongest),
    unitSummary: [...units.entries()]
      .map(([维保单位, 台数]) => ({ 维保单位, 台数 }))
      .sort((a, b) => b.台数 - a.台数 || a.维保单位.localeCompare(b.维保单位)),
    presence: buildPresence(records),
    revision: envelope?.revision ?? 0,
  }
}

/** 掘进环次、运营概览等页面读台数统一走这里，保证两处是同一份。 */
export function getShieldPresence(): ShieldPresence {
  const envelope = readArchiveWithRetry()
  return buildPresence(envelope ? envelope.records : [])
}

/** 详情视图：直接回档案里取，跟看板对不上时以这里读到的为准。 */
export function loadMachineDetail(id: number): ShieldMachine | null {
  const envelope = readArchiveWithRetry()
  const found = envelope?.records.find((item) => item.id === id)
  return found ? migrateRecord(found) : null
}

/** 档案一变就把旧台账的 shield 行对齐过去，其他页面看到的还是同一份。 */
function mirrorLedgerFromArchive(records: ShieldMachine[]): void {
  const ledger = listRows('shield')
  const byCode = new Map(ledger.map((row) => [String(row['盾构机编号'] ?? ''), row]))
  let nextId = ledger.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const next: EntryRow[] = sortByArrival(records).map((machine) => {
    const existing = byCode.get(machine.盾构机编号)
    return {
      ...(existing ?? {}),
      id: existing ? Number(existing.id) : nextId++,
      status: machine.状态,
      pending: machine.状态 !== '已退场',
      abnormal: machine.状态 === '检修中',
      盾构机编号: machine.盾构机编号,
      盾构机型号: machine.盾构机型号,
      开挖直径: machine.开挖直径,
      刀盘形式: machine.刀盘形式,
      总推力: String(existing?.['总推力'] ?? '—'),
      进场日期: machine.进场日期,
      维保单位: machine.维保单位,
      设备状态: machine.状态,
    }
  })
  saveRows('shield', next)
}

/**
 * 一笔提交的公共骨架：越权与重复提交在这里挡，落库不成整笔撤回。
 * 流程：读档案 → 查提交单号 → 校验并改草稿 → 落库 → 返回列表核对。
 */
function commit(opId: string, mutate: (draft: ShieldArchiveEnvelope) => MutationResult): MutationResult {
  const envelope = readArchiveWithRetry()
  if (!envelope) {
    return { ok: false, message: '设备档案读取失败，请稍后重试' }
  }
  const seen = envelope.appliedOps[opId]
  if (seen) {
    // 连着点两回仍按头一回：同一单号直接回头一次的结果，不再改数据。
    return { ok: seen.result.ok, message: `${seen.result.message}（重复提交已按首次结果处理）` }
  }
  const snapshot = clone(envelope)
  const draft = clone(envelope)
  const result = mutate(draft)
  if (!result.ok) {
    return result
  }
  draft.revision = envelope.revision + 1
  draft.appliedOps[opId] = { at: nowText(), result }
  try {
    writeArchiveEnvelope(draft)
    mirrorLedgerFromArchive(draft.records)
  } catch {
    // 落库不成整笔撤回：档案和台账都回到提交前。
    try {
      writeArchiveEnvelope(snapshot)
      mirrorLedgerFromArchive(snapshot.records)
    } catch {
      // 撤回也失败时只能提示人工核对，不再抛错。
    }
    return { ok: false, message: '写入设备档案失败，已整笔撤回' }
  }
  // 提交之后返回列表核对一遍：取不到就重试，确认档案里真是刚写的这版。
  const verified = readArchiveWithRetry()
  if (!verified) {
    try {
      writeArchiveEnvelope(snapshot)
      mirrorLedgerFromArchive(snapshot.records)
    } catch {
      // 同上，撤回失败不抛错。
    }
    return { ok: false, message: '提交后核对取不到设备档案，已整笔撤回' }
  }
  if (verified.revision !== draft.revision) {
    // 档案已经被别的写入顶到更新的版本：以档案为准，不把上一版盖回去。
    return { ok: false, message: '设备档案已被其他提交更新，以档案当前内容为准，请刷新后重试' }
  }
  notifyArchiveChange()
  return result
}

/** 改档案字段：刀盘形式与维保单位只有设备管理员能改，整笔要么全落要么全撤。 */
export function updateMachine(id: number, patch: MachinePatch, opId: string, role: Role): MutationResult {
  const touched = Object.keys(patch).filter((key) => EDITABLE_FIELDS.includes(key as EditableField))
  if (touched.length === 0) {
    return { ok: false, message: '没有需要保存的字段' }
  }
  if (role !== '设备管理员') {
    const adminOnly = touched.filter((key) => (ADMIN_ONLY_FIELDS as readonly string[]).includes(key))
    const reason = adminOnly.length > 0 ? `「${adminOnly.join('、')}」只有设备管理员能改` : '项目账号只能查看，不能修改设备档案'
    return { ok: false, message: `越权操作已拦截：${reason}` }
  }
  return commit(opId, (draft) => {
    const index = draft.records.findIndex((item) => item.id === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的盾构机档案` }
    }
    const current = draft.records[index]
    const changed = touched.some((key) => String(patch[key as EditableField] ?? '') !== String(current[key as EditableField] ?? ''))
    if (!changed) {
      return { ok: true, message: `${current.盾构机编号} 档案内容未变化` }
    }
    const updated: ShieldMachine = { ...current }
    for (const key of touched) {
      const value = patch[key as EditableField]
      if (typeof value === 'string') {
        ;(updated as Record<string, unknown>)[key] = value.trim()
      }
    }
    updated.档案版本 = current.档案版本 + 1
    updated.更新时间 = nowText()
    draft.records[index] = updated
    return { ok: true, message: `${updated.盾构机编号} 设备档案已保存` }
  })
}

/** 状态流转：改完档案会同步旧台账，掘进环次与概览读到的台数跟着一起变。 */
export function changeMachineStatus(id: number, action: string, opId: string, role: Role): MutationResult {
  if (role !== '设备管理员') {
    return { ok: false, message: '越权操作已拦截：项目账号只能查看，不能办理状态流转' }
  }
  return commit(opId, (draft) => {
    const index = draft.records.findIndex((item) => item.id === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的盾构机档案` }
    }
    const current = draft.records[index]
    const transition = availableActions(current.状态).find((item) => item.action === action)
    if (!transition) {
      return { ok: false, message: `${current.盾构机编号} 当前状态「${current.状态}」不能办理「${action}」` }
    }
    if (current.状态 === transition.to) {
      return { ok: false, message: `${current.盾构机编号} 已经是「${transition.to}」，不用重复操作` }
    }
    draft.records[index] = {
      ...current,
      状态: transition.to,
      状态起始时间: nowText(),
      档案版本: current.档案版本 + 1,
      更新时间: nowText(),
    }
    return { ok: true, message: `${current.盾构机编号} 已${action}，当前状态「${transition.to}」` }
  })
}
