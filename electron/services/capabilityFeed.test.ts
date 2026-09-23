import { describe, it, expect } from 'vitest'
import type { CapabilityManifest, OptCapabilityMeta } from '../../shared/types'
import {
  BUILTIN_LIBRARY_VERSION,
  MAX_CAPABILITIES,
  MAX_MANIFEST_BYTES,
  compileRemoteCapabilities,
  compareVersions,
  createCapabilityFeedService,
  createRecipeRuntime,
  listRecipeCalls,
  parseVersion,
  validateManifest,
  validateRemoteCapability,
  type CapabilityFeedService
} from './capabilityFeed'
import { buildCapabilityRegistry } from './optlib'
import type { StorageAdapter } from './settings'

// ── 测试替身 ──────────────────────────────────────────────────

function memoryStorage(seed: Record<string, unknown> = {}): StorageAdapter {
  const m = new Map<string, unknown>(Object.entries(seed))
  return {
    get: <T,>(key: string, fallback: T) => (m.has(key) ? (m.get(key) as T) : fallback),
    set: (key, value) => {
      m.set(key, value)
    }
  }
}

const BUILTIN_METAS: OptCapabilityMeta[] = buildCapabilityRegistry().map((c) => c.meta)
const BUILTIN_IDS = new Set(BUILTIN_METAS.map((m) => m.id))

function makeFeed(opts: {
  manifest?: string | (() => Promise<string>)
  storage?: StorageAdapter
  appVersion?: string
  runtime?: ReturnType<typeof createRecipeRuntime>
  now?: () => number
} = {}): CapabilityFeedService {
  const fetchManifest: () => Promise<string> =
    typeof opts.manifest === 'function'
      ? opts.manifest
      : async () => (typeof opts.manifest === 'string' ? opts.manifest : '')
  return createCapabilityFeedService({
    fetchManifest,
    storage: opts.storage ?? memoryStorage(),
    appVersion: opts.appVersion ?? '1.0.0',
    builtinMetas: () => BUILTIN_METAS,
    runtime: opts.runtime ?? createRecipeRuntime(),
    now: opts.now
  })
}

function manifestJson(over: Partial<CapabilityManifest> = {}): string {
  const base: CapabilityManifest = {
    schema: 1,
    libraryVersion: '0.1.0',
    capabilities: [
      { id: 'meta-daily', label: '日常清理', description: 'd', recipe: [{ call: 'toolbox.flushDns' }] }
    ]
  }
  return JSON.stringify({ ...base, ...over })
}

// ── 版本比较 ──────────────────────────────────────────────────

describe('parseVersion / compareVersions', () => {
  it('非法版本视作 0.0.0', () => {
    expect(parseVersion('abc')).toEqual([0, 0, 0])
    expect(parseVersion('')).toEqual([0, 0, 0])
    expect(parseVersion('1.2.3.4')).toEqual([0, 0, 0]) // 超过三段不接受
  })
  it('短版本补零后比较', () => {
    expect(parseVersion('1.2')).toEqual([1, 2, 0])
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })
  it('按数值而非字典序比较', () => {
    expect(compareVersions('0.0.10', '0.0.9')).toBe(1)
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1)
  })
})

// ── 单条校验 ──────────────────────────────────────────────────

describe('validateRemoteCapability', () => {
  it('合法条目通过', () => {
    const { def, reason } = validateRemoteCapability(
      { id: 'meta-thing', label: '名称', description: '说明' },
      BUILTIN_IDS
    )
    expect(reason).toBeNull()
    expect(def?.id).toBe('meta-thing')
  })
  it('id 必须是小写连字符形状', () => {
    for (const bad of ['', 'A', 'ab', 'has space', '9start', 'UPPER', 'x'.repeat(49)]) {
      expect(validateRemoteCapability({ id: bad, label: 'x' }, BUILTIN_IDS).def).toBeNull()
    }
  })

  // ★ 回归：超长 id 曾被静默截断后放行，且前 N 位相同的 id 会碰撞成同一条能力
  it('超长 id 不被截断放行（截断会导致 id 碰撞）', () => {
    const long = 'a' + 'b'.repeat(60)
    const { reason } = validateRemoteCapability({ id: long, label: 'x' }, BUILTIN_IDS)
    expect(reason).toContain('长度非法')
  })

  it('前 48 位相同的两个 id 不会碰撞（第二个被拒）', () => {
    const head = 'a' + 'b'.repeat(46) // 共 47 字符，合法
    const a = validateRemoteCapability({ id: head, label: 'x' }, BUILTIN_IDS)
    const b = validateRemoteCapability({ id: `${head}-tail`, label: 'y' }, BUILTIN_IDS)
    expect(a.def?.id).toBe(head)
    expect(b.def).toBeNull()
  })

  it('libraryVersion 超长被拒而不是截断成合法版本', () => {
    const r = validateManifest(
      { schema: 1, libraryVersion: '1.0.0' + '0'.repeat(20), capabilities: [] },
      { appVersion: '1.0.0', builtinIds: BUILTIN_IDS }
    )
    expect(r.manifest).toBeNull()
    expect(r.errors[0]).toContain('libraryVersion')
  })
  it('缺 label 被拒', () => {
    expect(validateRemoteCapability({ id: 'meta-thing' }, BUILTIN_IDS).reason).toContain('label')
  })

  // ★ 最关键的安全断言：远端不能替换内置能力的实现
  it('内置 id 带 recipe 一律拒绝（防止劫持高危能力）', () => {
    const { def, reason } = validateRemoteCapability(
      { id: 'repair-system-files', label: '劫持', recipe: [{ call: 'toolbox.flushDns' }] },
      BUILTIN_IDS
    )
    expect(def).toBeNull()
    expect(reason).toContain('不可被远端覆盖')
  })
  it('内置 id 不带 recipe 允许（仅覆盖元信息）', () => {
    const { def } = validateRemoteCapability(
      { id: 'repair-system-files', label: '新名称', description: '新说明' },
      BUILTIN_IDS
    )
    expect(def?.label).toBe('新名称')
  })

  it('recipe 形状非法被拒', () => {
    const cases: unknown[] = [
      'not-array',
      [],
      Array.from({ length: 9 }, () => ({ call: 'toolbox.flushDns' })),
      [{ args: {} }] // 缺 call
    ]
    for (const recipe of cases) {
      expect(validateRemoteCapability({ id: 'meta-x', label: 'x', recipe }, BUILTIN_IDS).def).toBeNull()
    }
  })
  it('minAppVersion 格式非法被拒', () => {
    expect(
      validateRemoteCapability({ id: 'meta-x', label: 'x', minAppVersion: 'v1' }, BUILTIN_IDS).def
    ).toBeNull()
  })
  it('needAdmin / enabled 仅接受布尔值', () => {
    const { def } = validateRemoteCapability(
      { id: 'meta-x', label: 'x', needsAdmin: 'yes', enabled: 1 },
      BUILTIN_IDS
    )
    expect(def?.needsAdmin).toBeUndefined()
    expect(def?.enabled).toBeUndefined()
  })
})

// ── 整份清单校验 ──────────────────────────────────────────────

describe('validateManifest', () => {
  const run = (raw: unknown, rawBytes?: number) =>
    validateManifest(raw, { appVersion: '1.0.0', builtinIds: BUILTIN_IDS, rawBytes })

  it('schema 不符 → 整份作废', () => {
    const r = run({ schema: 2, libraryVersion: '1.0.0', capabilities: [] })
    expect(r.manifest).toBeNull()
    expect(r.errors[0]).toContain('schema')
  })
  it('libraryVersion 非法 → 整份作废', () => {
    expect(run({ schema: 1, libraryVersion: 'v1', capabilities: [] }).manifest).toBeNull()
  })
  it('capabilities 非数组 → 整份作废', () => {
    expect(run({ schema: 1, libraryVersion: '1.0.0', capabilities: {} }).manifest).toBeNull()
  })
  it('条目数超上限 → 整份作废', () => {
    const capabilities = Array.from({ length: MAX_CAPABILITIES + 1 }, (_, i) => ({
      id: `meta-${String(i).padStart(3, '0')}`,
      label: 'x'
    }))
    const r = run({ schema: 1, libraryVersion: '1.0.0', capabilities })
    expect(r.manifest).toBeNull()
    expect(r.errors[0]).toContain('条目过多')
  })
  it('体积超上限 → 整份作废', () => {
    const r = run({ schema: 1, libraryVersion: '1.0.0', capabilities: [] }, MAX_MANIFEST_BYTES + 1)
    expect(r.manifest).toBeNull()
    expect(r.errors[0]).toContain('体积')
  })

  it('单条失败不拖垮整份清单，但被拒原因如实记录', () => {
    const r = run({
      schema: 1,
      libraryVersion: '1.0.0',
      capabilities: [
        { id: 'meta-good', label: '好的' },
        { id: 'BAD ID', label: '坏的' },
        { id: 'meta-good', label: '重复的' }
      ]
    })
    expect(r.manifest?.capabilities).toHaveLength(1)
    expect(r.rejected).toHaveLength(2)
    expect(r.rejected.map((x) => x.id)).toContain('BAD ID')
    expect(r.rejected.some((x) => x.reason === 'id 重复')).toBe(true)
  })

  it('minAppVersion 高于当前应用版本 → 拒绝该条并说明原因', () => {
    const r = run({
      schema: 1,
      libraryVersion: '1.0.0',
      capabilities: [{ id: 'meta-new', label: '新', minAppVersion: '9.0.0' }]
    })
    expect(r.manifest?.capabilities).toHaveLength(0)
    expect(r.rejected[0].reason).toContain('9.0.0')
  })

  it('全部条目都被拒 → 视为整体错误（避免"空清单"覆盖可用配置）', () => {
    const r = run({ schema: 1, libraryVersion: '1.0.0', capabilities: [{ id: 'BAD', label: 'x' }] })
    expect(r.errors).toContain('清单中没有任何可用条目')
  })
})

// ── 配方编译 ──────────────────────────────────────────────────

describe('compileRemoteCapabilities', () => {
  const runtime = createRecipeRuntime()

  it('白名单内的调用可编译为能力', () => {
    const { capabilities, rejected } = compileRemoteCapabilities(
      [{ id: 'meta-x', label: 'X', description: '', recipe: [{ call: 'toolbox.flushDns' }] }],
      runtime
    )
    expect(rejected).toHaveLength(0)
    expect(capabilities[0].meta.source).toBe('remote')
  })

  it('引用白名单外的调用 → 整条拒绝', () => {
    const { capabilities, rejected } = compileRemoteCapabilities(
      [
        {
          id: 'meta-evil',
          label: 'E',
          description: '',
          recipe: [{ call: 'toolbox.flushDns' }, { call: 'child_process.exec' }]
        }
      ],
      runtime
    )
    expect(capabilities).toHaveLength(0)
    expect(rejected[0].reason).toContain('白名单外')
  })

  it('原型链上的键不算白名单成员（toString/constructor/__proto__ 必须被拒）', () => {
    const { capabilities, rejected } = compileRemoteCapabilities(
      [
        { id: 'meta-proto-1', label: 'P1', description: '', recipe: [{ call: 'toString' }] },
        { id: 'meta-proto-2', label: 'P2', description: '', recipe: [{ call: 'constructor' }] },
        { id: 'meta-proto-3', label: 'P3', description: '', recipe: [{ call: '__proto__' }] }
      ],
      runtime
    )
    expect(capabilities).toHaveLength(0)
    expect(rejected.map((r) => r.id)).toEqual(['meta-proto-1', 'meta-proto-2', 'meta-proto-3'])
    expect(rejected[0].reason).toContain('白名单外')
  })

  it('无 recipe 的远端新能力不产出实现（避免凭空造能力）', () => {
    const { capabilities, rejected } = compileRemoteCapabilities(
      [{ id: 'meta-noimpl', label: 'N', description: '' }],
      runtime
    )
    expect(capabilities).toHaveLength(0)
    expect(rejected).toHaveLength(0)
  })

  it('enabled=false 的能力被下线并记录原因', () => {
    const { capabilities, rejected } = compileRemoteCapabilities(
      [
        {
          id: 'meta-off',
          label: 'O',
          description: '',
          enabled: false,
          recipe: [{ call: 'toolbox.flushDns' }]
        }
      ],
      runtime
    )
    expect(capabilities).toHaveLength(0)
    expect(rejected[0].reason).toContain('下线')
  })

  it('配方含需提权步骤时，整体 needsAdmin 自动为 true', () => {
    const { capabilities } = compileRemoteCapabilities(
      [{ id: 'meta-sfc', label: 'S', description: '', recipe: [{ call: 'disk.repairSystemFiles', args: { kind: 'sfc' } }] }],
      runtime
    )
    expect(capabilities[0].meta.needsAdmin).toBe(true)
  })

  it('远端新能力默认不纳入一键优化（须显式 defaultEnabled=true）', () => {
    const def = { id: 'meta-d', label: 'D', description: '', recipe: [{ call: 'toolbox.flushDns' }] }
    const a = compileRemoteCapabilities([def], runtime).capabilities[0]
    const b = compileRemoteCapabilities([{ ...def, defaultEnabled: true }], runtime).capabilities[0]
    expect(a.meta.defaultEnabled).toBe(false)
    expect(b.meta.defaultEnabled).toBe(true)
  })

  it('配方参数非法时运行返回 failed 而不是抛错', async () => {
    const { capabilities } = compileRemoteCapabilities(
      [{ id: 'meta-k', label: 'K', description: '', recipe: [{ call: 'optimizer.cleanupKind', args: { kind: '../../etc' } }] }],
      runtime
    )
    const ctx = {
      platform: 'win32' as const,
      normal: {} as never,
      admin: {} as never,
      isElevated: async () => true,
      cache: { get: () => undefined, set: () => {} }
    }
    const r = await capabilities[0].run(ctx)
    expect(r.status).toBe('failed')
    expect(r.error).toContain('参数非法')
  })

  it('disk.deepCleanup 只接受已声明的 id（参数逐字段校验）', async () => {
    const { capabilities } = compileRemoteCapabilities(
      [{ id: 'meta-ids', label: 'I', description: '', recipe: [{ call: 'disk.deepCleanup', args: { ids: [] } }] }],
      runtime
    )
    const ctx = {
      platform: 'win32' as const,
      normal: {} as never,
      admin: {} as never,
      isElevated: async () => true,
      cache: { get: () => undefined, set: () => {} }
    }
    expect((await capabilities[0].run(ctx)).error).toContain('非空字符串数组')
  })

  it('白名单调用清单可枚举（供文档与校验）', () => {
    const calls = listRecipeCalls()
    expect(calls).toContain('toolbox.flushDns')
    expect(calls).toContain('dll.repairMissing')
    expect(calls.length).toBeGreaterThan(5)
  })
})

// ── 服务：检查 / 生效 / 回退 ───────────────────────────────────

describe('createCapabilityFeedService', () => {
  it('初始状态为内置', () => {
    const s = makeFeed().state()
    expect(s.source).toBe('builtin')
    expect(s.libraryVersion).toBe(BUILTIN_LIBRARY_VERSION)
    expect(s.updateAvailable).toBe(false)
  })

  it('拉取失败 → 保持内置并给出可读原因（不抛错）', async () => {
    const s = makeFeed({
      manifest: async () => {
        throw new Error('ENOTFOUND')
      }
    })
    const st = await s.check()
    expect(st.source).toBe('builtin')
    expect(st.lastError).toContain('ENOTFOUND')
    expect(st.checkedAt).toBeGreaterThan(0)
  })

  it('非法 JSON → 保持内置并报错', async () => {
    const st = await makeFeed({ manifest: '{ not json' }).check()
    expect(st.lastError).toContain('JSON')
  })

  it('版本更高 → updateAvailable，apply 后 source=remote 且持久化', async () => {
    const storage = memoryStorage()
    const s = makeFeed({ manifest: manifestJson(), storage })
    const checked = await s.check()
    expect(checked.updateAvailable).toBe(true)
    expect(checked.availableVersion).toBe('0.1.0')
    // 未 apply 前仍为内置
    expect(checked.source).toBe('builtin')

    const applied = await s.apply()
    expect(applied.source).toBe('remote')
    expect(applied.libraryVersion).toBe('0.1.0')

    // 新进程（同 storage）应直接读到远端版本
    const again = makeFeed({ manifest: manifestJson(), storage }).state()
    expect(again.source).toBe('remote')
    expect(again.libraryVersion).toBe('0.1.0')
  })

  it('版本相同或更低 → 不接受（防降级攻击）', async () => {
    const storage = memoryStorage()
    const first = makeFeed({ manifest: manifestJson({ libraryVersion: '0.5.0' }), storage })
    await first.check()
    await first.apply()

    const lower = makeFeed({ manifest: manifestJson({ libraryVersion: '0.4.0' }), storage })
    const st = await lower.check()
    expect(st.updateAvailable).toBe(false)
    expect(st.libraryVersion).toBe('0.5.0') // 仍为已生效的 0.5.0
  })

  it('reset 清除远端清单并回落内置', async () => {
    const storage = memoryStorage()
    const s = makeFeed({ manifest: manifestJson(), storage })
    await s.check()
    await s.apply()
    expect(s.state().source).toBe('remote')
    expect(s.reset().source).toBe('builtin')
    expect(makeFeed({ storage }).state().source).toBe('builtin')
  })

  it('未检查就 apply → 不生效并给出提示', async () => {
    const s = makeFeed()
    const st = await s.apply()
    expect(st.source).toBe('builtin')
    expect(st.lastError).toContain('先检查')
  })

  it('损坏的本地缓存被忽略（回落内置）', () => {
    const storage = memoryStorage({
      capabilityLibrary: { libraryVersion: 'not-a-version', manifest: { schema: 1 } }
    })
    expect(makeFeed({ storage }).state().source).toBe('builtin')
  })

  it('schema 不符的缓存被忽略', () => {
    const storage = memoryStorage({
      capabilityLibrary: {
        libraryVersion: '1.0.0',
        manifest: { schema: 99, libraryVersion: '1.0.0', capabilities: [] }
      }
    })
    expect(makeFeed({ storage }).state().source).toBe('builtin')
  })

  // ★ 安全断言：远端不得替换内置实现
  it('externalCapabilities 只返回非内置 id（内置实现无法被远端替换）', async () => {
    const storage = memoryStorage()
    const s = makeFeed({
      manifest: manifestJson({
        capabilities: [
          { id: 'repair-system-files', label: '劫持名', description: 'x' },
          { id: 'meta-brand-new', label: '新能力', description: 'n', recipe: [{ call: 'toolbox.flushDns' }] }
        ]
      }),
      storage
    })
    await s.check()
    await s.apply()
    const ext = s.externalCapabilities()
    expect(ext.map((c) => c.meta.id)).toEqual(['meta-brand-new'])
    expect(ext[0].meta.id).not.toBe('repair-system-files')
  })

  it('metaOverrides 只覆盖内置 id，且不含 recipe 带来的新能力', async () => {
    const storage = memoryStorage()
    const s = makeFeed({
      manifest: manifestJson({
        capabilities: [
          { id: 'clean-temp', label: '改名后的临时清理', description: '被覆盖的说明', defaultEnabled: false },
          { id: 'meta-brand-new', label: '新能力', description: 'n', recipe: [{ call: 'toolbox.flushDns' }] }
        ]
      }),
      storage
    })
    await s.check()
    await s.apply()
    const ov = s.metaOverrides()
    expect([...ov.keys()]).toEqual(['clean-temp'])
    expect(ov.get('clean-temp')?.label).toBe('改名后的临时清理')
    expect(ov.has('meta-brand-new')).toBe(false)
  })

  it('state 合并后 capabilities 同时含内置与远端，并标注 source', async () => {
    const storage = memoryStorage()
    const s = makeFeed({
      manifest: manifestJson({
        capabilities: [
          { id: 'clean-temp', label: '覆盖名', description: 'd' },
          { id: 'meta-brand-new', label: '新能力', description: 'n', recipe: [{ call: 'toolbox.flushDns' }] }
        ]
      }),
      storage
    })
    await s.check()
    const st = await s.apply()
    const merged = st.capabilities
    expect(merged).toHaveLength(BUILTIN_METAS.length + 1)
    expect(merged.find((c) => c.id === 'clean-temp')?.label).toBe('覆盖名')
    expect(merged.find((c) => c.id === 'clean-temp')?.source).toBe('builtin')
    expect(merged.find((c) => c.id === 'meta-brand-new')?.source).toBe('remote')
  })

  // ── needsAdmin 提权边界：只许收紧、不许放宽 ──────────────────
  // 这是安全边界：若远端能把需要管理员的步骤标成 false，onekey 的权限预检会放行，
  // 未提权时会去执行高危操作（失败或逐项弹 UAC），绕开「不轰炸 UAC」的设计。
  it('远端把需提权步骤声明为 needsAdmin:false 时仍判为 true（不许放宽）', () => {
    const rt = createRecipeRuntime()
    const { capabilities } = compileRemoteCapabilities(
      [
        {
          id: 'meta-sneaky',
          label: 'S',
          description: '',
          needsAdmin: false,
          recipe: [{ call: 'disk.repairSystemFiles', args: { kind: 'sfc' } }]
        }
      ],
      rt
    )
    expect(capabilities[0].meta.needsAdmin).toBe(true)
  })

  it('远端可把不含提权步骤的能力显式收紧为 needsAdmin:true', () => {
    const rt = createRecipeRuntime()
    const { capabilities } = compileRemoteCapabilities(
      [
        {
          id: 'meta-tight',
          label: 'T',
          description: '',
          needsAdmin: true,
          recipe: [{ call: 'toolbox.flushDns' }]
        }
      ],
      rt
    )
    expect(capabilities[0].meta.needsAdmin).toBe(true)
  })

  it('覆盖内置能力时不得把内置的 needsAdmin 放宽为 false', async () => {
    const adminBuiltin = BUILTIN_METAS.find((m) => m.needsAdmin)
    expect(adminBuiltin).toBeDefined()

    const storage = memoryStorage()
    const s = makeFeed({
      manifest: manifestJson({
        capabilities: [
          { id: adminBuiltin!.id, label: '改过的名字', description: 'd', needsAdmin: false }
        ]
      }),
      storage
    })
    await s.check()
    const st = await s.apply()
    const merged = st.capabilities.find((c) => c.id === adminBuiltin!.id)
    // label 可以被远端改名，但提权边界不能被远端抹掉
    expect(merged?.label).toBe('改过的名字')
    expect(merged?.needsAdmin).toBe(true)
  })

  it('metaOverrides 不下发 needsAdmin（提权边界只能由本地代码定义）', async () => {
    const adminBuiltin = BUILTIN_METAS.find((m) => m.needsAdmin)
    expect(adminBuiltin).toBeDefined()

    const storage = memoryStorage()
    const s = makeFeed({
      manifest: manifestJson({
        capabilities: [{ id: adminBuiltin!.id, label: 'L', description: 'd', needsAdmin: false }]
      }),
      storage
    })
    await s.check()
    await s.apply()
    const ov = s.metaOverrides()
    const override = ov.get(adminBuiltin!.id)
    expect(override).toBeDefined()
    // 类型层已 Omit 掉 needsAdmin，这里在运行时确认该键确实不存在（提权边界不下发）
    expect(Object.prototype.hasOwnProperty.call(override, 'needsAdmin')).toBe(false)
  })

  it('无可用条目时整份清单作废，不覆盖内置', async () => {
    const storage = memoryStorage()
    const s = makeFeed({
      manifest: manifestJson({ capabilities: [{ id: 'BAD ID', label: 'x', description: '' }] }),
      storage
    })
    const st = await s.check()
    expect(st.updateAvailable).toBe(false)
    expect(st.lastError).toContain('没有任何可用条目')
    expect(st.rejected.map((r) => r.id)).toContain('BAD ID')
  })

  // ── M3：内置 needsAdmin 三处对齐（不收紧也不放宽）────────────────
  it('M3：远端把内置 clean-temp(needsAdmin:false) 标 needsAdmin:true 不生效（mergedMetas 不收紧）', async () => {
    const cleanTemp = BUILTIN_METAS.find((m) => m.id === 'clean-temp')
    expect(cleanTemp?.needsAdmin).toBe(false)
    const storage = memoryStorage()
    const s = makeFeed({
      manifest: manifestJson({
        capabilities: [{ id: 'clean-temp', label: '改名', description: 'd', needsAdmin: true }]
      }),
      storage
    })
    await s.check()
    const st = await s.apply()
    const merged = st.capabilities.find((c) => c.id === 'clean-temp')
    // 本地 needsAdmin=false 不被远端收紧为 true（与 metaOverrides 不下发、optlib 不接受一致）
    expect(merged?.needsAdmin).toBe(false)
  })

  // ── M4：apply 后 validate 期被拒条目仍保留并展示原因 ────────────
  it('M4：apply 后 validate 期被拒的条目仍在 rejected 中并带原因（不静默消失）', async () => {
    const storage = memoryStorage()
    const s = makeFeed({
      manifest: manifestJson({
        capabilities: [
          { id: 'meta-good', label: '好', description: '好描述', recipe: [{ call: 'toolbox.flushDns' }] },
          { id: 'BAD ID', label: '坏', description: '坏描述' }
        ]
      }),
      storage
    })
    await s.check()
    const applied = await s.apply()
    expect(applied.source).toBe('remote')
    expect(applied.rejected.map((r) => r.id)).toContain('BAD ID')
    expect(applied.rejected.find((r) => r.id === 'BAD ID')?.reason).toBeTruthy()
    // 已落盘：新进程同 storage 也读得到
    const again = makeFeed({ storage }).state()
    expect(again.rejected.map((r) => r.id)).toContain('BAD ID')
  })

  // ── M5：disk.deepCleanup 按 id 的 needsAdmin 分别路由 normal/admin ──
  it('M5：disk.deepCleanup 把 needsAdmin=true 的 id 路由到 ctx.admin，其余走 ctx.normal', async () => {
    const rt = createRecipeRuntime()
    const { capabilities } = compileRemoteCapabilities(
      [{ id: 'meta-dc', label: 'DC', description: '', recipe: [{ call: 'disk.deepCleanup', args: { ids: ['n1', 'a1'] } }] }],
      rt
    )
    const ran: string[] = []
    const fakeDisk = (tag: string) =>
      ({
        scanDeepCleanup: async () => [
          { id: 'n1', kind: 'system', label: 'n', detail: '', sizeBytes: 1, needsAdmin: false, safe: true, defaultChecked: true },
          { id: 'a1', kind: 'system', label: 'a', detail: '', sizeBytes: 1, needsAdmin: true, safe: true, defaultChecked: true }
        ],
        runDeepCleanup: async (ids: string[]) => {
          ran.push(`${tag}:${[...ids].sort().join(',')}`)
          return ids.map((id) => ({ id, ok: true, releasedBytes: 1 }))
        }
      }) as never
    const ctx = {
      platform: 'win32' as const,
      normal: { disk: fakeDisk('normal') },
      admin: { disk: fakeDisk('admin') },
      isElevated: async () => true,
      cache: { get: () => undefined, set: () => {} }
    } as never
    const r = await capabilities[0].run(ctx)
    expect(r.status).toBe('success')
    expect(ran).toContain('normal:n1')
    expect(ran).toContain('admin:a1')
  })
})
