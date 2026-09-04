import type { ToolResult } from '../../shared/types'
import type { ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'

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

// ─────────────────────────────────────────────────────────────
// 平台脚本生成器：同一操作语义，三套平台实现（win32=PowerShell，darwin/linux=bash）
// ─────────────────────────────────────────────────────────────

export function buildFlushDnsScript(platform: Platform): string {
  switch (platform) {
    case 'win32':
      return 'ipconfig /flushdns'
    case 'darwin':
      return `dscacheutil -flushcache >/dev/null 2>&1; killall -HUP mDNSResponder >/dev/null 2>&1 || true; echo "OK"`
    default:
      // Linux：resolvectl（systemd 239+）或 systemd-resolve（旧版）
      return `if command -v resolvectl >/dev/null 2>&1; then resolvectl flush-caches >/dev/null 2>&1 && echo "OK"; elif command -v systemd-resolve >/dev/null 2>&1; then systemd-resolve --flush-caches >/dev/null 2>&1 && echo "OK"; else echo "ERR:未找到 DNS 刷新工具(resolvectl/systemd-resolve)"; exit 1; fi`
  }
}

export function buildEmptyRecycleBinScript(platform: Platform): string {
  switch (platform) {
    case 'win32':
      return 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue; if ($?) { "OK" }'
    case 'darwin':
      // 首选 Finder 原生清空（安全走回收站机制）；osascript 不可用/无自动化权限时回退 rm
      return `osascript -e 'tell application "Finder" to empty trash' >/dev/null 2>&1 && echo "OK" || { rm -rf "$HOME/.Trash/"* 2>/dev/null; echo "OK"; }`
    default:
      // XDG Trash（~/.local/share/Trash/files）
      return `rm -rf "$HOME/.local/share/Trash/files/"* "$HOME/.local/share/Trash/files/".[!.]* 2>/dev/null; echo "OK"`
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
      // defaults 即时生效于新进程；注销/重启后全局生效
      return enable
        ? `defaults write -g AppleInterfaceStyle -string Dark; echo "OK"`
        : `defaults delete -g AppleInterfaceStyle 2>/dev/null; echo "OK"`
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
