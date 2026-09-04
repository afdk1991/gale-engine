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
  process: {
    list(sort?: ProcessSortKey): Promise<ProcessInfo[]>
    kill(pid: number): Promise<ProcessActionResult>
    suspend(pid: number): Promise<ProcessActionResult>
    resume(pid: number): Promise<ProcessActionResult>
    priority(pid: number, level: ProcessPriorityLevel): Promise<ProcessActionResult>
  }
  network: {
    ping(host: string, count?: number): Promise<PingResult>
    interfaces(): Promise<NetInterface[]>
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
  firewall: {
    profiles(): Promise<FirewallProfile[]>
    listRules(): Promise<FirewallRule[]>
    setProfileEnabled(profile: string, enable: boolean): Promise<ToolResult>
    toggleRule(name: string, enable: boolean): Promise<ToolResult>
  }
  tasks: {
    list(): Promise<ScheduledTask[]>
    setEnabled(path: string, name: string, enable: boolean): Promise<ToolResult>
    run(path: string, name: string): Promise<ToolResult>
    stop(path: string, name: string): Promise<ToolResult>
  }
  winServices: {
    list(): Promise<WinService[]>
    start(name: string): Promise<ToolResult>
    stop(name: string): Promise<ToolResult>
    setStartupType(name: string, startType: ServiceStartupType): Promise<ToolResult>
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

// ---- Process（进程管理）----
export type ProcessSortKey = 'cpu' | 'mem' | 'name'
export type ProcessPriorityLevel = 'low' | 'belowNormal' | 'normal' | 'aboveNormal' | 'high'

export interface ProcessInfo {
  pid: number
  name: string
  /** CPU 占用估算 0-100（双采样差值计算） */
  cpuPercent: number
  /** 内存占用 MB */
  memMB: number
  status: 'running' | 'suspended'
  /** 是否系统关键进程（拒绝结束 / 挂起） */
  protected: boolean
}

export interface ProcessActionResult {
  ok: boolean
  message: string
}

// ---- Network（网络诊断）----
export interface PingResult {
  host: string
  /** 往返延迟 ms，无成功样本为 0 */
  min: number
  avg: number
  max: number
  /** 丢包率 0-100 */
  loss: number
  ok: boolean
}

export interface NetInterface {
  name: string
  /** 主 IPv4 地址，无地址为 '' */
  ip: string
  /** 连接状态描述（如 已连接 / 未连接） */
  status: string
}

// ---- Firewall（防火墙）----
export interface FirewallProfile {
  /** Domain / Private / Public */
  name: string
  enabled: boolean
  /** 入站默认动作（Allow / Block） */
  inbound: string
  /** 出站默认动作（Allow / Block） */
  outbound: string
}

export interface FirewallRule {
  /** 规则名（唯一标识，用于启停操作） */
  name: string
  displayName: string
  enabled: boolean
  /** Inbound / Outbound */
  direction: string
  /** Allow / Block */
  action: string
  /** 生效的配置文件（Domain,Private,Public 等） */
  profile: string
}

// ---- Tasks（计划任务）----
export interface ScheduledTask {
  /** 任务路径（\ 开头，\ 表示根目录） */
  path: string
  /** 任务名 */
  name: string
  /** Ready / Running / Disabled */
  state: string
  /** 上次运行时间（本地化字符串，无记录为 ''） */
  lastRunTime: string
  /** 下次运行时间（无计划为 ''） */
  nextRunTime: string
}

// ---- WinServices（Windows 服务）----
export type ServiceStartupType = 'auto' | 'manual' | 'disabled'

export interface WinService {
  name: string
  displayName: string
  /** Running / Stopped / Paused 等 */
  status: string
  /** Automatic / Manual / Disabled */
  startType: string
  /** 当前是否可停止（系统关键服务为 false） */
  canStop: boolean
  /** 是否系统关键服务（拒绝停止） */
  protected: boolean
}
