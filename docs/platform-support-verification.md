# 疾风引擎 — 支持平台验证报告

> 验证时间：2026-09-08 ｜ 版本：v0.5.4（commit 待打 tag）
> 方法：静态核查构建配置、主进程、13 个 service 的跨平台实现，确认实际可运行平台。

## 一、结论速览

| 维度 | 支持情况 | 说明 |
|---|---|---|
| **操作系统** | ✅ Windows 10/11 + macOS + Linux | 三平台原生支持，13 个 service 全跨平台 |
| **CPU 架构** | ✅ x64 + arm64 | Win/Mac/Linux 均提供 x64 与 arm64 构建产物 |
| **Windows 旧版** | ❌ Win 7/8/8.1 | Electron 33 已放弃（自 Electron 23 起仅 Win 10+）；用户已确认放弃旧版 |
| **管理员权限** | ⚠️ 部分需要 | 只读/常规优化普通用户即可；防火墙/服务/计划任务/HKLM 启动项需管理员（Win UAC / mac root / Linux root） |
| **运行时依赖** | ✅ 无额外安装 | Win 用系统 PowerShell 5.1；mac/Linux 用系统 bash；监控用 systeminformation |
| **跨平台架构** | ✅ PAL 平台抽象层 | `shell.ts` 按 `process.platform` 自动选 PowerShell / bash 执行器 |

## 二、关键证据

### 1. 构建配置覆盖三平台双架构（`electron-builder.yml`）
```yaml
win:
  target: nsis
  arch: [x64, arm64]          # Windows on ARM 原生
mac:
  target: dmg
  arch: [x64, arm64]          # Intel + Apple Silicon
linux:
  target: [AppImage, deb]
  arch: [x64, arm64]          # 含 ARM Linux 工作站/树莓派
```
- `package.json` 脚本：`package:win` / `package:mac` / `package:linux` 三套。
- CI（`.github/workflows/release.yml`）6 矩阵：win/macos/linux × x64/arm64，`fail-fast: false`，Linux arm64 用 qemu 交叉编译。

### 2. 13 个 service 全部跨平台（平台分发脚本 + 平台无关解析器范式）
| 模块 | Windows | macOS | Linux |
|---|---|---|---|
| `shell.ts`（PAL） | powershell | bash | bash |
| `network` | Test-Connection / Win32_NetworkAdapter | ping / ip addr / ifconfig | ping / ip addr |
| `process` | Get-Process / NtSuspendProcess | ps / kill -STOP/-CONT | ps / kill -STOP/-CONT |
| `optimizer` | 注册表 Run / 回收站 / 浏览器缓存 | launchd plist / ~/.Trash / Library/Caches | XDG autostart / Trash / .cache |
| `gamemode` | powercfg 电源计划 | caffeinate 防休眠 | CPU scaling_governor |
| `toolbox` | ipconfig / Clear-RecycleBin | dscacheutil / osascript | systemd-resolve / rm Trash |
| `autolaunch` | 注册表 Run 键 | launchd plist (~/Library/LaunchAgents) | XDG autostart .desktop |
| `firewall` | Get-NetFirewallProfile/Rule | pfctl / pf.conf（需 root） | ufw / iptables（需 root） |
| `tasks` | Get-ScheduledTask | launchctl / launchd | systemctl timer + cron |
| `winservices` | Win32_Service / Set-Service | launchctl / launchd | systemctl start/stop/enable |
| `monitor` | systeminformation（跨平台库） | 同 | 同 |
| `hardware` | systeminformation（主板/CPU/内存/显卡/显示器/硬盘/电源） | 同 | 同 |
| `settings` / `history` | electron-store（跨平台库） | 同 | 同 |
| `update` | electron-updater（各平台 latest*.yml） | 同 | 同 |

→ **每个 service 按平台分发 win/unix 脚本，解析器平台无关**。无平台则 PAL 兜底 bash，功能按平台降级而非崩溃。

### 3. main.ts 接入平台工厂
```ts
import { createPlatformRunner, detectPlatform } from './services/shell'
const runner = createPlatformRunner()      // 按 OS 自动选 PowerShell / bash
const platform = detectPlatform()          // 传给各 service 脚本生成器
```

## 三、架构与版本边界

- **为何支持 arm64**：`electron-builder.yml` 各平台均列 `arch: [x64, arm64]`。Win arm64 覆盖 Surface/骁龙本；mac arm64 覆盖 Apple Silicon（M1-M4）；Linux arm64 覆盖树莓派/ARM 服务器。
- **为何仅 Win 10+**：Electron 33 运行时最低 Win 10（官方自 Electron 23 移除 Win 7/8/8.1）。PowerShell cmdlet（`Get-NetFirewallProfile` 等）需 Win 8+/Server 2012+。
- **macOS 版本**：支持当前维护中的 macOS 版本（约 macOS 11 Big Sur+，随 Electron 33）。
- **Linux 发行版**：优先支持 systemd 主流发行版（Ubuntu/Debian/Fedora/Arch）；init 系统与无 ufw 的发行版降级为只读。

## 四、权限模型（三平台）

- 普通用户可：硬件监控/信息、进程查看/结束无害进程、网络诊断(Ping)、优化中心(用户态清理)、工具箱(刷新 DNS/清回收站/清剪贴板)、外观设置、优化记录。
- 需管理员/提权：防火墙配置、服务启停、计划任务运行/结束、HKLM/launchd/systemd 启动项管理、CPU governor 切换（Linux）。
- 当前实现：上述操作在非管理员下由系统命令返回明确错误（Win「拒绝访问」/ mac「Operation not permitted」/ Linux「Permission denied」），前端显示明确错误提示并降级，**不崩溃**。

## 五、风险与现状

| 项 | 现状 | 说明 |
|---|---|---|
| macOS 公证 | 未配置 | 无 Apple Developer 证书时 Gatekeeper 提示「未验证开发者」，需右键→打开；配置 `APPLE_ID` 等 Secrets 后 CI 自动签名+公证 |
| Linux 发行版差异 | 优先 systemd | init 系统与无 ufw 发行版降级为只读；AppImage 自带依赖兼容性最好 |
| 代码签名（Win） | 休眠态 | 配置 `CSC_LINK`/`CSC_KEY_PASSWORD` Secrets 后 CI 自动签名，消除 SmartScreen 提示 |
| ARM64 实机验证 | 待用户侧验证 | 三平台 arm64 产物已就绪，需在 Apple Silicon / Win ARM / 树莓派实机点检 |
| 落地页多平台下载 | ✅ 已适配 | 按 OS 推荐 + 架构分段器 + UA 检测，资产名精确映射 |

> 注：鸿蒙（HarmonyOS）不在 Electron 支持范围，需用 ArkTS+ArkUI 从零重写，作为独立项目，详见 docs/HARMONYOS-FEASIBILITY.md。
