import { execFile } from 'child_process'

export interface ExecResult {
  stdout: string
  stderr: string
  /** 0 表示成功；非 0 为进程退出码或 1（异常） */
  code: number
}

export interface ExecRunner {
  /** 运行一段 powershell 脚本，返回标准输出与退出码 */
  run(script: string): Promise<ExecResult>
}

/**
 * 默认执行器：调用系统 powershell 执行脚本。
 * 测试时注入 fake 实现，避免依赖真实 Windows 环境。
 * 统一设置 [Console]::OutputEncoding=UTF8：PowerShell 5.1 在无 TTY 重定向时默认用系统 ANSI(GBK) 输出，
 * 会导致中文输出被 Node 按 UTF-8 误读为乱码。
 */
export function createPowershellRunner(): ExecRunner {
  const UTF8_PREFIX = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;'
  return {
    run(script: string): Promise<ExecResult> {
      return new Promise((resolve) => {
        execFile(
          'powershell',
          ['-NoProfile', '-NonInteractive', '-Command', UTF8_PREFIX + script],
          { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
          (err, stdout, stderr) => {
            // 非零退出时 err.code 为退出码（number）；无法启动时为字符串（如 ENOENT）
            const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
            // 前缀已设置 UTF-8 输出，stdout 无参 toString() 按 utf8 解码中文即可
            resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code })
          }
        )
      })
    }
  }
}
