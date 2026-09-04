import type { ToolResult } from '../../shared/types'
import type { ExecRunner } from './shell'

const DARK_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'

/** 统一包装：执行脚本，按退出码返回 ToolResult */
async function runTool(
  runner: ExecRunner,
  script: string,
  okMsg: string,
  failMsg: string
): Promise<ToolResult> {
  const { code, stdout, stderr } = await runner.run(script)
  const ok = code === 0
  return { ok, message: ok ? okMsg : (stderr.trim() || stdout.trim() || failMsg) }
}

/**
 * 工具箱服务：一组安全、幂等的 Windows 小工具。
 * 全部经可注入 ExecRunner 执行，便于单测。
 */
export function createToolboxService(runner: ExecRunner) {
  const flushDns = (): Promise<ToolResult> =>
    runTool(runner, 'ipconfig /flushdns', 'DNS 缓存已刷新', '刷新 DNS 失败')

  const emptyRecycleBin = (): Promise<ToolResult> =>
    runTool(
      runner,
      'Clear-RecycleBin -Force -ErrorAction SilentlyContinue; if ($?) { "OK" }',
      '回收站已清空',
      '清空回收站失败'
    )

  const clearClipboard = (): Promise<ToolResult> =>
    runTool(runner, 'Set-Clipboard -Value ""', '剪贴板已清空', '清空剪贴板失败')

  const toggleDarkMode = (enable: boolean): Promise<ToolResult> => {
    // AppsUseLightTheme: 0 = 深色, 1 = 浅色
    const value = enable ? 0 : 1
    return runTool(
      runner,
      `Set-ItemProperty -Path "${DARK_KEY}" -Name AppsUseLightTheme -Value ${value} -ErrorAction Stop; "OK"`,
      enable ? '已切换到深色模式' : '已切换到浅色模式',
      '切换系统主题失败'
    )
  }

  return { flushDns, emptyRecycleBin, clearClipboard, toggleDarkMode }
}
