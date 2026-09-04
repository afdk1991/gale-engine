import { describe, it, expect } from 'vitest'
import { createToolboxService } from './toolbox'
import type { ExecRunner } from './shell'

function recordingRunner(respond: (script: string) => { stdout: string; stderr: string; code: number }) {
  const runner: ExecRunner = {
    run: (script: string) => Promise.resolve(respond(script))
  }
  return runner
}

const ok = (stdout = 'OK'): { stdout: string; stderr: string; code: number } => ({
  stdout,
  stderr: '',
  code: 0
})
const fail = (stderr = 'boom'): { stdout: string; stderr: string; code: number } => ({
  stdout: '',
  stderr,
  code: 1
})

describe('Toolbox', () => {
  it('flushDns 成功时返回 ok', async () => {
    const runner = recordingRunner(() => ok('Successfully flushed'))
    const r = await createToolboxService(runner).flushDns()
    expect(r.ok).toBe(true)
    expect(r.message).toContain('已刷新')
  })

  it('emptyRecycleBin 成功时返回 ok', async () => {
    const runner = recordingRunner(() => ok())
    const r = await createToolboxService(runner).emptyRecycleBin()
    expect(r.ok).toBe(true)
  })

  it('clearClipboard 成功时返回 ok', async () => {
    const runner = recordingRunner(() => ok())
    const r = await createToolboxService(runner).clearClipboard()
    expect(r.ok).toBe(true)
  })

  it('toggleDarkMode(true) 写入 AppsUseLightTheme=0（深色）', async () => {
    const calls: string[] = []
    const runner = recordingRunner((s) => {
      calls.push(s)
      return ok()
    })
    const r = await createToolboxService(runner).toggleDarkMode(true)
    expect(r.ok).toBe(true)
    expect(calls[0]).toContain('AppsUseLightTheme')
    expect(calls[0]).toContain('-Value 0')
  })

  it('toggleDarkMode(false) 写入 AppsUseLightTheme=1（浅色）', async () => {
    const calls: string[] = []
    const runner = recordingRunner((s) => {
      calls.push(s)
      return ok()
    })
    const r = await createToolboxService(runner).toggleDarkMode(false)
    expect(r.ok).toBe(true)
    expect(calls[0]).toContain('-Value 1')
  })

  it('命令失败时将 stderr 透传为失败原因', async () => {
    const runner = recordingRunner(() => fail('access denied'))
    const r = await createToolboxService(runner).flushDns()
    expect(r.ok).toBe(false)
    expect(r.message).toContain('access denied')
  })
})
