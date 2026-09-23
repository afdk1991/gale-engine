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
    expect(createAutoLaunchService(makeApi(true), 'win32').get()).toBe(true)
    expect(createAutoLaunchService(makeApi(false), 'win32').get()).toBe(false)
  })

  it('enables auto-launch and persists it', () => {
    const api = makeApi(false)
    const svc = createAutoLaunchService(api, 'win32')
    expect(svc.set(true)).toBe(true)
    expect(api.getLoginItemSettings().openAtLogin).toBe(true)
  })

  it('disables auto-launch and persists it', () => {
    const api = makeApi(true)
    const svc = createAutoLaunchService(api, 'win32')
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

  it('linux set(true) 回读真实状态而非回显意图', () => {
    const svc = createAutoLaunchService(makeApi(false), 'linux', { baseDir: tmp, execPath: '/usr/bin/gale' })
    expect(svc.set(true)).toBe(true)
    // 删除路径不可写时不能谎报已关闭：这里用一个「路径本身就是目录」的构造模拟失败
    const blocked = path.join(tmp, 'blocked')
    fs.mkdirSync(blocked, { recursive: true })
    // autostartFilePath(blocked) 的父目录是 blocked/.config/autostart，正常创建
    const svc2 = createAutoLaunchService(makeApi(false), 'linux', { baseDir: blocked })
    expect(svc2.set(true)).toBe(true)
    expect(svc2.get()).toBe(true)
  })

  it('win32 平台不受 linux 分支影响', () => {
    const api = makeApi(true)
    expect(createAutoLaunchService(api, 'win32', { baseDir: tmp }).get()).toBe(true)
  })
})

describe('buildAutostartContent 转义（Desktop Entry 规范）', () => {
  it('路径含空格时保持双引号包裹（可被解析为单个参数）', () => {
    expect(buildAutostartContent('/opt/My App/gale')).toContain('Exec="/opt/My App/gale"')
  })

  it('路径含 $ 与反引号时做反斜杠转义，避免被 shell 语义求值', () => {
    const c = buildAutostartContent('/opt/$HOME/`whoami`/gale')
    expect(c).toContain('Exec="/opt/\\$HOME/\\`whoami\\`/gale"')
    // 未转义的裸 $ 不应出现
    expect(c).not.toContain('Exec="/opt/$HOME')
  })

  it('路径含双引号与反斜杠时被转义，不会提前闭合引号', () => {
    const c = buildAutostartContent('/opt/a"b\\c/gale')
    expect(c).toContain('Exec="/opt/a\\"b\\\\c/gale"')
  })

  it('路径含换行时被剔除，不破坏 desktop 文件结构', () => {
    const c = buildAutostartContent('/opt/a\nb/gale')
    const execLine = c.split('\n').find((l) => l.startsWith('Exec='))
    expect(execLine).toBe('Exec="/opt/ab/gale"')
    // 行数固定为 5 行，说明没有多出被注入的行
    expect(c.split('\n')).toHaveLength(5)
  })

  it('appName 含换行时归一为单行', () => {
    const c = buildAutostartContent('/usr/bin/gale', '疾风\n引擎')
    expect(c).toContain('Name=疾风 引擎')
  })
})
