import { defineStore } from 'pinia'

export type SessionRole = '设备管理员' | '项目账号'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
    // 设备管理员能改刀盘形式与维保单位；项目账号只能查看。
    role: '设备管理员' as SessionRole,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isDeviceAdmin: (state) => state.role === '设备管理员',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: SessionRole) {
      this.role = role
    },
  },
})
