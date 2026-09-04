# 疾风引擎 — 支持平台验证报告

> 验证时间：2026-09-05 ｜ 版本：v0.4.0（commit 0b46dc9）
> 方法：静态核查构建配置、主进程、12 个 service 的代码路径与 API 依赖，确认实际可运行平台。

## 一、结论速览

| 维度 | 支持情况 | 说明 |
|---|---|---|
| **操作系统** | ✅ Windows 10 / 11 | 不支持 macOS、Linux（设计如此，依赖 Windows 系统 API） |
| **CPU 架构** | ✅ x64（AMD64） | 不支持 ARM64（Windows on ARM 需经 x64 模拟层运行，非原生） |
| **Windows 旧版** | ❌ Win 7 / 8 / 8.1 | Electron 33 已放弃这些系统（自 Electron 23 起仅 Win 10+） |
| **管理员权限** | ⚠️ 部分需要 | 只读/常规优化普通用户即可；防火墙开关、服务启停、HKLM 启动项需管理员（UAC） |
| **运行时依赖** | ✅ 无额外安装 | 依赖系统自带 PowerShell 5.1（Win10/11 内置），无需 .NET 独立安装 |
| **启动期 OS 校验** | ❌ 缺失 | 无 `process.platform` 早期拦截，非 Windows 上会跑飞（PowerShell 调用失败） |

## 二、关键证据

### 1. 构建配置仅含 Windows 目标（`electron-builder.yml`）
```yaml
win:
  target:
    - target: nsis
      arch:
        - x64          # 仅 x64，无 arm64
  forceCodeSigning: false
```
- `package.json` 脚本：`"package": "electron-vite build && electron-builder --win"`、`package:ci` 同为 `--win`，**无任何 `--mac` / `--linux`**。
- CI（`.github/workflows/release.yml`）`runs-on: windows-latest`，产物为 NSIS 安装包。

### 2. 全部 12 个 service 深度依赖 Windows 专属 API
| 模块 | 调用的 Windows API / 命令 |
|---|---|
| `shell.ts`（执行器） | `execFile('powershell', ...)` —— 整个应用的功能都经 PowerShell 脚本执行 |
| `process.ts` | `Get-Process`、`Win32_ComputerSystem`、`NtSuspendProcess`（ntdll.dll P/Invoke 挂起进程） |
| `network.ts` | `Test-Connection`、`Win32_NetworkAdapterConfiguration`、`Win32_NetworkAdapter` |
| `firewall.ts` | `Get-NetFirewallProfile`、`Get-NetFirewallRule`（需 Win8+/Server2012+ 与管理员） |
| `tasks.ts` | `Get-ScheduledTask`、`Get-ScheduledTaskInfo` |
| `winservices.ts` | `Win32_Service`、`Get-Service`、`Set-Service` |
| `gamemode.ts` | `powercfg /getactivescheme`、`/setactive`（电源计划） |
| `optimizer.ts` | 注册表清理（HKCU/HKLM）、回收站、浏览器缓存 |
| `autolaunch.ts` | Windows 开机自启（注册表 Run 键 / 启动文件夹） |
| `monitor.ts` | `systeminformation`（跨平台库，但监对象为 Windows 硬件/电源） |

→ **无任何 macOS/Linux 等价实现，也无平台抽象层**。在非 Windows 上安装/运行会因 `powershell` 不存在而全面失败。

### 3. 唯一平台相关代码是 Electron 标准样板（`electron/main.ts:140`）
```ts
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()   // 标准跨平台样板：mac 保留进程，其余退出
})
```
这是正确的 Electron 模板，**不是**对 Windows 的限制，也不构成 macOS 支持。

## 三、架构与版本边界

- **为何仅 x64**：`electron-builder.yml` 显式 `arch: [x64]`，未列 `arm64`。Electron 33 本身提供 Windows arm64 构建，但本工程未启用。
- **为何仅 Win 10/11**：Electron 33 运行时最低要求 Windows 10（官方自 Electron 23 移除 Win 7/8/8.1 支持）。所用 PowerShell cmdlet（`Get-NetFirewallProfile` 等）需 Windows 8+/Server 2012+，Win10/11 默认 PowerShell 5.1 满足。
- **Windows on ARM 现状**：x64 安装包可借 Windows 11 的 x64 模拟（Prism）运行，但非原生、性能有损，且部分内核 API 模拟不完全，属未验证路径。

## 四、权限模型

- 普通用户可：硬件监控、进程查看/结束无害进程、网络诊断(Ping)、优化中心(用户态清理)、工具箱(刷新 DNS/清回收站/清剪贴板)、外观设置、优化记录。
- 需管理员(UAC)：防火墙配置开关、服务启停与启动类型修改、计划任务运行/结束、HKLM 启动项管理、部分电源计划切换。
- 当前实现：上述操作在非管理员下由 PowerShell 返回「拒绝访问 / 需要管理员权限」类错误，前端显示明确错误提示并降级，**不崩溃**（已在 smoke 清单标注）。

## 五、风险与建议

| 项 | 风险 | 建议 |
|---|---|---|
| 无启动期 OS 校验 | 非 Windows 用户双击 exe 后功能全失败、体验差 | 在 `createWindow` 前加 `if (process.platform !== 'win32') { 弹窗提示仅支持 Windows 后退出 }` |
| 无 arm64 构建 | 错过 Windows on ARM 设备用户 | 如需支持，在 `electron-builder.yml` 增 `arch: [x64, arm64]` 并验证 Prism 下 API 行为 |
| 管理员无主动提示 | 用户不知需「以管理员身份运行」才能用防火墙/服务 | 设置页增加「当前是否管理员」状态指示 + 置顶「以管理员运行」入口 |
| 无最低 Windows 版本声明 | 极低概率在异常旧系统上运行 | 安装包/落地页明确「要求 Windows 10 或 11（64 位）」 |

> 注：macOS/Linux 不在产品定位内（本软件本质是 Windows 系统优化工具），无需支持。
