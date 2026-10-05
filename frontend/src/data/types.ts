/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 账号角色：只有设备管理员能动刀盘形式与维保单位；值班调度能改状态；观摩账号只读。
export type RoleKey = 'admin' | 'dispatcher' | 'viewer'

export type RoleMeta = {
  key: RoleKey
  name: string
  desc: string
}

// 写操作结果：失败时一定没落库（或已整笔回滚），调用方不用再猜。
export type MutationResult = {
  ok: boolean
  message: string
  conflicts?: { field: string; current: string | number; incoming: string | number }[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
