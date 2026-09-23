import type {
  CleanupPlan,
  CleanupResult,
  DeepCleanupPlan,
  OptCapabilityMeta,
  OptCapabilityMetaPatch,
  OptOutcome,
  OptStatus
} from '../../shared/types'
import type { Platform } from './shell'
import { detectPlatform } from './shell'
import { createDiskService } from './disk'
import { createOptimizerService } from './optimizer'
import { createToolboxService } from './toolbox'

// ─────────────────────────────────────────────────────────────
// 优化能力动态库（DLL = Dynamically Loadable Library）
//
// 目标：把每一项优化能力封装成「独立可调用单元」，主程序既能一键批量编排，
// 也能通过 runSingle(id) 单独调用任意一项。
//
// 关于「DLL」的实现口径（重要）：
//   本库是**动态可装载能力库**——注册表 + 稳定 ABI，运行期按需装载。
//   之所以不产出 Windows 原生 .dll：
//     1. 本项目是 Win/macOS/Linux 跨平台应用，原生 .dll 只在 Windows 可用，
//        与既有 PAL（shell.ts 的平台分发）架构直接冲突；
//     2. 原生模块需 node-gyp + MSVC 工具链参与 CI 六矩阵构建，且要为每个平台
//        维护 .dll/.dylib/.so 三套产物与 N-API 版本矩阵。
//   但 ABI 是按「可替换为原生后端」设计的：输入只有 OptContext，输出只有
//   OptOutcome（纯 JSON 结构）。若将来要接入原生 .dll，只需让某个 capability
//   的 run() 内部改为调用 N-API 绑定，调用方一行都不用改。
// ─────────────────────────────────────────────────────────────

export type OptimizerService = ReturnType<typeof createOptimizerService>
export type DiskService = ReturnType<typeof createDiskService>
export type ToolboxService = ReturnType<typeof createToolboxService>

/** 一组按权限级别划分的服务实例 */
export interface OptServiceSet {
  optimizer: OptimizerService
  disk: DiskService
  toolbox: ToolboxService
}

/** 跨能力共享的扫描缓存：一键优化里避免每项都重新扫一遍（扫描很慢） */
export interface OptCache {
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T): void
}

export function createOptCache(): OptCache {
  const m = new Map<string, unknown>()
  return {
    get: <T,>(key: string) => m.get(key) as T | undefined,
    set: <T,>(key: string, value: T) => {
      m.set(key, value)
    }
  }
}

/** 能力执行上下文（ABI 输入） */
export interface OptContext {
  platform: Platform
  /** 当前进程权限下的服务集 */
  normal: OptServiceSet
  /** 提权服务集（内部执行器走 UAC / pkexec） */
  admin: OptServiceSet
  /** 当前是否已提权 */
  isElevated(): Promise<boolean>
  cache: OptCache
}

/** 能力的原始返回（id / label / 耗时由动态库统一补齐） */
export interface OptRunResult {
  status: OptStatus
  error?: string
  reason?: string
  releasedBytes?: number
}

export interface OptCapability {
  meta: OptCapabilityMeta
  run(ctx: OptContext): Promise<OptRunResult>
}

export interface OptLibrary {
  /** 列出全部可用能力（供界面勾选） */
  listCapabilities(): OptCapabilityMeta[]
  /** 独立调用单项能力（主程序可按需调用任意一个） */
  runSingle(id: string): Promise<OptOutcome>
  /** 创建一个共享上下文（一键优化复用同一份扫描缓存） */
  createContext(): OptContext
  /** 在指定上下文内执行单项 */
  runInContext(ctx: OptContext, id: string): Promise<OptOutcome>
}

export interface OptLibraryDeps {
  normal: OptServiceSet
  admin: OptServiceSet
  isElevated: () => Promise<boolean>
  platform?: Platform
  /**
   * 由「可独立更新的能力库」下发的附加能力（配方能力）。
   * 每次取用时实时求值，因此远端清单生效后无需重启应用即可用上新能力。
   */
  externalCapabilities?: () => OptCapability[]
  /**
   * 远端对内置能力的元信息覆盖。
   * 只能改 label / description / defaultEnabled —— 不能替换实现，也不能改 needsAdmin
   * （类型 OptCapabilityMetaPatch 已在编译期排除 needsAdmin 与 id/source）。
   */
  metaOverrides?: () => Map<string, OptCapabilityMetaPatch>
}

// ─────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────

async function cached<T>(ctx: OptContext, key: string, load: () => Promise<T>): Promise<T> {
  const hit = ctx.cache.get<T>(key)
  if (hit !== undefined) return hit
  const value = await load()
  ctx.cache.set(key, value)
  return value
}

/** 把多项 CleanupResult 聚合为单个能力结果 */
export function aggregateResults(results: CleanupResult[]): OptRunResult {
  if (results.length === 0) return { status: 'skipped', reason: '当前系统无可清理项' }
  const released = results.reduce((sum, r) => sum + (r.releasedBytes ?? 0), 0)
  const failed = results.filter((r) => !r.ok)
  const out: OptRunResult = { status: 'success', releasedBytes: released }
  if (failed.length > 0) {
    out.status = 'failed'
    out.error =
      failed
        .map((r) => r.error)
        .filter(Boolean)
        .join('；') || `${failed.length} 项执行失败`
  }
  return out
}

/** 执行优化中心（基础清理）里某一类项目 */
async function runCleanupKind(ctx: OptContext, kind: CleanupPlan['kind']): Promise<OptRunResult> {
  const plans = await cached(ctx, 'cleanup-plans', () => ctx.normal.optimizer.scanCleanup())
  // H3：runCleanup 现在只收 id，路径由服务端按 id 权威解析（这里的 id 来自本地权威扫描，可信）
  const ids = plans.filter((p) => p.kind === kind && p.safe).map((p) => p.id)
  if (ids.length === 0) return { status: 'skipped', reason: '未扫描到该类项目' }
  const results = await ctx.normal.optimizer.runCleanup(ids)
  return aggregateResults(results)
}

/** 执行磁盘深度清理里指定的一组 id（id 由服务端权威清单给出，客户端无法注入路径） */
async function runDeepIds(ctx: OptContext, ids: string[], needsAdmin: boolean): Promise<OptRunResult> {
  const set = needsAdmin ? ctx.admin : ctx.normal
  const plans = await cached(ctx, `deep-plans-${needsAdmin ? 'admin' : 'normal'}`, () =>
    set.disk.scanDeepCleanup()
  )
  const wanted = pickDeep(plans, ids)
  if (wanted.length === 0) return { status: 'skipped', reason: '当前系统无此清理项' }
  const results = await set.disk.runDeepCleanup(wanted.map((p) => p.id))
  return aggregateResults(results)
}

export function pickDeep(plans: DeepCleanupPlan[], ids: string[]): DeepCleanupPlan[] {
  return plans.filter((p) => ids.includes(p.id) && p.safe)
}

// ─────────────────────────────────────────────────────────────
// 能力注册表
// ─────────────────────────────────────────────────────────────

function cap(opts: {
  id: string
  label: string
  description: string
  needsAdmin?: boolean
  defaultEnabled?: boolean
  run: (ctx: OptContext) => Promise<OptRunResult>
}): OptCapability {
  return {
    meta: {
      id: opts.id,
      label: opts.label,
      description: opts.description,
      needsAdmin: opts.needsAdmin === true,
      defaultEnabled: opts.defaultEnabled !== false
    },
    run: opts.run
  }
}

export function buildCapabilityRegistry(): OptCapability[] {
  return [
    cap({
      id: 'clean-temp',
      label: '清理临时文件',
      description: '清空当前用户与系统临时目录（仅安全白名单路径）',
      run: (ctx) => runCleanupKind(ctx, 'temp')
    }),
    cap({
      id: 'clean-recycle',
      label: '清空回收站',
      description: '逐个卷清空回收站，真正释放 $Recycle.Bin 占用的空间',
      run: (ctx) => runCleanupKind(ctx, 'recycle')
    }),
    cap({
      id: 'clean-browser',
      label: '清理浏览器缓存',
      description: '清理 Chrome / Edge 的 Cache 与 Code Cache',
      run: (ctx) => runCleanupKind(ctx, 'browser')
    }),
    cap({
      id: 'deep-system-cache',
      label: '清理系统缓存',
      description: '系统临时文件、缩略图缓存、错误报告队列、预读取文件',
      run: (ctx) =>
        runDeepIds(ctx, ['win-system-temp', 'win-thumbnail', 'win-wer', 'win-prefetch'], false)
    }),
    cap({
      id: 'deep-user-cache',
      label: '清理用户缓存',
      description: 'macOS ~/Library/Caches 与 Logs；Linux ~/.cache',
      run: (ctx) => runDeepIds(ctx, ['mac-user-cache', 'mac-user-logs', 'linux-user-cache'], false)
    }),
    cap({
      id: 'deep-update-cache',
      label: '清理系统更新缓存',
      description: 'Windows 更新下载缓存 SoftwareDistribution\\Download',
      needsAdmin: true,
      run: (ctx) => runDeepIds(ctx, ['win-update-cache'], true)
    }),
    cap({
      id: 'net-flush-dns',
      label: '刷新 DNS 缓存',
      description: '清除本机 DNS 解析缓存，解决域名解析异常',
      run: async (ctx) => {
        const r = await ctx.normal.toolbox.flushDns()
        return r.ok ? { status: 'success' } : { status: 'failed', error: r.message }
      }
    }),
    cap({
      id: 'deep-component-store',
      label: '组件存储清理（WinSxS）',
      description: 'DISM StartComponentCleanup，清理旧组件版本（耗时数分钟）',
      needsAdmin: true,
      defaultEnabled: false, // 耗时很长，默认不纳入一键优化
      run: (ctx) => runDeepIds(ctx, ['win-dism-cleanup'], true)
    }),
    cap({
      id: 'repair-system-files',
      label: '系统文件与 DLL 修复',
      description: 'sfc /scannow 扫描并修复损坏的系统文件（耗时较长）',
      needsAdmin: true,
      defaultEnabled: false,
      run: async (ctx) => {
        const r = await ctx.admin.disk.repairSystemFiles('sfc')
        return r.ok
          ? { status: 'success' }
          : { status: 'failed', error: r.summary || '系统文件修复失败（可能需要管理员权限）' }
      }
    })
  ]
}

// ─────────────────────────────────────────────────────────────
// 动态库工厂
// ─────────────────────────────────────────────────────────────

export function createOptLibrary(deps: OptLibraryDeps): OptLibrary {
  const platform = deps.platform ?? detectPlatform()

  /**
   * 每次调用实时组装注册表，使远端下发的附加能力「生效即用」，无需重启应用。
   *
   * 安全边界（重要）：内置能力**不可被远端覆盖实现**。
   *   - 远端能力 id 若与内置能力重名 → 直接忽略该远端项（内置实现优先）；
   *   - 远端只能通过 metaOverrides 修改内置项的展示文案与默认勾选，
   *     且 needsAdmin 不允许被改（提权边界不能由远端放宽）。
   */
  const resolveRegistry = (): Map<string, OptCapability> => {
    const reg = new Map<string, OptCapability>()
    for (const c of buildCapabilityRegistry()) reg.set(c.meta.id, c)

    const overrides = deps.metaOverrides?.()
    if (overrides && overrides.size > 0) {
      for (const [id, patch] of overrides) {
        const base = reg.get(id)
        if (!base) continue // 不能给不存在的能力凭空加元信息
        reg.set(id, {
          meta: {
            ...base.meta,
            label: typeof patch.label === 'string' && patch.label ? patch.label : base.meta.label,
            description:
              typeof patch.description === 'string' && patch.description
                ? patch.description
                : base.meta.description,
            defaultEnabled:
              typeof patch.defaultEnabled === 'boolean'
                ? patch.defaultEnabled
                : base.meta.defaultEnabled
            // needsAdmin 有意不参与覆盖：提权边界只能由本地代码定义
          },
          run: base.run
        })
      }
    }

    for (const c of deps.externalCapabilities?.() ?? []) {
      const id = String(c?.meta?.id ?? '')
      if (!id || reg.has(id)) continue // 重名一律拒绝，内置实现优先
      reg.set(id, c)
    }
    return reg
  }

  const createContext = (): OptContext => ({
    platform,
    normal: deps.normal,
    admin: deps.admin,
    isElevated: deps.isElevated,
    cache: createOptCache()
  })

  const runInContext = async (ctx: OptContext, id: string): Promise<OptOutcome> => {
    const key = String(id ?? '')
    const c = resolveRegistry().get(key)
    if (!c) {
      return {
        id: key,
        label: key || '未知项',
        status: 'failed',
        durationMs: 0,
        error: `未知优化项：${key}`
      }
    }
    const started = Date.now()
    try {
      const r = await c.run(ctx)
      return {
        id: c.meta.id,
        label: c.meta.label,
        needsAdmin: c.meta.needsAdmin,
        durationMs: Date.now() - started,
        ...r
      }
    } catch (error) {
      return {
        id: c.meta.id,
        label: c.meta.label,
        needsAdmin: c.meta.needsAdmin,
        status: 'failed',
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  return {
    listCapabilities: () =>
      [...resolveRegistry().values()].map((c) => ({
        ...c.meta,
        source: c.meta.source ?? 'builtin'
      })),
    runSingle: (id) => runInContext(createContext(), id),
    createContext,
    runInContext
  }
}
