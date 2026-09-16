import type { UpdateCapability } from '../../shared/types'

/**
 * 平台自动更新能力探测（纯函数，无 Electron 依赖，可单测）。
 *
 * 为什么必须探测：electron-updater 并不能在所有平台/所有安装方式下都自更新，
 * 而且「装了哪个格式的包」直接决定能不能自更新。不探测就会出现最糟糕的体验——
 * 「点检查更新 → 提示发现新版本 → 但永远装不上」。
 *
 *  - Windows：NSIS 安装包（perMachine=false，装到用户目录）→ 支持应用内自更新。
 *  - macOS：electron-updater **只认 zip**（dmg 是给用户手动拖拽安装的）。
 *    因此 electron-builder 必须同时产出 dmg（给人）与 zip（给自动更新）。
 *    另：未签名应用会被系统拒绝替换，故签名错误要翻译成可行动的提示。
 *  - Linux：只有 **AppImage** 能自更新（靠 APPIMAGE 环境变量定位自身文件）；
 *    deb/rpm 归系统包管理器管辖，应用内无法也不应自行覆盖 → 诚实降级并给出指引。
 */
export function detectUpdateCapability(input: {
  platform: string
  isPackaged: boolean
  /** AppImage 运行时由 AppImage runtime 注入的自身路径 */
  appImagePath?: string | undefined
}): UpdateCapability {
  const platform =
    (['win32', 'darwin', 'linux'] as const).find((p) => p === input.platform) ?? 'other'

  if (!input.isPackaged) {
    return {
      canAutoUpdate: false,
      platform,
      packageKind: 'unknown',
      reason: '开发模式（未打包）下没有可用的更新源，请用打包后的安装包验证自动更新'
    }
  }

  if (platform === 'win32') {
    return { canAutoUpdate: true, platform, packageKind: 'nsis', reason: null }
  }

  if (platform === 'darwin') {
    // 打包后的 mac 应用走 zip 更新；是否真的能装取决于签名，失败时由错误翻译兜底
    return { canAutoUpdate: true, platform, packageKind: 'mac-zip', reason: null }
  }

  if (platform === 'linux') {
    if (input.appImagePath) {
      return { canAutoUpdate: true, platform, packageKind: 'appimage', reason: null }
    }
    return {
      canAutoUpdate: false,
      platform,
      packageKind: 'deb',
      reason:
        '当前以 deb/rpm 等系统包方式安装，应用内无法自更新。请用系统包管理器升级' +
        '（如 sudo apt update && sudo apt install --only-upgrade 疾风引擎），' +
        '或改用 AppImage 版本以获得应用内自动更新'
    }
  }

  return {
    canAutoUpdate: false,
    platform,
    packageKind: 'unknown',
    reason: `当前平台（${input.platform}）不支持应用内自动更新`
  }
}

/**
 * 解释 electron-updater `checkForUpdates()` 的返回值（纯函数，可单测）。
 *
 * ⚠️ 这里有个极易踩错的地方，必须区分「两种没有更新」：
 *   - `res == null`：更新器未启用（未打包、或 isUpdaterActive() 为 false）。
 *   - `res.isUpdateAvailable === false`：**确实已是最新版本**。
 *     此时 `res.versionInfo` 装的是仓库里的**最新版**信息，而不是"有可更新版本"，
 *     所以绝不能拿 versionInfo 的存在与否来判断有没有更新。
 *
 * 曾经因为「非 null 即视为有更新」，导致「已是最新版本」永远不会出现、永远误报有新版本。
 */
export function interpretCheckResult(
  res: { isUpdateAvailable: boolean; versionInfo?: { version?: string | number } } | null | undefined
): { isUpdateAvailable: boolean; updateInfo?: { version?: string | number } } {
  if (!res || !res.isUpdateAvailable) return { isUpdateAvailable: false }
  const version = res.versionInfo?.version
  if (version === undefined || version === null || version === '') {
    // 声称有更新却没给版本号：无法驱动下载/展示，按「无更新」处理比误报更安全
    return { isUpdateAvailable: false }
  }
  return { isUpdateAvailable: true, updateInfo: { version } }
}

/** 把 electron-updater 的原始错误翻译成用户能看懂、能行动的说明 */
export function describeUpdateError(message: string, platform: string): string {
  const m = message || ''
  if (/code signature|signature.*invalid|not signed|could not get code signature/i.test(m)) {
    return 'macOS 版本未做代码签名，系统拒绝自动替换应用。请到 Release 页面手动下载 dmg 覆盖安装'
  }
  if (/net::|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|socket hang up|getaddrinfo|fetch failed/i.test(m)) {
    return `网络不可达，无法连接更新源（请检查网络或代理后重试）：${m}`
  }
  if (/404|Cannot find|not found|no published versions|latest.*ya?ml/i.test(m)) {
    return `更新源缺少当前平台（${platform}）的更新元数据（latest*.yml）。请确认该版本的 Release 已发布对应平台的安装包：${m}`
  }
  if (/EPERM|EACCES|permission|拒绝访问/i.test(m)) {
    return `没有权限写入安装目录，请以管理员身份运行后重试：${m}`
  }
  return m
}
