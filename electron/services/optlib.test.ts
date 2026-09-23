import { describe, it, expect } from 'vitest'
import type { CleanupPlan, CleanupResult, DeepCleanupPlan } from '../../shared/types'
import {
  buildCapabilityRegistry,
  createOptLibrary,
  aggregateResults,
  pickDeep,
  type OptServiceSet
} from './optlib'

// ── fake 服务集（只实现能力用到的几个方法，注入式，不触真实系统）──
const fakeScan: CleanupPlan[] = [
  { id: 't1', kind: 'temp', label: '临时文件', path: 'C:\\TESTTEMP', sizeBytes: 0, safe: true },
  { id: 'r1', kind: 'recycle', label: '回收站', path: 'C:\\RECYCLE', sizeBytes: 0, safe: true }
]

const deepScan: DeepCleanupPlan[] = [
  { id: 'win-system-temp', kind: 'path', label: '', detail: '', sizeBytes: 0, needsAdmin: false, safe: true, defaultChecked: true },
  { id: 'win-update-cache', kind: 'path', label: '', detail: '', sizeBytes: 0, needsAdmin: true, safe: true, defaultChecked: true }
]

function makeServices(): { normal: OptServiceSet; admin: OptServiceSet; adminRan: string[] } {
  const adminRan: string[] = []
  const base = {
    scanCleanup: async () => fakeScan,
    // H3：runCleanup 契约改为只收 id 数组，路径由服务端按 id 权威解析
    runCleanup: async (ids: string[]) => ids.map((id) => ({ id, ok: true, releasedBytes: 1024 })),
    scanDeepCleanup: async () => deepScan,
    // runDeepCleanup 的契约是「只收 id 数组」：路径由服务端权威清单解析
    runDeepCleanup: async (ids: string[]) =>
      ids.map((id) => ({ id, ok: true, releasedBytes: 2048 })),
    repairSystemFiles: async () => ({ ok: true, summary: 'ok', target: '', repaired: false, output: '', needsAdmin: false, unsupported: false }),
    flushDns: async () => ({ ok: true, message: '' })
  }
  const normal = { optimizer: base, disk: base, toolbox: base } as unknown as OptServiceSet
  const adminSet = {
    optimizer: base,
    toolbox: base,
    disk: {
      ...base,
      scanDeepCleanup: async () => deepScan,
      runDeepCleanup: async (ids: string[]) => {
        adminRan.push(...ids)
        return base.runDeepCleanup(ids)
      },
      repairSystemFiles: async () => {
        adminRan.push('repairSystemFiles')
        return base.repairSystemFiles()
      }
    }
  } as unknown as OptServiceSet
  return { normal, admin: adminSet, adminRan }
}

describe('buildCapabilityRegistry', () => {
  const caps = buildCapabilityRegistry()
  it('注册 9 项能力', () => {
    expect(caps).toHaveLength(9)
  })
  it('含关键能力 id', () => {
    const ids = caps.map((c) => c.meta.id)
    for (const id of ['clean-temp', 'clean-recycle', 'clean-browser', 'deep-system-cache', 'deep-user-cache', 'deep-update-cache', 'net-flush-dns', 'deep-component-store', 'repair-system-files']) {
      expect(ids).toContain(id)
    }
  })
  it('高危/耗时项默认不纳入一键优化', () => {
    const map = new Map(caps.map((c) => [c.meta.id, c.meta]))
    expect(map.get('deep-component-store')!.defaultEnabled).toBe(false)
    expect(map.get('repair-system-files')!.defaultEnabled).toBe(false)
    expect(map.get('deep-update-cache')!.needsAdmin).toBe(true)
  })
})

describe('aggregateResults', () => {
  it('空结果视为跳过', () => {
    expect(aggregateResults([])).toEqual({ status: 'skipped', reason: '当前系统无可清理项' })
  })
  it('全部成功时汇总释放量', () => {
    const r = aggregateResults([
      { id: 'a', ok: true, releasedBytes: 100 } as CleanupResult,
      { id: 'b', ok: true, releasedBytes: 200 } as CleanupResult
    ])
    expect(r.status).toBe('success')
    expect(r.releasedBytes).toBe(300)
  })
  it('存在失败时汇总为失败并拼接错误', () => {
    const r = aggregateResults([
      { id: 'a', ok: true, releasedBytes: 100 } as CleanupResult,
      { id: 'b', ok: false, error: '占用' } as CleanupResult
    ])
    expect(r.status).toBe('failed')
    expect(r.error).toContain('占用')
  })
})

describe('pickDeep', () => {
  it('按 id 过滤且只保留 safe 项', () => {
    const unsafe: DeepCleanupPlan = { ...deepScan[0], id: 'x', safe: false }
    const picked = pickDeep([...deepScan, unsafe], ['win-update-cache', 'x'])
    expect(picked.map((p) => p.id)).toEqual(['win-update-cache'])
  })
})

describe('createOptLibrary', () => {
  it('runSingle 单项目返回耗时/状态/释放量', async () => {
    const { normal, admin } = makeServices()
    const lib = createOptLibrary({ normal, admin, isElevated: async () => true })
    const o = await lib.runSingle('clean-temp')
    expect(o.id).toBe('clean-temp')
    expect(o.status).toBe('success')
    expect(o.releasedBytes).toBe(1024)
    expect(o.durationMs).toBeGreaterThanOrEqual(0)
    // 注：attempts 由 onekey 的 runWithRetry 注入，此处 runSingle 直接调用不返回该字段
  })
  it('未知项返回 failed', async () => {
    const { normal, admin } = makeServices()
    const lib = createOptLibrary({ normal, admin, isElevated: async () => true })
    const o = await lib.runSingle('nope')
    expect(o.status).toBe('failed')
    expect(o.error).toContain('未知')
  })
  it('需管理员项在已提权时走 admin 执行器', async () => {
    const { normal, admin, adminRan } = makeServices()
    const lib = createOptLibrary({ normal, admin, isElevated: async () => true })
    const o = await lib.runSingle('deep-update-cache')
    expect(o.status).toBe('success')
    expect(adminRan).toContain('win-update-cache')
  })
  it('listCapabilities 返回元信息副本', () => {
    const { normal, admin } = makeServices()
    const lib = createOptLibrary({ normal, admin, isElevated: async () => true })
    const caps = lib.listCapabilities()
    expect(caps).toHaveLength(9)
    expect(caps[0]).not.toBe(lib.listCapabilities()[0])
  })

  it('listCapabilities 标注 source（内置为 builtin）', () => {
    const { normal, admin } = makeServices()
    const lib = createOptLibrary({ normal, admin, isElevated: async () => true })
    expect(lib.listCapabilities().every((c) => c.source === 'builtin')).toBe(true)
  })
})

// ── 远端能力接入（可独立更新的能力库）──────────────────────────
describe('createOptLibrary + 远端能力', () => {
  const remoteCap = (id: string) => ({
    meta: {
      id,
      label: `远端 ${id}`,
      description: '由远端清单下发',
      needsAdmin: false,
      defaultEnabled: false,
      source: 'remote' as const
    },
    run: async () => ({ status: 'success' as const, releasedBytes: 4096 })
  })

  it('远端能力出现在清单中并可被 runSingle 调用', async () => {
    const { normal, admin } = makeServices()
    const lib = createOptLibrary({
      normal,
      admin,
      isElevated: async () => true,
      externalCapabilities: () => [remoteCap('meta-remote-a')]
    })
    const caps = lib.listCapabilities()
    expect(caps).toHaveLength(10)
    expect(caps.find((c) => c.id === 'meta-remote-a')?.source).toBe('remote')

    const o = await lib.runSingle('meta-remote-a')
    expect(o.status).toBe('success')
    expect(o.releasedBytes).toBe(4096)
  })

  // ★ 安全断言：远端 id 与内置重名时，内置实现必须胜出
  it('远端能力与内置 id 重名时被忽略，内置实现不被替换', async () => {
    const { normal, admin } = makeServices()
    const lib = createOptLibrary({
      normal,
      admin,
      isElevated: async () => true,
      // 伪装成 clean-temp 的恶意实现
      externalCapabilities: () => [remoteCap('clean-temp')]
    })
    const caps = lib.listCapabilities()
    expect(caps).toHaveLength(9) // 未新增
    expect(caps.find((c) => c.id === 'clean-temp')?.source).toBe('builtin')

    // 执行的仍是内置实现（走 optimizer.runCleanup → 1024），而非远端的 4096
    const o = await lib.runSingle('clean-temp')
    expect(o.releasedBytes).toBe(1024)
  })

  it('外部能力实时求值：清单生效后无需重启即可用上新能力', async () => {
    const { normal, admin } = makeServices()
    let external: ReturnType<typeof remoteCap>[] = []
    const lib = createOptLibrary({
      normal,
      admin,
      isElevated: async () => true,
      externalCapabilities: () => external
    })
    expect(lib.listCapabilities()).toHaveLength(9)
    external = [remoteCap('meta-late')]
    expect(lib.listCapabilities()).toHaveLength(10)
  })

  it('metaOverrides 覆盖文案与默认勾选，但不改变实现', async () => {
    const { normal, admin } = makeServices()
    const lib = createOptLibrary({
      normal,
      admin,
      isElevated: async () => true,
      metaOverrides: () => new Map([['clean-temp', { label: '换个名字', defaultEnabled: false }]])
    })
    const c = lib.listCapabilities().find((x) => x.id === 'clean-temp')!
    expect(c.label).toBe('换个名字')
    expect(c.defaultEnabled).toBe(false)
    // 实现未变：仍是内置的 optimizer.runCleanup
    expect((await lib.runSingle('clean-temp')).releasedBytes).toBe(1024)
  })

  it('metaOverrides 不能凭空创造能力，也不能放宽 needsAdmin', () => {
    const { normal, admin } = makeServices()
    const lib = createOptLibrary({
      normal,
      admin,
      isElevated: async () => true,
      metaOverrides: () =>
        new Map([
          ['does-not-exist', { label: '幽灵' }],
          ['deep-update-cache', { needsAdmin: false, label: '降权尝试' }]
        ])
    })
    const caps = lib.listCapabilities()
    expect(caps.find((c) => c.id === 'does-not-exist')).toBeUndefined()
    const target = caps.find((c) => c.id === 'deep-update-cache')!
    expect(target.label).toBe('降权尝试') // 文案可改
    expect(target.needsAdmin).toBe(true) // 提权边界不可被远端放宽
  })
})
