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
  gameMode: {
    status(): Promise<GameModeStatus>
    boost(): Promise<GameModeStatus>
    restore(): Promise<GameModeStatus>
  }
  toolbox: {
    flushDns(): Promise<ToolResult>
    emptyRecycleBin(): Promise<ToolResult>
    clearClipboard(): Promise<ToolResult>
    toggleDarkMode(enable: boolean): Promise<ToolResult>
  }
  app: {
    /** 当前应用版本（来自 package.json） */
    getVersion(): Promise<string>
    /** 检查更新（自动下载可用更新），返回结果摘要 */
    checkUpdate(): Promise<AppUpdateResult>
    /** 退出并安装已下载的更新 */
    installUpdate(): Promise<void>
    /** 读取开机自启状态 */
    getAutoLaunch(): Promise<boolean>
    /** 设置开机自启，返回设置后的状态 */
    setAutoLaunch(enable: boolean): Promise<boolean>
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

// ---- GameMode（游戏模式）----
export interface GameModeStatus {
  /** 当前激活的电源计划 GUID */
  active: string
  /** 当前电源计划名称（本地化，可能为 ''） */
  activeName: string
  /** 是否已处于游戏模式（高性能计划） */
  boosted: boolean
  /** boost 之前记录的上一计划 GUID，未记录为 null */
  previous: string | null
}

// ---- Toolbox（工具箱）----
export interface ToolResult {
  ok: boolean
  /** 成功提示或失败原因 */
  message: string
}

// ---- App（关于 / 自动更新 / 开机自启）----
export interface AppUpdateResult {
  /** up-to-date=已是最新；available=有可用更新；error=检查失败 */
  status: 'up-to-date' | 'available' | 'error'
  /** 可用更新版本号（status==='available' 时） */
  version?: string
  /** 失败原因（status==='error' 时） */
  error?: string
}
