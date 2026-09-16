import { tmpdir } from 'os'
import { join } from 'path'
import type { ExecResult, ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'

// ─────────────────────────────────────────────────────────────
// 提权（UAC / root）
//
// 背景与成因（本项目原本拿不到管理员权限的三个原因）：
//   1. 打包清单未声明 requestedExecutionLevel，默认 asInvoker → 双击启动永不弹 UAC。
//   2. 所有优化命令都走「当前进程权限」的 PowerShell/bash 子进程 → 父进程没提权，
//      子进程必然也没提权（Windows 上无法在运行时给自身提权）。
//   3. 没有「按需提权」通道：要么整个应用始终以管理员运行（与开机自启/自动更新冲突），
//      要么永远没权限。正确做法是 asInvoker 启动 + 需要时经由 ShellExecute(runas) 提权执行。
//
// 因此这里提供：
//   - isElevated()：检测当前是否已提权
//   - runElevated(script)：把单条命令放到提权子进程里执行，并回收其 stdout/stderr
//   - restartElevated()：以提权方式重启本应用（供用户手动点一次）
// ─────────────────────────────────────────────────────────────

/** PowerShell 单引号字面量转义 */
function psSingleQuote(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`
}

/** shell 单引号转义：' → '\'' */
function shq(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/** 读写临时文件的抽象，便于测试注入（不依赖真实磁盘） */
export interface TempIo {
  writeFile(path: string, content: string): Promise<void>
  readFile(path: string): Promise<string>
  unlink(path: string): Promise<void>
  /** 列出目录下的文件名（用于清理残留）。缺省时跳过清理，不影响主流程。 */
  list?(dir: string): Promise<string[]>
  /** 读取文件最后修改时间（毫秒）。与 list 配合，只清理「确实陈旧」的残留。 */
  mtime?(path: string): Promise<number>
}

/** 提权临时文件的统一前缀 */
export const TMP_PREFIX = 'gale-elev-'

/** 超过该时长未改动，视为上一轮异常退出留下的残留（默认 1 小时） */
export const STALE_TEMP_MS = 60 * 60 * 1000

export function createNodeTempIo(): TempIo {
  return {
    async writeFile(path, content) {
      const { writeFile } = await import('fs/promises')
      await writeFile(path, content, 'utf8')
    },
    async readFile(path) {
      const { readFile } = await import('fs/promises')
      return readFile(path, 'utf8')
    },
    async unlink(path) {
      const { unlink } = await import('fs/promises')
      try {
        await unlink(path)
      } catch {
        /* 已被清理或不存在，忽略 */
      }
    },
    async list(dir) {
      const { readdir } = await import('fs/promises')
      return readdir(dir)
    },
    async mtime(path) {
      const { stat } = await import('fs/promises')
      return (await stat(path)).mtimeMs
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 脚本生成（纯函数，可单测）
// ─────────────────────────────────────────────────────────────

/** 检测是否已提升到管理员 / root。输出 True / False。 */
export function buildIsElevatedScript(platform: Platform = detectPlatform()): string {
  if (platform === 'win32') {
    return (
      '$id = [Security.Principal.WindowsIdentity]::GetCurrent(); ' +
      '$p = New-Object Security.Principal.WindowsPrincipal($id); ' +
      'if ($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { "True" } else { "False" }'
    )
  }
  return 'if [ "$(id -u)" = "0" ]; then echo True; else echo False; fi'
}

/** 解析提权检测输出。命令失败时保守地按「未提权」处理。 */
export function parseIsElevated(stdout: string, code = 0): boolean {
  if (code !== 0) return false
  return /^\s*true\s*$/i.test(String(stdout).trim().split(/\r?\n/)[0] ?? '')
}

/**
 * 生成「提权执行」外层脚本。
 * - win32：把 payload 脚本文件交给 Start-Process -Verb RunAs（ShellExecute runas）弹 UAC，
 *   并用 -RedirectStandardOutput/-RedirectStandardError 把提权子进程的输出落盘，
 *   -Wait -PassThru 等待结束并取回 ExitCode。
 * - unix：依次尝试 pkexec / sudo -n 执行 bash 脚本；两者都不可用时退出 127 由调用方诚实降级。
 */
export function buildElevatedRunScript(opts: {
  scriptPath: string
  outPath: string
  errPath: string
  platform?: Platform
}): string {
  const platform = opts.platform ?? detectPlatform()
  if (platform === 'win32') {
    return [
      '$ErrorActionPreference = "Stop"',
      `$p = Start-Process -FilePath "powershell" -Verb RunAs -Wait -PassThru -WindowStyle Hidden \``,
      `  -RedirectStandardOutput ${psSingleQuote(opts.outPath)} \``,
      `  -RedirectStandardError ${psSingleQuote(opts.errPath)} \``,
      `  -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${psSingleQuote(
        opts.scriptPath
      )}`,
      'exit $p.ExitCode'
    ].join('\n')
  }
  return [
    `if command -v pkexec >/dev/null 2>&1; then`,
    `  pkexec bash ${shq(opts.scriptPath)}`,
    `  exit $?`,
    `elif command -v sudo >/dev/null 2>&1; then`,
    `  sudo -n bash ${shq(opts.scriptPath)}`,
    `  exit $?`,
    `else`,
    `  echo "ERR: 未找到 pkexec 或 sudo，无法提权执行" >&2`,
    `  exit 127`,
    `fi`
  ].join('\n')
}

/**
 * 生成「以提升权限重启本应用」脚本。
 * @param exePath 应用可执行文件路径（Windows 为 .exe；macOS 传 .app 或内部二进制均可）
 * @returns 脚本；当前平台不支持时返回 null
 */
export function buildRelaunchElevatedScript(
  exePath: string,
  platform: Platform = detectPlatform()
): string | null {
  if (!exePath) return null
  if (platform === 'win32') {
    return `Start-Process -FilePath ${psSingleQuote(exePath)} -Verb RunAs`
  }
  if (platform === 'darwin') {
    const app = macAppPath(exePath) ?? exePath
    return `osascript -e 'do shell script "open -a ${app.replace(/'/g, "'\\''")}" with administrator privileges' >/dev/null 2>&1`
  }
  return null
}

/**
 * macOS：由 ".../疾风引擎.app/Contents/MacOS/疾风引擎" 还原出 ".app" 路径。
 * 非 .app 结构时返回 null（调用方退回原始路径）。
 */
export function macAppPath(exePath: string): string | null {
  const marker = '/Contents/MacOS/'
  const i = exePath.indexOf(marker)
  return i > 0 ? exePath.slice(0, i) : null
}

// ─────────────────────────────────────────────────────────────
// Service 工厂
// ─────────────────────────────────────────────────────────────

export interface ElevatorDeps {
  /** 普通权限执行器（用于跑外层脚本） */
  runner: ExecRunner
  platform?: Platform
  /** 临时文件读写，默认走 fs/promises */
  io?: TempIo
  /** 临时目录，默认 os.tmpdir() */
  tmpDir?: string
  /** 应用可执行文件路径，restartElevated 需要 */
  exePath?: string
  /** 重启前退出当前实例（Electron 侧注入 app.quit） */
  quit?: () => void
  /** 唯一 id 生成，默认时间戳+随机 */
  newId?: () => string
}

export interface Elevator {
  /** 当前是否已提升权限 */
  isElevated(): Promise<boolean>
  /** 以提升权限执行一段平台脚本，并回收其输出 */
  runElevated(script: string): Promise<ExecResult>
  /** 以提升权限重启本应用 */
  restartElevated(): Promise<{ ok: boolean; message: string }>
}

export function createElevator(deps: ElevatorDeps): Elevator {
  const platform = deps.platform ?? detectPlatform()
  const io = deps.io ?? createNodeTempIo()
  const tmpDir = deps.tmpDir ?? tmpdir()
  const newId = deps.newId ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)

  const isElevated = async (): Promise<boolean> => {
    const { stdout, code } = await deps.runner.run(buildIsElevatedScript(platform))
    return parseIsElevated(stdout, code)
  }

  /** 逐个删除，互不拖累：任一失败都不影响其余文件的清理 */
  const safeUnlink = async (paths: string[]): Promise<void> => {
    for (const p of paths) {
      try {
        await io.unlink(p)
      } catch {
        /* 清理失败不应影响正常流程 */
      }
    }
  }

  /**
   * 清理历史残留的临时文件（进程级只做一次，尽力而为）。
   *
   * 为什么需要：Windows 上提权靠 `Start-Process -Verb RunAs -Wait`，UAC 弹窗长时间
   * 无人应答、或用户直接结束进程时，`finally` 根本不会执行，临时脚本与输出文件会
   * 永久留在 %TEMP%；而临时脚本内容包含本机路径，属于不必要的信息残留。
   * 这里只清理「确实陈旧」（默认 1 小时未改动）的文件，避免误删并发实例正在用的文件。
   */
  const sweepStaleTemp = async (): Promise<number> => {
    if (!io.list || !io.mtime) return 0
    let names: string[]
    try {
      names = await io.list(tmpDir)
    } catch {
      return 0
    }
    const now = Date.now()
    let removed = 0
    for (const name of names) {
      if (!name.startsWith(TMP_PREFIX)) continue
      const full = join(tmpDir, name)
      try {
        if (now - (await io.mtime(full)) < STALE_TEMP_MS) continue
      } catch {
        continue // 读不到时间就不动它，宁可留着也不误删
      }
      try {
        await io.unlink(full)
        removed++
      } catch {
        /* 单个文件失败继续 */
      }
    }
    return removed
  }

  let swept = false

  const runElevated = async (script: string): Promise<ExecResult> => {
    if (!swept) {
      swept = true
      await sweepStaleTemp()
    }
    const id = newId()
    const scriptPath = join(tmpDir, `${TMP_PREFIX}${id}.${platform === 'win32' ? 'ps1' : 'sh'}`)
    const outPath = join(tmpDir, `${TMP_PREFIX}${id}.out`)
    const errPath = join(tmpDir, `${TMP_PREFIX}${id}.err`)

    // Windows PowerShell 5.1 读取无 BOM 的 .ps1 会按系统 ANSI(GBK) 解码，
    // 路径含中文时会乱码甚至解析失败，因此显式写入 BOM。
    const payload = platform === 'win32' ? `﻿${script}` : script
    await io.writeFile(scriptPath, payload)

    try {
      const outer = buildElevatedRunScript({ scriptPath, outPath, errPath, platform })
      const res = await deps.runner.run(outer)

      if (platform === 'win32') {
        let stdout = ''
        let stderr = ''
        try {
          stdout = await io.readFile(outPath)
        } catch {
          /* 提权进程未产出输出 */
        }
        try {
          stderr = await io.readFile(errPath)
        } catch {
          /* 同上 */
        }
        // 用户在 UAC 弹窗点了「否」→ Start-Process 抛错，外层脚本非零退出且无输出
        if (res.code !== 0 && !stdout && !stderr) {
          stderr = '用户取消了 UAC 授权，或提权执行失败'
        }
        return { stdout, stderr, code: res.code }
      }

      // unix：pkexec/sudo 直接继承标准输出，runner 已回收
      return res
    } finally {
      // 逐项清理：任一失败不阻断其余（UAC 无响应导致进程被杀时，这里不会执行，
      // 由下一次启动的 sweepStaleTemp 兜底）
      await safeUnlink(
        platform === 'win32' ? [scriptPath, outPath, errPath] : [scriptPath]
      )
    }
  }

  const restartElevated = async (): Promise<{ ok: boolean; message: string }> => {
    // 已经提权就没必要重启
    if (await isElevated()) {
      return { ok: true, message: '当前已具备管理员/root 权限，无需重启' }
    }
    const script = buildRelaunchElevatedScript(deps.exePath ?? '', platform)
    if (!script) {
      if (platform === 'linux') {
        return {
          ok: false,
          message: 'Linux 请手动以 root 启动：sudo 疾风引擎（应用内不代持 root 凭据）'
        }
      }
      return { ok: false, message: '当前平台不支持应用内提权重启，请右键选择「以管理员身份运行」' }
    }
    const { code, stderr } = await deps.runner.run(script)
    if (code !== 0) {
      return { ok: false, message: stderr.trim() || '提权重启失败，请手动以管理员身份运行' }
    }
    // Windows/macOS：新实例由系统拉起，旧实例需自行退出
    deps.quit?.()
    return { ok: true, message: '已发起提权重启' }
  }

  return { isElevated, runElevated, restartElevated }
}
