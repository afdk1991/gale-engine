import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createOptimizerService } from './optimizer'
import type { ExecRunner } from './shell'

// createOptimizerService 的 meter 参数有**默认实现**（systeminformation 实测磁盘可用空间），
// 目的是让「调用方忘记注入」不再可能（这正是一处历史缺陷的成因）。
// 单元测试必须保持无 IO：这里**只替换读磁盘的那一层**（fetcher），
// createSpaceMeter / mountOfPath / diffReleasedBytes 全部保留真实实现，
// 因此测试覆盖的是真实接线逻辑，而不是被整体替换掉的桩。
// 交替返回两个可用空间值，等价于「清理后腾出 2MB」。
vi.mock('./space', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./space')>()
  return {
    ...actual,
    createSystemInformationSpaceFetcher: () => {
      let call = 0
      return {
        fsSize: async () => [
          {
            mount: 'C:',
            size: 1_000_000_000,
            used: 1,
            available: call++ % 2 === 0 ? 1_000_000 : 3_000_000
          }
        ]
      }
    }
  }
})

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

const ORIG_TEMP = process.env.TEMP
const ORIG_SYSTEMROOT = process.env.SystemRoot
const ORIG_LOCALAPPDATA = process.env.LOCALAPPDATA
const ORIG_TMPDIR = process.env.TMPDIR
const ORIG_HOME = process.env.HOME

beforeAll(() => {
  // 固化安全白名单根，避免测试机真实环境变量影响断言。
  // TMPDIR/HOME 必须一并固化：allowedTempRoots('linux'/'darwin') 用 TMPDIR||'/tmp'，
  // allowedBrowserRoots(unix) 用 HOME；本机 Windows 若设了 TMPDIR 指向 Windows 路径，
  // 会使 linux 分支 isSafePath('/tmp') 失败，污染跨平台测试断言。
  process.env.TEMP = 'C:\\TESTTEMP'
  process.env.SystemRoot = 'C:\\WIN'
  process.env.LOCALAPPDATA = 'C:\\TESTLOCAL'
  process.env.TMPDIR = '/tmp'
  process.env.HOME = '/home/tester'
})

afterAll(() => {
  // 用 delete 恢复而非赋值：ORIG_* 可能为 undefined（环境变量未设），
  // process.env.X = undefined 会写入字符串 "undefined"，在跨平台 CI 上污染后续测试。
  function restore(key: string, orig: string | undefined): void {
    if (orig === undefined) delete process.env[key]
    else process.env[key] = orig
  }
  restore('TEMP', ORIG_TEMP)
  restore('SystemRoot', ORIG_SYSTEMROOT)
  restore('LOCALAPPDATA', ORIG_LOCALAPPDATA)
  restore('TMPDIR', ORIG_TMPDIR)
  restore('HOME', ORIG_HOME)
})

describe('scanCleanup', () => {
  it('解析合法 JSON 数组为 CleanupPlan', async () => {
    const raw = [
      { id: 'temp:abc', kind: 'temp', label: '临时文件：C:\\TESTTEMP', path: 'C:\\TESTTEMP', size: 1234, safe: true }
    ]
    const { runner } = recordingRunner(() => ({ ...ok(), stdout: JSON.stringify(raw) }))
    const plans = await createOptimizerService(runner, 'win32').scanCleanup()
    expect(plans).toHaveLength(1)
    expect(plans[0].sizeBytes).toBe(1234)
    expect(plans[0].kind).toBe('temp')
  })

  it('空输出返回空数组', async () => {
    const { runner } = recordingRunner(() => ok(''))
    const plans = await createOptimizerService(runner, 'win32').scanCleanup()
    expect(plans).toEqual([])
  })

  it('非法 JSON 容错返回空数组（不抛异常）', async () => {
    const { runner } = recordingRunner(() => ok('not json at all'))
    const plans = await createOptimizerService(runner, 'win32').scanCleanup()
    expect(plans).toEqual([])
  })

  it('解析浏览器缓存项（kind=browser）', async () => {
    const raw = [
      { id: 'browser:xyz', kind: 'browser', label: 'Chrome 缓存：Cache', path: 'C:\\TESTLOCAL\\Google\\Chrome\\User Data\\Default\\Cache', size: 2048, safe: true }
    ]
    const { runner } = recordingRunner(() => ({ ...ok(), stdout: JSON.stringify(raw) }))
    const plans = await createOptimizerService(runner, 'win32').scanCleanup()
    expect(plans[0].kind).toBe('browser')
    expect(plans[0].sizeBytes).toBe(2048)
  })
})

describe('runCleanup', () => {
  // 权威扫描返回的合法清单（id → path/kind/safe 全部以此为准）
  const WIN_PLANS = [
    { id: 'temp:1', kind: 'temp', label: '临时文件', path: 'C:\\TESTTEMP', size: 1, safe: true },
    { id: 'recycle', kind: 'recycle', label: '回收站', path: 'RecycleBin', size: 1, safe: true },
    { id: 'browser:1', kind: 'browser', label: 'Chrome 缓存', path: 'C:\\TESTLOCAL\\Google\\Chrome\\User Data\\Default\\Cache', size: 1, safe: true }
  ]
  // H3：runCleanup 现在内部先跑一次权威扫描，再按 id 执行清理。
  // 这个假 runner 对「扫描脚本」回 WIN_PLANS，对「清理脚本」回默认成功。
  const winRunner = (plans: unknown[] = WIN_PLANS, cleanup?: (s: string) => { stdout: string; stderr: string; code: number }) =>
    recordingRunner((s) => {
      if (s.includes('Clear-RecycleBin')) return ok('OK')
      if (s.includes('Remove-Item')) {
        return cleanup
          ? cleanup(s)
          : ok(JSON.stringify({ deletedBytes: 0, deletedCount: 1, failedCount: 0, locked: [] }))
      }
      return { ...ok(), stdout: JSON.stringify(plans) }
    })

  it('未显式注入 meter 时也会实测释放量（回归：此前调用方漏传 meter，releasedBytes 恒缺失，界面显示「释放 0 B」）', async () => {
    const { runner } = winRunner()
    const res = await createOptimizerService(runner, 'win32').runCleanup(['temp:1'])
    // stub meter 交替返回 1MB / 3MB，差值应为 2MB —— 能取到数值即证明默认 meter 真的被接线了
    expect(res[0].releasedBytes).toBe(2_000_000)
  })

  it('显式注入 meter 时使用注入的实现（便于主进程共享一份实测器）', async () => {
    let call = 0
    const injected = {
      freeBytes: async () => 0,
      freeBytesForPath: async () => (call++ % 2 === 0 ? 5_000_000 : 9_000_000)
    }
    const { runner } = winRunner()
    const res = await createOptimizerService(runner, 'win32', injected).runCleanup(['temp:1'])
    expect(res[0].releasedBytes).toBe(4_000_000)
  })

  it('无法推断卷（如 RecycleBin 这类虚拟路径）时不产出 releasedBytes，而不是报 0', async () => {
    const { runner } = winRunner()
    const res = await createOptimizerService(runner, 'win32').runCleanup(['recycle'])
    expect(res[0].ok).toBe(true)
    // RecycleBin 无盘符 → mountOfPath 返回 null → 真实 meter 返回 null → 不写 releasedBytes
    expect('releasedBytes' in res[0]).toBe(false)
  })

  it('回收站项走 Clear-RecycleBin 并返回成功', async () => {
    const { runner, calls } = winRunner()
    const res = await createOptimizerService(runner, 'win32').runCleanup(['recycle'])
    expect(res).toHaveLength(1)
    expect(res[0].ok).toBe(true)
    expect(res[0].error).toBeUndefined()
    expect(calls.some((c) => c.script.includes('Clear-RecycleBin'))).toBe(true)
  })

  it('白名单内临时路径（按 id 命中权威清单）执行 Remove-Item 并返回成功', async () => {
    const { runner, calls } = winRunner()
    const res = await createOptimizerService(runner, 'win32').runCleanup(['temp:1'])
    expect(res[0].ok).toBe(true)
    expect(calls.some((c) => c.script.includes('Remove-Item'))).toBe(true)
  })

  it('浏览器缓存白名单路径（按 id 命中权威清单）放行并执行 Remove-Item', async () => {
    const { runner, calls } = winRunner()
    const res = await createOptimizerService(runner, 'win32').runCleanup(['browser:1'])
    expect(res[0].ok).toBe(true)
    expect(calls.some((c) => c.script.includes('Remove-Item'))).toBe(true)
  })

  it('混合合法 id 与未知 id：合法项成功，未知项被拒', async () => {
    const { runner } = winRunner()
    const res = await createOptimizerService(runner, 'win32').runCleanup(['temp:1', 'unknown-id'])
    expect(res).toHaveLength(2)
    expect(res[0].ok).toBe(true)
    expect(res[1].ok).toBe(false)
    expect(res[1].error).toContain('未知清理项')
  })

  // ★ H3 安全回归：旧契约允许渲染层传 path，`C:\TESTTEMP\..\..\Windows` 这类
  // 「根\..\..\」既以前缀命中白名单、又能穿越到任意目录。现在 runCleanup 只收 id，
  // 路径由服务端权威扫描解析；伪造/穿越 id 一律拒绝，且穿越路径绝不能拼进执行脚本。
  it('H3 回归：含「根\\..\\..\\」穿越路径的 id 被拒，且穿越路径不进入任何执行脚本', async () => {
    const { runner, calls } = winRunner()
    const svc = createOptimizerService(runner, 'win32')
    const res = await svc.runCleanup(['temp:1', 'C:\\TESTTEMP\\..\\..\\Windows'])
    expect(res[0].ok).toBe(true) // 合法 id 正常清理
    expect(res[1].ok).toBe(false)
    expect(res[1].error).toContain('未知清理项')
    // 穿越路径绝不能出现在任何被执行的脚本里（含扫描与清理）
    expect(calls.some((c) => c.script.includes('..\\..\\Windows'))).toBe(false)
    // 也绝不为这个伪造 id 发起删除
    expect(calls.filter((c) => c.script.includes('Remove-Item'))).toHaveLength(1) // 只清理 temp:1
  })

  it('H3 回归：以前缀看似命中白名单、实则穿越的 id 同样被拒', async () => {
    const { runner, calls } = winRunner()
    const svc = createOptimizerService(runner, 'win32')
    const res = await svc.runCleanup(['C:\\TESTTEMP\\..\\..\\WIN\\System32'])
    expect(res[0].ok).toBe(false)
    expect(res[0].error).toContain('未知清理项')
    expect(calls.filter((c) => c.script.includes('Remove-Item'))).toHaveLength(0)
  })

  it('去重：同一 id 重复传入只清理一次', async () => {
    const { runner, calls } = winRunner()
    const res = await createOptimizerService(runner, 'win32').runCleanup(['temp:1', 'temp:1'])
    expect(res).toHaveLength(1)
    expect(calls.filter((c) => c.script.includes('Remove-Item'))).toHaveLength(1)
  })
})

describe('listStartup', () => {
  it('解析注册表项 JSON 为 StartupItem，并处理 HKLM/HKCU 位置', async () => {
    const raw = [
      { name: 'OneDrive', command: 'C:\\OneDrive.exe', location: 'HKCU', enabled: true },
      { name: 'Svc', command: 'C:\\svc.exe', location: 'HKLM', enabled: true }
    ]
    const { runner } = recordingRunner(() => ({ ...ok(), stdout: JSON.stringify(raw) }))
    const items = await createOptimizerService(runner, 'win32').listStartup()
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe('HKCU:OneDrive')
    expect(items[1].id).toBe('HKLM:Svc')
  })
})

describe('toggleStartup', () => {
  it('enable 调用 Set-ItemProperty 并返回更新后的列表', async () => {
    const updated = [{ name: 'App', command: 'C:\\app.exe', location: 'HKCU', enabled: true }]
    const { runner, calls } = recordingRunner((s) =>
      s.includes('Set-ItemProperty')
        ? ok('OK')
        : { ...ok(), stdout: JSON.stringify(updated) }
    )
    const res = await createOptimizerService(runner, 'win32').toggleStartup('HKCU:App', true, 'C:\\app.exe')
    expect(calls.some((c) => c.script.includes('Set-ItemProperty'))).toBe(true)
    expect(res).toHaveLength(1)
    expect(res[0].enabled).toBe(true)
  })

  it('disable 调用 Remove-ItemProperty', async () => {
    const { runner, calls } = recordingRunner((s) =>
      s.includes('Remove-ItemProperty') ? ok() : fail()
    )
    await createOptimizerService(runner, 'win32').toggleStartup('HKCU:App', false)
    expect(calls.some((c) => c.script.includes('Remove-ItemProperty'))).toBe(true)
  })

  // 低危回归：脚本失败必须抛错（旧实现无论成败都 return listStartup()，界面假成功）
  it('脚本返回 ERR 时抛错而非吞掉（不再假成功）', async () => {
    const { runner } = recordingRunner(() => ({ stdout: 'ERR:权限不足', stderr: '', code: 1 }))
    await expect(
      createOptimizerService(runner, 'win32').toggleStartup('HKCU:App', false)
    ).rejects.toThrow(/权限不足/)
  })
})
describe('optimizer unix 分支', () => {
  it('scanCleanup(darwin) 扫描 Trash 与 Library/Caches', async () => {
    const { runner, calls } = recordingRunner(() => ok('[]'))
    await createOptimizerService(runner, 'darwin').scanCleanup()
    expect(calls[0].script).toContain('du -sk')
    expect(calls[0].script).toContain('.Trash')
    expect(calls[0].script).toContain('Library/Caches/Google/Chrome')
  })

  it('scanCleanup(linux) 扫描 XDG Trash 与 .cache', async () => {
    const { runner, calls } = recordingRunner(() => ok('[]'))
    await createOptimizerService(runner, 'linux').scanCleanup()
    expect(calls[0].script).toContain('.local/share/Trash')
    expect(calls[0].script).toContain('.cache/google-chrome')
  })

  it('listStartup(darwin) 使用 PlistBuddy', async () => {
    const { runner, calls } = recordingRunner(() => ok('[]'))
    await createOptimizerService(runner, 'darwin').listStartup()
    expect(calls[0].script).toContain('PlistBuddy')
    expect(calls[0].script).toContain('LaunchAgents')
  })

  it('listStartup(linux) 扫描 autostart .desktop', async () => {
    const { runner, calls } = recordingRunner(() => ok('[]'))
    await createOptimizerService(runner, 'linux').listStartup()
    expect(calls[0].script).toContain('.config/autostart')
    expect(calls[0].script).toContain('.desktop')
  })

  it('toggleStartup(launchd) enable 生成 plist XML', async () => {
    const { runner, calls } = recordingRunner(() => ok('OK'))
    await createOptimizerService(runner, 'darwin').toggleStartup('launchd:com.gale.test', true, '/usr/bin/app')
    const s = calls[0].script
    expect(s).toContain('LaunchAgents/com.gale.test.plist')
    expect(s).toContain('RunAtLoad')
    expect(s).toContain('com.gale.test')
  })

  it('toggleStartup(launchd) enable 不覆盖已存在的原始 plist（回归：曾无条件 cat > 覆盖）', async () => {
    const { runner, calls } = recordingRunner(() => ok('OK'))
    await createOptimizerService(runner, 'darwin').toggleStartup('launchd:com.gale.test', true, '/usr/bin/app')
    const s = calls[0].script
    // 回归：旧脚本先 mv .disabled 还原、紧接着无条件 cat > 覆盖，
    // 会把原始 plist 的 KeepAlive / 环境变量 / 多参数全部抹掉，且不可撤销。
    // 现在必须在 .disabled 存在或 plist 已存在时直接返回，不再写新内容。
    expect(s).toContain('if [ -f')
    expect(s).toContain('.disabled ]')
    expect(s).toContain('elif [ -f')
    // 写入分支必须在 else 里，且前面不能被无条件执行
    const writeIdx = s.indexOf('GALE_PLIST_EOF')
    const elseIdx = s.lastIndexOf('else', writeIdx)
    expect(elseIdx).toBeGreaterThan(-1)
    expect(elseIdx).toBeLessThan(writeIdx)
  })

  it('toggleStartup(autostart) disable 写 Hidden=true 而非删文件（保证可再启用）', async () => {
    const { runner, calls } = recordingRunner(() => ok('OK'))
    await createOptimizerService(runner, 'linux').toggleStartup('autostart:myapp', false)
    const s = calls[0].script
    // 回归：旧实现 `rm -f` 删除 .desktop，项随即从列表消失，没有 command 可供再启用
    expect(s).not.toContain('rm -f')
    expect(s).toContain('Hidden=true')
    expect(s).toContain('myapp.desktop')
  })

  it('runCleanup 回收站(darwin) 使用 osascript', async () => {
    const plans = [
      { id: 'recycle', kind: 'recycle', label: 'Trash', path: '/home/tester/.Trash', size: 1, safe: true }
    ]
    const { runner, calls } = recordingRunner((s) =>
      s.includes('osascript') ? ok() : { ...ok(), stdout: JSON.stringify(plans) }
    )
    const res = await createOptimizerService(runner, 'darwin').runCleanup(['recycle'])
    expect(res[0].ok).toBe(true)
    expect(calls.some((c) => c.script.includes('empty trash'))).toBe(true)
  })

  it('runCleanup 白名单(linux) 放行 /tmp，未知 id 拒绝', async () => {
    const plans = [{ id: 't1', kind: 'temp', label: 'tmp', path: '/tmp', size: 1, safe: true }]
    const { runner, calls } = recordingRunner((s) =>
      s.includes('find "$p"')
        ? ok(JSON.stringify({ deletedBytes: 0, deletedCount: 1, failedCount: 0, locked: [] }))
        : { ...ok(), stdout: JSON.stringify(plans) }
    )
    const svc = createOptimizerService(runner, 'linux')
    const okRes = await svc.runCleanup(['t1'])
    expect(okRes[0].ok).toBe(true)
    expect(calls.some((c) => c.script.includes('find "$p"'))).toBe(true)
    const badRes = await svc.runCleanup(['C:\\Windows\\Temp'])
    expect(badRes[0].ok).toBe(false)
    expect(badRes[0].error).toContain('未知清理项')
  })

  it('回收站脚本(darwin/linux) 失败时必须回 ERR 而非无条件 OK（回归：`; echo "OK"`）', async () => {
    // 回归：旧写法 `A || B; echo "OK"` —— shell 中 `;` 之后的 echo 恒成功，
    // parseActionOutcome 必然判定 ok，清理失败也报「成功」并写入历史。
    const svc = createOptimizerService(recordingRunner(() => ok('')).runner, 'darwin')
    const plans = [{ id: 'recycle', kind: 'recycle', label: 'Trash', path: '/x', size: 1, safe: true }]
    const { runner, calls } = recordingRunner((s) =>
      s.includes('empty trash') ? ok('') : { ...ok(), stdout: JSON.stringify(plans) }
    )
    void svc
    const res = await createOptimizerService(runner, 'darwin').runCleanup(['recycle'])
    const script = calls.find((c) => c.script.includes('empty trash'))?.script ?? ''
    expect(script).toContain('ERR:清空回收站失败')
    // 关键：`echo "OK"` 不能出现在无条件执行的位置（必须包在 if/elif 分支里）
    expect(script).not.toMatch(/; *echo "OK"/)
    // 空输出走严格判定 → 如实报失败
    expect(res[0].ok).toBe(false)
  })

  it('回收站脚本(linux) 走 XDG Trash 且失败回 ERR', async () => {
    const plans = [{ id: 'recycle', kind: 'recycle', label: 'Trash', path: '/x', size: 1, safe: true }]
    // 扫描脚本与清理脚本都含 .local/share/Trash，无法用内容筛选 ——
    // 改按调用序区分：第 1 次是扫描（回清单），之后是清理（回空输出＝失败）。
    let n = 0
    const { runner, calls } = recordingRunner(() => (n++ === 0 ? { ...ok(), stdout: JSON.stringify(plans) } : ok('')))
    await createOptimizerService(runner, 'linux').runCleanup(['recycle'])
    const script = calls.find((c) => c.script.includes('Trash/files/"*'))?.script ?? ''
    expect(script).toContain('ERR:清空回收站失败')
    expect(script).not.toMatch(/; *echo "OK"/)
  })

  it('解析 launchd/autostart location 的 StartupItem', async () => {
    const raw = [
      { name: 'com.x', command: '/bin/x', location: 'launchd', enabled: true },
      { name: 'y', command: '/bin/y', location: 'autostart', enabled: true }
    ]
    const { runner } = recordingRunner(() => ({ ...ok(), stdout: JSON.stringify(raw) }))
    const items = await createOptimizerService(runner, 'linux').listStartup()
    expect(items[0].id).toBe('launchd:com.x')
    expect(items[1].id).toBe('autostart:y')
  })
})
