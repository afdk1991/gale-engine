# 疾风引擎 (gale-engine) 更新日志

> 版本格式遵循语义化版本（SemVer）：`主版本.次版本.修订`。
> 本仓库通过 Git tag（如 `v0.2.0`）触发 `.github/workflows/release.yml` 自动构建 NSIS 安装包并发布到 GitHub Releases。

---

## v0.4.0 — 2026-09-04（M4 系统深度管理里程碑）

在 v0.3.0 基础上，新增**计划任务**、**服务管理**、**防火墙**三大系统级模块。服务层延续可注入依赖范式，vitest 142 项全绿，所有用户输入（任务路径 / 服务名 / 规则名）经字符白名单校验防 PowerShell 注入。

### 新增功能
- **计划任务（Tasks）**：
  - 任务列表：枚举全部计划任务及其状态（Ready/Running/Disabled）、上次/下次运行时间，支持名称/路径筛选。
  - 启用 / 禁用任务（Enable-/Disable-ScheduledTask）、立即运行（Start-ScheduledTask）、结束运行中任务（Stop-ScheduledTask）。
- **服务管理（WinServices）**：
  - 服务列表：Win32_Service 查询（前 400 条），状态、启动类型、是否可停止、系统关键服务标记。
  - 启动 / 停止服务（停止前二次确认）；启动类型切换（自动/手动/禁用，Set-Service）。
  - 系统关键服务保护：RpcSs / DcomLaunch / Winmgmt / Schedule / EventLog 等 10 项一律拒绝停止（JS 白名单 + PowerShell 端 AcceptStop/名单双保险）。
- **防火墙（Firewall）**：
  - 三个配置文件（Domain/Private/Public）开关状态与出入站默认动作，一键切换开关（Set-NetFirewallProfile）。
  - 规则列表（按显示名排序取前 200 条）+ 筛选，单条规则启用/禁用（Enable-/Disable-NetFirewallRule）。

### 工程
- IPC 新增 12 个 handler（firewall 4 + tasks 4 + winServices 4），preload 桥接同步扩展，共 41 个 handler。
- 新增 3 个页面（服务管理 / 计划任务 / 防火墙）与 3 个导航项，共 12 个页面。
- vitest 由 100 项增至 142 项；AppSidebar 测试同步更新。

### 已知限制
- 修改防火墙配置 / 停止部分服务需要管理员权限，普通权限下失败会返回明确错误信息。
- 规则列表仅展示前 200 条（按显示名排序），海量规则场景建议使用筛选。
- 计划任务未过滤 \Microsoft\ 内部维护任务，建议按路径筛选查看第三方任务。

---

## v0.3.0 — 2026-09-03（M3 深度优化里程碑）

在 v0.2.0 基础上，新增**进程管理**与**网络诊断**两大模块，并补齐浏览器缓存清理。服务层延续可注入依赖范式，纯函数 vitest 覆盖（100 项全绿），核心 PowerShell 命令在真实 Windows 直测通过。

### 新增功能
- **进程管理（Process）**：
  - 进程列表：双采样 CPU 占用估算、内存、状态，支持按 CPU / 内存 / 名称排序。
  - 结束进程：二次确认 + 系统关键进程保护（System / lsass / csrss 等一律拒绝）。
  - 挂起 / 恢复进程：`NtSuspendProcess` / `NtResumeProcess`（P/Invoke），安全可逆。
  - 调整优先级：低 / 低于正常 / 正常 / 高于正常 / 高，失败有回执。
- **网络诊断（Network）**：
  - 延迟测试：Ping 目标主机，返回最小 / 平均 / 最大延迟与丢包率（host 白名单字符校验防注入）。
  - 网络接口：本机网卡名称、IP、连接状态。
- **优化中心扩展**：浏览器缓存清理（Chrome / Edge 的 Cache 与 Code Cache），白名单路径校验。

### 工程
- IPC 新增 7 个 handler（process 5 + network 2），preload 桥接同步扩展。
- 新增 2 个页面（进程管理 / 网络诊断）与导航项，共 9 个页面。
- 新增 `docs/M3-plan.md`；vitest 由 62 项增至 100 项。

### 已知限制
- 进程 CPU% 为双采样估算值，短生命周期进程可能显示偏低。
- 挂起/结束系统关键进程被保护拒绝；调整高优先级可能因权限失败（需管理员）。
- 网络诊断基于系统 Test-Connection / CIM，跨网络环境延迟受物理链路影响。

---

## v0.2.0 — 2026-08-30（M2 功能里程碑）

在 M1 骨架基础上，新增五大真实功能模块，全部 service 逻辑经可注入依赖（fetcher / exec runner / storage）实现，纯函数由 vitest 覆盖（54 项全绿）。

### 新增功能
- **硬件监控（Monitor）**：基于 `systeminformation` 采集 CPU 负载/每核、内存占用、各磁盘占用、网络收发速率、温度/电量/运行时长，页面每秒刷新仪表盘。
- **优化记录（History）**：复用 electron-store 持久化每次优化/模式切换时间线，支持按时间倒序展示与清空。
- **优化中心（Optimizer）**：
  - 垃圾清理：扫描 Temp 与回收站占用，仅白名单安全路径可清理，逐项回执 + 失败隔离。
  - 启动项管理：读取/切换 HKCU、HKLM 开机启动项（注册表）。
- **游戏模式（GameMode）**：一键切换高性能电源计划（`powercfg /setactive`），退出自动还原进入前的计划，安全可逆。
- **系统工具箱（Toolbox）**：刷新 DNS（`ipconfig /flushdns`）、清空回收站、清空剪贴板、切换深色模式，幂等且失败有反馈。

### 工程与发布
- IPC 注册 22 个 handler，preload 桥接 `window.gale` 全模块打通。
- 新增 `docs/M2-plan.md`、`docs/smoke-test-checklist.md`（发布前质量门禁清单）。
- 发布流水线：`.github/workflows/release.yml`（打 tag 自动构建发布）、`scripts/publish-release.ps1`（本地发布）、落地页 `landing/`（经 EdgeOne Makers 部署）。

### 已知限制
- 本沙箱为命令行环境，无 Windows GUI，所有 GUI 交互需在 Windows 实机按冒烟清单核验。
- 进程挂起类激进优化暂未纳入，避免影响系统稳定性。
- 启动项/电源计划等真实 Windows 注册表与命令需在 Windows 实机验证（沙箱已用 PowerShell 直测命令构造）。

---

## v0.1.0 — 2026-08-30（M1 骨架里程碑）

初始可运行版本，确立工程范式与打包链路。

### 功能
- Electron + Vue 3 + TypeScript 工程骨架（electron-vite 多进程构建）。
- 主窗口（1080×720，`contextIsolation: true`）+ 7 个占位页面（首页/监控/优化/游戏模式/工具箱/记录/设置）与左侧导航。
- 设置模块：3 种外观模式（系统/浅/深）× 6 种强调色（蓝/青/紫/绿/橙/渐变），经 electron-store 持久化。
- 主题令牌系统（浅/深色表面变量 + 6 色 accent）。

### 工程与发布
- NSIS 安装包产出（`electron-builder.yml`，支持自定义安装目录）。
- 一键打包脚本 `scripts/package-win.cmd`（npmmirror 镜像 + 7za PATH + 关闭安全删除拦截）。
- typecheck（vue-tsc）、vitest 基础用例通过。
