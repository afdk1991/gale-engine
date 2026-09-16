import type { ToolResult } from '../../shared/types'
import type { ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'
import { parseActionOutcome } from './actionResult'

const DARK_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'

/**
 * 统一包装：执行脚本并判定结果。
 *
 * 脚本有两种风格，必须都支持：
 *   1. 带回执令牌：`OK` / `OK:细节` / `ERR:原因`（多数脚本）；
 *   2. 只有退出码：如 `ipconfig /flushdns`，既无 OK 也无 ERR。
 * 同时存在时**以令牌为准** —— 否则 `try { ...; "OK" } catch { "ERR:..." }` 这类写法
 * 在失败分支只输出字符串、退出码仍为 0，会被误判成功（回收站清空失败却报「已清空」）。
 */
async function runTool(
  runner: ExecRunner,
  script: string,
  okMsg: string,
  failMsg: string
): Promise<ToolResult> {
  const { code, stdout, stderr } = await runner.run(script)
  const text = String(stdout ?? '')
  const tokenized = /^[ \t]*(OK(?::.*)?|ERR:.*)$/m.test(text)
  if (tokenized) {
    const outcome = parseActionOutcome(stdout, code)
    return outcome.ok ? { ok: true, message: okMsg } : { ok: false, message: outcome.message }
  }
  if (code === 0) return { ok: true, message: okMsg }
  return { ok: false, message: stderr.trim() || text.trim() || failMsg }
}

// ─────────────────────────────────────────────────────────────
// 平台脚本生成器：同一操作语义，三套平台实现（win32=PowerShell，darwin/linux=bash）
// ─────────────────────────────────────────────────────────────

export function buildFlushDnsScript(platform: Platform): string {
  switch (platform) {
    case 'win32':
      return 'ipconfig /flushdns'
    case 'darwin':
      // 原写法 `... ; echo "OK"` 无条件成功：dscacheutil 失败也报「DNS 缓存已刷新」。
      // runTool 按退出码判定，故失败必须显式 exit 1。
      return (
        'if dscacheutil -flushcache >/dev/null 2>&1; then ' +
        'killall -HUP mDNSResponder >/dev/null 2>&1 || true; echo "OK"; ' +
        'else echo "ERR:刷新 DNS 缓存失败（dscacheutil 执行失败）"; exit 1; fi'
      )
    default:
      // Linux：resolvectl（systemd 239+）或 systemd-resolve（旧版）
      return `if command -v resolvectl >/dev/null 2>&1; then resolvectl flush-caches >/dev/null 2>&1 && echo "OK"; elif command -v systemd-resolve >/dev/null 2>&1; then systemd-resolve --flush-caches >/dev/null 2>&1 && echo "OK"; else echo "ERR:未找到 DNS 刷新工具(resolvectl/systemd-resolve)"; exit 1; fi`
  }
}

export function buildEmptyRecycleBinScript(platform: Platform): string {
  switch (platform) {
    case 'win32':
      // 不可 SilentlyContinue + 无条件 "OK"：权限不足时会静默失败却报成功
      return 'try { Clear-RecycleBin -Force -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }'
    case 'darwin':
      // 首选 Finder 原生清空（安全走回收站机制）；osascript 不可用/无自动化权限时回退 rm
      return `osascript -e 'tell application "Finder" to empty trash' >/dev/null 2>&1 && echo "OK" || { rm -rf "$HOME/.Trash/"* 2>/dev/null && echo "OK" || echo "ERR:清空回收站失败（可能需要授权）"; }`
    default:
      // XDG Trash（~/.local/share/Trash/files）
      return `rm -rf "$HOME/.local/share/Trash/files/"* "$HOME/.local/share/Trash/files/".[!.]* 2>/dev/null && echo "OK" || echo "ERR:清空回收站失败"`
  }
}

export function buildClearClipboardScript(platform: Platform): string {
  switch (platform) {
    case 'win32':
      return 'Set-Clipboard -Value ""'
    case 'darwin':
      return `pbcopy < /dev/null && echo "OK" || echo "ERR:清空剪贴板失败"`
    default:
      // Wayland → wl-copy；X11 → xclip / xsel
      return `if command -v wl-copy >/dev/null 2>&1; then printf '' | wl-copy >/dev/null 2>&1 && echo "OK"; elif command -v xclip >/dev/null 2>&1; then printf '' | xclip -selection clipboard >/dev/null 2>&1 && echo "OK"; elif command -v xsel >/dev/null 2>&1; then printf '' | xsel -b >/dev/null 2>&1 && echo "OK"; else echo "ERR:未找到剪贴板工具(wl-copy/xclip/xsel)"; exit 1; fi`
  }
}

export function buildToggleDarkModeScript(enable: boolean, platform: Platform): string {
  switch (platform) {
    case 'win32': {
      // AppsUseLightTheme: 0 = 深色, 1 = 浅色
      const value = enable ? 0 : 1
      return `Set-ItemProperty -Path "${DARK_KEY}" -Name AppsUseLightTheme -Value ${value} -ErrorAction Stop; "OK"`
    }
    case 'darwin':
      // defaults 即时生效于新进程；注销/重启后全局生效。
      // 切换深色失败必须报错（原写法 `defaults write ...; echo "OK"` 无条件成功）；
      // 切回浅色时键可能本就不存在，属预期状态，故视为成功。
      return enable
        ? `defaults write -g AppleInterfaceStyle -string Dark >/dev/null 2>&1 && echo "OK" || { echo "ERR:切换深色模式失败"; exit 1; }`
        : `defaults delete -g AppleInterfaceStyle >/dev/null 2>&1; echo "OK"`
    default:
      // GNOME gsettings；其他桌面环境无统一接口
      return enable
        ? `if command -v gsettings >/dev/null 2>&1; then gsettings set org.gnome.desktop.interface color-scheme prefer-dark >/dev/null 2>&1 && echo "OK"; else echo "ERR:当前桌面环境不支持切换主题(gsettings 不可用)"; exit 1; fi`
        : `if command -v gsettings >/dev/null 2>&1; then gsettings set org.gnome.desktop.interface color-scheme prefer-light >/dev/null 2>&1 && echo "OK"; else echo "ERR:当前桌面环境不支持切换主题(gsettings 不可用)"; exit 1; fi`
  }
}

/**
 * 工具箱服务：一组安全、幂等的小工具。
 * 全部经可注入 ExecRunner 执行，便于单测；按 platform 分发三平台脚本。
 */
export function createToolboxService(runner: ExecRunner, platform: Platform = detectPlatform()) {
  const flushDns = (): Promise<ToolResult> =>
    runTool(runner, buildFlushDnsScript(platform), 'DNS 缓存已刷新', '刷新 DNS 失败')

  const emptyRecycleBin = (): Promise<ToolResult> =>
    runTool(runner, buildEmptyRecycleBinScript(platform), '回收站已清空', '清空回收站失败')

  const clearClipboard = (): Promise<ToolResult> =>
    runTool(runner, buildClearClipboardScript(platform), '剪贴板已清空', '清空剪贴板失败')

  const toggleDarkMode = (enable: boolean): Promise<ToolResult> =>
    runTool(
      runner,
      buildToggleDarkModeScript(enable, platform),
      enable ? '已切换到深色模式' : '已切换到浅色模式',
      '切换系统主题失败'
    )

  return { flushDns, emptyRecycleBin, clearClipboard, toggleDarkMode }
}
