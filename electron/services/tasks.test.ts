import { describe, it, expect } from 'vitest'
import {
  createTasksService,
  parseTaskList,
  parseTaskResult,
  isSafeTaskToken,
  isSafeUnixUnit,
  buildTasksListScript,
  buildTaskOpScript,
  parseUnixTaskList
} from './tasks'
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

describe('isSafeUnixUnit', () => {
  it('合法 launchd label / systemd unit 通过', () => {
    expect(isSafeUnixUnit('com.apple.periodic-daily')).toBe(true)
    expect(isSafeUnixUnit('gale-engine.timer')).toBe(true)
  })
  it('含注入字符拒绝', () => {
    expect(isSafeUnixUnit('a;b')).toBe(false)
    expect(isSafeUnixUnit('a b')).toBe(false)
    expect(isSafeUnixUnit('a$b')).toBe(false)
    expect(isSafeUnixUnit('')).toBe(false)
  })
})

describe('计划任务跨平台脚本分发', () => {
  it('list 脚本按平台分发', () => {
    expect(buildTasksListScript('win32')).toContain('Get-ScheduledTask')
    expect(buildTasksListScript('darwin')).toContain('launchctl list')
    expect(buildTasksListScript('linux')).toContain('systemctl --user list-timers')
    expect(buildTasksListScript('linux')).toContain('crontab')
  })

  it('macOS run 用 launchctl kickstart，stop/enable 诚实降级', () => {
    expect(buildTaskOpScript('run', 'com.apple.x', 'darwin')).toContain('kickstart')
    expect(buildTaskOpScript('stop', 'com.apple.x', 'darwin')).toContain('登录项')
    expect(buildTaskOpScript('enable', 'com.apple.x', 'darwin')).toContain('登录项')
  })

  it('Linux run/stop/enable/disable 用 systemctl --user', () => {
    expect(buildTaskOpScript('run', 'gale.timer', 'linux')).toContain('systemctl --user start')
    expect(buildTaskOpScript('stop', 'gale.timer', 'linux')).toContain('systemctl --user stop')
    expect(buildTaskOpScript('enable', 'gale.timer', 'linux')).toContain('systemctl --user enable')
    expect(buildTaskOpScript('disable', 'gale.timer', 'linux')).toContain('systemctl --user disable')
  })
})

describe('计划任务 unix 解析器', () => {
  it('macOS launchctl list 行映射为任务', () => {
    // launchctl list 列：PID Status Label；PID=- 未运行，Status=上次退出码（仅未运行时有意义）
    const out = `-	0	com.apple.ready
1234	0	com.apple.running
-	1	com.apple.error`
    const list = parseUnixTaskList(out, 'darwin')
    expect(list).toHaveLength(3)
    expect(list[0]).toMatchObject({ name: 'com.apple.ready', state: 'Ready' })
    expect(list[1]).toMatchObject({ name: 'com.apple.running', state: 'Running' })
    expect(list[2]).toMatchObject({ name: 'com.apple.error', state: 'Error' })
  })

  it('Linux systemd 定时器行与 cron 行映射', () => {
    const out = `NEXT                         LEFT UNIT            ACTIVATES
Fri 2026-09-05 08:00:00 CST   1h   gale-engine.timer gale-engine.service
---CRON---
*/5 * * * * /usr/bin/backup.sh`
    const list = parseUnixTaskList(out, 'linux')
    expect(list.some((t) => t.name === 'gale-engine.timer')).toBe(true)
    expect(list.some((t) => t.path === 'cron' && t.name.includes('backup.sh'))).toBe(true)
  })
})

describe('计划任务 unix 服务行为', () => {
  function unixRunner(platform: 'darwin' | 'linux', stdout = 'OK') {
    return recordingRunner((s) => ok(stdout))
  }

  it('Linux run 调用 systemctl start', async () => {
    const { runner, calls } = unixRunner('linux')
    const res = await createTasksService(runner, 'linux').run('systemd', 'gale.timer')
    expect(res.ok).toBe(true)
    expect(calls[0]).toContain('systemctl --user start gale.timer')
  })

  it('unix 非法单元名拒绝且不调用执行器', async () => {
    const { runner, calls } = unixRunner('linux')
    const res = await createTasksService(runner, 'linux').run('systemd', 'bad name')
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('macOS list 解析 launchctl 输出', async () => {
    const { runner } = recordingRunner(() => ok(`-	0	com.apple.app
123	0	com.apple.run`))
    const list = await createTasksService(runner, 'darwin').list()
    expect(list).toHaveLength(2)
    expect(list[0].name).toBe('com.apple.app')
  })
})
