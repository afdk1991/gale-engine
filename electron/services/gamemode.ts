import type { GameModeActionResult, GameModeStatus } from '../../shared/types'
import type { ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'
import type { StorageAdapter } from './settings'
import { parseActionOutcome } from './actionResult'

/** 高性能电源计划（Windows 固定 GUID） */
export const HIGH_PERFORMANCE_GUID = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'

/** Linux 高性能 CPU governor 标识 */
export const PERFORMANCE_GOVERNOR = 'performance'

const KEY_BOOSTED = 'gamemode.boosted'
/** boost 前的电源方案 GUID（win32）或 governor 名（linux）；macOS 不使用此键 */
const KEY_PREVIOUS = 'gamemode.previous'
/** macOS caffeinate 进程 PID，独立于 KEY_PREVIOUS 存储，避免互相覆盖导致进程泄漏 */
const KEY_CAFF_PID = 'gamemode.caffeinatePid'

/** Windows 电源计划 GUID 解析（在任意位置搜索，供解析 powercfg 输出用） */
const GUID_RE =
  /\{?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}?/

// ─────────────────────────────────────────────────────────────
// 还原凭据校验
//
// 还原凭据（上一电源计划 GUID / 原 CPU 调速器名 / caffeinate PID）经
// electron-store 持久化，落盘文件位于用户可写目录，**不可信**。若不校验就
// 拼进 shell 脚本，等于把「谁改了配置文件谁就能执行任意命令」这条口子留给本地
// 提权。三平台一律白名单校验，不合法就如实报错、不生成任何拼接。
// ─────────────────────────────────────────────────────────────

/** 电源计划 GUID（还原用）：必须整串匹配，可选花括号包裹 */
const SCHEME_RE =
  /^\{?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}?$/

/** CPU 调速器名：内核命名规则为小写字母开头，可含数字、下划线、连字符 */
const GOVERNOR_RE = /^[a-z][a-z0-9_-]{0,31}$/

/** caffeinate 进程 PID：纯数字，限制位数以防超长字符串 */
const PID_RE = /^\d{1,10}$/

/** 还原凭据非法时的脚本：不拼接任何输入，只如实回传失败原因 */
function invalidPrevScript(what: string): string {
  return `echo "ERR:还原凭据非法（${what}），已跳过本次还原"`
}

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
// 因此脚本末尾统一回显结果令牌（成功 `OK` / 失败 `ERR:原因`）。
// 退出码在 PS 非交互模式下无法可靠透传给 Node，显式回显最稳妥；
// 服务层统一用 parseActionOutcome 判定（ERR: 优先、OK 须独立成行）。
// ─────────────────────────────────────────────────────────────
const WIN_STATUS_SCRIPT = 'powercfg /getactivescheme'
function buildWinBoostScript(): string {
  return `powercfg /setactive ${HIGH_PERFORMANCE_GUID}; if ($LASTEXITCODE -eq 0) { echo OK } else { echo "ERR:切换到高性能电源计划失败（可能需要管理员权限）" }`
}
function buildWinRestoreScript(prev: string): string {
  // 只取校验后的 GUID 本体（小写）拼进脚本：即便 prev 是 "{GUID}" 形式，
  // 也不会把花括号/大小写差异带进 powercfg 参数。
  const m = prev.match(SCHEME_RE)
  const guid = (m ? m[1] : prev).toLowerCase()
  return `powercfg /setactive ${guid}; if ($LASTEXITCODE -eq 0) { echo OK } else { echo "ERR:还原电源计划失败（可能需要管理员权限）" }`
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
  // pid 已由 buildRestoreScript 按 PID_RE 校验为纯数字。
  // 先用 kill -0 探活：进程已退出说明休眠抑制本就不存在，属「已完成还原」而非失败；
  // 旧的 `kill || echo ERR:进程已结束` 会把它当成错误，使还原在实现上成功、在回执上失败。
  return `if kill -0 ${pid} 2>/dev/null; then kill ${pid} 2>/dev/null && echo OK || echo "ERR:结束 caffeinate 失败"; else echo OK; fi`
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
  // prev 已由 buildRestoreScript 按 GOVERNOR_RE 校验为合法 governor 名；
  // 仍加引号，避免将来白名单放宽后 ${prev} 被 shell 按词/通配展开。
  return `err=0
for f in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
  echo "${prev}" | tee "$f" >/dev/null 2>&1 || err=1
done
[ "$err" = "0" ] && echo OK || echo "ERR:还原调速器失败（需 root 权限）"`
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
  // 还原凭据来自持久化存储（用户可写文件），三条分支都必须先过白名单再拼接。
  const raw = String(prev ?? '')
  switch (platform) {
    case 'win32':
      return SCHEME_RE.test(raw)
        ? buildWinRestoreScript(raw)
        : invalidPrevScript('电源计划 GUID')
    case 'darwin':
      return PID_RE.test(raw)
        ? buildMacRestoreScript(raw)
        : invalidPrevScript('caffeinate PID')
    case 'linux':
      return GOVERNOR_RE.test(raw)
        ? buildLinuxRestoreScript(raw)
        : invalidPrevScript('CPU 调速器名称')
    default:
      return 'echo "ERR:不支持的平台"'
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
      // previous = 「还原所需的凭据」：win/linux 是 boost 前的方案/governor，
      // macOS 是 caffeinate 的 PID。两者分键存储，对外仍统一由 previous 暴露。
      previous:
        platform === 'darwin'
          ? read<string | null>(KEY_CAFF_PID, null)
          : read<string | null>(KEY_PREVIOUS, null)
    }
  }

  const boost = async (): Promise<GameModeActionResult> => {
    const cur = await status()
    /** 重复 boost 时若清不掉旧 caffeinate，需如实告知（否则进程泄漏且无人知晓） */
    let cleanupWarning = ''
    // 记录 boost 前的状态用于还原（仅首次 boost 时记录）。
    // macOS 没有"上一个电源方案"概念，靠 kill caffeinate 还原，故不占用 KEY_PREVIOUS。
    if (platform !== 'darwin' && !cur.boosted && cur.active) {
      write(KEY_PREVIOUS, cur.active)
    } else if (platform === 'darwin' && cur.boosted) {
      // 重复 boost：先收掉上一轮残留的 caffeinate，避免多实例叠加
      const oldPid = read<string | null>(KEY_CAFF_PID, null)
      if (oldPid && PID_RE.test(oldPid)) {
        const prior = await runner
          .run(buildRestoreScript(oldPid, platform))
          .catch(() => null)
        if (prior && !parseActionOutcome(prior.stdout, prior.code).ok) {
          cleanupWarning = `上一轮 caffeinate（PID ${oldPid}）未能结束，可能仍在阻止休眠`
        }
      }
    }
    const { stdout, code } = await runner.run(buildBoostScript(platform))
    // macOS 的 boost 回执是 caffeinate 的 PID（而非 OK 令牌），单独判定；
    // 其余平台统一走严格回执解析（ERR: 优先 / OK 必须独立成行）。
    let ok: boolean
    let message: string
    if (platform === 'darwin') {
      const pid = stdout.trim()
      ok = PID_RE.test(pid)
      message = ok ? '已启动 caffeinate，游戏期间不会休眠' : '启动 caffeinate 失败'
      // 仅在拿到合法 PID 时落盘，避免把错误输出当 PID 存下来
      if (ok) write(KEY_CAFF_PID, pid)
    } else {
      const outcome = parseActionOutcome(stdout, code)
      ok = outcome.ok
      message = outcome.ok ? '已切换到高性能模式' : outcome.message
    }
    if (cleanupWarning) message = `${message}；注意：${cleanupWarning}`
    write(KEY_BOOSTED, ok)
    return { ok, message, status: await status() }
  }

  const restore = async (): Promise<GameModeActionResult> => {
    // macOS 还原靠 caffeinate PID，其他平台还原靠 boost 前的电源方案/governor
    const prev =
      platform === 'darwin'
        ? read<string | null>(KEY_CAFF_PID, null)
        : read<string | null>(KEY_PREVIOUS, null)

    if (!prev) {
      // 从未 boost（或凭据已被清理）：无需执行脚本，只校正标志位
      write(KEY_BOOSTED, false)
      return { ok: true, message: '当前未处于游戏模式，无需还原', status: await status() }
    }

    const { stdout, code } = await runner.run(buildRestoreScript(prev, platform))
    const outcome = parseActionOutcome(stdout, code)
    if (!outcome.ok) {
      // 还原失败必须保留凭据与 boosted：否则用户会永久停在性能模式，
      // 而应用已忘掉该还原成什么，再也无法恢复。
      return { ok: false, message: outcome.message, status: await status() }
    }

    write(KEY_BOOSTED, false)
    write(KEY_PREVIOUS, null)
    write(KEY_CAFF_PID, null)
    return { ok: true, message: '已退出游戏模式，还原上一模式', status: await status() }
  }

  return { status, boost, restore }
}
