import { describe, it, expect } from 'vitest'
import { createTasksService, parseTaskList, parseTaskResult, isSafeTaskToken } from './tasks'
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

describe('isSafeTaskToken', () => {
  it('常规路径与名称通过', () => {
    expect(isSafeTaskToken('\\Microsoft\\Windows\\Defrag')).toBe(true)
    expect(isSafeTaskToken('MyTask_1')).toBe(true)
    expect(isSafeTaskToken('\\')).toBe(true)
  })

  it('注入向量拒绝：单引号 / 分号 / 管道 / $ / 反引号 / 换行', () => {
    expect(isSafeTaskToken("x'; rm -rf; '")).toBe(false)
    expect(isSafeTaskToken('a;b')).toBe(false)
    expect(isSafeTaskToken('a|b')).toBe(false)
    expect(isSafeTaskToken('a$b')).toBe(false)
    expect(isSafeTaskToken('a`b')).toBe(false)
    expect(isSafeTaskToken('a\nb')).toBe(false)
  })

  it('空串与超长拒绝', () => {
    expect(isSafeTaskToken('')).toBe(false)
    expect(isSafeTaskToken('x'.repeat(261))).toBe(false)
  })
})

describe('parseTaskList', () => {
  it('解析 JSON 数组', () => {
    const raw = [
      { taskPath: '\\', taskName: 'T1', state: 'Ready', lastRunTime: '2026-09-01 10:00', nextRunTime: '' },
      { taskPath: '\\A\\', taskName: 'T2', state: 'Disabled', lastRunTime: '', nextRunTime: '2026-09-05 09:00' }
    ]
    const list = parseTaskList(JSON.stringify(raw))
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ path: '\\', name: 'T1', state: 'Ready', lastRunTime: '2026-09-01 10:00' })
    expect(list[1].state).toBe('Disabled')
  })

  it('单对象（非数组）包装为数组', () => {
    const list = parseTaskList(JSON.stringify({ taskPath: '\\', taskName: 'T', state: 'Ready' }))
    expect(list).toHaveLength(1)
  })

  it('空 / 非法 JSON / 字段缺失容错', () => {
    expect(parseTaskList('')).toEqual([])
    expect(parseTaskList('not json')).toEqual([])
    const list = parseTaskList(JSON.stringify([{}]))
    expect(list[0].name).toBe('')
    expect(list[0].state).toBe('Unknown')
  })
})

describe('parseTaskResult', () => {
  it('OK / ERR / 未知输出', () => {
    expect(parseTaskResult('OK')).toEqual({ ok: true, message: '操作成功' })
    expect(parseTaskResult('ERR:拒绝访问')).toEqual({ ok: false, message: '拒绝访问' })
    expect(parseTaskResult('').ok).toBe(false)
  })
})

describe('createTasksService', () => {
  it('setEnabled(true) 生成 Enable-ScheduledTask 且注入路径与名称', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createTasksService(runner).setEnabled('\\Test\\', 'T1', true)
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('Enable-ScheduledTask')
    expect(calls[0]).toContain("-TaskPath '\\Test\\'")
    expect(calls[0]).toContain("-TaskName 'T1'")
  })

  it('setEnabled(false) 生成 Disable-ScheduledTask', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    await createTasksService(runner).setEnabled('\\', 'T2', false)
    expect(calls[0]).toContain('Disable-ScheduledTask')
  })

  it('run 生成 Start-ScheduledTask', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    await createTasksService(runner).run('\\', 'T3')
    expect(calls[0]).toContain('Start-ScheduledTask')
  })

  it('stop 生成 Stop-ScheduledTask', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    await createTasksService(runner).stop('\\', 'T4')
    expect(calls[0]).toContain('Stop-ScheduledTask')
  })

  it('非法 token 直接拒绝且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createTasksService(runner).run("\\x'; harmful", 'T')
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('list 脚本使用 Get-ScheduledTask + Get-ScheduledTaskInfo', async () => {
    const { runner, calls } = recordingRunner(() => ({ ...ok(), stdout: '[]' }))
    await createTasksService(runner).list()
    expect(calls[0]).toContain('Get-ScheduledTask')
    expect(calls[0]).toContain('Get-ScheduledTaskInfo')
  })

  it('list 解析真实形态输出', async () => {
    const raw = [{ taskPath: '\\Gale\\', taskName: 'Boost', state: 'Ready', lastRunTime: '2026-09-04 08:00', nextRunTime: '2026-09-05 08:00' }]
    const { runner } = recordingRunner(() => ({ ...ok(), stdout: JSON.stringify(raw) }))
    const list = await createTasksService(runner).list()
    expect(list[0].path).toBe('\\Gale\\')
    expect(list[0].nextRunTime).toBe('2026-09-05 08:00')
  })
})
