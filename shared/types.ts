export type AppearanceMode = 'system' | 'light' | 'dark'

export type AccentKey = 'blue' | 'cyan' | 'violet' | 'green' | 'orange' | 'gradient'

export interface ThemeSettings {
  appearance: AppearanceMode
  accent: AccentKey
}

// ---- Monitor（硬件监控）----
export interface CpuSnapshot {
  /** 整体负载 0-100 */
  load: number
  /** 每核负载 0-100 */
  cores: number[]
}

export interface MemSnapshot {
  used: number
  total: number
  percent: number
}

export interface DiskSnapshot {
  mount: string
  used: number
  total: number
  percent: number
}

export interface NetSnapshot {
  /** 接收速率 bytes/s */
  rxSec: number
  /** 发送速率 bytes/s */
  txSec: number
}

export interface SystemSnapshot {
  cpu: CpuSnapshot
  mem: MemSnapshot
  disks: DiskSnapshot[]
  net: NetSnapshot
  /** CPU 温度（°C），不支持时为 null */
  temp: number | null
  /** 电量百分比，无电池时为 null */
  battery: number | null
  uptimeSec: number
  /** 采样时间戳 */
  at: number
}

export interface GaleApi {
  settings: {
    get(): Promise<ThemeSettings>
    set(patch: Partial<ThemeSettings>): Promise<ThemeSettings>
  }
  monitor: {
    snapshot(): Promise<SystemSnapshot>
  }
  history: {
    list(): Promise<HistoryEntry[]>
    add(entry: { type: HistoryType; label: string; detail?: string }): Promise<HistoryEntry>
    clear(): Promise<void>
  }
  optimizer: {
    scanCleanup(): Promise<CleanupPlan[]>
    runCleanup(items: { id: string; path: string; kind: OptimizerTargetKind }[]): Promise<CleanupResult[]>
    listStartup(): Promise<StartupItem[]>
    toggleStartup(id: string, enable: boolean, command?: string): Promise<StartupItem[]>
  }
}

// ---- History（优化记录）----
export type HistoryType = 'cleanup' | 'startup' | 'gameMode' | 'toolbox' | 'optimize'

export interface HistoryEntry {
  id: string
  type: HistoryType
  label: string
  detail?: string
  /** 时间戳（ms） */
  at: number
}

// ---- Optimizer（优化中心）----
export type OptimizerTargetKind = 'temp' | 'recycle' | 'browser'

export interface CleanupPlan {
  id: string
  kind: OptimizerTargetKind
  label: string
  path: string
  sizeBytes: number
  /** 是否 safe 白名单路径（仅 safe 项允许清理） */
  safe: boolean
}

export interface CleanupResult {
  id: string
  ok: boolean
  error?: string
}

export interface StartupItem {
  id: string
  name: string
  command: string
  location: 'HKCU' | 'HKLM'
  enabled: boolean
}
