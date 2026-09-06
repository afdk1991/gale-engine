import type { GameModeStatus } from '../../shared/types'
import type { ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'
import type { StorageAdapter } from './settings'

/** 高性能电源计划（Windows 固定 GUID） */
export const HIGH_PERFORMANCE_GUID = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'

/** Linux 高性能 CPU governor 标识 */
export const PERFORMANCE_GOVERNOR = 'performance'

const KEY_BOOSTED = 'gamemode.boosted'
const KEY_PREVIOUS = 'gamemode.previous'

/** Windows 电源计划 GUID 解析 */
const GUID_RE =
  /\{?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}?/

/** 解析 Windows powercfg /getactivescheme 输出，提取 GUID 与计划名 */
export function parseScheme(output: string): { guid: string; name: string } {
  const m = output.match(GUID_RE)
  const guid = m ? m[1].toLowerCase() : ''
  const nameMatch = output.match(/\(([^)]+)\)/)
  const name = nameMatch ? nameMatch[1].trim() : ''
  return { guid, name }
}

/** 解析 unix status 脚本输出：形如 "ACTIVE:xxx" 或 "NONE" */
export function parseUnixStatus(output: string): string {
  const trimmed = output.trim()
  const m = trimmed.match(/^ACTIVE:(.*)$/m)
  return m ? m[1].trim() : ''
}

// ─────────────────────────────────────────────────────────────
// Windows 脚本：powercfg 电源计划
// 注意：powercfg 成功时不产生 stdout、失败（退出码 1）时 stderr 含错误信息，
// 因此脚本末尾统一用 `; if ($LASTEXITCODE -eq 0) { echo OK }` 回显结果，
// 供服务层以 stdout.includes('OK') 判定成功（退出码在 PS 非交互模式下无法
// 可靠透传给 Node，这里用显式回显最稳妥）。
// ─────────────────────────────────────────────────────────────
const WIN_STATUS_SCRIPT = 'powercfg /getactivescheme'
function buildWinBoostScript(): string {
  return `powercfg /setactive ${HIGH_PERFORMANCE_GUID}; if ($LASTEXITCODE -eq 0) { echo OK }`
}
function buildWinRestoreScript(prev: string): string {
  return `powercfg /setactive ${prev}; if ($LASTEXITCODE -eq 0) { echo OK }`
}

// ─────────────────────────────────────────────────────────────
// macOS 脚本：caffeinate 防系统休眠
// boost 启动后台 caffeinate 进程并输出 PID；restore 按 PID kill；status 查存活
// ─────────────────────────────────────────────────────────────
const MAC_STATUS_SCRIPT = `pgrep -x caffeinate >/dev/null 2>&1 && echo "ACTIVE:caffeinate" || echo "NONE"`
function buildMacBoostScript(): string {
  // -d 防显示器休眠 -i 防系统空闲休眠 -s 阻止系统睡眠 -u 模拟用户活动
  return `caffeinate -disu >/dev/null 2>&1 & echo $!`
}
function buildMacRestoreScript(pid: string): string {
  // 用 isSafeToken 校验过 pid（纯数字）
  return `kill ${pid} 2>/dev/null && echo OK || echo "ERR:进程已结束"`
}

// ─────────────────────────────────────────────────────────────
// Linux 脚本：CPU scaling_governor 切换（需 root）
// status 读当前 governor；boost 切 performance；restore 切回原值
// ─────────────────────────────────────────────────────────────
const LINUX_STATUS_SCRIPT = `gov=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null)
if [ -n "$gov" ]; then echo "ACTIVE:$gov"; else echo "NONE"; fi`
function buildLinuxBoostScript(): string {
  // 写入所有 CPU 的 governor；需 root，失败输出 ERR
  return `err=0
for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
  if [ -w "$f" ]; then
    echo ${PERFORMANCE_GOVERNOR} | tee "$f" >/dev/null 2>&1 || err=1
  else
    # 尝试 sudo（无 TTY 会失败，输出 ERR 提示需 root）
    echo ${PERFORMANCE_GOVERNOR} | sudo tee "$f" >/dev/null 2>&1 || err=1
  fi
done
[ "$err" = "0" ] && echo OK || echo "ERR:需 root 权限切换 CPU 调速器"`
}
function buildLinuxRestoreScript(prev: string): string {
  // prev 已校验为 governor 名（小写字母）
  return `err=0
for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
  echo ${prev} | tee "$f" >/dev/null 2>&1 || err=1
done
[ "$err" = "0" ] && echo OK || echo "ERR:还原调速器失败（需 root）"`
}

// ─────────────────────────────────────────────────────────────
// 脚本分发
// ─────────────────────────────────────────────────────────────
export function buildStatusScript(platform: Platform = detectPlatform()): string {
  switch (platform) {
    case 'win32': return WIN_STATUS_SCRIPT
    case 'darwin': return MAC_STATUS_SCRIPT
    case 'linux': return LINUX_STATUS_SCRIPT
    default: return 'echo NONE'
  }
}
export function buildBoostScript(platform: Platform = detectPlatform()): string {
  switch (platform) {
    case 'win32': return buildWinBoostScript()
    case 'darwin': return buildMacBoostScript()
    case 'linux': return buildLinuxBoostScript()
    default: return 'echo "ERR:不支持的平台"'
  }
}
export function buildRestoreScript(prev: string, platform: Platform = detectPlatform()): string {
  switch (platform) {
    case 'win32': return buildWinRestoreScript(prev)
    case 'darwin': return buildMacRestoreScript(prev)
    case 'linux': return buildLinuxRestoreScript(prev)
    default: return 'echo "ERR:不支持的平台"'
  }
}

/**
 * 游戏模式服务（跨平台）。
 * - Windows：切换高性能电源计划，记录 boost 前的计划用于还原
 * - macOS：启动 caffeinate 防止系统/显示器休眠，记录 PID 用于还原时 kill
 * - Linux：切换 CPU scaling_governor 为 performance（需 root），记录原 governor 用于还原
 * 依赖 ExecRunner（执行平台脚本）与可选 StorageAdapter（跨重启记住上一状态）。
 */
export function createGameModeService(
  runner: ExecRunner,
  storage?: StorageAdapter,
  platform: Platform = detectPlatform()
) {
  const mem: Record<string, unknown> = {}
  const read = <T>(key: string, fallback: T): T =>
    storage ? storage.get<T>(key, fallback) : ((mem[key] as T) ?? fallback)
  const write = (key: string, value: unknown): void => {
    if (storage) storage.set(key, value)
    else mem[key] = value
  }

  const status = async (): Promise<GameModeStatus> => {
    const { stdout } = await runner.run(buildStatusScript(platform))
    let active = ''
    let activeName = ''
    if (platform === 'win32') {
      const parsed = parseScheme(stdout)
      active = parsed.guid
      activeName = parsed.name
    } else {
      active = parseUnixStatus(stdout)
      activeName = active
    }
    return {
      active,
      activeName,
      boosted: read<boolean>(KEY_BOOSTED, false),
      previous: read<string | null>(KEY_PREVIOUS, null)
    }
  }

  const boost = async (): Promise<GameModeStatus> => {
    const cur = await status()
    // 记录 boost 前的状态用于还原（仅首次 boost 时记录）
    if (!cur.boosted && cur.active) {
      write(KEY_PREVIOUS, cur.active)
    }
    const { stdout } = await runner.run(buildBoostScript(platform))
    // macOS：boost 脚本输出 PID，需存入 storage 供 restore kill
    if (platform === 'darwin') {
      const pid = stdout.trim()
      if (/^\d+$/.test(pid)) {
        write(KEY_PREVIOUS, pid)
      }
    }
    const ok = platform === 'darwin'
      ? /^\d+$/.test(stdout.trim())
      : stdout.includes('OK')
    write(KEY_BOOSTED, ok)
    return status()
  }

  const restore = async (): Promise<GameModeStatus> => {
    const prev = read<string | null>(KEY_PREVIOUS, null)
    if (prev) {
      await runner.run(buildRestoreScript(prev, platform))
    }
    write(KEY_BOOSTED, false)
    write(KEY_PREVIOUS, null)
    return status()
  }

  return { status, boost, restore }
}
