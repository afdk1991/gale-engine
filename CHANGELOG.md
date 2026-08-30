# 疾风引擎 (gale-engine) 更新日志

> 版本格式遵循语义化版本（SemVer）：`主版本.次版本.修订`。
> 本仓库通过 Git tag（如 `v0.2.0`）触发 `.github/workflows/release.yml` 自动构建 NSIS 安装包并发布到 GitHub Releases。

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
