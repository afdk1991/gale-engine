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
 */
export function createPowershellRunner(): ExecRunner {
  return {
    run(script: string): Promise<ExecResult> {
      return new Promise((resolve) => {
        execFile(
          'powershell',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
          (err, stdout, stderr) => {
            // 非零退出时 err.code 为退出码（number）；无法启动时为字符串（如 ENOENT）
            const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
            resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code })
          }
        )
      })
    }
  }
}
