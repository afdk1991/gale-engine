import { describe, it, expect, vi } from 'vitest'
import type { ExecResult, ExecRunner } from './shell'
import {
  DLL_CATALOG,
  NO_MISSING_NOTE,
  VCREDIST_URLS,
  buildDllAdvice,
  buildDllScanScript,
  buildSharedLibProbeScript,
  buildVcRedistScript,
  createDllService,
  parseDllScanOutput,
  parseVcRedistResult,
  toScanResult,
  unixDllCatalog
} from './dllrepair'

function runnerReturning(...results: Partial<ExecResult>[]): ExecRunner & { calls: string[] } {
  const calls: string[] = []
  let i = 0
  return {
    calls,
    async run(script: string): Promise<ExecResult> {
      calls.push(script)
      const r = results[Math.min(i, results.length - 1)] ?? {}
      i++
      return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 }
    }
  }
}

/** 构造一段符合协议的 Windows 扫描输出 */
const WIN_OUTPUT = [
  'R\tC:\\Windows\\System32\t64',
  'R\tC:\\Windows\\SysWOW64\t32',
  'D\tvcruntime140.dll\t64\t1\t14.38.33130.0',
  'D\tvcruntime140.dll\t32\t0\t',
  'D\tmsvcp140.dll\t64\t1\t14.38.33130.0',
  'D\tmsvcp140.dll\t32\t1\t14.38.33130.0',
  'D\tkernel32.dll\t64\t1\t10.0.22621.1',
  'D\tkernel32.dll\t32\t1\t10.0.22621.1',
  'V\t14.38.33130.0\t14.38.33130.0'
].join('\n')

describe('buildDllScanScript — Windows 扫描脚本', () => {
  it('Windows 生成脚本，包含两个根目录与协议标记', () => {
    const s = buildDllScanScript('win32')
    expect(s).toBeTruthy()
    expect(s).toContain('System32')
    expect(s).toContain('SysWOW64')
    expect(s).toContain('Is64BitOperatingSystem')
    expect(s).toContain('Runtimes')
  })

  it('非 Windows 返回 null（DLL 是 Windows 专有机制）', () => {
    expect(buildDllScanScript('darwin')).toBeNull()
    expect(buildDllScanScript('linux')).toBeNull()
  })

  it('清单里包含系统 API / VC++ 运行库 / UCRT 三类关键 DLL', () => {
    const names = DLL_CATALOG.map((d) => d.name)
    expect(names).toContain('kernel32.dll')
    expect(names).toContain('msvcp140.dll')
    expect(names).toContain('vcruntime140_1.dll')
    expect(names).toContain('api-ms-win-crt-runtime-l1-1-0.dll')
    expect(names).toContain('ucrtbase.dll')
  })
})

describe('buildSharedLibProbeScript — 非 Windows 只读探针', () => {
  it('macOS 探针输出基名（与 Windows 侧口径一致）', () => {
    const s = buildSharedLibProbeScript('darwin')
    expect(s).toContain('libSystem.B.dylib')
    expect(s).toContain('/usr/lib/libSystem.B.dylib')
    expect(s).toContain('R\t/usr/lib\t64')
  })

  it('Linux 探针走 ldconfig 缓存', () => {
    const s = buildSharedLibProbeScript('linux')
    expect(s).toContain('ldconfig -p')
    expect(s).toContain('libc.so.6')
  })
})

describe('parseDllScanOutput — 协议解析', () => {
  it('解析根目录、命中项、缺失项与 VC++ 运行库版本', () => {
    const probe = parseDllScanOutput(WIN_OUTPUT)
    expect(probe.roots).toEqual([
      { path: 'C:\\Windows\\System32', bits: 64 },
      { path: 'C:\\Windows\\SysWOW64', bits: 32 }
    ])
    expect(probe.vc).toEqual({ x64: '14.38.33130.0', x86: '14.38.33130.0' })
    expect(probe.found.get('msvcp140.dll')?.length).toBe(2)
    expect(probe.missing.has('vcruntime140.dll')).toBe(false)
  })

  it('空输出与乱码输出不抛错，返回空探针', () => {
    expect(parseDllScanOutput('').roots).toEqual([])
    expect(parseDllScanOutput('垃圾输出\n没有制表符').roots).toEqual([])
  })

  it('同一文件部分位数命中时不算缺失（由 partial 表达）', () => {
    const probe = parseDllScanOutput(WIN_OUTPUT)
    expect(probe.missing.has('vcruntime140.dll')).toBe(false)
    const scan = toScanResult(probe, DLL_CATALOG, 'win32', 0)
    expect(scan.partial).toContain('vcruntime140.dll')
    expect(scan.missing).toContain('xinput1_4.dll') // 输出里完全没提到
  })
})

describe('toScanResult — 与静态清单合并', () => {
  it('Windows：命中路径按位数拼出 System32/SysWOW64 真实路径', () => {
    const scan = toScanResult(parseDllScanOutput(WIN_OUTPUT), DLL_CATALOG, 'win32', 123)
    const msvcp = scan.items.find((i) => i.name === 'msvcp140.dll')
    expect(msvcp?.present).toBe(true)
    expect(msvcp?.partial).toBe(false)
    expect(msvcp?.paths.map((p) => p.bits).sort()).toEqual([32, 64])
    expect(msvcp?.paths[0].path).toContain('Windows')
    expect(scan.scannedAt).toBe(123)
    expect(scan.vcRedist.x64).toBe('14.38.33130.0')
  })

  it('非 Windows：说明文案点明不使用 DLL 机制，且不编造路径', () => {
    const catalog = unixDllCatalog('linux')
    const probe = parseDllScanOutput('R\t/lib /usr/lib\t64\nD\tlibc.so.6\t64\t1\t\nD\tlibz.so.1\t64\t0\t\nV\t\t')
    const scan = toScanResult(probe, catalog, 'linux', 0)
    expect(scan.supported).toBe(true)
    expect(scan.note).toContain('.so')
    const libc = scan.items.find((i) => i.name === 'libc.so.6')
    expect(libc?.paths).toEqual([]) // ldconfig 给不出唯一路径，就如实留空
    expect(scan.missing).toContain('libz.so.1')
  })
})

describe('buildDllAdvice — 修复建议', () => {
  const scanWith = (missing: string[], partial: string[] = [], vc = { x64: '', x86: '' }) => {
    const base = toScanResult(parseDllScanOutput('R\tC:\\Windows\\System32\t64'), DLL_CATALOG, 'win32', 0)
    return { ...base, missing, partial, vcRedist: vc }
  }

  it('未扫描或非 Windows 时不给建议', () => {
    expect(buildDllAdvice(null)).toEqual([])
    const linux = toScanResult(parseDllScanOutput(''), [], 'linux', 0)
    expect(buildDllAdvice(linux)).toEqual([])
  })

  it('无缺失时不给建议（页面展示"环境完整"）', () => {
    expect(buildDllAdvice(scanWith([], []))).toEqual([])
    expect(NO_MISSING_NOTE).toContain('未发现')
  })

  it('缺运行库 DLL 时优先建议装 VC++ 运行库', () => {
    const advice = buildDllAdvice(scanWith(['msvcp140.dll', 'vcruntime140.dll']))
    expect(advice[0].kind).toBe('vcredist-x64')
    expect(advice[0].priority).toBe(1)
    expect(advice.map((a) => a.kind)).toContain('vcredist-x86')
  })

  it('缺系统 API DLL 时建议 SFC + DISM', () => {
    const advice = buildDllAdvice(scanWith(['kernel32.dll', 'user32.dll']))
    expect(advice.map((a) => a.kind)).toEqual(['sfc', 'dism-restore'])
  })

  it('仅位数不全时也给出运行库修复建议', () => {
    const advice = buildDllAdvice(scanWith([], ['msvcp140.dll']))
    expect(advice.map((a) => a.kind)).toContain('vcredist-x64')
  })

  it('已装运行库时建议文案说明是"修复式重装"', () => {
    const advice = buildDllAdvice(scanWith(['msvcp140.dll'], [], { x64: '14.38.0', x86: '' }))
    expect(advice[0].description).toContain('14.38.0')
  })
})

describe('buildVcRedistScript / parseVcRedistResult', () => {
  it('仅 Windows 生成脚本，且用 winget 安装官方运行库', () => {
    const s = buildVcRedistScript('x64', 'win32')
    expect(s).toContain('winget install')
    expect(s).toContain('Microsoft.VCRedist.2015+.x64')
    expect(buildVcRedistScript('x86', 'win32')).toContain('Microsoft.VCRedist.2015+.x86')
    expect(buildVcRedistScript('x64', 'linux')).toBeNull()
  })

  it('识别缺少 winget 的情况', () => {
    const r = parseVcRedistResult({ stdout: 'NO_WINGET', stderr: '', code: 2 })
    expect(r.noWinget).toBe(true)
    expect(r.installed).toBe(false)
  })

  it('识别安装成功与已安装', () => {
    expect(
      parseVcRedistResult({ stdout: 'Successfully installed\nWINGET_EXIT=0', stderr: '', code: 0 }).installed
    ).toBe(true)
    expect(
      parseVcRedistResult({ stdout: '已安装此包\nWINGET_EXIT=0', stderr: '', code: 0 }).installed
    ).toBe(true)
  })

  it('失败时如实返回未安装', () => {
    const r = parseVcRedistResult({ stdout: 'WINGET_EXIT=1', stderr: 'access denied', code: 0 })
    expect(r.installed).toBe(false)
  })
})

describe('createDllService', () => {
  it('扫描后可按结果给出建议，并保留最近一次扫描', async () => {
    const runner = runnerReturning({ stdout: WIN_OUTPUT })
    const svc = createDllService({ runner, platform: 'win32', now: () => 7 })
    const scan = await svc.scan()
    expect(scan.platform).toBe('win32')
    expect(scan.total).toBe(DLL_CATALOG.length)
    expect(svc.lastScan()?.scannedAt).toBe(7)
    const advice = await svc.advice()
    expect(Array.isArray(advice)).toBe(true)
  })

  it('复用到传入的系统文件修复通道（sfc）', async () => {
    const runner = runnerReturning({ stdout: WIN_OUTPUT })
    const repairSystemFiles = vi.fn(async () => ({
      target: 'SFC 系统文件检查器',
      ok: true,
      repaired: true,
      summary: '发现损坏的系统文件并已成功修复',
      output: 'ok',
      needsAdmin: true,
      unsupported: false
    }))
    const svc = createDllService({ runner, platform: 'win32', repairSystemFiles })
    const r = await svc.repair('sfc')
    expect(repairSystemFiles).toHaveBeenCalledWith('sfc')
    expect(r.repaired).toBe(true)
    expect(r.unsupported).toBe(false)
  })

  it('装运行库走提权执行器，并把官方下载链接作为兜底', async () => {
    const normal = runnerReturning({ stdout: WIN_OUTPUT })
    const admin = runnerReturning({ stdout: 'NO_WINGET', code: 2 })
    const svc = createDllService({ runner: normal, adminRunner: admin, platform: 'win32' })
    const r = await svc.repair('vcredist-x64')
    expect(admin.calls.length).toBe(1)
    expect(normal.calls.length).toBe(0) // 必须走提权通道
    expect(r.repaired).toBe(false)
    expect(r.nextSteps.join(' ')).toContain(VCREDIST_URLS.x64)
  })

  it('非 Windows 上修复能力诚实降级', async () => {
    const svc = createDllService({
      runner: runnerReturning({ stdout: 'R\t/lib /usr/lib\t64\nD\tlibc.so.6\t64\t1\t\nV\t\t' }),
      platform: 'linux'
    })
    const scan = await svc.scan()
    expect(scan.supported).toBe(true)
    const r = await svc.repair('sfc')
    expect(r.unsupported).toBe(true)
    expect(r.summary).toMatch(/DLL|共享库/)
  })

  it('other 平台扫描返回 supported=false', async () => {
    const svc = createDllService({ runner: runnerReturning({}), platform: 'other' })
    const scan = await svc.scan()
    expect(scan.supported).toBe(false)
    expect(scan.items).toEqual([])
  })
})
