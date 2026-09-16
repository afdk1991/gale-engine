import { describe, it, expect } from 'vitest'
import { detectUpdateCapability, describeUpdateError, interpretCheckResult } from './update.capability'

describe('detectUpdateCapability — 平台自动更新能力', () => {
  it('开发模式（未打包）不支持，并说明原因', () => {
    const c = detectUpdateCapability({ platform: 'win32', isPackaged: false })
    expect(c.canAutoUpdate).toBe(false)
    expect(c.packageKind).toBe('unknown')
    expect(c.reason).toContain('开发模式')
  })

  it('Windows 打包后走 NSIS，支持自更新', () => {
    const c = detectUpdateCapability({ platform: 'win32', isPackaged: true })
    expect(c.canAutoUpdate).toBe(true)
    expect(c.packageKind).toBe('nsis')
    expect(c.reason).toBeNull()
  })

  it('macOS 打包后走 zip（electron-updater 只认 zip，不认 dmg）', () => {
    const c = detectUpdateCapability({ platform: 'darwin', isPackaged: true })
    expect(c.canAutoUpdate).toBe(true)
    expect(c.packageKind).toBe('mac-zip')
  })

  it('Linux AppImage 运行时可自更新', () => {
    const c = detectUpdateCapability({
      platform: 'linux',
      isPackaged: true,
      appImagePath: '/home/u/Apps/疾风引擎.AppImage'
    })
    expect(c.canAutoUpdate).toBe(true)
    expect(c.packageKind).toBe('appimage')
  })

  it('Linux deb/rpm 安装时诚实降级，并给出可执行替代方案', () => {
    const c = detectUpdateCapability({ platform: 'linux', isPackaged: true })
    expect(c.canAutoUpdate).toBe(false)
    expect(c.packageKind).toBe('deb')
    expect(c.reason).toContain('包管理器')
    expect(c.reason).toContain('AppImage')
  })

  it('未知平台不支持', () => {
    const c = detectUpdateCapability({ platform: 'freebsd', isPackaged: true })
    expect(c.canAutoUpdate).toBe(false)
    expect(c.platform).toBe('other')
  })
})

describe('describeUpdateError — 错误翻译成可行动的提示', () => {
  it('签名错误 → 提示手动下载 dmg', () => {
    const msg = describeUpdateError('Could not get code signature for running application', 'darwin')
    expect(msg).toContain('dmg')
  })

  it('网络错误 → 提示检查网络/代理', () => {
    const msg = describeUpdateError('net::ERR_INTERNET_DISCONNECTED', 'win32')
    expect(msg).toContain('网络')
  })

  it('缺少 latest.yml → 提示更新源元数据缺失', () => {
    const msg = describeUpdateError('Cannot find latest.yml in the latest release', 'linux')
    expect(msg).toContain('latest')
  })

  it('权限错误 → 提示以管理员身份运行', () => {
    const msg = describeUpdateError('EPERM: operation not permitted', 'win32')
    expect(msg).toContain('管理员')
  })

  it('无法归类的错误原样返回，不丢失信息', () => {
    expect(describeUpdateError('某个未知错误', 'win32')).toBe('某个未知错误')
  })
})

// ── 返回值解释（回归：曾把「已是最新」误判为「有更新」）──────────
describe('interpretCheckResult — 区分两种"没有更新"', () => {
  it('更新器未启用（null/undefined）→ 无更新', () => {
    expect(interpretCheckResult(null).isUpdateAvailable).toBe(false)
    expect(interpretCheckResult(undefined).isUpdateAvailable).toBe(false)
  })

  // ★ 关键回归：electron-updater 无更新时返回 { isUpdateAvailable:false }，且 versionInfo 是"最新版"信息
  it('isUpdateAvailable=false 时不得误报有更新（versionInfo 存在也不行）', () => {
    const r = interpretCheckResult({
      isUpdateAvailable: false,
      versionInfo: { version: '0.1.9' }
    })
    expect(r.isUpdateAvailable).toBe(false)
    expect(r.updateInfo).toBeUndefined()
  })

  it('isUpdateAvailable=true 且有版本号 → 有更新并带版本', () => {
    const r = interpretCheckResult({ isUpdateAvailable: true, versionInfo: { version: '0.1.10' } })
    expect(r.isUpdateAvailable).toBe(true)
    expect(r.updateInfo?.version).toBe('0.1.10')
  })

  it('声称有更新但缺版本号 → 按无更新处理（避免界面无法展示/下载）', () => {
    expect(interpretCheckResult({ isUpdateAvailable: true }).isUpdateAvailable).toBe(false)
    expect(interpretCheckResult({ isUpdateAvailable: true, versionInfo: {} }).isUpdateAvailable).toBe(false)
    expect(
      interpretCheckResult({ isUpdateAvailable: true, versionInfo: { version: '' } }).isUpdateAvailable
    ).toBe(false)
  })
})
