import { describe, it, expect } from 'vitest'
import type { ExecResult, ExecRunner } from './shell'
import {
  buildIsElevatedScript,
  parseIsElevated,
  buildElevatedRunScript,
  buildRelaunchElevatedScript,
  macAppPath,
  createElevator,
  type TempIo
} from './elevate'

function recordingRunner(
  respond: (script: string) => ExecResult
): { runner: ExecRunner; calls: string[] } {
  const calls: string[] = []
  const runner: ExecRunner = {
    run: (script: string) => {
      calls.push(script)
      return Promise.resolve(respond(script))
    }
  }
  return { runner, calls }
}

/** 内存版 TempIo，不落盘；writes 持久记录所有写入内容（不被 unlink 清除） */
function memoryIo(): { io: TempIo; store: Map<string, string>; writes: Map<string, string> } {
  const store = new Map<string, string>()
  const writes = new Map<string, string>()
  const io: TempIo = {
    writeFile: async (p, c) => { store.set(p, c); writes.set(p, c) },
    readFile: async (p) => {
      const v = store.get(p)
      if (v === undefined) throw new Error('missing')
      return v
    },
    unlink: async (p) => { store.delete(p) }
  }
  return { io, store, writes }
}

const ok = (stdout = '', code = 0): ExecResult => ({ stdout, stderr: '', code })

describe('提权检测脚本/解析', () => {
  it('Windows 脚本检测 Administrator 角色', () => {
    const s = buildIsElevatedScript('win32')
    expect(s).toContain('Administrator')
    expect(s).toContain('"True"')
  })
  it('unix 脚本用 id -u 判定 root', () => {
    expect(buildIsElevatedScript('linux')).toContain('id -u')
    expect(buildIsElevatedScript('darwin')).toContain('id -u')
  })
  it('parseIsElevated 正确解析 True/False', () => {
    expect(parseIsElevated('True')).toBe(true)
    expect(parseIsElevated('false')).toBe(false)
    expect(parseIsElevated('  TRUE  ')).toBe(true)
  })
  it('退出码非零时保守按未提权处理', () => {
    expect(parseIsElevated('True', 1)).toBe(false)
  })
})

describe('buildElevatedRunScript', () => {
  it('Windows 用 ShellExecute runas 并落盘输出', () => {
    const s = buildElevatedRunScript({ scriptPath: 'a.ps1', outPath: 'a.out', errPath: 'a.err', platform: 'win32' })
    expect(s).toContain('-Verb RunAs')
    expect(s).toContain('RedirectStandardOutput')
    expect(s).toContain('RedirectStandardError')
  })
  it('unix 优先 pkexec 再 sudo -n', () => {
    const s = buildElevatedRunScript({ scriptPath: 'a.sh', outPath: 'a.out', errPath: 'a.err', platform: 'linux' })
    expect(s).toContain('pkexec')
    expect(s).toContain('sudo -n')
    expect(s).toContain('exit 127')
  })
})

describe('buildRelaunchElevatedScript / macAppPath', () => {
  it('Windows 以 RunAs 重启 exe', () => {
    expect(buildRelaunchElevatedScript('C:\\p\\app.exe', 'win32')).toContain('-Verb RunAs')
  })
  it('macOS 用 osascript administrator privileges 重启 .app', () => {
    const s = buildRelaunchElevatedScript('/A/疾风引擎.app/Contents/MacOS/疾风引擎', 'darwin')
    expect(s).toContain('osascript')
    expect(s).toContain('administrator privileges')
    expect(s).toContain('/A/疾风引擎.app')
  })
  it('Linux 不支持应用内提权重启，返回 null', () => {
    expect(buildRelaunchElevatedScript('/usr/bin/app', 'linux')).toBeNull()
  })
  it('空路径返回 null', () => {
    expect(buildRelaunchElevatedScript('', 'win32')).toBeNull()
  })
  it('macAppPath 由 MacOS 二进制还原 .app', () => {
    expect(macAppPath('/A/疾风引擎.app/Contents/MacOS/疾风引擎')).toBe('/A/疾风引擎.app')
    expect(macAppPath('/usr/local/bin/app')).toBeNull()
  })
})

describe('createElevator', () => {
  it('isElevated 透传解析结果', async () => {
    const { runner } = recordingRunner(() => ok('True'))
    const e = createElevator({ runner, platform: 'win32' })
    expect(await e.isElevated()).toBe(true)
  })

  it('runElevated 写入 payload 并回收提权子进程重定向输出', async () => {
    const { runner, calls } = recordingRunner(() => ok('', 0))
    const { io, store, writes } = memoryIo()
    const e = createElevator({ runner, platform: 'win32', io, tmpDir: '/tmp', newId: () => 'id1' })
    const res = await e.runElevated('Write-Host hello')
    // 外层提权脚本被调用
    expect(calls[0]).toContain('-Verb RunAs')
    // payload 文件内容被写入（含 BOM 防 GBK 乱码）；临时文件在 finally 中已被清理，
    // 故从持久记录的 writes 中校验写入内容（路径分隔符随平台变化，按内容匹配）。
    expect(Array.from(writes.values()).some((v) => v.includes('Write-Host hello'))).toBe(true)
    // 重定向输出被读回
    expect(res.stdout).toBe('')
  })

  it('UAC 被取消（非零退出且无输出）时给出明确提示', async () => {
    const { runner } = recordingRunner(() => ok('', 1))
    const { io } = memoryIo()
    const e = createElevator({ runner, platform: 'win32', io, tmpDir: '/tmp', newId: () => 'id2' })
    const res = await e.runElevated('anything')
    expect(res.code).toBe(1)
    expect(res.stderr).toContain('UAC')
  })

  it('restartElevated 已提权时无需重启', async () => {
    const { runner } = recordingRunner(() => ok('True'))
    let quitCalled = false
    const e = createElevator({
      runner,
      platform: 'win32',
      exePath: 'C:\\p\\app.exe',
      quit: () => { quitCalled = true }
    })
    const r = await e.restartElevated()
    expect(r.ok).toBe(true)
    expect(quitCalled).toBe(false)
  })

  it('restartElevated 未提权时发起重启并退出旧实例', async () => {
    const { runner, calls } = recordingRunner(() => ok('False'))
    let quitCalled = false
    const e = createElevator({
      runner,
      platform: 'win32',
      exePath: 'C:\\p\\app.exe',
      quit: () => { quitCalled = true }
    })
    const r = await e.restartElevated()
    expect(r.ok).toBe(true)
    expect(quitCalled).toBe(true)
    expect(calls[1]).toContain('-Verb RunAs')
  })
})
