import {
  SHIELD_TRANSITIONS,
  normalizeStatus,
  type ShieldStatus,
} from '@/data/shield'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow, MutationResult, RoleKey } from '@/data/types'

const MODULE_KEY = 'shield'

// 只有设备管理员能改的档案字段。
export const ADMIN_ONLY_FIELDS = ['刀盘形式', '维保单位'] as const
export type ArchivePatch = Partial<Record<(typeof ADMIN_ONLY_FIELDS)[number], string>>

// 幂等：同一台机器、同一个动作、同样的档案内容连着点两回，只按头一回处理。
type IdempotentEntry = { key: string; at: number; result: MutationResult }
const recentMutations: IdempotentEntry[] = []
const IDEMPOTENT_TTL = 5000

function remember(key: string, result: MutationResult): MutationResult {
  recentMutations.unshift({ key, at: Date.now(), result })
  if (recentMutations.length > 100) {
    recentMutations.length = 100
  }
  return result
}

function findRecent(key: string): MutationResult | null {
  const now = Date.now()
  while (recentMutations.length && now - recentMutations[recentMutations.length - 1].at > IDEMPOTENT_TTL) {
    recentMutations.pop()
  }
  return recentMutations.find((item) => item.key === key)?.result ?? null
}

function patchFingerprint(patch: ArchivePatch): string {
  return JSON.stringify(
    Object.keys(patch)
      .sort()
      .map((key) => [key, String(patch[key as keyof ArchivePatch] ?? '').trim()]),
  )
}

function todayLabel(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function findRow(id: number): { row: EntryRow; index: number; rows: EntryRow[] } | null {
  const rows = listRows(MODULE_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  return index < 0 ? null : { row: rows[index], index, rows }
}

export function actionsForStatus(status: unknown): { action: string; target: ShieldStatus }[] {
  return SHIELD_TRANSITIONS[normalizeStatus(status)] ?? []
}

export function canChangeStatus(role: RoleKey): boolean {
  return role === 'admin' || role === 'dispatcher'
}

export function canEditArchive(role: RoleKey): boolean {
  return role === 'admin'
}

// 改状态：权限、状态机、幂等、冲突、落库、回读核对都在这，页面不做业务判断。
export function changeShieldStatus(
  id: number,
  action: string,
  role: RoleKey,
  expectedRev?: number,
): MutationResult {
  if (!canChangeStatus(role)) {
    return { ok: false, message: '当前账号只能查看，无权流转设备状态' }
  }
  // 幂等键带「视图基线版本」：同一界面连点两回，第二回拿到的还是头一回的结果，不再落库。
  const idemKey = `status:${id}:${action}:${expectedRev ?? 'na'}`
  const cached = findRecent(idemKey)
  if (cached) {
    return cached
  }
  const found = findRow(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的盾构机` }
  }
  const status = normalizeStatus(found.row.status)
  const edge = SHIELD_TRANSITIONS[status]?.find((item) => item.action === action)
  if (!edge) {
    return { ok: false, message: `「${status}」状态下不允许执行「${action}」` }
  }

  const rev = Number(found.row.rev ?? 0)
  if (typeof expectedRev === 'number' && rev !== expectedRev) {
    return {
      ok: false,
      message: '设备档案刚被别人改过，已按设备档案最新数据刷新，请核对后再提交',
      conflicts: [{ field: '设备状态', current: status, incoming: edge.target }],
    }
  }
  // 状态已经是目标（头一回已落库）：按头一回成功处理，不再写。
  if (status === edge.target) {
    return remember(idemKey, { ok: true, message: `设备状态已是「${edge.target}」，无需重复提交` })
  }

  const target = edge.target
  const updated: EntryRow = {
    ...found.row,
    status: target,
    pending: target !== '已退场',
    rev: rev + 1,
  }
  updated['设备状态'] = target
  // 进入掘进 = 恢复生产，清停机起点；其他状态一律从今天起算停机时长。
  updated['停机开始'] = target === '掘进中' ? '' : todayLabel()

  const next = [...found.rows]
  next[found.index] = updated

  try {
    saveRows(MODULE_KEY, next)
  } catch (error) {
    // 失败不进幂等缓存：整笔已撤回，用户可以立刻重试，不会被一次失败顶住。
    return {
      ok: false,
      message: error instanceof Error ? error.message : '落库失败，已整笔撤回',
    }
  }

  // 提交之后返回列表核对一遍：回读设备档案，确认落的就是这笔。
  const verified = listRows(MODULE_KEY)[found.index]
  if (!verified || normalizeStatus(verified.status) !== target || Number(verified.rev) !== rev + 1) {
    try {
      saveRows(MODULE_KEY, found.rows)
    } catch {
      /* 核对不一致且回滚也失败：保持现场，交由上层报错，绝不返回成功 */
    }
    return { ok: false, message: '提交后与设备档案核对不一致，已整笔撤回，请重试' }
  }
  return remember(idemKey, { ok: true, message: `已${action}，当前状态「${target}」` })
}

// 设备管理员改刀盘形式/维保单位；空值不落，冲突以设备档案（库里最新值）为准。
export function updateShieldArchive(
  id: number,
  patch: ArchivePatch,
  role: RoleKey,
  expectedRev?: number,
): MutationResult {
  if (!canEditArchive(role)) {
    return { ok: false, message: '只有设备管理员能修改刀盘形式与维保单位' }
  }
  const keys = Object.keys(patch).filter((key) =>
    (ADMIN_ONLY_FIELDS as readonly string[]).includes(key),
  )
  if (keys.length === 0) {
    return { ok: false, message: '没有可保存的档案字段' }
  }
  for (const key of keys) {
    if (!String(patch[key as keyof ArchivePatch] ?? '').trim()) {
      return { ok: false, message: `${key}不能为空，写不成就不提交` }
    }
  }

  // 幂等键带视图基线版本：同样的内容连点两回，只按头一回处理。
  const idemKey = `archive:${id}:${expectedRev ?? 'na'}:${patchFingerprint(patch)}`
  const cachedResult = findRecent(idemKey)
  if (cachedResult) {
    return cachedResult
  }

  const found = findRow(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的盾构机` }
  }
  const rev = Number(found.row.rev ?? 0)
  if (typeof expectedRev === 'number' && rev !== expectedRev) {
    return {
      ok: false,
      message: '设备档案已被更新，页面数字与档案不符时以设备档案为准，已按档案刷新',
      conflicts: keys.map((key) => ({
        field: key,
        current: String(found.row[key] ?? ''),
        incoming: String(patch[key as keyof ArchivePatch] ?? ''),
      })),
    }
  }

  const updated: EntryRow = { ...found.row, rev: rev + 1 }
  for (const key of keys) {
    updated[key] = String(patch[key as keyof ArchivePatch]).trim()
  }
  const next = [...found.rows]
  next[found.index] = updated

  try {
    saveRows(MODULE_KEY, next)
  } catch (error) {
    // 失败不进幂等缓存：整笔已撤回，用户可以立刻重试，不会被一次失败顶住。
    return {
      ok: false,
      message: error instanceof Error ? error.message : '落库失败，已整笔撤回',
    }
  }

  // 回读核对：详情视图与看板都以设备档案为准，这里对不上就说明没写对，整笔撤回。
  const verified = listRows(MODULE_KEY)[found.index]
  const mismatch = keys.some(
    (key) => String(verified?.[key] ?? '') !== String(updated[key] ?? ''),
  ) || Number(verified?.rev ?? 0) !== rev + 1
  if (!verified || mismatch) {
    try {
      saveRows(MODULE_KEY, found.rows)
    } catch {
      /* 同上：回滚失败也绝不返回成功 */
    }
    return { ok: false, message: '保存后与设备档案核对不一致，已整笔撤回，请重试' }
  }
  return remember(idemKey, { ok: true, message: '设备档案已保存，并以设备档案为准同步全平台台数' })
}
