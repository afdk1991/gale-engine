import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createDiskService,
  buildDeepCatalog,
  buildDeepScanScript,
  buildCheckVolumeScript,
  buildSystemRepairScript,
  toWinDrive,
  LOW_SPACE_PERCENT,
  LOW_SPACE_BYTES,
  type DiskFetcher
} from './disk'
import type { ExecRunner } from './shell'

interface Call {
  script: string
}
interface Fake {
  runner: ExecRunner
  calls: Call[]
}

function recordingRunner(
  respond: (script: string) => { stdout: string; stderr: string; code: number }
): Fake {
  const calls: Call[] = []
  const runner: ExecRunner = {
    run: (script: string) => {
      calls.push({ script })
      return Promise.resolve(respond(script))
    }
  }
  return { runner, calls }
}

const ok = (stdout = 'OK'): { stdout: string; stderr: string; code: number } => ({
  stdout,
  stderr: '',
  code: 0
})
const fail = (stderr = 'err'): { stdout: string; stderr: string; code: number } => ({
  stdout: '',
  stderr,
  code: 1
})

function fakeFetcher(volumes: unknown[]): DiskFetcher {
  return { fsSize: () => Promise.resolve(volumes as never[]) }
}

const ORIG: Record<string, string | undefined> = {
  SystemRoot: process.env.SystemRoot,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  ProgramData: process.env.ProgramData,
  HOME: process.env.HOME
}

beforeAll(() => {
  process.env.SystemRoot = 'C:\\WIN'
  process.env.LOCALAPPDATA = 'C:\\TESTLOCAL'
  process.env.ProgramData = 'C:\\TESTPD'
  process.env.HOME = '/home/tester'
})

afterAll(() => {
  for (const [k, v] of Object.entries(ORIG)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('volumes 空间总览', () => {
  it('映射 fsSize 为 DiskVolume 并计算百分比', async () => {
    const total = 1000 * 1024 ** 3
    const used = 400 * 1024 ** 3
    const free = 600 * 1024 ** 3
    const fetcher = fakeFetcher([
      { mount: 'C:', fs: 'C:\\', type: 'NTFS', size: total, used, available: free, use: 40 }
    ])
    const { runner } = recordingRunner(() => fail('volumes 不应调用 runner'))
    const vols = await createDiskService(runner, 'win32', fetcher).volumes()
    expect(vols).toHaveLength(1)
    expect(vols[0].mount).toBe('C:')
    expect(vols[0].fsType).toBe('NTFS')
    expect(vols[0].percent).toBe(40)
    expect(vols[0].freeBytes).toBe(free)
    expect(vols[0].lowSpace).toBe(false)
  })

  it('已用 ≥90% 判定空间不足', async () => {
    const total = 1000 * 1024 ** 3
    const fetcher = fakeFetcher([
      { mount: 'D:', size: total, used: 950 * 1024 ** 3, available: 50 * 1024 ** 3, use: 95 }
    ])
    const { runner } = recordingRunner(() => fail())
    const vols = await createDiskService(runner, 'win32', fetcher).volumes()
    expect(vols[0].lowSpace).toBe(true)
  })

  it('可用 <10GiB 即使百分比不高也判定空间不足', async () => {
    const total = 100 * 1024 * 1024 * 1024
    const free = LOW_SPACE_BYTES - 1024
    const fetcher = fakeFetcher([
      { mount: 'E:', size: total, used: total - free, available: free, use: 90.0001 }
    ])
    const { runner } = recordingRunner(() => fail())
    const vols = await createDiskService(runner, 'win32', fetcher).volumes()
    expect(vols[0].lowSpace).toBe(true)
    expect(LOW_SPACE_PERCENT).toBe(90)
  })

  it('过滤 size=0 的伪卷', async () => {
    const fetcher = fakeFetcher([{ mount: 'x', size: 0, used: 0 }])
    const { runner } = recordingRunner(() => fail())
    const vols = await createDiskService(runner, 'linux', fetcher).volumes()
    expect(vols).toHaveLength(0)
  })
})

describe('深度清理清单 buildDeepCatalog', () => {
  it('Windows 清单含更新缓存/系统临时/DISM/休眠，且路径来自环境变量白名单根', () => {
    const cat = buildDeepCatalog('win32')
    const ids = cat.map((c) => c.id)
    expect(ids).toContain('win-update-cache')
    expect(ids).toContain('win-dism-cleanup')
    expect(ids).toContain('win-hibernate-off')
    const dism = cat.find((c) => c.id === 'win-dism-cleanup')
    expect(dism?.kind).toBe('action')
    expect(dism?.action).toContain('StartComponentCleanup')
    expect(dism?.action).not.toContain('ResetBase') // 不用激进的 ResetBase
    expect(dism?.defaultChecked).toBe(false)
    // 休眠改变系统行为，默认不勾
    expect(cat.find((c) => c.id === 'win-hibernate-off')?.defaultChecked).toBe(false)
    // 路径项落在 SystemRoot / LOCALAPPDATA / ProgramData 下
    const update = cat.find((c) => c.id === 'win-update-cache')
    expect(update?.path.startsWith('C:\\WIN')).toBe(true)
  })

  it('macOS 清单含 Library/Caches 与 brew 清理', () => {
    const cat = buildDeepCatalog('darwin')
    expect(cat.find((c) => c.id === 'mac-user-cache')?.path).toBe('/home/tester/Library/Caches')
    expect(cat.find((c) => c.id === 'mac-brew-cleanup')?.action).toContain('brew cleanup')
  })

  it('Linux 清单含 ~/.cache、journal 与 apt', () => {
    const cat = buildDeepCatalog('linux')
    expect(cat.map((c) => c.id)).toEqual([
      'linux-user-cache',
      'linux-journal-vacuum',
      'linux-apt-clean'
    ])
  })
})

describe('scanDeepCleanup', () => {
  it('Windows：解析 path 项 JSON 并补充 action 项', async () => {
    const raw = [
      {
        id: 'win-prefetch',
        kind: 'path',
        label: '预读取文件 Prefetch',
        detail: 'C:\\WIN\\Prefetch',
        path: 'C:\\WIN\\Prefetch',
        size: 2048,
        needsAdmin: false,
        safe: true,
        defaultChecked: true
      }
    ]
    const { runner, calls } = recordingRunner(() => ({ ...ok(), stdout: JSON.stringify(raw) }))
    const plans = await createDiskService(runner, 'win32').scanDeepCleanup()
    // path 项 1 个 + action 项（explorer-thumb/dism/hibernate）3 个
    expect(plans.filter((p) => p.kind === 'path')).toHaveLength(1)
    expect(plans.filter((p) => p.kind === 'action')).toHaveLength(3)
    expect(plans.find((p) => p.id === 'win-prefetch')?.sizeBytes).toBe(2048)
    expect(calls[0].script).toContain('__galeSizeDir')
  })

  it('Windows 缩略图项使用 __galeSizeFiles 与通配', () => {
    const script = buildDeepScanScript('win32')
    expect(script).toContain('thumbcache_*.db')
    expect(script).toContain('__galeSizeFiles')
  })

  it('单元素对象输出也能被容错为数组', async () => {
    const { runner } = recordingRunner(() => ({
      ...ok(),
      stdout: JSON.stringify({
        id: 'x',
        kind: 'path',
        label: 'l',
        detail: '',
        path: 'C:\\WIN\\Temp',
        size: 1,
        needsAdmin: false,
        safe: true,
        defaultChecked: true
      })
    }))
    const plans = await createDiskService(runner, 'win32').scanDeepCleanup()
    expect(plans.filter((p) => p.kind === 'path')).toHaveLength(1)
  })

  it('macOS 扫描脚本使用 du -sk 与 Library/Caches', async () => {
    const { runner, calls } = recordingRunner(() => ok('[]'))
    await createDiskService(runner, 'darwin').scanDeepCleanup()
    expect(calls[0].script).toContain('du -sk')
    expect(calls[0].script).toContain('/home/tester/Library/Caches')
  })

  it('Linux 扫描脚本覆盖 ~/.cache', async () => {
    const { runner, calls } = recordingRunner(() => ok('[]'))
    await createDiskService(runner, 'linux').scanDeepCleanup()
    expect(calls[0].script).toContain('/home/tester/.cache')
  })
})

describe('runDeepCleanup', () => {
  it('白名单 path 项执行 Remove-Item（Windows）', async () => {
    const { runner, calls } = recordingRunner(() => ok('OK'))
    const res = await createDiskService(runner, 'win32').runDeepCleanup(['win-system-temp'])
    expect(res[0].ok).toBe(true)
    expect(calls[0].script).toContain('Remove-Item')
  })

  it('缩略图项仅删除 thumbcache/iconcache 匹配文件', async () => {
    const { runner, calls } = recordingRunner(() => ok('OK'))
    await createDiskService(runner, 'win32').runDeepCleanup(['win-thumbnail'])
    const s = calls[0].script
    expect(s).toContain('thumbcache_*.db')
    expect(s).not.toContain('-Recurse') // 不递归清空整个 Explorer 目录
  })

  it('action 项执行 DISM 维护命令', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createDiskService(runner, 'win32').runDeepCleanup(['win-dism-cleanup'])
    expect(res[0].ok).toBe(true)
    expect(calls[0].script).toContain('StartComponentCleanup')
  })

  it('未知 id 被拒绝且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => fail('should-not-run'))
    // 只传 id：路径由服务端权威清单解析，客户端无法注入
    const res = await createDiskService(runner, 'win32').runDeepCleanup(['not-exist'])
    expect(res[0].ok).toBe(false)
    expect(res[0].error).toContain('未知')
    expect(calls).toHaveLength(0)
  })

  it('Linux path 项使用 find -mindepth 1 -delete', async () => {
    const { runner, calls } = recordingRunner(() => ok('OK'))
    const res = await createDiskService(runner, 'linux').runDeepCleanup(['linux-user-cache'])
    expect(res[0].ok).toBe(true)
    expect(calls[0].script).toContain('find')
    expect(calls[0].script).toContain('-mindepth 1 -depth -delete')
  })

  it('执行器非零退出码返回失败回执', async () => {
    const { runner } = recordingRunner(() => fail('access denied'))
    const res = await createDiskService(runner, 'win32').runDeepCleanup(['win-delivery'])
    expect(res[0].ok).toBe(false)
    expect(res[0].error).toContain('access denied')
  })
})

describe('诚实回执残留修复（不再无条件 OK / ; echo OK 吞失败）', () => {
  it('win-explorer-thumb 脚本统计删除失败并回 ERR:/exit 1，不再无条件 OK', () => {
    const cat = buildDeepCatalog('win32')
    const act = cat.find((c) => c.id === 'win-explorer-thumb')!.action
    // 仍会在成功时输出 OK，但必须有失败分支
    expect(act).toContain('"OK"')
    expect(act).toContain('ERR:')
    expect(act).toContain('exit 1')
    // 逐个 try/catch 计数失败，而不是 SilentlyContinue 一把吞掉
    expect(act).toContain('$failed')
    expect(act).toContain('ErrorAction Stop')
    // 无论成败都必须把资源管理器拉回来（安全底线）
    expect(act).toContain('Start-Process explorer.exe')
  })

  it('macOS brew 清理：未装 brew 跳过，但 cleanup 失败必须回 ERR:', () => {
    const act = buildDeepCatalog('darwin').find((c) => c.id === 'mac-brew-cleanup')!.action
    expect(act).toContain('brew cleanup -s')
    expect(act).toContain('ERR:')
    expect(act).toContain('exit 1')
    // 禁止旧的 `; echo OK` 吞失败模式
    expect(act).not.toContain('; echo OK')
  })

  it('Linux journal/apt 清理：按真实退出码收尾，失败回 ERR: 并不再恒 0', () => {
    const cat = buildDeepCatalog('linux')
    for (const id of ['linux-journal-vacuum', 'linux-apt-clean']) {
      const act = cat.find((c) => c.id === id)!.action
      expect(act).toContain('ERR:')
      expect(act).toContain('exit 1')
      expect(act).not.toContain('; echo OK')
    }
  })

  it('action 项即使退出码为 0，stdout 出现 ERR: 也必须判失败（explicitErr 机制）', async () => {
    // 模拟脚本：资源管理器拉回来了，但有缩略图删不掉，输出 ERR: 且退出码 0
    const { runner } = recordingRunner(() => ({
      stdout: 'ERR:部分缩略图缓存被占用或无权删除，未能完全清理',
      stderr: '',
      code: 0
    }))
    const res = await createDiskService(runner, 'win32').runDeepCleanup(['win-explorer-thumb'])
    expect(res[0].ok).toBe(false)
    // parseActionOutcome 会剥掉 "ERR:" 前缀，回传其后可读原因
    expect(res[0].error).toContain('缩略图缓存被占用')
  })

  it('action 项失败（退出码非 0）如实报失败，不再被末尾 OK 掩盖', async () => {
    const { runner } = recordingRunner(() => ({ stdout: 'OK', stderr: '', code: 1 }))
    const res = await createDiskService(runner, 'win32').runDeepCleanup(['win-dism-cleanup'])
    expect(res[0].ok).toBe(false)
  })
})

describe('checkVolume 磁盘检查/修复', () => {
  it('toWinDrive 仅接受盘符', () => {
    expect(toWinDrive('c:')).toBe('C:')
    expect(toWinDrive('C:\\')).toBe('C:')
    expect(toWinDrive('D:/')).toBe('D:')
    expect(toWinDrive('C:;format')).toBeNull()
    expect(toWinDrive('../etc')).toBeNull()
  })

  it('Windows 检查为只读 chkdsk（无 /scan /f）', () => {
    expect(buildCheckVolumeScript('C:', false, 'win32')).toBe('chkdsk C:')
  })

  it('Windows 修复使用 /scan 在线扫描（不锁定、不安排重启）', () => {
    const s = buildCheckVolumeScript('C:', true, 'win32')
    expect(s).toBe('chkdsk C: /scan')
    expect(s).not.toContain('/f')
    expect(s).not.toContain('/r')
  })

  it('非法盘符返回 null（防注入）', () => {
    expect(buildCheckVolumeScript('C: && rm', false, 'win32')).toBeNull()
  })

  it('macOS 使用 diskutil verify/repairVolume', () => {
    expect(buildCheckVolumeScript('/', false, 'darwin')).toContain('diskutil verifyVolume')
    expect(buildCheckVolumeScript('/', true, 'darwin')).toContain('diskutil repairVolume')
  })

  it('macOS 非法挂载点返回 null', () => {
    expect(buildCheckVolumeScript('/;rm', false, 'darwin')).toBeNull()
  })

  it('Linux 诚实降级：返回 unsupported 且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => fail('should-not-run'))
    const res = await createDiskService(runner, 'linux').checkVolume('/', false)
    expect(res.unsupported).toBe(true)
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('Windows 只读检查无问题时结论为未发现错误', async () => {
    const { runner } = recordingRunner(() =>
      ok('Windows has scanned the file system and found no problems.')
    )
    const res = await createDiskService(runner, 'win32').checkVolume('C:', false)
    expect(res.ok).toBe(true)
    expect(res.repaired).toBe(false)
    expect(res.summary).toContain('未检测到文件系统错误')
  })

  it('Windows 在线修复命中修复关键词时 repaired=true', async () => {
    const { runner } = recordingRunner(() => ok('corruption was successfully repaired online'))
    const res = await createDiskService(runner, 'win32').checkVolume('C:', true)
    expect(res.ok).toBe(true)
    expect(res.repaired).toBe(true)
  })
})

describe('repairSystemFiles 系统文件 / DLL 修复', () => {
  it('Windows SFC 脚本为 sfc /scannow，DISM 为 RestoreHealth', () => {
    expect(buildSystemRepairScript('sfc', 'win32')).toBe('sfc /scannow')
    expect(buildSystemRepairScript('dism-restore', 'win32')).toContain('RestoreHealth')
  })

  it('非 Windows 返回 null（诚实降级）', () => {
    expect(buildSystemRepairScript('sfc', 'darwin')).toBeNull()
    expect(buildSystemRepairScript('sfc', 'linux')).toBeNull()
  })

  it('SFC 未发现完整性冲突 → 系统文件完整', async () => {
    const { runner } = recordingRunner(() =>
      ok('Windows Resource Protection did not find any integrity violations.')
    )
    const res = await createDiskService(runner, 'win32').repairSystemFiles('sfc')
    expect(res.ok).toBe(true)
    expect(res.repaired).toBe(false)
    expect(res.summary).toContain('完整')
  })

  it('SFC 命中成功修复关键词 → repaired=true', async () => {
    const { runner } = recordingRunner(() =>
      ok('Windows Resource Protection found corrupt files and successfully repaired them.')
    )
    const res = await createDiskService(runner, 'win32').repairSystemFiles('sfc')
    expect(res.ok).toBe(true)
    expect(res.repaired).toBe(true)
    expect(res.summary).toContain('已成功修复')
  })

  it('DISM 退出码 0 → 修复完成', async () => {
    const { runner, calls } = recordingRunner(() => ok('The restore operation completed successfully.'))
    const res = await createDiskService(runner, 'win32').repairSystemFiles('dism-restore')
    expect(res.ok).toBe(true)
    expect(calls[0].script).toContain('Cleanup-Image /RestoreHealth')
  })

  it('非零退出码标记需要管理员', async () => {
    const { runner } = recordingRunner(() => fail('You must be an administrator'))
    const res = await createDiskService(runner, 'win32').repairSystemFiles('sfc')
    expect(res.ok).toBe(false)
    expect(res.needsAdmin).toBe(true)
  })

  it('macOS 诚实降级：unsupported 且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => fail('should-not-run'))
    const res = await createDiskService(runner, 'darwin').repairSystemFiles('sfc')
    expect(res.unsupported).toBe(true)
    expect(calls).toHaveLength(0)
  })
})
