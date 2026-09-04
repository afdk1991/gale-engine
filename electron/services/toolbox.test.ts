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
describe('Toolbox unix 分支', () => {
  it('darwin flushDns 使用 dscacheutil', async () => {
    const calls: string[] = []
    const runner = recordingRunner((s) => { calls.push(s); return ok() })
    const r = await createToolboxService(runner, 'darwin').flushDns()
    expect(r.ok).toBe(true)
    expect(calls[0]).toContain('dscacheutil -flushcache')
  })

  it('linux flushDns 使用 resolvectl', async () => {
    const calls: string[] = []
    const runner = recordingRunner((s) => { calls.push(s); return ok() })
    const r = await createToolboxService(runner, 'linux').flushDns()
    expect(r.ok).toBe(true)
    expect(calls[0]).toContain('resolvectl flush-caches')
  })

  it('darwin emptyRecycleBin 优先 Finder osascript', async () => {
    const calls: string[] = []
    const runner = recordingRunner((s) => { calls.push(s); return ok() })
    const r = await createToolboxService(runner, 'darwin').emptyRecycleBin()
    expect(r.ok).toBe(true)
    expect(calls[0]).toContain('empty trash')
  })

  it('linux emptyRecycleBin 清空 XDG Trash', async () => {
    const calls: string[] = []
    const runner = recordingRunner((s) => { calls.push(s); return ok() })
    const r = await createToolboxService(runner, 'linux').emptyRecycleBin()
    expect(r.ok).toBe(true)
    expect(calls[0]).toContain('.local/share/Trash')
  })

  it('darwin clearClipboard 使用 pbcopy', async () => {
    const calls: string[] = []
    const runner = recordingRunner((s) => { calls.push(s); return ok() })
    const r = await createToolboxService(runner, 'darwin').clearClipboard()
    expect(r.ok).toBe(true)
    expect(calls[0]).toContain('pbcopy')
  })

  it('linux clearClipboard 使用 wl-copy/xclip/xsel', async () => {
    const calls: string[] = []
    const runner = recordingRunner((s) => { calls.push(s); return ok() })
    const r = await createToolboxService(runner, 'linux').clearClipboard()
    expect(r.ok).toBe(true)
    expect(calls[0]).toContain('wl-copy')
  })

  it('darwin toggleDarkMode(true) 写入 AppleInterfaceStyle Dark', async () => {
    const calls: string[] = []
    const runner = recordingRunner((s) => { calls.push(s); return ok() })
    const r = await createToolboxService(runner, 'darwin').toggleDarkMode(true)
    expect(r.ok).toBe(true)
    expect(calls[0]).toContain('AppleInterfaceStyle -string Dark')
  })

  it('linux toggleDarkMode(false) 使用 gsettings prefer-light', async () => {
    const calls: string[] = []
    const runner = recordingRunner((s) => { calls.push(s); return ok() })
    const r = await createToolboxService(runner, 'linux').toggleDarkMode(false)
    expect(r.ok).toBe(true)
    expect(calls[0]).toContain('gsettings')
    expect(calls[0]).toContain('prefer-light')
  })
})
