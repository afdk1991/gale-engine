import type {
  DllCategory,
  DllCheckItem,
  DllRepairAdvice,
  DllRepairKind,
  DllRepairResult,
  DllScanItem,
  DllScanResult,
  DiskRepairResult,
  SystemRepairKind
} from '../../shared/types'
import type { ExecResult, ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'

// ─────────────────────────────────────────────────────────────
// DLL（Dynamic Link Library，动态链接库）缺失检测与修复
//
// 为什么值得单做一块：
//   DLL 是 Windows 的代码共享机制——多个程序共用同一份实现。好处是省内存、
//   可模块化升级（如「运行库 VC++ Redistributable 的 msvcp140.dll」）；
//   代价是**一旦公共 DLL 缺失，会同时打挂一批程序**，而且报错往往是
//   「找不到 xxx.dll」或「0xc000007b」这种对普通用户毫无指向性的信息。
//
// 本模块做的事：
//   1. 扫描关键「系统 API DLL」与「运行库 DLL」是否缺失 / 位数不全；
//   2. 按缺失的类别给出**可执行**的修复建议（而不是一句"重装系统"）；
//   3. 执行修复：系统文件走 sfc/DISM（复用 disk 服务），运行库走 winget 装
//      VC++ Redistributable；两者都拿不到时给出官方下载地址。
//
// 诚实边界（重要）：
//   - macOS 用 .dylib/framework，Linux 用 .so，**都没有 DLL 概念**。
//     本模块在非 Windows 上只做只读的「动态库探针」，不会假装能修 DLL。
//   - 不会从任意来源下载并执行 DLL/EXE 来"补文件"：那等于开后门。
//     修复只走系统自带通道（sfc/DISM/包管理器/官方 aka.ms 安装包）。
// ─────────────────────────────────────────────────────────────

/** 目录位数标记 */
type Bits = 32 | 64

export interface DllRoot {
  path: string
  bits: Bits
}

// ─────────────────────────────────────────────────────────────
// 检查清单（静态元信息）
// ─────────────────────────────────────────────────────────────

function item(
  name: string,
  category: DllCategory,
  purpose: string,
  origin: string,
  impact: string,
  critical = false
): DllCheckItem {
  return {
    id: name.replace(/\.dll$/i, '').toLowerCase(),
    name,
    category,
    purpose,
    origin,
    impact,
    critical
  }
}

/** Windows 核心系统 API（kernel32/user32 等，正常系统恒存在，缺失=系统已损坏） */
const SYSTEM_DLLS: DllCheckItem[] = [
  item('kernel32.dll', 'system', '内存管理、文件与进程等最底层 API', 'Windows 系统组件', '几乎所有程序无法启动', true),
  item('user32.dll', 'system', '窗口创建、消息循环与键鼠输入', 'Windows 系统组件', '界面无法创建或完全无响应', true),
  item('gdi32.dll', 'system', '图形设备接口（绘图、字体、位图）', 'Windows 系统组件', '界面绘制错乱、字体异常', true),
  item('advapi32.dll', 'system', '注册表、服务与安全令牌', 'Windows 系统组件', '启动项与服务读写失败', true),
  item('shell32.dll', 'system', 'Shell API（文件操作、快捷方式、图标）', 'Windows 系统组件', '资源管理器相关功能异常'),
  item('ole32.dll', 'system', 'COM/OLE 组件对象模型', 'Windows 系统组件', '调用 COM 的程序启动失败', true),
  item('oleaut32.dll', 'system', 'OLE 自动化与类型库', 'Windows 系统组件', 'Office 等自动化程序报错'),
  item('comctl32.dll', 'system', '通用控件（列表、树、进度条）', 'Windows 系统组件', '窗口控件显示异常'),
  item('comdlg32.dll', 'system', '通用对话框（打开/保存/打印）', 'Windows 系统组件', '打开或另存为对话框不可用'),
  item('shlwapi.dll', 'system', 'Shell 轻量工具函数（路径、注册表助手）', 'Windows 系统组件', '依赖该库的程序启动失败'),
  item('ws2_32.dll', 'system', 'Winsock 网络通信', 'Windows 系统组件', '联网程序无法建立连接', true),
  item('crypt32.dll', 'system', '证书与加密消息', 'Windows 系统组件', 'HTTPS/TLS 握手失败', true),
  item('bcrypt.dll', 'system', '新一代加密原语', 'Windows 系统组件', '依赖 BCrypt 的程序启动失败'),
  item('wininet.dll', 'system', 'WinINet HTTP/FTP 客户端', 'Windows 系统组件', '下载与联网检查失败'),
  item('winhttp.dll', 'system', 'WinHTTP 服务端 HTTP 客户端', 'Windows 系统组件', '应用内网络请求失败'),
  item('imm32.dll', 'system', '输入法管理器', 'Windows 系统组件', '无法输入中文/切换输入法'),
  item('rpcrt4.dll', 'system', '远程过程调用运行时', 'Windows 系统组件', '系统服务通信失败'),
  item('sechost.dll', 'system', '安全与服务主机辅助', 'Windows 系统组件', '服务相关 API 调用失败'),
  item('setupapi.dll', 'system', '设备与驱动安装 API', 'Windows 系统组件', '驱动/设备安装失败'),
  item('cfgmgr32.dll', 'system', '设备配置管理器', 'Windows 系统组件', '设备管理相关功能异常'),
  item('psapi.dll', 'system', '进程状态查询 API', 'Windows 系统组件', '任务管理器类功能异常'),
  item('version.dll', 'system', '文件版本资源查询', 'Windows 系统组件', '依赖版本查询的安装器失败'),
  item('uxtheme.dll', 'system', '视觉样式（主题）', 'Windows 系统组件', '界面回退到经典外观'),
  item('dwmapi.dll', 'system', '桌面窗口管理器 API（窗口合成）', 'Windows 系统组件', '窗口特效/缩略图异常'),
  item('msimg32.dll', 'system', '位图混合与渐变绘制', 'Windows 系统组件', '界面绘制报错'),
  item('winmm.dll', 'system', '多媒体计时器与音频设备', 'Windows 系统组件', '音频播放异常'),
  item('iphlpapi.dll', 'system', 'IP 辅助 API（网卡/路由）', 'Windows 系统组件', '网络诊断失败'),
  item('dnsapi.dll', 'system', 'DNS 查询 API', 'Windows 系统组件', '域名解析失败'),
  item('wintrust.dll', 'system', '数字签名与信任校验', 'Windows 系统组件', '安装包签名校验报错'),
  item('msvcrt.dll', 'system', '旧版 Visual C 运行时（大量老程序依赖）', 'Windows 系统组件', '老程序启动报缺失', true)
]

/** VC++ 运行库（2015-2022 统一为 14.x）：最常见的「缺失 DLL」来源 */
const RUNTIME_DLLS: DllCheckItem[] = [
  item('vcruntime140.dll', 'runtime', 'VC++ 2015-2022 的 C 运行时核心', 'VC++ Redistributable 2015-2022', '程序启动即报「缺少 vcruntime140.dll」', true),
  item('vcruntime140_1.dll', 'runtime', 'VC++ x64 异常处理支持', 'VC++ Redistributable 2015-2022', '报「缺少 vcruntime140_1.dll」，常见于 x64 程序', true),
  item('msvcp140.dll', 'runtime', 'VC++ C++ 标准库实现', 'VC++ Redistributable 2015-2022', '报「缺少 msvcp140.dll」，游戏与工具软件高发', true),
  item('msvcp140_1.dll', 'runtime', 'C++ 标准库扩展（并行算法等）', 'VC++ Redistributable 2015-2022', '特定程序启动失败'),
  item('msvcp140_2.dll', 'runtime', 'C++ 标准库扩展（数值/字符转换）', 'VC++ Redistributable 2015-2022', '特定程序启动失败'),
  item('msvcp140_atomic_wait.dll', 'runtime', 'C++20 原子等待原语', 'VC++ Redistributable 2015-2022', '较新编译的程序启动失败'),
  item('msvcp140_codecvt_ids.dll', 'runtime', '字符集转换 ID 定义', 'VC++ Redistributable 2015-2022', '字符编码相关功能异常'),
  item('concrt140.dll', 'runtime', '并发运行时（并行模式库）', 'VC++ Redistributable 2015-2022', '使用 PPL/并发运行时的程序失败'),
  item('vccorlib140.dll', 'runtime', 'C++/CX 运行时（WinRT 组件）', 'VC++ Redistributable 2015-2022', 'UWP/Store 相关程序失败'),
  item('msvcp120.dll', 'runtime', 'VC++ 2013 C++ 标准库', 'VC++ Redistributable 2013', '老游戏/老工具报缺失'),
  item('msvcr120.dll', 'runtime', 'VC++ 2013 C 运行时', 'VC++ Redistributable 2013', '老游戏/老工具报缺失'),
  item('msvcp110.dll', 'runtime', 'VC++ 2012 C++ 标准库', 'VC++ Redistributable 2012', '老程序报缺失'),
  item('msvcr110.dll', 'runtime', 'VC++ 2012 C 运行时', 'VC++ Redistributable 2012', '老程序报缺失'),
  item('msvcp100.dll', 'runtime', 'VC++ 2010 C++ 标准库', 'VC++ Redistributable 2010', '老程序报缺失'),
  item('msvcr100.dll', 'runtime', 'VC++ 2010 C 运行时', 'VC++ Redistributable 2010', '老程序报缺失'),
  item('msvcp90.dll', 'runtime', 'VC++ 2008 C++ 标准库', 'VC++ Redistributable 2008', '更老的软件报缺失'),
  item('msvcr90.dll', 'runtime', 'VC++ 2008 C 运行时', 'VC++ Redistributable 2008', '更老的软件报缺失'),
  item('mfc140u.dll', 'runtime', 'MFC 2015-2022（Unicode 版）', 'VC++ Redistributable 2015-2022', '使用 MFC 的桌面程序启动失败')
]

/** 通用 C 运行时（UCRT）：缺失典型表现为 api-ms-win-crt-* 与 0xc000007b */
const CRT_DLLS: DllCheckItem[] = [
  item('ucrtbase.dll', 'crt', '通用 C 运行时（Windows 10/11 系统内置）', 'Windows 通用 CRT', '报「缺少 ucrtbase.dll」或 0xc000007b', true),
  item('api-ms-win-crt-runtime-l1-1-0.dll', 'crt', 'UCRT 运行时接口集', 'Windows 通用 CRT', '报「缺少 api-ms-win-crt-runtime-l1-1-0.dll」', true),
  item('api-ms-win-crt-stdio-l1-1-0.dll', 'crt', 'UCRT 标准输入输出接口集', 'Windows 通用 CRT', '报缺少该 api-ms 系列 DLL', true),
  item('api-ms-win-crt-heap-l1-1-0.dll', 'crt', 'UCRT 堆内存接口集', 'Windows 通用 CRT', '报缺少该 api-ms 系列 DLL', true),
  item('api-ms-win-crt-math-l1-1-0.dll', 'crt', 'UCRT 数学函数接口集', 'Windows 通用 CRT', '报缺少该 api-ms 系列 DLL'),
  item('api-ms-win-crt-string-l1-1-0.dll', 'crt', 'UCRT 字符串函数接口集', 'Windows 通用 CRT', '报缺少该 api-ms 系列 DLL'),
  item('api-ms-win-crt-convert-l1-1-0.dll', 'crt', 'UCRT 数值转换接口集', 'Windows 通用 CRT', '报缺少该 api-ms 系列 DLL')
]

/** 图形与输入（DirectX / 手柄） */
const GRAPHICS_DLLS: DllCheckItem[] = [
  item('d3d11.dll', 'graphics', 'Direct3D 11 图形 API', 'DirectX / Windows 系统组件', '游戏报「缺少 d3d11.dll」无法启动'),
  item('d3d9.dll', 'graphics', 'Direct3D 9 图形 API', 'DirectX / Windows 系统组件', '老游戏启动失败'),
  item('dxgi.dll', 'graphics', 'DirectX 图形基础设施（交换链）', 'DirectX / Windows 系统组件', '游戏/视频渲染失败'),
  item('d3dcompiler_47.dll', 'graphics', 'HLSL 着色器编译器', 'DirectX 运行库', '游戏报「缺少 d3dcompiler_47.dll」'),
  item('xinput1_4.dll', 'graphics', 'Xbox 手柄输入（Win8+）', 'DirectX 输入组件', '手柄无法识别'),
  item('xinput9_1_0.dll', 'graphics', 'Xbox 手柄输入（旧版兼容）', 'DirectX 输入组件', '老游戏手柄无法识别'),
  item('dinput8.dll', 'graphics', 'DirectInput 传统输入设备', 'DirectX 输入组件', '旧游戏输入设备失效')
]

/** 媒体与旧组件 */
const MEDIA_LEGACY_DLLS: DllCheckItem[] = [
  item('msacm32.dll', 'media', '音频压缩管理器（ACM）', 'Windows 多媒体组件', '音频编码/录音相关功能异常'),
  item('avrt.dll', 'media', '多媒体线程优先级（MMCSS）', 'Windows 多媒体组件', '音视频卡顿或无法实时播放'),
  item('mfplat.dll', 'media', 'Media Foundation 平台层', 'Windows 媒体框架', '音视频播放/录制失败'),
  item('msvbvm60.dll', 'legacy', 'Visual Basic 6 运行库', 'VB6 运行库', '老 VB6 程序启动报缺失'),
  item('scrrun.dll', 'legacy', 'Scripting Runtime（FileSystemObject）', 'Windows 脚本组件', 'VBScript/旧脚本报错'),
  item('urlmon.dll', 'legacy', 'URL Moniker（下载与流绑定）', 'Windows 系统组件', '旧下载器/更新器失败'),
  item('msxml3.dll', 'legacy', 'MSXML 3.0 XML 解析器', 'Windows 系统组件', '老程序读写 XML 失败')
]

/** 完整检查清单（Windows） */
export const DLL_CATALOG: DllCheckItem[] = [
  ...SYSTEM_DLLS,
  ...RUNTIME_DLLS,
  ...CRT_DLLS,
  ...GRAPHICS_DLLS,
  ...MEDIA_LEGACY_DLLS
]

// ─────────────────────────────────────────────────────────────
// 非 Windows：动态库（.dylib / .so）只读探针
// ─────────────────────────────────────────────────────────────

const UNIX_LIBS: { name: string; desc: string; impact: string }[] = [
  { name: 'libc.so.6', desc: 'glibc 核心 C 运行时', impact: '几乎所有程序无法启动' },
  { name: 'libstdc++.so.6', desc: 'GNU C++ 标准库', impact: 'C++ 程序启动报 cannot open shared object' },
  { name: 'libgcc_s.so.1', desc: 'GCC 底层运行时', impact: '程序异常处理与栈展开失败' },
  { name: 'libm.so.6', desc: '数学库', impact: '依赖数学函数的程序失败' },
  { name: 'libz.so.1', desc: 'zlib 压缩库', impact: '解压/读压缩包失败' },
  { name: 'libpthread.so.0', desc: 'POSIX 线程库', impact: '多线程程序启动失败' },
  { name: 'libdl.so.2', desc: '动态加载库（dlopen）', impact: '插件式程序无法加载模块' }
]

const MAC_LIBS: { path: string; desc: string; impact: string }[] = [
  { path: '/usr/lib/libSystem.B.dylib', desc: 'macOS 系统 libc（libSystem）', impact: '几乎所有程序无法启动' },
  { path: '/usr/lib/libc++.1.dylib', desc: 'LLVM libc++ 标准库', impact: 'C++ 程序启动失败' },
  { path: '/usr/lib/libobjc.A.dylib', desc: 'Objective-C 运行时', impact: 'AppKit/Cocoa 程序无法启动' },
  { path: '/usr/lib/libz.1.dylib', desc: 'zlib 压缩库', impact: '压缩包处理失败' },
  { path: '/usr/lib/libiconv.2.dylib', desc: '字符编码转换库', impact: '字符集转换失败' }
]

/** 取库文件基名（/usr/lib/libSystem.B.dylib → libSystem.B.dylib） */
function baseName(p: string): string {
  const parts = String(p).split('/')
  return parts[parts.length - 1] || String(p)
}

/** 去掉动态库扩展名与版本后缀，得到稳定 id */
function libId(name: string): string {
  return name.replace(/\.(dll|dylib|so(\.\d+)*)$/i, '').toLowerCase()
}

/**
 * 非 Windows 平台的探针清单。
 * DLL 是 Windows 专有机制，这里检测的是等价物（macOS .dylib / Linux .so），
 * 目的只是回答「本机动态库环境是否完整」，不做"补 DLL"这种事。
 */
export function unixDllCatalog(platform: Platform): DllCheckItem[] {
  if (platform === 'darwin') {
    return MAC_LIBS.map((l) => ({
      id: libId(baseName(l.path)),
      name: baseName(l.path),
      category: 'system' as const,
      purpose: l.desc,
      origin: 'macOS 系统动态库（受 SIP 保护）',
      impact: l.impact,
      critical: true
    }))
  }
  if (platform === 'linux') {
    return UNIX_LIBS.map((l) => ({
      id: libId(l.name),
      name: l.name,
      category: 'system' as const,
      purpose: l.desc,
      origin: 'Linux 共享库',
      impact: l.impact,
      critical: true
    }))
  }
  return []
}

// ─────────────────────────────────────────────────────────────
// 脚本生成（纯函数，可单测）
// ─────────────────────────────────────────────────────────────

/** 输出协议：R=根目录声明，D=单个 DLL 探测，V=VC++ 运行库版本 */
export const DLL_SCAN_PROTOCOL = {
  root: 'R',
  dll: 'D',
  vc: 'V'
} as const

/** PowerShell 单引号字面量转义 */
function psq(s: string): string {
  return `'${String(s).replace(/'/g, "''")}'`
}

/** shell 单引号转义 */
function shq(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/** Windows：扫描 System32(x64) 与 SysWOW64(x86)，并读取 VC++ 运行库注册表版本 */
export function buildDllScanScript(platform: Platform = detectPlatform()): string | null {
  if (platform !== 'win32') return null

  const names = DLL_CATALOG.map((d) => d.name)
  const nameList = names.map(psq).join(',')

  return [
    '$ErrorActionPreference = "SilentlyContinue"',
    '$root = $env:SystemRoot; if (-not $root) { $root = "C:\\Windows" }',
    `$names = @(${nameList})`,
    '$roots = @()',
    '$dir64 = Join-Path $root "System32"',
    '$dir32 = Join-Path $root "SysWOW64"',
    'if (Test-Path -LiteralPath $dir64) { $roots += [pscustomobject]@{ p = $dir64; bits = 64 } }',
    // 32 位 Windows 没有 SysWOW64，此时 System32 里装的就是 32 位库
    '$is64 = [Environment]::Is64BitOperatingSystem',
    'if ($is64 -and (Test-Path -LiteralPath $dir32)) { $roots += [pscustomobject]@{ p = $dir32; bits = 32 } }',
    'elseif (-not $is64) { $roots[0].bits = 32 }',
    'foreach ($r in $roots) { Write-Output ("R`t" + $r.p + "`t" + $r.bits) }',
    'foreach ($n in $names) {',
    '  foreach ($r in $roots) {',
    '    $f = Join-Path $r.p $n',
    '    if (Test-Path -LiteralPath $f) {',
    '      $v = ""',
    '      try { $v = [string](Get-Item -LiteralPath $f).VersionInfo.FileVersion } catch { $v = "" }',
    '      if ($null -eq $v) { $v = "" }',
    '      Write-Output ("D`t" + $n + "`t" + $r.bits + "`t1`t" + $v)',
    '    } else {',
    '      Write-Output ("D`t" + $n + "`t" + $r.bits + "`t0`t")',
    '    }',
    '  }',
    '}',
    // VC++ Redistributable 安装版本（2015-2022 统一写入 VisualStudio\\14.0\\VC\\Runtimes）
    '$vcx64 = ""; $vcx86 = ""',
    '$keys64 = @("HKLM:\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64")',
    '$keys32 = @("HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86", "HKLM:\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86")',
    'foreach ($k in $keys64) { if (-not $vcx64) { $p = Get-ItemProperty -Path $k; if ($p -and $p.Version) { $vcx64 = [string]$p.Version } } }',
    'foreach ($k in $keys32) { if (-not $vcx86) { $p = Get-ItemProperty -Path $k; if ($p -and $p.Version) { $vcx86 = [string]$p.Version } } }',
    'Write-Output ("V`t" + $vcx64 + "`t" + $vcx86)'
  ].join('\n')
}

/**
 * macOS / Linux：只读动态库探针。
 * Linux 用 ldconfig 缓存判断某个 .so 能否被动态链接器解析（等价于"是否存在"）；
 * macOS 直接判断系统库路径是否存在（/usr/lib 由 SIP 保护，正常不会被改动）。
 */
export function buildSharedLibProbeScript(platform: Platform = detectPlatform()): string | null {
  if (platform === 'darwin') {
    const lines = MAC_LIBS.flatMap((l) => {
      const b = baseName(l.path)
      return [
        `if [ -f ${shq(l.path)} ]; then`,
        `  echo "D\t${b}\t64\t1\t"`,
        'else',
        `  echo "D\t${b}\t64\t0\t"`,
        'fi'
      ]
    })
    return ['echo "R\t/usr/lib\t64"', ...lines, 'echo "V\t\t"'].join('\n')
  }
  if (platform === 'linux') {
    const lines = UNIX_LIBS.map(
      (l) =>
        `if command -v ldconfig >/dev/null 2>&1 && ldconfig -p 2>/dev/null | grep -q ${shq(l.name)}; then echo "D\t${l.name}\t64\t1\t"; else echo "D\t${l.name}\t64\t0\t"; fi`
    )
    return ['echo "R\t/lib /usr/lib\t64"', ...lines, 'echo "V\t\t"'].join('\n')
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// 输出解析（纯函数，可单测）
// ─────────────────────────────────────────────────────────────

export interface DllProbe {
  roots: DllRoot[]
  /** 文件名（小写）→ 命中的 (位数, 版本) 列表 */
  found: Map<string, { bits: Bits; version: string }[]>
  /** 完全未命中的文件名（小写） */
  missing: Set<string>
  vc: { x64: string; x86: string }
}

export function parseDllScanOutput(stdout: string): DllProbe {
  const probe: DllProbe = {
    roots: [],
    found: new Map(),
    missing: new Set(),
    vc: { x64: '', x86: '' }
  }

  for (const raw of String(stdout ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const parts = line.split('\t')
    const tag = parts[0]

    if (tag === DLL_SCAN_PROTOCOL.root) {
      const bits = Number(parts[2]) === 32 ? 32 : 64
      if (parts[1]) probe.roots.push({ path: parts[1], bits })
      continue
    }

    if (tag === DLL_SCAN_PROTOCOL.vc) {
      probe.vc = { x64: (parts[1] ?? '').trim(), x86: (parts[2] ?? '').trim() }
      continue
    }

    if (tag === DLL_SCAN_PROTOCOL.dll) {
      const name = (parts[1] ?? '').trim().toLowerCase()
      if (!name) continue
      const bits: Bits = Number(parts[2]) === 32 ? 32 : 64
      const exists = (parts[3] ?? '').trim() === '1'
      const version = (parts[4] ?? '').trim()
      if (exists) {
        const list = probe.found.get(name) ?? []
        list.push({ bits, version })
        probe.found.set(name, list)
      } else {
        probe.missing.add(name)
      }
    }
  }

  // 同一文件在某些位数命中、某些位数缺失 → 从 missing 中移除（由 partial 表达）
  for (const name of [...probe.missing]) {
    if (probe.found.has(name)) probe.missing.delete(name)
  }

  return probe
}

/**
 * 命中的实际路径。
 * - Windows：System32 / SysWOW64 下按位数拼路径，信息是精确的；
 * - macOS：系统库固定在 /usr/lib，可给准确路径；
 * - Linux：ldconfig 只知道该 soname 可被解析，给不出唯一路径，故返回空（不编造）。
 */
function hitPaths(
  platform: Platform,
  probe: DllProbe,
  fileName: string,
  hits: { bits: Bits; version: string }[]
): { path: string; bits: Bits; version: string }[] {
  if (platform === 'win32') {
    return hits.map((h) => {
      const root = probe.roots.find((r) => r.bits === h.bits)?.path ?? ''
      return { path: root ? `${root}\\${fileName}` : fileName, bits: h.bits, version: h.version }
    })
  }
  if (platform === 'darwin') {
    const root = probe.roots[0]?.path ?? '/usr/lib'
    return hits.map((h) => ({ path: `${root}/${fileName}`, bits: h.bits, version: h.version }))
  }
  return []
}

/** 把探针结果与静态清单合并为界面可直接渲染的扫描结果 */
export function toScanResult(
  probe: DllProbe,
  catalog: DllCheckItem[],
  platform: Platform,
  now: number
): DllScanResult {
  const items: DllScanItem[] = catalog.map((def) => {
    const hits = probe.found.get(def.name.toLowerCase()) ?? []
    const rootCount = probe.roots.length || 1
    const present = hits.length > 0
    return {
      ...def,
      present,
      partial: present && hits.length < rootCount,
      paths: hitPaths(platform, probe, def.name, hits)
    }
  })

  const note =
    platform === 'win32'
      ? '扫描 System32（64 位）与 SysWOW64（32 位）下的系统与运行库 DLL；「位数不全」表示 32/64 位程序之一可能报缺失'
      : platform === 'darwin'
        ? 'macOS 不使用 DLL 机制（使用 .dylib/framework），此处为系统动态库只读探针；系统库受 SIP 保护，正常不会被删改'
        : platform === 'linux'
          ? 'Linux 不使用 DLL 机制（使用 .so 共享库），此处为动态链接器的只读探针；缺失请用系统包管理器修复'
          : '当前平台不支持动态库检测'

  return {
    platform,
    supported: platform === 'win32' || platform === 'darwin' || platform === 'linux',
    note,
    roots: probe.roots.map((r) => r.path),
    items,
    missing: items.filter((i) => !i.present).map((i) => i.name),
    partial: items.filter((i) => i.partial).map((i) => i.name),
    total: items.length,
    vcRedist: probe.vc,
    scannedAt: now
  }
}

// ─────────────────────────────────────────────────────────────
// 修复建议
// ─────────────────────────────────────────────────────────────

/** VC++ 运行库官方安装包（aka.ms 短链，指向微软官方最新 VC++ 2015-2022 可再发行包） */
export const VCREDIST_URLS: Record<'x64' | 'x86', string> = {
  x64: 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
  x86: 'https://aka.ms/vs/17/release/vc_redist.x86.exe'
}

/**
 * 依据扫描结果产出修复建议。
 * 排序逻辑：先补最可能「一击解决」的运行库（装完大量程序即可用），
 * 再跑系统级修复（sfc/DISM 慢且需要管理员）。
 */
export function buildDllAdvice(scan: DllScanResult | null): DllRepairAdvice[] {
  if (!scan || !scan.supported) return []
  if (scan.platform !== 'win32') return []
  if (scan.missing.length === 0 && scan.partial.length === 0) return []

  const byName = new Map(scan.items.map((i) => [i.name, i]))
  const missingItems = scan.missing.map((n) => byName.get(n)).filter(Boolean) as DllScanItem[]
  const partialItems = scan.partial.map((n) => byName.get(n)).filter(Boolean) as DllScanItem[]

  const hasRuntime = [...missingItems, ...partialItems].some(
    (i) => i.category === 'runtime' || i.category === 'crt'
  )
  const missingX86Runtime = [...missingItems, ...partialItems].some(
    (i) => (i.category === 'runtime' || i.category === 'crt') && i.paths.every((p) => p.bits === 64)
  )
  const hasSystem = missingItems.some((i) => i.category === 'system')
  const hasOther = missingItems.some(
    (i) => i.category === 'graphics' || i.category === 'media' || i.category === 'legacy'
  )
  const partialOnly = missingItems.length === 0 && partialItems.length > 0

  const advice: DllRepairAdvice[] = []
  const vcInstalled = Boolean(scan.vcRedist.x64 || scan.vcRedist.x86)

  if (hasRuntime || partialOnly) {
    advice.push({
      kind: 'vcredist-x64',
      label: '安装/修复 VC++ 运行库（64 位）',
      description: vcInstalled
        ? `已检出 x64 运行库版本 ${scan.vcRedist.x64 || '未知'}，可执行修复式重装以补齐缺失的 msvcp/vcruntime 系列 DLL`
        : '未检出 64 位 VC++ 运行库，这是「缺少 msvcp140.dll / vcruntime140.dll」最常见的原因',
      needsAdmin: true,
      priority: 1
    })
  }
  if (missingX86Runtime || partialOnly) {
    advice.push({
      kind: 'vcredist-x86',
      label: '安装/修复 VC++ 运行库（32 位）',
      description: '32 位程序需要 SysWOW64 下的运行库，缺失时同样会报 DLL 找不到',
      needsAdmin: true,
      priority: 2
    })
  }
  if (hasSystem) {
    advice.push({
      kind: 'sfc',
      label: '用 SFC 扫描并修复系统文件',
      description: '检测到系统 API DLL 缺失，通常意味着系统文件已损坏，需用系统文件检查器还原',
      needsAdmin: true,
      priority: 3
    })
    advice.push({
      kind: 'dism-restore',
      label: '用 DISM 从组件存储修复映像',
      description: '若 SFC 无法修复（组件存储本身受损），改用 DISM 恢复健康源后再跑一次 SFC',
      needsAdmin: true,
      priority: 4
    })
  } else if (hasOther || partialOnly) {
    advice.push({
      kind: 'sfc',
      label: '用 SFC 校验系统文件（推荐）',
      description: 'DirectX / 媒体 / 旧组件 DLL 缺失多与系统文件损坏有关，SFC 可一并校验修复',
      needsAdmin: true,
      priority: 3
    })
  }

  return advice.sort((a, b) => a.priority - b.priority)
}

/** 无缺失时的提示（供页面直接展示） */
export const NO_MISSING_NOTE = '未发现关键 DLL 缺失或位数不全，运行时环境完整。'

// ─────────────────────────────────────────────────────────────
// 修复脚本
// ─────────────────────────────────────────────────────────────

/**
 * 生成「安装 VC++ 运行库」脚本（Windows）。
 * 优先用 winget（系统自带包管理器，静默安装、可核验退出码）；
 * 没有 winget 时退出码 2 且输出 NO_WINGET，由调用方给出官方下载链接（不自行下载执行）。
 */
export function buildVcRedistScript(arch: 'x64' | 'x86', platform: Platform = detectPlatform()): string | null {
  if (platform !== 'win32') return null
  const id = arch === 'x64' ? 'Microsoft.VCRedist.2015+.x64' : 'Microsoft.VCRedist.2015+.x86'
  return [
    '$ErrorActionPreference = "Continue"',
    '$w = Get-Command winget.exe -ErrorAction SilentlyContinue',
    'if (-not $w) { Write-Output "NO_WINGET"; exit 2 }',
    `$out = & winget install --id ${psq(id)} -e --silent --disable-interactivity --accept-package-agreements --accept-source-agreements 2>&1 | Out-String`,
    '$code = $LASTEXITCODE',
    'Write-Output $out',
    'Write-Output ("WINGET_EXIT=" + $code)',
    'exit 0'
  ].join('\n')
}

/** 解析 winget 安装结果 */
export function parseVcRedistResult(res: ExecResult): { installed: boolean; noWinget: boolean; detail: string } {
  const text = `${res.stdout}\n${res.stderr}`
  const noWinget = /NO_WINGET/i.test(text)
  const codeMatch = /WINGET_EXIT=(-?\d+)/i.exec(text)
  const code = codeMatch ? Number(codeMatch[1]) : res.code
  const success = /successfully installed|已成功安装|install.*succeeded|已安装/i.test(text)
  const already = /no applicable|already installed|已安装此包|无可用升级|No newer package/i.test(text)
  const installed = !noWinget && (success || already || code === 0)
  return {
    installed,
    noWinget,
    detail: (text.trim().split(/\r?\n/).filter(Boolean).slice(-4).join('\n') || '').slice(-1200)
  }
}

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

export interface DllServiceDeps {
  /** 普通权限执行器（扫描用） */
  runner: ExecRunner
  /** 提权执行器（装运行库用；不传则视为无提权通道） */
  adminRunner?: ExecRunner
  platform?: Platform
  /** 复用磁盘服务的系统文件修复（sfc / DISM） */
  repairSystemFiles?: (kind: SystemRepairKind) => Promise<DiskRepairResult>
  /** 时间戳注入（测试用） */
  now?: () => number
}

export interface DllService {
  /** 扫描关键 DLL 是否缺失 / 位数不全 */
  scan(): Promise<DllScanResult>
  /** 基于最近一次扫描结果给出修复建议（未扫描时返回空） */
  advice(): Promise<DllRepairAdvice[]>
  /** 执行某项修复 */
  repair(kind: DllRepairKind): Promise<DllRepairResult>
  /** 最近一次扫描结果（未扫描为 null） */
  lastScan(): DllScanResult | null
}

const REPAIR_LABELS: Record<DllRepairKind, string> = {
  sfc: 'SFC 系统文件检查器',
  'dism-restore': 'DISM 组件存储修复',
  'vcredist-x64': 'VC++ 运行库（64 位）',
  'vcredist-x86': 'VC++ 运行库（32 位）'
}

function unsupportedRepair(kind: DllRepairKind, platform: Platform): DllRepairResult {
  return {
    kind,
    label: REPAIR_LABELS[kind],
    ok: false,
    repaired: false,
    summary:
      platform === 'darwin'
        ? 'macOS 不使用 DLL 机制，也没有可对应的"补 DLL"操作；系统动态库受 SIP 保护，无需修复'
        : platform === 'linux'
          ? 'Linux 不使用 DLL 机制；共享库缺失请用发行版包管理器修复（如 sudo apt install --reinstall libc6）'
          : '当前平台不支持 DLL 修复',
    output: '',
    needsAdmin: false,
    unsupported: true,
    nextSteps: []
  }
}

export function createDllService(deps: DllServiceDeps): DllService {
  const platform = deps.platform ?? detectPlatform()
  const now = deps.now ?? (() => Date.now())
  let cached: DllScanResult | null = null

  const catalog = platform === 'win32' ? DLL_CATALOG : unixDllCatalog(platform)
  const scriptForPlatform =
    platform === 'win32' ? buildDllScanScript(platform) : buildSharedLibProbeScript(platform)

  const scan = async (): Promise<DllScanResult> => {
    if (!scriptForPlatform) {
      cached = toScanResult(
        { roots: [], found: new Map(), missing: new Set(), vc: { x64: '', x86: '' } },
        [],
        platform,
        now()
      )
      return cached
    }

    const { stdout } = await deps.runner.run(scriptForPlatform)
    const probe = parseDllScanOutput(stdout)
    cached = toScanResult(probe, catalog, platform, now())
    return cached
  }

  const advice = async (): Promise<DllRepairAdvice[]> => buildDllAdvice(cached)

  const repair = async (kind: DllRepairKind): Promise<DllRepairResult> => {
    if (platform !== 'win32') return unsupportedRepair(kind, platform)

    if (kind === 'sfc' || kind === 'dism-restore') {
      if (!deps.repairSystemFiles) {
        return {
          kind,
          label: REPAIR_LABELS[kind],
          ok: false,
          repaired: false,
          summary: '系统文件修复通道未接入，请在「磁盘修复」页执行',
          output: '',
          needsAdmin: true,
          unsupported: false,
          nextSteps: []
        }
      }
      const r = await deps.repairSystemFiles(kind)
      return {
        kind,
        label: REPAIR_LABELS[kind],
        ok: r.ok,
        repaired: r.repaired,
        summary: r.summary,
        output: r.output,
        needsAdmin: r.needsAdmin,
        unsupported: r.unsupported,
        nextSteps: r.ok ? [] : ['可在「磁盘修复」页重试，或手动以管理员身份运行 sfc /scannow']
      }
    }

    // VC++ 运行库：必须提权（per-machine 安装），走提权通道
    const script = buildVcRedistScript(kind === 'vcredist-x64' ? 'x64' : 'x86', platform)
    const arch = kind === 'vcredist-x64' ? 'x64' : 'x86'
    if (!script) return unsupportedRepair(kind, platform)

    const runner = deps.adminRunner ?? deps.runner
    const res = await runner.run(script)
    const parsed = parseVcRedistResult(res)

    if (parsed.noWinget) {
      return {
        kind,
        label: REPAIR_LABELS[kind],
        ok: false,
        repaired: false,
        summary: '本机没有 winget 包管理器，无法在线安装；请用下方官方安装包手动安装（安装后重启相关程序即可生效）',
        output: parsed.detail,
        needsAdmin: true,
        unsupported: false,
        nextSteps: [
          `下载并运行微软官方运行库：${VCREDIST_URLS[arch]}`,
          '若已装过仍报缺失，先在「应用和功能」里卸载 Microsoft Visual C++ 2015-2022 Redistributable 后重新安装'
        ]
      }
    }

    return {
      kind,
      label: REPAIR_LABELS[kind],
      ok: parsed.installed,
      repaired: parsed.installed,
      summary: parsed.installed
        ? `VC++ 运行库（${arch}）安装/修复已完成，重新运行刚才报错的程序即可`
        : '安装未成功（可能被取消授权、无网络或被安全软件拦截）',
      output: parsed.detail,
      needsAdmin: true,
      unsupported: false,
      nextSteps: parsed.installed ? [] : [`也可手动下载官方安装包：${VCREDIST_URLS[arch]}`]
    }
  }

  return { scan, advice, repair, lastScan: () => cached }
}
