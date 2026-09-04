import { describe, it, expect, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createAutoLaunchService, autostartFilePath, buildAutostartContent, type LoginItemApi } from './autolaunch'

function makeApi(initial = false): LoginItemApi {
  let openAtLogin = initial
  return {
    getLoginItemSettings: () => ({ openAtLogin }),
    setLoginItemSettings: (s) => {
      openAtLogin = s.openAtLogin
    }
  }
}

describe('createAutoLaunchService', () => {
  it('reads initial state', () => {
    expect(createAutoLaunchService(makeApi(true)).get()).toBe(true)
    expect(createAutoLaunchService(makeApi(false)).get()).toBe(false)
  })

  it('enables auto-launch and persists it', () => {
    const api = makeApi(false)
    const svc = createAutoLaunchService(api)
    expect(svc.set(true)).toBe(true)
    expect(api.getLoginItemSettings().openAtLogin).toBe(true)
  })

  it('disables auto-launch and persists it', () => {
    const api = makeApi(true)
    const svc = createAutoLaunchService(api)
    expect(svc.set(false)).toBe(false)
    expect(api.getLoginItemSettings().openAtLogin).toBe(false)
  })
})
describe('createAutoLaunchService linux 分支', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gale-autolaunch-'))

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('linux get 读取 autostart 文件存在性', () => {
    const svc = createAutoLaunchService(makeApi(false), 'linux', { baseDir: tmp })
    expect(svc.get()).toBe(false)
    svc.set(true)
    expect(fs.existsSync(autostartFilePath(tmp))).toBe(true)
    expect(svc.get()).toBe(true)
  })

  it('linux set(false) 删除 autostart 文件', () => {
    const svc = createAutoLaunchService(makeApi(false), 'linux', { baseDir: tmp })
    svc.set(true)
    expect(fs.existsSync(autostartFilePath(tmp))).toBe(true)
    svc.set(false)
    expect(fs.existsSync(autostartFilePath(tmp))).toBe(false)
  })

  it('linux set(true) 写入标准 desktop 条目', () => {
    const svc = createAutoLaunchService(makeApi(false), 'linux', { baseDir: tmp, execPath: '/usr/bin/gale' })
    svc.set(true)
    const content = fs.readFileSync(autostartFilePath(tmp), 'utf8')
    expect(content).toContain('[Desktop Entry]')
    expect(content).toContain('Exec="/usr/bin/gale"')
    expect(content).toContain('X-GNOME-Autostart-enabled=true')
  })

  it('buildAutostartContent 生成标准 desktop 条目', () => {
    const c = buildAutostartContent('/opt/gale/bin')
    expect(c).toContain('[Desktop Entry]')
    expect(c).toContain('Type=Application')
    expect(c).toContain('Exec="/opt/gale/bin"')
  })

  it('win32 平台不受 linux 分支影响', () => {
    const api = makeApi(true)
    expect(createAutoLaunchService(api, 'win32', { baseDir: tmp }).get()).toBe(true)
  })
})
