import { defineStore } from 'pinia'

import type { RoleKey, RoleMeta } from '@/data/types'

// 纯前端演示版的账号：切换角色即可，真正换后端时换成登录态。
export const ROLES: RoleMeta[] = [
  { key: 'admin', name: '设备管理员', desc: '可改刀盘形式、维保单位，可流转设备状态' },
  { key: 'dispatcher', name: '值班调度', desc: '可流转设备状态，不能改设备档案字段' },
  { key: 'viewer', name: '观摩账号', desc: '全程只读，所有写操作都会被挡住' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: 'admin' as RoleKey,
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isAdmin: (state) => state.role === 'admin',
    canEditArchive: (state) => state.role === 'admin',
    // 状态流转属于调度动作：管理员和值班调度都能做，观摩账号不行。
    canChangeStatus: (state) => state.role === 'admin' || state.role === 'dispatcher',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: RoleKey) {
      this.role = role
      const found = ROLES.find((item) => item.key === role)
      this.operator = found ? found.name : this.operator
    },
  },
})
