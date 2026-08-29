# 疾风引擎 M2 计划

> 目标：把 M1 的 7 个骨架页面升级为具备真实能力的 Windows 优化工具。
> 约束：沙箱为 Windows（win32），可运行 Node/PowerShell 与 vitest，但无法启动 Electron GUI，故所有 service 逻辑通过**可注入数据源/执行器**实现，保证纯函数可单测；真实 Windows 调用在沙箱用 PowerShell 直测。

## 架构约定（沿用 M1 的 settings 范式）
- 类型契约：`shared/types.ts` 的 `GaleApi`（前端 `window.gale`）
- 服务层：`electron/services/<module>.ts`，导出 `create<Module>Service(...)`；纯逻辑 + 可注入依赖
- IPC：`electron/main.ts` 用 `ipcMain.handle('<module>:<action>', ...)` 注册
- 桥接：`electron/preload.ts` 把方法挂到 `window.gale.<module>`
- 页面：`src/pages/<Module>.vue` 通过 `window.gale` 取数，渲染并接入主题 token

## 五大模块 API 设计

### 1) Monitor（硬件监控）— 高优先、最易测
- `monitor.snapshot(): Promise<SystemSnapshot>`，字段：cpu(load/cores)、mem(used/total/percent)、disks[]、net(rx/tx 每秒)、temp|null、battery|null、uptimeSec
- 数据源：`systeminformation`（跨平台，Windows 原生可用），封装为可注入 `MonitorFetcher`
- 页面：CPU/内存/磁盘/网络 实时仪表盘，前端 `setInterval(snapshot, 1000)`

### 2) History（优化记录）— 高优先、纯逻辑可测
- `history.list() / history.add(entry) / history.clear()`
- 持久化：复用 `StorageAdapter`（electron-store），记录每次优化/模式切换的时间线
- 页面：按时间倒序的时间线卡片

### 3) Optimizer（优化中心）— Windows 适配
- `optimizer.scanCleanup(): Promise<CleanupPlan>`（扫描 Temp/回收站/浏览器缓存占用）
- `optimizer.runCleanup(plan): Promise<CleanupResult>`（仅删可安全删除项，逐项回执+失败隔离）
- `optimizer.listStartup(): Promise<StartupItem[]>` / `toggleStartup(id, enable)`（注册表）
- 执行器：`createExecRunner()` 封装 `child_process.execFile('powershell',[...])`，可注入便于单测；真实命令在沙箱直测

### 4) GameMode（游戏模式）
- `gameMode.boost(): Promise<void>`（设高性能电源计划 `powercfg /setactive`，挂起低优先级后台进程）
- `gameMode.restore(): Promise<void>`（还原上一电源计划）
- 页面：一键进入/退出，显示当前电源计划

### 5) Toolbox（工具箱）
- 小工具集合（安全、幂等）：`flushDns()`(`ipconfig /flushdns`)、`emptyRecycleBin()`、`clearClipboard()`、`toggleDarkMode()`(注册表)
- 页面：工具网格，逐个带状态反馈

## 测试策略
- service 纯逻辑全部 vitest 覆盖（注入 fake fetcher / exec runner / memory storage）
- `npm run typecheck`（vue-tsc）准入；`npm run test` 全绿
- 真实 PowerShell 命令在沙箱用 Bash 直测验证（非 GUI）

## 发布流水线（方向3）
- 安装包已可经 `scripts/package-win.cmd` 复现产出
- 落地页（静态站点）托管安装包 + 更新日志，经 **EdgeOne Makers** 部署
- 可选：GitHub Actions 在打 tag 时自动构建（需远端仓库）

## 里程碑切分
- M2a：Monitor + History（完成即形成"取数→持久化→渲染"完整范式）
- M2b：Optimizer（清理 + 启动项）
- M2c：GameMode + Toolbox
- M2d：发布流水线 + 冒烟清单（`docs/smoke-test-checklist.md`）

## 风险
- 沙箱无法跑 GUI：以单测 + PowerShell 直测替代，GUI 冒烟列清单交用户在 Windows 实机执行
- Windows 破坏性操作：清理/启动项均先 `scan` 预览、逐项失败隔离、`run` 默认保守白名单
