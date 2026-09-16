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
  /**
   * 本次采样中**采集失败、已按兜底值降级**的数据项（如 `['cpu','temp']`）。
   * 空数组 = 全部正常。用于让界面如实提示「部分数据不可用」，
   * 而不是整块报「监控数据获取失败」——单项失败不应拖垮整张快照。
   */
  degraded: string[]
}

// ---- Hardware（硬件型号规格，静态硬件信息，区别于实时监控快照）----
// 适用于 x86 / x64 / arm64 架构；基于 systeminformation 跨平台采集，
// 部分字段（内存条布局、磁盘布局）需管理员/root 权限，无权限时返回空数组或 ''。

/** 主板 + BIOS 信息 */
export interface HardwareMotherboard {
  /** 主板型号，无法获取为 '' */
  model: string
  /** 主板厂商 */
  vendor: string
  /** 主板版本/修订号 */
  version: string
  /** BIOS 厂商 */
  biosVendor: string
  /** BIOS 版本 */
  biosVersion: string
  /** BIOS 发布日期，无为 '' */
  biosDate: string
}

/** CPU 型号规格 */
export interface HardwareCpu {
  /** CPU 厂商（如 Intel / AMD / Apple） */
  vendor: string
  /** CPU 品牌/型号（如 Intel Core i7-12700K） */
  brand: string
  /** 架构标识：x64 / ia32(x86) / arm64 / unknown */
  arch: string
  /** 物理核心数 */
  physicalCores: number
  /** 逻辑核心数（含超线程） */
  cores: number
  /** 基础频率 GHz，不可获取为 null */
  speedGHz: number | null
}

/** 单条内存规格 */
export interface HardwareMemoryStick {
  /** 内存条型号/料号 */
  model: string
  /** 厂商 */
  vendor: string
  /** 单条容量 bytes */
  size: number
  /** 频率 MHz，不可获取为 null */
  speedMHz: number | null
  /** 内存类型（DDR4 / DDR5 / LPDDR 等），无 '' */
  type: string
}

/** 内存总览 */
export interface HardwareMemory {
  /** 总容量 bytes */
  total: number
  /** 内存条布局（需管理员/root 权限，无权限为空数组） */
  sticks: HardwareMemoryStick[]
}

/** 显卡控制器规格 */
export interface HardwareGraphicsController {
  /** 显卡型号 */
  model: string
  /** 厂商（如 NVIDIA / AMD / Intel） */
  vendor: string
  /** 显存 MB，不可获取为 null */
  vramMB: number | null
  /** 总线类型（PCIe / Integrated / USB 等），无 '' */
  bus: string
}

/** 显示器规格 */
export interface HardwareDisplay {
  /** 显示器型号 */
  model: string
  /** 厂商 */
  vendor: string
  /** 分辨率宽 px */
  resolutionX: number
  /** 分辨率高 px */
  resolutionY: number
  /** 尺寸英寸，不可获取为 null */
  sizeInch: number | null
}

/** 硬盘物理规格 */
export interface HardwareDisk {
  /** 硬盘型号 */
  model: string
  /** 厂商 */
  vendor: string
  /** 容量 bytes */
  size: number
  /** 类型（HDD / SSD / NVMe 等） */
  type: string
  /** 接口类型（SATA / NVMe / USB 等），无 '' */
  interfaceType: string
}

/**
 * 电源规格。
 * 台式机 PSU（电源供应器）通常无标准软件接口读取型号（需 PMBus/SMBus 服务器电源），
 * 此时 model 为 ''、type 为 'unknown'；
 * 笔记本电池型号从电池信息读取，type 为 'battery'。
 */
export interface HardwarePower {
  /** 电源/电池型号，台式机 PSU 不可获取为 '' */
  model: string
  /** 厂商 */
  vendor: string
  /** 'battery'（笔记本电池）/ 'psu'（台式机电源，需 PMBus）/ 'unknown' */
  type: string
  /** 额定功率 W（PSU）或电池容量设计 Wh，不可获取为 null */
  powerW: number | null
}

/** 硬件型号信息聚合 */
export interface HardwareInfo {
  /** 主板 + BIOS */
  motherboard: HardwareMotherboard
  /** CPU */
  cpu: HardwareCpu
  /** 内存 */
  memory: HardwareMemory
  /** 显卡控制器列表（可能多卡，含集显+独显） */
  graphics: HardwareGraphicsController[]
  /** 显示器列表（可能多屏） */
  displays: HardwareDisplay[]
  /** 硬盘物理列表 */
  disks: HardwareDisk[]
  /** 电源（台式机通常不可获取，笔记本取电池） */
  power: HardwarePower
  /** 采集时间戳 */
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
  hardware: {
    /** 采集静态硬件型号规格（主板/CPU/内存/显卡/显示器/硬盘/电源） */
    info(): Promise<HardwareInfo>
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
  /** 优化能力动态库：列出全部单项能力、并按 id 独立调用其中任意一项 */
  optlib: {
    listCapabilities(): Promise<OptCapabilityMeta[]>
    runSingle(id: string): Promise<OptOutcome>
    /** 能力库（本项目的「DLL」）当前状态：来源 / 版本 / 远端能力 / 被拒条目 */
    libraryState(): Promise<CapabilityLibraryState>
    /** 检查能力库是否有可更新版本（只检查，不生效） */
    checkLibrary(): Promise<CapabilityLibraryState>
    /** 把已下载的能力库落盘生效 */
    applyLibrary(): Promise<CapabilityLibraryState>
    /** 回退到内置能力库（丢弃远端清单） */
    resetLibrary(): Promise<CapabilityLibraryState>
  }
  /** 一键优化：按序执行全部（或指定）优化项，实时推送进度，支持取消与重试 */
  onekey: {
    start(ids?: string[]): Promise<OneKeySummary>
    cancel(): Promise<void>
    /** 只重试上一轮中失败的项 */
    retryFailed(): Promise<OneKeySummary>
    /** 读取当前进度快照（界面重进时恢复展示），从未运行过为 null */
    state(): Promise<OneKeyProgress | null>
    /** 订阅进度推送，返回取消订阅函数 */
    onProgress(cb: (p: OneKeyProgress) => void): () => void
  }
  disk: {
    /** 各卷空间占用与空间不足预警（systeminformation 跨平台） */
    volumes(): Promise<DiskVolume[]>
    /** 扫描可深度释放的空间（更新缓存/系统临时/组件存储等，按平台分发） */
    scanDeepCleanup(): Promise<DeepCleanupPlan[]>
    /** 按选中的 id 执行深度清理，id 由服务端权威清单解析（客户端无法注入路径） */
    runDeepCleanup(items: { id: string; kind: DeepCleanupKind; path: string }[]): Promise<CleanupResult[]>
    /** 检查/在线修复指定卷的文件系统错误（Win chkdsk / mac diskutil；linux 诚实降级） */
    checkVolume(mount: string, fix: boolean): Promise<DiskRepairResult>
    /** 修复系统文件与 DLL（Win sfc /scannow 或 DISM RestoreHealth；非 Win 诚实降级） */
    repairSystemFiles(kind: SystemRepairKind): Promise<DiskRepairResult>
  }
  /** DLL（动态链接库）缺失检测与修复：扫描 → 建议 → 修复 */
  dll: {
    /** 扫描关键系统 DLL / 运行库 DLL 是否缺失或位数不全 */
    scan(): Promise<DllScanResult>
    /** 基于最近一次扫描结果给出可执行的修复建议（未扫描时返回通用建议） */
    advice(): Promise<DllRepairAdvice[]>
    /** 执行某项修复（走提权通道；非 Windows 诚实降级） */
    repair(kind: DllRepairKind): Promise<DllRepairResult>
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
    /** 当前更新状态快照：不发网络请求，仅读主进程内状态机 */
    getUpdateState(): Promise<AppUpdateResult>
    /** 当前平台的自动更新能力探测（能否自更新、走哪种包、不能时的替代方案） */
    getUpdateCapability(): Promise<UpdateCapability>
    /** 订阅更新状态推送（检查中 / 下载进度 / 已下载 / 失败），返回退订函数 */
    onUpdateEvent(cb: (state: AppUpdateResult) => void): () => void
    /** 读取自动更新偏好 */
    getUpdatePrefs(): Promise<AppUpdatePrefs>
    /** 写入自动更新偏好（部分字段） */
    setUpdatePrefs(patch: Partial<AppUpdatePrefs>): Promise<AppUpdatePrefs>
    /** 退出并安装已下载的更新 */
    installUpdate(): Promise<void>
    /** 读取开机自启状态 */
    getAutoLaunch(): Promise<boolean>
    /** 设置开机自启，返回设置后的状态 */
    setAutoLaunch(enable: boolean): Promise<boolean>
    /** 当前进程是否已提升到管理员 / root 权限 */
    isElevated(): Promise<boolean>
    /** 以提升权限重启本应用（Windows 弹 UAC；macOS 弹认证框；Linux 诚实降级） */
    restartElevated(): Promise<{ ok: boolean; message: string }>
    /**
     * 用系统默认浏览器打开外部链接。
     * 渲染进程里不能直接用 <a href>——那会变成应用内导航（把整个界面换掉）。
     * 主进程侧按主机白名单校验，非白名单链接直接拒绝。
     */
    openExternal(url: string): Promise<ToolResult>
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
  /** 实测释放的卷空闲空间增量（bytes）；无法测量时为 undefined */
  releasedBytes?: number
  /** 实际成功删除的条目数 */
  deletedCount?: number
  /** 因被占用 / 无权限而删除失败的条目数 */
  failedCount?: number
  /** 被占用而删除失败的样例路径（最多 5 条），用于界面提示"谁在占用" */
  locked?: string[]
}

export interface StartupItem {
  id: string
  name: string
  command: string
  /** 启动项来源：win=注册表 HKCU/HKLM；mac=launchd；linux=XDG autostart */
  location: 'HKCU' | 'HKLM' | 'launchd' | 'autostart'
  enabled: boolean
}

// ---- 优化能力动态库（DLL：Dynamically Loadable Library）----
// 每个「优化能力」是一个独立可调用的单元，主程序既可通过一键优化批量编排，
// 也可通过 runSingle(id) 单独调用任意一项。ABI 固定为：
//   入 OptContext（执行器 + 提权执行器 + 平台 + 空间测量）
//   出 OptOutcome（状态 + 耗时 + 错误信息 + 实测释放空间）

/** 单项优化执行结果状态 */
export type OptStatus = 'success' | 'failed' | 'skipped'

/** 单项优化的统一返回结构（DLL 的对外 ABI 输出） */
export interface OptOutcome {
  /** 能力 id */
  id: string
  /** 能力名称（便于界面直接展示，无需二次查表） */
  label: string
  status: OptStatus
  /** 执行耗时（ms） */
  durationMs: number
  /** failure 时的错误原因 */
  error?: string
  /** skipped 时的跳过原因 */
  reason?: string
  /** 实测释放的空间（bytes），无法测量时为 undefined */
  releasedBytes?: number
  /** 该项是否需要管理员 / root 权限 */
  needsAdmin?: boolean
  /** 实际执行次数（>1 表示首次失败后自动重试过） */
  attempts?: number
}

/** 优化能力的对外描述（不含实现，供界面列清单） */
export interface OptCapabilityMeta {
  id: string
  label: string
  description: string
  needsAdmin: boolean
  /** 是否默认纳入一键优化（改变系统行为的高危项默认 false） */
  defaultEnabled: boolean
  /** 能力来源：builtin=主程序内置实现；remote=由可独立更新的能力库下发（配方能力） */
  source?: 'builtin' | 'remote'
}

/**
 * 远端能力库**允许覆盖**的内置能力元信息字段。
 *
 * `needsAdmin` 与 `id` / `source` 被**类型层面排除**：提权边界只能由本地代码定义。
 * 若远端能把需要管理员的步骤标成 `needsAdmin: false`，`onekey` 的权限预检会据此放行，
 * 未提权时就会去执行高危操作（失败或逐项弹 UAC），绕开「不轰炸 UAC」的设计。
 * 用类型而非注释来守住这条边界，避免后来者在合并处补一行 `needsAdmin: patch.needsAdmin`。
 */
export type OptCapabilityMetaPatch = Partial<
  Omit<OptCapabilityMeta, 'id' | 'needsAdmin' | 'source'>
>

// ---- 优化能力库（本项目的「DLL」：可独立更新的动态能力库）----
// 设计口径见 electron/services/optlib.ts 头部注释与 electron/services/capabilityFeed.ts。
// 关键安全边界：远端清单**只能编排既有能力**（白名单方法 + 严格参数校验），
// 不能下发任意可执行代码——否则等同于给应用开一个远程代码执行后门。

/** 配方步骤：调用白名单内的某个既有服务方法 */
export interface CapabilityRecipeStep {
  /** 白名单调用标识，如 'toolbox.flushDns' / 'optimizer.cleanupKind' / 'disk.deepCleanup' */
  call: string
  /** 调用参数（按白名单逐字段校验，未声明的字段一律拒绝） */
  args?: Record<string, unknown>
}

/** 远端下发的单个能力定义 */
export interface RemoteCapabilityDef {
  id: string
  label: string
  description: string
  needsAdmin?: boolean
  defaultEnabled?: boolean
  /** 远端可直接下线某个能力（false 时不计入可用清单；内置能力不可被下线到不可用） */
  enabled?: boolean
  /** 最低应用版本要求，低于该版本时忽略此条 */
  minAppVersion?: string
  /** 配方：为空表示仅覆盖同一 id 内置能力的元信息（不可替换其实现） */
  recipe?: CapabilityRecipeStep[]
}

/** 能力库清单（远端 JSON） */
export interface CapabilityManifest {
  /** 清单结构版本，当前只接受 1 */
  schema: number
  /** 能力库版本（语义化版本号，必须单调递增才会被接受） */
  libraryVersion: string
  /** 生成时间（ISO 字符串，可选） */
  generatedAt?: string
  /** 面向的应用版本（仅用于展示，可选） */
  appVersion?: string
  capabilities: RemoteCapabilityDef[]
}

/** 能力库状态（界面展示用） */
export interface CapabilityLibraryState {
  /** 当前生效来源：builtin=内置；remote=远端清单 */
  source: 'builtin' | 'remote'
  /** 当前生效的能力库版本（内置为 '0.0.0'） */
  libraryVersion: string
  /** 远端清单地址 */
  feedUrl: string
  /** 合并后的完整能力清单（内置 + 远端） */
  capabilities: OptCapabilityMeta[]
  /** 来自远端的能力 id 列表 */
  remoteIds: string[]
  /** 远端清单中被本机拒绝的条目及原因（校验失败会明确列出，不静默吞掉） */
  rejected: { id: string; reason: string }[]
  /** 上次检查时间戳，未检查为 null */
  checkedAt: number | null
  /** 上次检查/拉取的错误信息 */
  lastError?: string
  /** 是否检测到可更新的能力库版本 */
  updateAvailable: boolean
  /** 可更新到的版本 */
  availableVersion?: string
}

// ---- DLL（动态链接库）缺失检测与修复 ----
// DLL = Dynamic Link Library：Windows 的代码共享机制，扩展名 .dll。
// 多个程序共用同一份实现（kernel32.dll 等系统 API、VC++ 运行库 msvcp140.dll 等），
// 因此某个公共 DLL 缺失会同时打挂一批程序；本模块负责检出并给出可执行的修复路径。

/** DLL 归属分类 */
export type DllCategory = 'system' | 'runtime' | 'crt' | 'graphics' | 'media' | 'legacy'

/** 单个 DLL 检查项的定义（静态元信息） */
export interface DllCheckItem {
  /** 稳定 id（等于归一化后的文件名，如 vcruntime140） */
  id: string
  /** DLL 文件名 */
  name: string
  category: DllCategory
  /** 这项 DLL 是干什么的 */
  purpose: string
  /** 归属组件 / 来源（系统组件、VC++ 2015-2022 运行库、DirectX 等） */
  origin: string
  /** 缺失后的典型症状（用于界面解释"为什么我会遇到报错"） */
  impact: string
  /** 是否关键项：缺失通常导致大量程序无法启动 */
  critical: boolean
}

/** 单个 DLL 在目标机上的检出结果 */
export interface DllScanItem extends DllCheckItem {
  /** 64 位目录（System32）或 32 位目录（SysWOW64）至少有一份存在 */
  present: boolean
  /** 位数不全：只在其中一个目录存在（32 位程序仍可能报缺失） */
  partial: boolean
  /** 命中的实际文件（含位数与文件版本） */
  paths: { path: string; bits: 32 | 64; version: string }[]
}

/** DLL 缺失扫描结果 */
export interface DllScanResult {
  platform: 'win32' | 'darwin' | 'linux' | 'other'
  /** 当前平台是否支持 DLL 检测（DLL 是 Windows 机制，mac/linux 走共享库 .dylib/.so） */
  supported: boolean
  /** 平台说明（不支持时解释原因，避免用户误以为功能坏了） */
  note: string
  /** 实际扫描的目录（Windows: System32 / SysWOW64） */
  roots: string[]
  items: DllScanItem[]
  /** 完全缺失的 DLL 文件名 */
  missing: string[]
  /** 位数不全的 DLL 文件名 */
  partial: string[]
  total: number
  /** 已安装的 VC++ 运行库版本（注册表检出；空字符串=未检出） */
  vcRedist: { x64: string; x86: string }
  scannedAt: number
}

/** 可执行的修复动作类型 */
export type DllRepairKind = 'sfc' | 'dism-restore' | 'vcredist-x64' | 'vcredist-x86'

/** 修复建议（界面直接渲染为按钮） */
export interface DllRepairAdvice {
  kind: DllRepairKind
  label: string
  description: string
  needsAdmin: boolean
  /** 建议优先级，越小越优先 */
  priority: number
}

/** 修复执行结果 */
export interface DllRepairResult {
  kind: DllRepairKind
  label: string
  /** 命令是否成功执行 */
  ok: boolean
  /** 是否真正完成了修复 */
  repaired: boolean
  summary: string
  /** 原始输出尾部 */
  output: string
  needsAdmin: boolean
  /** 当前平台不支持该修复（诚实降级，未执行任何命令） */
  unsupported: boolean
  /** 无法自动完成时的手动步骤（官方下载链接等） */
  nextSteps: string[]
}

// ---- 一键优化（首页）----

export type OneKeyPhase = 'idle' | 'running' | 'cancelling' | 'done' | 'cancelled'

/** 一键优化实时进度（主进程 → 渲染进程推送） */
export interface OneKeyProgress {
  runId: string
  phase: OneKeyPhase
  /** 本次计划执行的总项数 */
  total: number
  /** 已完成项数（含失败与跳过） */
  completed: number
  /** 正在执行的项 id，空闲时为 null */
  currentId: string | null
  currentLabel: string | null
  /** 已产出的逐项结果 */
  outcomes: OptOutcome[]
  startedAt: number
  /** 结束时间戳，未结束为 null */
  finishedAt: number | null
  /** 累计实测释放空间（bytes） */
  releasedBytes: number
  /** 当前是否以提升权限运行 */
  elevated: boolean
}

/** 一键优化的汇总报告 */
export interface OneKeySummary {
  runId: string
  total: number
  success: number
  failed: number
  skipped: number
  releasedBytes: number
  durationMs: number
  cancelled: boolean
  /** 逐项结果（与 OneKeyProgress.outcomes 同源，供汇总报告/重试持久化） */
  outcomes: OptOutcome[]
  /** 整轮无法启动时的说明（并发守卫拦截 / 无可用项等）；正常为空 */
  error?: string
}

// ---- Disk（磁盘空间 / 深度释放 / 磁盘修复 / 系统文件修复）----
/** 单个卷（分区/挂载点）的空间占用 */
export interface DiskVolume {
  /** 挂载点：Windows 为 "C:"，unix 为 "/" 等 */
  mount: string
  /** 文件系统/卷名（fsSize.fs，如 C:\ 或 /dev/disk1s1） */
  label: string
  /** 文件系统类型（NTFS / ext4 / apfs 等），无为 '' */
  fsType: string
  /** 总容量 bytes */
  sizeBytes: number
  /** 已用 bytes */
  usedBytes: number
  /** 可用 bytes */
  freeBytes: number
  /** 已用百分比 0-100 */
  percent: number
  /** 是否空间不足（已用 ≥90% 或可用 <10GiB） */
  lowSpace: boolean
}

/** 深度清理项类型：path=删除目录内容；action=执行维护命令（如 DISM） */
export type DeepCleanupKind = 'path' | 'action'

/** 深度空间释放项（区别于优化中心的基础清理） */
export interface DeepCleanupPlan {
  id: string
  kind: DeepCleanupKind
  label: string
  /** 说明文字（路径或命令作用） */
  detail: string
  /** 可释放字节数；action 项执行前无法预估为 0 */
  sizeBytes: number
  /** 是否需要管理员/root 权限 */
  needsAdmin: boolean
  /** 是否在安全白名单内（恒为 true，目录由服务端权威清单给出） */
  safe: boolean
  /** 是否默认勾选（改变系统行为的项如关闭休眠默认不勾） */
  defaultChecked: boolean
}

/** 磁盘/系统文件修复结果（chkdsk / diskutil / sfc / dism） */
export interface DiskRepairResult {
  /** 操作目标（盘符 / 挂载点 / 工具名） */
  target: string
  /** 命令是否成功执行（退出码 0） */
  ok: boolean
  /** 是否检测到问题并完成修复 */
  repaired: boolean
  /** 一句话结论 */
  summary: string
  /** 原始输出尾部，供界面展示 */
  output: string
  /** 是否需要管理员/root 权限 */
  needsAdmin: boolean
  /** 当前平台不支持该能力（诚实降级，未执行任何命令） */
  unsupported: boolean
}

/** 系统文件（含 DLL）修复工具：sfc=系统文件检查器；dism-restore=组件存储修复 */
export type SystemRepairKind = 'sfc' | 'dism-restore'

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

/** 应用内自动更新的状态机 */
export type AppUpdateStatus =
  /** 尚未检查过 */
  | 'idle'
  /** 正在检查 */
  | 'checking'
  /** 已是最新 */
  | 'up-to-date'
  /** 有可用更新（已开始/等待下载） */
  | 'available'
  /** 正在下载 */
  | 'downloading'
  /** 下载完成，可立即安装 */
  | 'downloaded'
  /** 当前平台/安装方式不支持应用内自更新（诚实降级） */
  | 'unsupported'
  /** 检查或下载失败 */
  | 'error'

/** 更新包分发方式，决定能否应用内自更新 */
export type UpdatePackageKind = 'nsis' | 'mac-zip' | 'appimage' | 'deb' | 'unknown'

/** 平台自动更新能力探测结果 */
export interface UpdateCapability {
  /** 当前平台+安装方式是否支持应用内自动更新 */
  canAutoUpdate: boolean
  platform: 'win32' | 'darwin' | 'linux' | 'other'
  packageKind: UpdatePackageKind
  /** 不支持的原因与替代更新方式；支持时为 null */
  reason: string | null
}

/** 自动更新偏好 */
export interface AppUpdatePrefs {
  /** 启动后静默检查更新（默认开） */
  autoCheck: boolean
  /** 检测到更新后自动下载（默认开） */
  autoDownload: boolean
  /** 下载完成后退出应用即自动安装（默认开） */
  autoInstallOnQuit: boolean
}

export interface AppUpdateResult {
  /** 状态机当前状态 */
  status: AppUpdateStatus
  /** 可用 / 已下载的版本号（status 为 available / downloading / downloaded 时） */
  version?: string
  /** 当前应用版本 */
  currentVersion?: string
  /** 下载进度百分比 0-100（status === 'downloading'） */
  percent?: number
  /** 已下载字节 */
  transferred?: number
  /** 总字节（未知为 undefined） */
  total?: number
  /** 实时速率 bytes/s */
  bytesPerSecond?: number
  /** 失败原因（status === 'error'） */
  error?: string
  /** status === 'unsupported' 时的原因与替代方案 */
  reason?: string
  /** 平台能力探测结果（随每次返回附带，便于界面直接展示） */
  capability?: UpdateCapability
  /** 是否为后台静默检查（静默检查失败不打扰用户） */
  silent?: boolean
  /** 状态时间戳 */
  at?: number
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
