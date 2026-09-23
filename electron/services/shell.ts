import { execFile } from 'child_process'
import * as os from 'os'

export interface ExecResult {
  stdout: string
  stderr: string
  /** 0 表示成功；非 0 为进程退出码或 1（异常） */
  code: number
}

/**
 * 执行器接口：运行一段「平台原生脚本」，返回标准输出与退出码。
 * - Windows：PowerShell 脚本（createPowershellRunner）
 * - macOS / Linux：bash 脚本（createBashRunner）
 * 脚本内容由各 service 的平台脚本生成器按 process.platform 产出，保证调用方语义一致。
 */
export interface ExecRunner {
  /** 运行一段平台原生脚本，返回标准输出与退出码 */
  run(script: string): Promise<ExecResult>
}

/** 平台标识，用于脚本生成器分发。 */
export type Platform = 'win32' | 'darwin' | 'linux' | 'other'

export function detectPlatform(): Platform {
  const p = process.platform
  if (p === 'win32') return 'win32'
  if (p === 'darwin') return 'darwin'
  if (p === 'linux') return 'linux'
  return 'other'
}

/**
 * 单次脚本执行的硬超时（毫秒）。
 *
 * 背景（走读 M7）：execFile 未设 timeout 时，若脚本卡死（如 Get-CimInstance 命中死网盘、
 * ping 无超时阻塞），子进程永不退出，runner 的 Promise 永不 resolve，渲染层 IPC 被挂住，
 * 且会不断堆积子进程。设硬超时后 Node 自动 kill 子进程并回调 err，本层按失败（非 0 退出码）
 * 返回，下游 parseActionOutcome / `code===0` 判定自然把它当成失败，不会静默成功。
 *
 * 测试时可向 createPowershellRunner / createBashRunner 传入更短的值，避免真等 30s。
 */
export const EXEC_TIMEOUT_MS = 30_000

/**
 * 默认 Windows 执行器：调用系统 powershell 执行脚本。
 * 测试时注入 fake 实现，避免依赖真实 Windows 环境。
 * 统一设置 [Console]::OutputEncoding=UTF8：PowerShell 5.1 在无 TTY 重定向时默认用系统 ANSI(GBK) 输出，
 * 会导致中文输出被 Node 按 UTF-8 误读为乱码。
 */
export function createPowershellRunner(timeoutMs: number = EXEC_TIMEOUT_MS): ExecRunner {
  const UTF8_PREFIX = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;'
  return {
    run(script: string): Promise<ExecResult> {
      return new Promise((resolve) => {
        execFile(
          'powershell',
          ['-NoProfile', '-NonInteractive', '-Command', UTF8_PREFIX + script],
          { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs },
          (err, stdout, stderr) => {
            // 超时 kill 时 err.killed=true 且 err.code 非数字（通常为 null），归一为 1 → 失败
            const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
            resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code })
          }
        )
      })
    }
  }
}

/**
 * macOS / Linux 执行器：调用系统 bash 执行脚本。
 * - macOS 默认 bash 3.2（/bin/bash）；脚本仅用 POSIX 兼容特性，避免依赖 bash 4+ 语法。
 * - Linux 主流发行版均自带 bash。
 * - env LC_ALL=C.UTF-8：强制 UTF-8 输出，避免 locale 未设置时中文乱码。
 * - 不强制 LANG：部分精简容器无 locale，设 LANG 会告警。
 */
export function createBashRunner(timeoutMs: number = EXEC_TIMEOUT_MS): ExecRunner {
  return {
    run(script: string): Promise<ExecResult> {
      return new Promise((resolve) => {
        execFile(
          'bash',
          ['-c', script],
          {
            env: { ...process.env, LC_ALL: 'C.UTF-8' },
            maxBuffer: 16 * 1024 * 1024,
            timeout: timeoutMs
          },
          (err, stdout, stderr) => {
            // 同 PowerShell：超时 kill 时 err.code 非数字，归一为 1 → 失败
            const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
            resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code })
          }
        )
      })
    }
  }
}

/**
 * 平台工厂：按当前操作系统返回合适的执行器。
 * - win32 → PowerShell
 * - darwin / linux → bash
 * - other → bash（兜底，行为未保证）
 *
 * 这是跨平台架构的总入口：main.ts 用此函数替代直接的 createPowershellRunner()，
 * 各 service 的脚本生成器再按 detectPlatform() 分发平台脚本。
 */
export function createPlatformRunner(platform: Platform = detectPlatform()): ExecRunner {
  switch (platform) {
    case 'win32':
      return createPowershellRunner()
    case 'darwin':
    case 'linux':
    case 'other':
    default:
      return createBashRunner()
  }
}

/** 便捷：当前是否为 Windows 平台 */
export const isWindows = os.platform() === 'win32'
