import { describe, it, expect } from 'vitest'
import {
  createProcessService,
  parseProcessList,
  parseActionResult,
  sortProcesses,
  PRIORITY_CLASS,
  PROTECTED_NAMES
} from './process'
import type { ExecRunner } from './shell'

function recordingRunner(respond: (script: string) => { stdout: string; stderr: string; code: number }) {
  const calls: string[] = []
  const runner: ExecRunner = {
    run: (script: string) => {
      calls.push(script)
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

describe('parseProcessList', () => {
  it('解析合法 JSON 数组为 ProcessInfo', () => {
    const raw = [
      { pid: 1234, name: 'chrome', cpu: 12.5, mem: 345.6, status: 'running', protected: false },
      { pid: 0, name: 'System', cpu: 0, mem: 0, status: 'running', protected: true }
    ]
    const list = parseProcessList(JSON.stringify(raw))
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ pid: 1234, name: 'chrome', cpuPercent: 12.5, memMB: 345.6, status: 'running', protected: false })
    expect(list[1].protected).toBe(true)
  })

  it('空输出返回空数组', () => {
    expect(parseProcessList('')).toEqual([])
  })

  it('非法 JSON 容错返回空数组', () => {
    expect(parseProcessList('not json')).toEqual([])
  })

  it('字段缺失/非法数值容错为 0', () => {
    const list = parseProcessList(JSON.stringify([{ pid: 'abc', name: 'x' }]))
    expect(list[0].pid).toBe(0)
    expect(list[0].cpuPercent).toBe(0)
    expect(list[0].memMB).toBe(0)
    expect(list[0].status).toBe('running')
  })
})

describe('sortProcesses', () => {
  const base = [
    { pid: 1, name: 'aaa', cpuPercent: 5, memMB: 100, status: 'running' as const, protected: false },
    { pid: 2, name: 'ccc', cpuPercent: 90, memMB: 50, status: 'running' as const, protected: false },
    { pid: 3, name: 'bbb', cpuPercent: 40, memMB: 300, status: 'running' as const, protected: false }
  ]
  it('cpu 降序', () => {
    expect(sortProcesses(base, 'cpu').map((p) => p.pid)).toEqual([2, 3, 1])
  })
  it('mem 降序', () => {
    expect(sortProcesses(base, 'mem').map((p) => p.pid)).toEqual([3, 1, 2])
  })
  it('name 升序', () => {
    expect(sortProcesses(base, 'name').map((p) => p.pid)).toEqual([1, 3, 2])
  })
  it('不传 sort 保持原顺序', () => {
    expect(sortProcesses(base).map((p) => p.pid)).toEqual([1, 2, 3])
  })
})

describe('parseActionResult', () => {
  it('OK 判定成功', () => {
    expect(parseActionResult('OK')).toEqual({ ok: true, message: '操作成功' })
  })
  it('ERR: 前缀提取错误信息', () => {
    expect(parseActionResult('ERR:进程不存在')).toEqual({ ok: false, message: '进程不存在' })
  })
  it('空/未知输出判定失败', () => {
    expect(parseActionResult('').ok).toBe(false)
    expect(parseActionResult('some output').ok).toBe(false)
  })
})

describe('createProcessService', () => {
  it('kill 脚本包含 Stop-Process 与目标 pid', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createProcessService(runner).kill(4321)
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('Stop-Process -Id 4321')
  })

  it('kill 脚本包含系统进程保护校验（guard）', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    await createProcessService(runner).kill(999)
    expect(calls[0]).toContain('受保护的系统进程，已拒绝')
    expect(calls[0]).toContain('Get-Process -Id 999')
  })

  it('suspend 脚本使用 NtSuspendProcess', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createProcessService(runner).suspend(111)
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('NtSuspendProcess')
  })

  it('resume 脚本使用 NtResumeProcess', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createProcessService(runner).resume(222)
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('NtResumeProcess')
  })

  it('priority 合法等级映射为 PriorityClass 且注入 pid', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createProcessService(runner).priority(333, 'high')
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('PriorityClass = "High"')
    expect(calls[0]).toContain('Get-Process -Id 333')
  })

  it('priority 非法等级直接拒绝且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createProcessService(runner).priority(333, 'realtime' as never)
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('list 返回按 sort 排序的结果', async () => {
    const raw = [
      { pid: 1, name: 'a', cpu: 10, mem: 5 },
      { pid: 2, name: 'b', cpu: 80, mem: 8 }
    ]
    const { runner } = recordingRunner(() => ({ ...ok(), stdout: JSON.stringify(raw) }))
    const list = await createProcessService(runner).list('cpu')
    expect(list[0].pid).toBe(2)
  })
})

describe('常量', () => {
  it('PRIORITY_CLASS 覆盖全部合法等级', () => {
    expect(Object.keys(PRIORITY_CLASS).sort()).toEqual(
      ['aboveNormal', 'belowNormal', 'high', 'low', 'normal']
    )
  })
  it('PROTECTED_NAMES 包含关键系统进程', () => {
    expect(PROTECTED_NAMES).toContain('lsass')
    expect(PROTECTED_NAMES).toContain('csrss')
    expect(PROTECTED_NAMES).toContain('System')
  })
})
