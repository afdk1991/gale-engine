import type {
  CapabilityLibraryState,
  CapabilityManifest,
  CapabilityRecipeStep,
  DllRepairKind,
  DllRepairResult,
  DllScanResult,
  OptCapabilityMeta,
  OptCapabilityMetaPatch,
  OptOutcome,
  RemoteCapabilityDef
} from '../../shared/types'
import type { OptCapability, OptContext, OptRunResult } from './optlib'
import { aggregateResults, pickDeep } from './optlib'
import type { StorageAdapter } from './settings'

// ─────────────────────────────────────────────────────────────
// 优化能力库的「独立更新」通道
//
// 这正是 DLL 的核心价值——**模块化：替换某个 DLL 即可修复或升级该功能，
// 无需重新编译整个程序**。本项目把它落到「能力库清单」上：
//   主程序内置能力实现 + 远端清单可覆盖元信息、下线能力、并用「配方」编排新能力。
//   于是新增/调整一项优化能力，只需更新清单文件，不必重新发版应用。
//
// ★ 安全边界（必须坚持，否则等于给自己开后门）：
//   远端清单**不能下发可执行代码**。它只能：
//     1. 覆盖内置能力的 label / description / defaultEnabled / needsAdmin；
//     2. 引用白名单内的「既有服务方法」并组成配方（recipe）。
//   参数按白名单逐字段校验，未知调用一律拒绝并如实记录在 rejected 里。
//   若要做真正的代码级热更新，必须先有签名校验 + 沙箱，属于后续里程碑。
//
// 其他防护：schema 版本校验、清单体积上限、条目数上限、版本号只增不减（防降级攻击）。
// ─────────────────────────────────────────────────────────────

/** 默认清单地址（仓库 master 上的清单文件；可用环境变量覆盖以便自建/内网源） */
export const DEFAULT_FEED_URL =
  'https://raw.githubusercontent.com/afdk1991/gale-engine/master/capabilities/manifest.json'

/** 内置能力库的版本标识（远端清单版本必须大于它才会生效） */
export const BUILTIN_LIBRARY_VERSION = '0.0.0'

/** 清单结构版本 */
export const SUPPORTED_SCHEMA = 1

/** 清单体积上限（字节） */
export const MAX_MANIFEST_BYTES = 256 * 1024
/** 单份清单允许的最大能力条目数 */
export const MAX_CAPABILITIES = 200
/** 单个配方允许的最大步骤数 */
export const MAX_RECIPE_STEPS = 8
/** 能力 id 形状：小写字母开头，允许数字与连字符 */
const ID_RE = /^[a-z][a-z0-9-]{2,47}$/
/** 版本号形状：1 / 1.2 / 1.2.3 */
const VERSION_RE = /^\d+(\.\d+){0,2}$/

// ─────────────────────────────────────────────────────────────
// 版本比较
// ─────────────────────────────────────────────────────────────

/** 数值化版本号；非法输入视为 0.0.0 */
export function parseVersion(v: string): number[] {
  if (!VERSION_RE.test(String(v ?? ''))) return [0, 0, 0]
  const parts = String(v).split('.').map((n) => Number(n) || 0)
  while (parts.length < 3) parts.push(0)
  return parts.slice(0, 3)
}

/** 比较两个版本号：a>b 返回 1，a<b 返回 -1，相等返回 0 */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1
  }
  return 0
}

// ─────────────────────────────────────────────────────────────
// 清单校验
// ─────────────────────────────────────────────────────────────

export interface ManifestValidation {
  manifest: CapabilityManifest | null
  /** 整体性错误（有值时 manifest 必为 null） */
  errors: string[]
  /** 被拒绝的单条能力及原因 */
  rejected: { id: string; reason: string }[]
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

function asString(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

/**
 * 读取**必须精确匹配**的短字符串（id / 版本号）。
 *
 * 为什么不能用 asString：它会静默截断。对 id 而言截断会带来两个真问题——
 *   1. 超长 id 被截断后反而通过正则，非法输入被放行；
 *   2. 前 N 位相同的不同 id 会**碰撞成同一条能力**（可被用来覆盖/绕过校验）。
 * 所以这里超长直接判非法。
 */
function takeExact(v: unknown, max: number): { value: string; ok: boolean } {
  if (typeof v !== 'string') return { value: '', ok: false }
  if (v.length > max) return { value: v, ok: false }
  return { value: v, ok: true }
}

/** 校验单条远端能力定义；不合法时返回原因 */
export function validateRemoteCapability(
  raw: unknown,
  builtinIds: Set<string>
): { def: RemoteCapabilityDef | null; reason: string | null } {
  const o = asRecord(raw)
  const idRead = takeExact(o.id, 48)
  if (!idRead.ok) {
    return { def: null, reason: `id 长度非法（上限 48）：${String(o.id ?? '').slice(0, 24)}` }
  }
  const id = idRead.value
  if (!ID_RE.test(id)) return { def: null, reason: `id 不合法：${id || '(空)'}` }

  const label = asString(o.label, 40)
  if (!label) return { def: null, reason: '缺少 label' }

  const recipeRaw = o.recipe
  let recipe: CapabilityRecipeStep[] | undefined

  if (recipeRaw !== undefined) {
    // 内置能力不允许被远端替换实现（只能改元信息），否则远端可劫持高危能力
    if (builtinIds.has(id)) {
      return { def: null, reason: '内置能力的实现不可被远端覆盖（只允许覆盖元信息）' }
    }
    if (!Array.isArray(recipeRaw)) return { def: null, reason: 'recipe 必须是数组' }
    if (recipeRaw.length === 0) return { def: null, reason: 'recipe 不能为空' }
    if (recipeRaw.length > MAX_RECIPE_STEPS) {
      return { def: null, reason: `recipe 步骤过多（上限 ${MAX_RECIPE_STEPS}）` }
    }
    recipe = []
    for (const step of recipeRaw) {
      const s = asRecord(step)
      const call = asString(s.call, 64)
      if (!call) return { def: null, reason: 'recipe 步骤缺少 call' }
      const args = s.args === undefined ? undefined : asRecord(s.args)
      recipe.push(args ? { call, args } : { call })
    }
  }

  const def: RemoteCapabilityDef = { id, label, description: asString(o.description, 200) }
  if (typeof o.needsAdmin === 'boolean') def.needsAdmin = o.needsAdmin
  if (typeof o.defaultEnabled === 'boolean') def.defaultEnabled = o.defaultEnabled
  if (typeof o.enabled === 'boolean') def.enabled = o.enabled
  const minAppRead = takeExact(o.minAppVersion, 16)
  const minAppVersion = minAppRead.value
  if (typeof o.minAppVersion !== 'undefined') {
    if (!minAppRead.ok || !VERSION_RE.test(minAppVersion)) {
      return { def: null, reason: `minAppVersion 格式非法：${String(o.minAppVersion).slice(0, 16)}` }
    }
  }
  if (minAppVersion) def.minAppVersion = minAppVersion
  if (recipe) def.recipe = recipe
  return { def, reason: null }
}

/**
 * 校验整份清单。任一整体性问题都会让清单整体作废（宁可回落内置，也不接受半可信清单）。
 */
export function validateManifest(
  raw: unknown,
  opts: { appVersion: string; builtinIds: Set<string>; rawBytes?: number }
): ManifestValidation {
  const errors: string[] = []
  if (typeof opts.rawBytes === 'number' && opts.rawBytes > MAX_MANIFEST_BYTES) {
    return { manifest: null, errors: [`清单体积超过上限（${opts.rawBytes} > ${MAX_MANIFEST_BYTES} 字节）`], rejected: [] }
  }

  const o = asRecord(raw)
  const schema = Number(o.schema)
  if (schema !== SUPPORTED_SCHEMA) {
    return { manifest: null, errors: [`不支持的清单 schema：${String(o.schema)}（本机支持 ${SUPPORTED_SCHEMA}）`], rejected: [] }
  }

  const verRead = takeExact(o.libraryVersion, 16)
  if (!verRead.ok || !VERSION_RE.test(verRead.value)) {
    return { manifest: null, errors: [`libraryVersion 格式非法：${verRead.value || '(空)'}`], rejected: [] }
  }
  const libraryVersion = verRead.value

  const listRaw = o.capabilities
  if (!Array.isArray(listRaw)) {
    return { manifest: null, errors: ['capabilities 必须是数组'], rejected: [] }
  }
  if (listRaw.length > MAX_CAPABILITIES) {
    return { manifest: null, errors: [`能力条目过多（${listRaw.length} > ${MAX_CAPABILITIES}）`], rejected: [] }
  }

  const capabilities: RemoteCapabilityDef[] = []
  const rejected: { id: string; reason: string }[] = []
  const seen = new Set<string>()

  for (const raw of listRaw) {
    const { def, reason } = validateRemoteCapability(raw, opts.builtinIds)
    const rawId = asString(asRecord(raw).id, 48) || '(空)'
    if (!def) {
      rejected.push({ id: rawId, reason: reason ?? '校验失败' })
      continue
    }
    if (seen.has(def.id)) {
      rejected.push({ id: def.id, reason: 'id 重复' })
      continue
    }
    if (def.minAppVersion && compareVersions(opts.appVersion, def.minAppVersion) < 0) {
      rejected.push({ id: def.id, reason: `要求应用版本 ≥ ${def.minAppVersion}，当前 ${opts.appVersion}` })
      continue
    }
    seen.add(def.id)
    capabilities.push(def)
  }

  if (capabilities.length === 0 && rejected.length > 0) {
    errors.push('清单中没有任何可用条目')
  }

  return {
    manifest: { schema: SUPPORTED_SCHEMA, libraryVersion, capabilities, generatedAt: asString(o.generatedAt, 40) || undefined },
    errors,
    rejected
  }
}

// ─────────────────────────────────────────────────────────────
// 配方运行时（白名单调用表）
// ─────────────────────────────────────────────────────────────

/** 配方可调用的白名单方法 */
export interface RecipeCall {
  /** 该调用是否需要管理员权限（供一键优化预检、避免逐项弹 UAC） */
  needsAdmin: boolean
  run(ctx: OptContext, args: Record<string, unknown>): Promise<OptRunResult>
}

export interface RecipeRuntimeDeps {
  /** DLL 能力不在 OptContext 里，单独注入 */
  dll?: {
    scan(): Promise<DllScanResult>
    repair(kind: DllRepairKind): Promise<DllRepairResult>
  }
}

const CLEANUP_KINDS = ['temp', 'recycle', 'browser']
const SYSTEM_REPAIR_KINDS = ['sfc', 'dism-restore']
const DLL_REPAIR_KINDS: DllRepairKind[] = ['sfc', 'dism-restore', 'vcredist-x64', 'vcredist-x86']

function badArgs(msg: string): OptRunResult {
  return { status: 'failed', error: `配方参数非法：${msg}` }
}

/**
 * 白名单调用表。这里是**唯一**的"能力边界"：
 * 远端清单只能引用这张表里的方法名，参数也在各方法内逐字段校验。
 */
export function createRecipeRuntime(deps: RecipeRuntimeDeps = {}): Record<string, RecipeCall> {
  return {
    'optimizer.cleanupKind': {
      needsAdmin: false,
      async run(ctx, args) {
        const kind = String(args.kind ?? '')
        if (!CLEANUP_KINDS.includes(kind)) return badArgs(`kind 必须是 ${CLEANUP_KINDS.join('/')}`)
        const plans = await ctx.normal.optimizer.scanCleanup()
        const items = plans
          .filter((p) => p.kind === kind && p.safe)
          .map((p) => ({ id: p.id, path: p.path, kind: p.kind }))
        if (items.length === 0) return { status: 'skipped', reason: '未扫描到该类项目' }
        return aggregateResults(await ctx.normal.optimizer.runCleanup(items))
      }
    },
    'disk.deepCleanup': {
      needsAdmin: false,
      async run(ctx, args) {
        const ids = Array.isArray(args.ids) ? args.ids.map(String).slice(0, 32) : []
        if (ids.length === 0) return badArgs('ids 必须是非空字符串数组')
        const plans = await ctx.normal.disk.scanDeepCleanup()
        // id 由服务端权威清单解析，远端给不出任意路径，因此这里安全
        const wanted = pickDeep(plans, ids)
        if (wanted.length === 0) return { status: 'skipped', reason: '当前系统无此清理项' }
        return aggregateResults(
          await ctx.normal.disk.runDeepCleanup(wanted.map((p) => p.id))
        )
      }
    },
    'toolbox.flushDns': {
      needsAdmin: false,
      async run(ctx) {
        const r = await ctx.normal.toolbox.flushDns()
        return r.ok ? { status: 'success' } : { status: 'failed', error: r.message }
      }
    },
    'toolbox.emptyRecycleBin': {
      needsAdmin: false,
      async run(ctx) {
        const r = await ctx.normal.toolbox.emptyRecycleBin()
        return r.ok ? { status: 'success' } : { status: 'failed', error: r.message }
      }
    },
    'toolbox.clearClipboard': {
      needsAdmin: false,
      async run(ctx) {
        const r = await ctx.normal.toolbox.clearClipboard()
        return r.ok ? { status: 'success' } : { status: 'failed', error: r.message }
      }
    },
    'disk.repairSystemFiles': {
      needsAdmin: true,
      async run(ctx, args) {
        const kind = String(args.kind ?? 'sfc')
        if (!SYSTEM_REPAIR_KINDS.includes(kind)) return badArgs('kind 必须是 sfc/dism-restore')
        const r = await ctx.admin.disk.repairSystemFiles(kind as 'sfc' | 'dism-restore')
        return r.ok
          ? { status: 'success' }
          : { status: 'failed', error: r.summary || '系统文件修复失败（可能需要管理员权限）' }
      }
    },
    'dll.scan': {
      needsAdmin: false,
      async run() {
        if (!deps.dll) return { status: 'skipped', reason: '当前环境未接入 DLL 检测能力' }
        const r = await deps.dll.scan()
        if (!r.supported) return { status: 'skipped', reason: r.note }
        const bad = r.missing.length + r.partial.length
        if (bad === 0) return { status: 'success' }
        return {
          status: 'failed',
          error: `检出 ${r.missing.length} 项缺失、${r.partial.length} 项位数不全，建议前往「DLL 修复」页处理`
        }
      }
    },
    'dll.repairMissing': {
      needsAdmin: true,
      async run(_ctx, args) {
        if (!deps.dll) return { status: 'skipped', reason: '当前环境未接入 DLL 修复能力' }
        const kinds = Array.isArray(args.kinds) ? args.kinds.map(String) : []
        const chosen = kinds.filter((k): k is DllRepairKind => DLL_REPAIR_KINDS.includes(k as DllRepairKind))
        if (chosen.length === 0) return badArgs(`kinds 必须是 ${DLL_REPAIR_KINDS.join('/')} 的子集`)
        const results: OptOutcome[] = []
        for (const k of chosen) {
          const r = await deps.dll.repair(k)
          results.push({ id: k, label: r.label, status: r.ok ? 'success' : 'failed', durationMs: 0, error: r.ok ? undefined : r.summary })
        }
        return aggregateResults(
          results.map((o) => ({ id: o.id, ok: o.status === 'success', error: o.error }))
        )
      }
    }
  }
}

/** 白名单调用名清单（供清单文档与校验使用） */
export function listRecipeCalls(): string[] {
  return Object.keys(createRecipeRuntime())
}

/**
 * 把远端定义编译为可直接注册进能力库的能力对象。
 * - id 命中内置 → 仅覆盖元信息（实现不变）；
 * - 新 id + 合法 recipe → 生成配方能力；
 * - recipe 里出现未知调用 → 整条拒绝（不静默丢弃某一步，避免"半截能力"）。
 */
export function compileRemoteCapabilities(
  defs: RemoteCapabilityDef[],
  runtime: Record<string, RecipeCall>
): { capabilities: OptCapability[]; rejected: { id: string; reason: string }[] } {
  const capabilities: OptCapability[] = []
  const rejected: { id: string; reason: string }[] = []

  for (const def of defs) {
    if (def.enabled === false) {
      rejected.push({ id: def.id, reason: '清单中标记为 enabled=false（已下线）' })
      continue
    }
    if (!def.recipe || def.recipe.length === 0) {
      // 只覆盖元信息：由调用方与内置能力合并（此处不产出实现，避免覆盖内置实现）
      continue
    }

    const steps: { call: string; impl: RecipeCall; args: Record<string, unknown> }[] = []
    let invalid = ''
    for (const s of def.recipe) {
      const impl = runtime[s.call]
      if (!impl) {
        invalid = `引用了白名单外的调用：${s.call}`
        break
      }
      steps.push({ call: s.call, impl, args: s.args ?? {} })
    }
    if (invalid) {
      rejected.push({ id: def.id, reason: invalid })
      continue
    }

    const needsAdmin = steps.some((s) => s.impl.needsAdmin)
    capabilities.push({
      meta: {
        id: def.id,
        label: def.label,
        description: def.description || '由可独立更新的能力库下发',
        // 同上：脚本实现已声明 needsAdmin 时，远端清单不得把它放宽为 false
        needsAdmin: needsAdmin || def.needsAdmin === true,
        defaultEnabled: def.defaultEnabled === true,
        source: 'remote'
      },
      async run(ctx: OptContext): Promise<OptRunResult> {
        let released = 0
        const errors: string[] = []
        for (const s of steps) {
          const r = await s.impl.run(ctx, s.args)
          released += r.releasedBytes ?? 0
          if (r.status === 'failed') errors.push(`${s.call}: ${r.error ?? '失败'}`)
        }
        if (errors.length > 0) return { status: 'failed', error: errors.join('；'), releasedBytes: released }
        return { status: 'success', releasedBytes: released }
      }
    })
  }

  return { capabilities, rejected }
}

/** 清单拉取超时（毫秒）：能力库更新是后台行为，不能拖住启动 */
export const FEED_TIMEOUT_MS = 10_000

/**
 * 生产环境的清单拉取器：带超时与体积上限。
 * 体积上限在这里就卡住，避免超大响应体先把内存吃掉再被 validateManifest 拒绝。
 */
export function createHttpManifestFetcher(
  url: string,
  opts: { timeoutMs?: number } = {}
): () => Promise<string> {
  const timeoutMs = opts.timeoutMs ?? FEED_TIMEOUT_MS
  return async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { accept: 'application/json' }
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const text = await res.text()
      if (text.length > MAX_MANIFEST_BYTES) {
        throw new Error(`清单体积超限（${text.length} > ${MAX_MANIFEST_BYTES} 字节）`)
      }
      return text
    } finally {
      clearTimeout(timer)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 清单的本地缓存（持久化）
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'capabilityLibrary'

interface CachedManifest {
  libraryVersion: string
  manifest: CapabilityManifest
  appliedAt: number
}

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

export interface CapabilityFeedDeps {
  /** 拉取清单文本（生产环境走 HTTP，测试注入内存实现） */
  fetchManifest: () => Promise<string>
  storage: StorageAdapter
  /** 当前应用版本（用于 minAppVersion 判断） */
  appVersion: string
  /** 内置能力元信息（用于合并与覆盖） */
  builtinMetas: () => OptCapabilityMeta[]
  /** 白名单运行时；默认自动构建 */
  runtime?: Record<string, RecipeCall>
  dll?: RecipeRuntimeDeps['dll']
  feedUrl?: string
  now?: () => number
}

export interface CapabilityFeedService {
  /** 当前能力库状态（含合并后的完整清单） */
  state(): CapabilityLibraryState
  /** 检查远端是否有更新（只拉取校验，不落盘生效） */
  check(): Promise<CapabilityLibraryState>
  /** 把已检查通过的新版本落盘生效 */
  apply(): Promise<CapabilityLibraryState>
  /** 回退到内置能力库 */
  reset(): CapabilityLibraryState
  /** 供 optlib 注册的远端能力（含配方能力与内置元信息覆盖） */
  externalCapabilities(): OptCapability[]
  /** 远端下发的元信息覆盖表（id → patch）；不含 needsAdmin，见 OptCapabilityMetaPatch */
  metaOverrides(): Map<string, OptCapabilityMetaPatch>
}

export function createCapabilityFeedService(deps: CapabilityFeedDeps): CapabilityFeedService {
  const now = deps.now ?? (() => Date.now())
  const feedUrl = deps.feedUrl ?? DEFAULT_FEED_URL
  const runtime = deps.runtime ?? createRecipeRuntime({ dll: deps.dll })

  let pending: CapabilityManifest | null = null
  let pendingRejected: { id: string; reason: string }[] = []
  let lastError: string | undefined
  let checkedAt: number | null = null
  let availableVersion: string | undefined

  const builtinIds = new Set(deps.builtinMetas().map((m) => m.id))

  /** 从持久化存储读出已生效清单 */
  const loadCached = (): CachedManifest | null => {
    const raw = deps.storage.get<CachedManifest | null>(STORAGE_KEY, null)
    if (!raw || typeof raw !== 'object') return null
    const v = String((raw as CachedManifest).libraryVersion ?? '')
    if (!VERSION_RE.test(v)) return null
    const manifest = (raw as CachedManifest).manifest
    if (!manifest || manifest.schema !== SUPPORTED_SCHEMA) return null
    return raw as CachedManifest
  }

  /** 合并内置元信息与远端覆盖 → 完整能力清单 */
  const mergedMetas = (active: CachedManifest | null): {
    metas: OptCapabilityMeta[]
    remoteIds: string[]
    rejected: { id: string; reason: string }[]
  } => {
    const defs = active?.manifest.capabilities ?? []
    const overrides = new Map<string, RemoteCapabilityDef>()
    for (const d of defs) overrides.set(d.id, d)

    const metas: OptCapabilityMeta[] = deps.builtinMetas().map((m) => {
      const o = overrides.get(m.id)
      if (!o) return { ...m, source: m.source ?? 'builtin' }
      return {
        ...m,
        label: o.label || m.label,
        description: o.description || m.description,
        defaultEnabled: typeof o.defaultEnabled === 'boolean' ? o.defaultEnabled : m.defaultEnabled,
        // needsAdmin **只许收紧、不许放宽**：内置能力已声明需要管理员时，
        // 远端不得把它改成 false —— 否则未提权环境下会照样执行高危步骤（失败或弹 UAC），
        // 绕开了 optlib 刻意守住的提权边界。
        needsAdmin: m.needsAdmin || o.needsAdmin === true,
        source: 'builtin'
      }
    })

    const { capabilities, rejected } = compileRemoteCapabilities(
      defs.filter((d) => !builtinIds.has(d.id)),
      runtime
    )
    for (const c of capabilities) metas.push(c.meta)

    const remoteIds = [
      ...defs.filter((d) => builtinIds.has(d.id)).map((d) => d.id),
      ...capabilities.map((c) => c.meta.id)
    ]

    return { metas, remoteIds, rejected }
  }

  const state = (): CapabilityLibraryState => {
    const active = loadCached()
    const { metas, remoteIds, rejected } = mergedMetas(active)
    return {
      source: active ? 'remote' : 'builtin',
      libraryVersion: active?.libraryVersion ?? BUILTIN_LIBRARY_VERSION,
      feedUrl,
      capabilities: metas,
      remoteIds,
      rejected: active ? rejected : pendingRejected,
      checkedAt,
      lastError,
      updateAvailable: availableVersion !== undefined,
      availableVersion
    }
  }

  const check = async (): Promise<CapabilityLibraryState> => {
    checkedAt = now()
    lastError = undefined
    availableVersion = undefined
    pending = null
    pendingRejected = []

    let text = ''
    try {
      text = await deps.fetchManifest()
    } catch (error) {
      lastError = `拉取能力库清单失败：${error instanceof Error ? error.message : String(error)}`
      return state()
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      lastError = '能力库清单不是合法 JSON'
      return state()
    }

    const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length
    const { manifest, errors, rejected } = validateManifest(parsed, {
      appVersion: deps.appVersion,
      builtinIds,
      rawBytes: bytes
    })
    pendingRejected = rejected

    if (!manifest || errors.length > 0) {
      lastError = errors.join('；') || '清单校验未通过'
      return state()
    }

    const active = loadCached()
    const currentVersion = active?.libraryVersion ?? BUILTIN_LIBRARY_VERSION
    // 只增不减：防止用旧清单覆盖新能力（也避免被降级到有缺陷的版本）
    if (compareVersions(manifest.libraryVersion, currentVersion) > 0) {
      pending = manifest
      availableVersion = manifest.libraryVersion
    } else {
      lastError = undefined
    }

    return state()
  }

  const apply = async (): Promise<CapabilityLibraryState> => {
    if (!pending) {
      lastError = lastError ?? '没有可应用的能力库更新，请先检查更新'
      return state()
    }
    const record: CachedManifest = {
      libraryVersion: pending.libraryVersion,
      manifest: pending,
      appliedAt: now()
    }
    deps.storage.set(STORAGE_KEY, record)
    pending = null
    availableVersion = undefined
    return state()
  }

  const reset = (): CapabilityLibraryState => {
    deps.storage.set(STORAGE_KEY, null)
    pending = null
    availableVersion = undefined
    pendingRejected = []
    lastError = undefined
    return state()
  }

  const externalCapabilities = (): OptCapability[] => {
    const active = loadCached()
    const defs = (active?.manifest.capabilities ?? []).filter((d) => !builtinIds.has(d.id))
    const { capabilities } = compileRemoteCapabilities(defs, runtime)
    return capabilities
  }

  const metaOverrides = (): Map<string, OptCapabilityMetaPatch> => {
    const active = loadCached()
    const map = new Map<string, OptCapabilityMetaPatch>()
    for (const d of active?.manifest.capabilities ?? []) {
      if (!builtinIds.has(d.id)) continue
      // 不下发 needsAdmin：optlib 侧本就不接受该字段的覆盖（提权边界只能由本地代码定义），
      // 继续下发只会成为「看起来生效、实际被忽略」的死数据，诱使后来者在合并处接上它。
      // 类型 OptCapabilityMetaPatch 已在编译期排除该字段。
      map.set(d.id, {
        label: d.label,
        description: d.description,
        defaultEnabled: d.defaultEnabled
      })
    }
    return map
  }

  return { state, check, apply, reset, externalCapabilities, metaOverrides }
}
