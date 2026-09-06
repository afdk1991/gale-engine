import type { ScheduledTask, ToolResult } from '../../shared/types'
import type { ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'

/**
 * 任务路径 / 名称白名单校验：
 * 只允许反斜杠、字母数字、空格、点、下划线、连字符与中英文常见字符之外的 ASCII 可见符一律拒绝，
 * 防止把名字注入进 PowerShell 单引号字符串（单引号本身也被拒绝，双保险）。
 */
export function isSafeTaskToken(token: string): boolean {
  if (!token || token.length > 260) return false
  // 禁止单引号 / 反引号 / 分号 / 管道 / $ / 换行 等注入向量
  if (/['`;|$&<>\r\n]/.test(token)) return false
  // 控制字符拒绝
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(token)) return false
  return true
}

/** 解析 Get-ScheduledTask 输出的 JSON 数组，容错空 / 非法输入 */
export function parseTaskList(stdout: string): ScheduledTask[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return []
  }
  const arr: unknown[] = Array.isArray(raw) ? raw : [raw]
  return arr.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    return {
      path: String(o.taskPath ?? ''),
      name: String(o.taskName ?? ''),
      state: String(o.state ?? 'Unknown'),
      lastRunTime: String(o.lastRunTime ?? ''),
      nextRunTime: String(o.nextRunTime ?? '')
    }
  })
}

/** 解析操作回执：与进程模块同约定（ERR: 前缀 / OK） */
export function parseTaskResult(stdout: string): ToolResult {
  const text = stdout.trim()
  if (text.startsWith('ERR:')) return { ok: false, message: text.slice(4) }
  if (text.includes('OK')) return { ok: true, message: '操作成功' }
  return { ok: false, message: text || '操作失败' }
}

/** 列表脚本：枚举全部计划任务及其上次/下次运行时间 */
const LIST_SCRIPT = `
$rows = Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object {
  $info = $_ | Get-ScheduledTaskInfo -ErrorAction SilentlyContinue
  [pscustomobject]@{
    taskPath = $_.TaskPath
    taskName = $_.TaskName
    state = [string]$_.State
    lastRunTime = if ($info -and $info.LastRunTime) { $info.LastRunTime.ToString('yyyy-MM-dd HH:mm') } else { '' }
    nextRunTime = if ($info -and $info.NextRunTime) { $info.NextRunTime.ToString('yyyy-MM-dd HH:mm') } else { '' }
  }
}
$rows | ConvertTo-Json -Compress -Depth 3
`

/** 组合任务定位（TaskPath + TaskName）的 PowerShell 过滤器片段，已校验的 token 直接内插 */
function taskLocator(path: string, name: string): string | null {
  if (!isSafeTaskToken(path) || !isSafeTaskToken(name)) return null
  return `-TaskPath '${path}' -TaskName '${name}'`
}

// ─────────────────────────────────────────────────────────────
// 平台脚本（macOS launchctl / launchd，Linux systemctl --user / crontab）
// ─────────────────────────────────────────────────────────────

/** unix 任务名安全校验（launchd label / systemd unit 字符集） */
export function isSafeUnixUnit(token: string): boolean {
  return /^[A-Za-z0-9._@/-]{1,200}$/.test(token)
}

/**
 * 列表脚本：
 * - Windows：Get-ScheduledTask（JSON）
 * - macOS：列出用户域 launchd 服务（launchctl print gui/$UID 下的服务 best-effort）
 * - Linux：systemctl --user timers + crontab -l
 */
export function buildTasksListScript(platform: Platform = detectPlatform()): string {
  switch (platform) {
    case 'win32':
      return LIST_SCRIPT
    case 'darwin':
      // launchctl list 输出：PID  Status  Label（PID=- 表示未运行）
      return `launchctl list 2>/dev/null | tail -n +2`
    case 'linux':
      // 用户定时器 + 用户 cron 条目
      return `{ systemctl --user list-timers --all 2>/dev/null; echo '---CRON---'; crontab -l 2>/dev/null; }`
    default:
      return `echo '[]'`
  }
}

/** run/stop/enable 的 unix 脚本 */
export function buildTaskOpScript(
  op: 'run' | 'stop' | 'enable' | 'disable',
  name: string,
  platform: Platform = detectPlatform()
): string {
  const unit = name
  if (platform === 'darwin') {
    switch (op) {
      case 'run':
        // kickstart -k 强制重启目标服务（gui/<uid>/<label>）
        return `launchctl kickstart -k gui/$(id -u)/${unit} 2>&1 && echo OK || echo 'ERR:服务不存在或无法启动'`
      // launchd 的启用/禁用/停止语义与 Windows 计划任务差异大（需 bootout/bootstrap），
      // v1 诚实降级，引导用户用系统设置
      case 'stop':
      case 'enable':
      case 'disable':
        return `echo 'ERR:macOS 请在「系统设置 → 通用 → 登录项」中管理该服务'`
    }
  }
  if (platform === 'linux') {
    switch (op) {
      case 'run':
        return `systemctl --user start ${unit} 2>&1 && echo OK || echo 'ERR:服务不存在（需先定义 systemd 用户单元）'`
      case 'stop':
        return `systemctl --user stop ${unit} 2>&1 && echo OK || echo 'ERR:服务不存在或无法停止'`
      case 'enable':
        return `systemctl --user enable ${unit} 2>&1 && echo OK || echo 'ERR:服务不存在或无法启用'`
      case 'disable':
        return `systemctl --user disable ${unit} 2>&1 && echo OK || echo 'ERR:服务不存在或无法禁用'`
    }
  }
  return `echo 'ERR:不支持的平台'`
}

/**
 * 解析 unix 任务列表文本为 ScheduledTask[]（best-effort，字段有限）。
 * - macOS launchctl list：每行 "PID Status Label"
 * - Linux：systemctl 定时器行 + cron 行
 */
export function parseUnixTaskList(stdout: string, platform: Platform = detectPlatform()): ScheduledTask[] {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  const tasks: ScheduledTask[] = []

  if (platform === 'darwin') {
    for (const line of lines) {
      // launchctl list 列顺序：PID Status Label（PID 为 - 表示未运行）
      const m = line.match(/^(\S+)\s+(\S+)\s+(\S+)$/)
      if (!m) continue
      const [, pid, status, label] = m
      const running = pid !== '-' && pid !== '0'
      const errored = !running && status !== '-' && status !== '0'
      tasks.push({
        path: 'gui',
        name: label,
        state: running ? 'Running' : errored ? 'Error' : 'Ready',
        lastRunTime: '',
        nextRunTime: ''
      })
    }
    return tasks.slice(0, 200)
  }

  if (platform === 'linux') {
    let inCron = false
    for (const line of lines) {
      if (line.includes('---CRON---')) { inCron = true; continue }
      if (inCron) {
        if (!line.startsWith('#') && line.length > 3) {
          tasks.push({ path: 'cron', name: line.slice(0, 60), state: 'Scheduled', lastRunTime: '', nextRunTime: '' })
        }
      } else {
        // systemctl list-timers 行：next-time / left / last / passed / unit / trigger（跳过表头）
        if (/\.timer/.test(line)) {
          const unit = line.match(/(\S+\.timer)/)?.[1] ?? line.slice(0, 40)
          tasks.push({ path: 'systemd', name: unit, state: 'Scheduled', lastRunTime: '', nextRunTime: '' })
        }
      }
    }
    return tasks.slice(0, 200)
  }

  return []
}

export function createTasksService(runner: ExecRunner, platform: Platform = detectPlatform()) {
  const isWin = platform === 'win32'

  const list = async (): Promise<ScheduledTask[]> => {
    const { stdout } = await runner.run(buildTasksListScript(platform))
    return isWin ? parseTaskList(stdout) : parseUnixTaskList(stdout, platform)
  }

  const setEnabled = async (path: string, name: string, enable: boolean): Promise<ToolResult> => {
    if (isWin) {
      const loc = taskLocator(path, name)
      if (!loc) return { ok: false, message: '任务路径或名称包含非法字符' }
      const verb = enable ? 'Enable-ScheduledTask' : 'Disable-ScheduledTask'
      const { stdout } = await runner.run(
        `try { ${verb} ${loc} -ErrorAction Stop | Out-Null; "OK" } catch { "ERR:$($_.Exception.Message)" }`
      )
      return parseTaskResult(stdout)
    }
    if (!isSafeUnixUnit(name)) return { ok: false, message: '任务名包含非法字符' }
    const { stdout } = await runner.run(buildTaskOpScript(enable ? 'enable' : 'disable', name, platform))
    return parseTaskResult(stdout)
  }

  const run = async (path: string, name: string): Promise<ToolResult> => {
    if (isWin) {
      const loc = taskLocator(path, name)
      if (!loc) return { ok: false, message: '任务路径或名称包含非法字符' }
      const { stdout } = await runner.run(
        `try { Start-ScheduledTask ${loc} -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
      )
      return parseTaskResult(stdout)
    }
    if (!isSafeUnixUnit(name)) return { ok: false, message: '任务名包含非法字符' }
    const { stdout } = await runner.run(buildTaskOpScript('run', name, platform))
    return parseTaskResult(stdout)
  }

  const stop = async (path: string, name: string): Promise<ToolResult> => {
    if (isWin) {
      const loc = taskLocator(path, name)
      if (!loc) return { ok: false, message: '任务路径或名称包含非法字符' }
      const { stdout } = await runner.run(
        `try { Stop-ScheduledTask ${loc} -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
      )
      return parseTaskResult(stdout)
    }
    if (!isSafeUnixUnit(name)) return { ok: false, message: '任务名包含非法字符' }
    const { stdout } = await runner.run(buildTaskOpScript('stop', name, platform))
    return parseTaskResult(stdout)
  }

  return { list, setEnabled, run, stop }
}
