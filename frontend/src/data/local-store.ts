import { SEED_ROWS } from './seed'
import { normalizeStatus } from './shield'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'shield-tunnel-construction:entries'
const DB_VERSION = 1

type Database = {
  version: number
  rows: Record<string, EntryRow[]>
}

type Listener = () => void

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function fieldText(row: EntryRow, field: string): string {
  const value = row[field]
  return value === undefined || value === null ? '' : String(value).trim()
}

function dayStart(value: string): number {
  if (!value) {
    return Number.POSITIVE_INFINITY
  }
  const [year, month, day] = value.split('-').map((part) => Number(part))
  const time = new Date(year || 1970, (month || 1) - 1, day || 1).getTime()
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY
}

// 存量盾构机迁移：未知/空状态归到已退场（兼容退场老设备），补齐停机开始与设备状态，
// 最后整表按进场日期重排一遍。迁移只在这里做一次，页面拿到的都是规整后的数据。
function migrateShieldRows(rows: EntryRow[]): EntryRow[] {
  const migrated = rows.map((row) => {
    const status = normalizeStatus(row.status)
    const next: EntryRow = { ...row, status }
    next['设备状态'] = status
    if (!fieldText(next, '停机开始')) {
      next['停机开始'] = status === '掘进中' ? '' : fieldText(next, '进场日期') || '2025-01-01'
    }
    if (typeof next.pending !== 'boolean') {
      next.pending = status !== '已退场'
    }
    if (typeof next.abnormal !== 'boolean') {
      next.abnormal = false
    }
    return next
  })
  return migrated.sort((a, b) => {
    const diff = dayStart(fieldText(a, '进场日期')) - dayStart(fieldText(b, '进场日期'))
    return diff !== 0 ? diff : Number(a.id) - Number(b.id)
  })
}

function seedDatabase(): Database {
  return { version: DB_VERSION, rows: clone(SEED_ROWS) }
}

function isDatabase(value: unknown): value is Database {
  if (!value || typeof value !== 'object') {
    return false
  }
  const db = value as Database
  if (!db.rows || typeof db.rows !== 'object') {
    return false
  }
  return Object.values(db.rows).every((list) => Array.isArray(list))
}

// 兼容旧版：旧库里 shield 是裸 Record<string, EntryRow[]>，没有 version 外壳。
function migrateDatabase(parsed: unknown): Database | null {
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const seed = seedDatabase()
  if (isDatabase(parsed) && parsed.version === DB_VERSION) {
    return { version: DB_VERSION, rows: { ...seed.rows, ...parsed.rows } }
  }
  const legacy = parsed as Record<string, unknown>
  const looksLegacy = Object.values(legacy).every((value) => Array.isArray(value))
  if (!looksLegacy) {
    return null
  }
  const rows = { ...seed.rows, ...(clone(legacy) as Record<string, EntryRow[]>) }
  rows.shield = migrateShieldRows(rows.shield ?? [])
  const migrated: Database = { version: DB_VERSION, rows }
  // 迁移完立即落库，下次打开读到的就是规整后的版本。
  persist(migrated)
  return migrated
}

function parseRaw(raw: string | null): Database {
  if (raw === null) {
    const seeded = seedDatabase()
    persist(seeded)
    return seeded
  }
  const db = migrateDatabase(JSON.parse(raw))
  if (!db) {
    // 数据坏了就原样留着，绝不拿种子数据把用户的库顶掉。
    throw new Error('本地数据结构无法识别，已保留原数据未做改动')
  }
  return db
}

function persist(db: Database): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

// 读一次：坏数据直接抛错，由上层重试，重试再失败也不回退到种子或上一版。
function readOnce(): Database {
  if (typeof window === 'undefined' || !window.localStorage) {
    return seedDatabase()
  }
  return parseRaw(window.localStorage.getItem(STORAGE_KEY))
}

let cache: Database | null = null

const listeners = new Set<Listener>()

function emitChange(): void {
  listeners.forEach((listener) => listener())
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// 跨标签页：另一个标签页改了数据，这个标签页也重读同一份库。
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) {
      return
    }
    try {
      const db = readOnce()
      cache = db
      emitChange()
    } catch {
      // 读不到就维持现状等下次，不用上一版冒充新数据。
    }
  })
}

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readOnce()
  }
  return cache.rows
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

// 异步取数：失败按退避间隔重试，三次都不行就抛出——调用方展示错误，不顶上一版。
export function loadRows(key: string, attempts = 3): Promise<EntryRow[]> {
  return new Promise((resolve, reject) => {
    const delays = [0, 80, 200]
    const attempt = (remain: number) => {
      try {
        cache = readOnce()
        resolve(clone(cache.rows[key] ?? []))
      } catch (error) {
        if (remain <= 1) {
          reject(error instanceof Error ? error : new Error('本地数据读取失败'))
          return
        }
        window.setTimeout(() => attempt(remain - 1), delays[attempts - remain] ?? 120)
      }
    }
    attempt(attempts)
  })
}

// 落库：序列化 → 写入 → 回读校验，任一步失败都整笔撤回（恢复上一版并抛出）。
export function saveRows(key: string, rows: EntryRow[]): void {
  const current = cache ?? readOnce()
  const previous: Database = clone(current)
  const next: Database = { version: DB_VERSION, rows: { ...current.rows, [key]: clone(rows) } }

  let serialized: string
  try {
    serialized = JSON.stringify(next)
  } catch {
    throw new Error('数据序列化失败，本次修改整笔撤回')
  }

  if (typeof window === 'undefined' || !window.localStorage) {
    cache = next
    emitChange()
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, serialized)
    const written = window.localStorage.getItem(STORAGE_KEY)
    if (written !== serialized) {
      throw new Error('回读不一致')
    }
  } catch {
    // 落库不成：尽力把上一版写回去，内存也不动，保证库里库外一致。
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(previous))
    } catch {
      /* localStorage 已不可用，保持现场交给上层报错 */
    }
    throw new Error('数据落库失败，已整笔撤回，没有写入半条记录')
  }

  cache = next
  emitChange()
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
