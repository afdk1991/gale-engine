import type { ScheduledTask, ToolResult } from '../../shared/types'
import type { ExecRunner } from './shell'

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

export function createTasksService(runner: ExecRunner) {
  const list = async (): Promise<ScheduledTask[]> => {
    const { stdout } = await runner.run(LIST_SCRIPT)
    return parseTaskList(stdout)
  }

  const setEnabled = async (path: string, name: string, enable: boolean): Promise<ToolResult> => {
    const loc = taskLocator(path, name)
    if (!loc) return { ok: false, message: '任务路径或名称包含非法字符' }
    const verb = enable ? 'Enable-ScheduledTask' : 'Disable-ScheduledTask'
    const { stdout } = await runner.run(
      `try { ${verb} ${loc} -ErrorAction Stop | Out-Null; "OK" } catch { "ERR:$($_.Exception.Message)" }`
    )
    return parseTaskResult(stdout)
  }

  const run = async (path: string, name: string): Promise<ToolResult> => {
    const loc = taskLocator(path, name)
    if (!loc) return { ok: false, message: '任务路径或名称包含非法字符' }
    const { stdout } = await runner.run(
      `try { Start-ScheduledTask ${loc} -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
    )
    return parseTaskResult(stdout)
  }

  const stop = async (path: string, name: string): Promise<ToolResult> => {
    const loc = taskLocator(path, name)
    if (!loc) return { ok: false, message: '任务路径或名称包含非法字符' }
    const { stdout } = await runner.run(
      `try { Stop-ScheduledTask ${loc} -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`
    )
    return parseTaskResult(stdout)
  }

  return { list, setEnabled, run, stop }
}
