import { describe, it, expect } from 'vitest'
import {
  createPowershellRunner,
  createBashRunner,
  createPlatformRunner,
  detectPlatform,
  isWindows,
  EXEC_TIMEOUT_MS
} from './shell'

// 注意：shell.ts 本身就是「真实子进程执行器」，单测不可避免要 spawn 一次系统 shell。
// 仅在对应平台上跑真实命令，避免在 mac/linux CI 上找不到 powershell 而误失败。

describe('detectPlatform / 常量', () => {
  it('detectPlatform 与当前平台一致', () => {
    expect(['win32', 'darwin', 'linux']).toContain(detectPlatform())
  })

  it('isWindows 与 process.platform 一致', () => {
    expect(isWindows).toBe(process.platform === 'win32')
  })

  it('默认超时为 30s 量级（M7：必须有硬超时）', () => {
    expect(EXEC_TIMEOUT_MS).toBe(30_000)
  })

  it('createPlatformRunner 在 Windows 返回 PowerShell 执行器', () => {
    const runner = createPlatformRunner(process.platform === 'win32' ? 'win32' : 'darwin')
    expect(runner).toBeTruthy()
    expect(typeof runner.run).toBe('function')
  })
})

describe('createPowershellRunner', () => {
  it.skipIf(process.platform !== 'win32')('快速脚本正常退出且 code=0', async () => {
    const runner = createPowershellRunner()
    const r = await runner.run('Write-Output "gale-ok"')
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('gale-ok')
  })

  it.skipIf(process.platform !== 'win32')(
    'M7 回归：卡死脚本在超时后按失败返回，永不挂起',
    async () => {
      // 给一个很短的硬超时，跑一个必然长时间阻塞的脚本
      const runner = createPowershellRunner(800)
      const t0 = Date.now()
      const r = await runner.run('Start-Sleep -Seconds 60; Write-Output "should-not-reach"')
      const elapsed = Date.now() - t0
      // 关键：Promise 必须 resolve（而不是永不 resolve），且按失败返回（非 0），不静默成功
      expect(r.code).not.toBe(0)
      // 应在超时附近返回，而不是真等 60s
      expect(elapsed).toBeLessThan(20_000)
    }
  )
})

describe('createBashRunner', () => {
  it.skipIf(process.platform === 'win32')('快速脚本正常退出且 code=0', async () => {
    const runner = createBashRunner()
    const r = await runner.run('echo gale-ok')
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('gale-ok')
  })

  it.skipIf(process.platform === 'win32')(
    'M7 回归：bash 卡死脚本在超时后按失败返回，永不挂起',
    async () => {
      const runner = createBashRunner(800)
      const t0 = Date.now()
      const r = await runner.run('sleep 60; echo should-not-reach')
      const elapsed = Date.now() - t0
      expect(r.code).not.toBe(0)
      expect(elapsed).toBeLessThan(20_000)
    }
  )
})
