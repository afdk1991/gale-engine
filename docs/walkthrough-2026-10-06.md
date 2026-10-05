# 疾风引擎 gale-engine v0.1.10 全项目读取（二轮）——对照 2026-09-17 基线的现状核对报告

> 走读日期：2026-10-06 ｜ 运行基线：Electron 39.8.10 + Vue 3.5 + TS strict + electron-vite 3 + vitest 5.0.1
> 对照基线：`docs/walkthrough-2026-09-17.md`（2026-09-17 走读，Electron 33，498/498 测试）
> 本轮背景：基线报告发现的 H1–H4 / M1–M9 / 低危项已于 2026-09-24 修复推送（commit 87b3bf4），随后 Dependabot PR#1 合并（9b3da0d），依赖升级 electron 33→39、vitest 4→5、electron-builder→26、tar 6→7。本报告不是重写，而是以当前工作区代码为准逐项核对：哪些已修复、哪些仍在、升级后有无新问题。
> 走读方式：5 个并行子代理分片逐行读码 + 编排者独立抽查关键结论。全部结论分级 **confirmed**（源码直接可见）/ **inferred**（装配推断）/ **unknown**，并回链 `file:line`（相对项目根）。
> 实测硬证据：`npm run typecheck` exit 0 零报错；`npm test`（vitest 5.0.1）**31 文件 555 passed / 2 skipped / 0 failed**，16.9s。

> 备注：本报告发出后，其中列出的 N-H1（30s 超时误杀长任务）与 N-M1（更新文案矛盾）已于 2026-10-06 修复并推送（见 master 最新提交：shell.ts 增加 timeoutMs 可选参数、elevate.ts 提权外层放宽到 30 分钟、useAppUpdate 文案修正）。

---

## 一、执行摘要

**总体结论：2026-09-24 修复批次质量很高——基线 H1–H4 高危全部闭合、M1–M9 中危 8 项完全闭合、1 项残留文案问题；契约三方（shared/types ↔ preload ↔ main）零漂移（68 invoke 方法 + 2 事件，孤儿 handler 0）。Electron 33→39 / vitest 5 / builder 26 / tar 7 升级本身健康，无 API 误用。但 M7 的修复引入了 1 个新高危回归：统一 30 秒硬超时会误杀 SFC/DISM/winget 等数分钟级长任务（后续已修，见上注）。**

### 本轮新发现高危（报告时）

| # | 严重度 | 问题 | 位置 |
|---|---|---|---|
| N-H1 | 高 | **30s execFile 硬超时误杀长修复任务（M7 修复引入的回归）**：`EXEC_TIMEOUT_MS=30s` 统一套用到所有 runner；提权外层等待脚本 `runElevated` 也走同一 runner（`main.ts:35` 默认 runner → `main.ts:70` elevator → `elevate.ts:276` `deps.runner.run(outer)`）。SFC / DISM / StartComponentCleanup / winget 装 VC++ 运行库均需数分钟，30s 即被 Node kill 报"修复未完成"假失败。 | `electron/services/shell.ts`；`electron/services/elevate.ts`；装配 `electron/main.ts`；长任务入口 `disk.ts`、`dllrepair.ts` |

### 本轮新发现中危（报告时）

| # | 严重度 | 问题 | 位置 |
|---|---|---|---|
| N-M1 | 中 | **更新状态机文案自相矛盾（M6 残留）**：手动下载出口已全链路补齐，但 `useAppUpdate.ts:171` 的 available 态 label 仍写"正在下载…"，与"下载更新"按钮矛盾。 | `src/composables/useAppUpdate.ts:171` |

### 低危（合并清单见第六节，共 17 项）

集中在三处：(a) 防御纵深小缺口（render-process-gone 无条件 reload 死循环风险、webSecurity 未显式声明）；(b) 旧修复批次的边角残留（darwin/linux 回收站 `; echo OK` 恒成功、dllrepair VC++ 结果回退 exit 0、retryFailed 命名不对称）；(c) 新修复引入的轻微不对称（unix 防火墙分支无二次确认、setStartupType 脚本端未二次复检、capabilityFeed 注释漂移）。

---

## 二、架构总览（confirmed）

- **形态**：Windows 桌面优化器（设计跨平台，当前主战场 Windows），Electron 主进程 + Vue3 渲染进程，preload 经 contextBridge 暴露 `window.gale.*` 单一门面；渲染层零裸用（grep 全 `src/` 无 `ipcRenderer`/`require(`/Node `process.` 裸调用，77 处 IPC 全走 `window.gale.*`）。
- **主进程**：`electron/main.ts`（窗口/单实例/IPC 装配/openExternal 白名单）+ `preload.ts`（桥）+ `services/` 25 个服务模块。执行层统一收口在 `shell.ts`（PowerShell/bash 双 runner，30s 硬超时）；成败判定统一收口在 `actionResult.ts`（`OK:/ERR:` 口径 + `parseActionOutcome`）。
- **权限双轨**：`runner`（普通权限）与 `adminRunner`（经 `elevate.ts` 提权子进程，Windows ShellExecute runas 弹 UAC）；`optlib.ts` 按能力元信息 `needsAdmin` 路由到 `ctx.normal` / `ctx.admin`。
- **三条旗舰链路**：① onekey 一键编排（串行 + 取消 + 重试，进度广播）；② capabilityFeed 远端能力库（schema/白名单/防降级多重校验，只能覆盖元信息 + 调配方白名单方法，不能下发代码）；③ update 更新状态机（八态，electron-updater v6 适配）。
- **契约**：`shared/types.ts` 定义 `GaleApi`（68 invoke 方法 + 2 事件订阅），与 preload 暴露面、main 注册 handler 三方对账零漂移。
- **渲染层**：router 15 条命名路由 ↔ 15 个页面一一对应；4 组件（AppSidebar/OneKeyPanel/UpdateCard/CapabilityLibraryPanel）、4 composables（useOneKey/useAppUpdate/usePolling/useFlash）、主题层 4 文件。

---

## 三、与 9-17 报告的差异总表

### 3.1 高危 H1–H4 核对

| 基线编号 | 基线问题 | 状态 | 当前证据 |
|---|---|---|---|
| H1 | 无单实例锁，多进程竞争写 store | ✅ 已修复 | `main.ts`：`requestSingleInstanceLock` + `second-instance` restore/focus |
| H2 | 无导航安全守卫，XSS 可劫持导航 | ✅ 已修复 | will-navigate 拦截；setWindowOpenHandler 拒开新窗；`nodeIntegration:false`；`contextIsolation:true`；render-process-gone |
| H3 | 深度清理收渲染层 path、字符串前缀可路径穿越 | ✅ 已修复 | 契约改 `runCleanup(ids: string[])`；服务端按 id 查权威扫描清单、未知 id 拒；`isSafePath` 已删 |
| H4 | SFC/DISM 跨页提权不一致（磁盘修复页不弹 UAC） | ✅ 已修复 | `disk:repairSystemFiles` 走 `adminDiskService`；dll 通道同走 adminDiskService，两路都弹 UAC |

### 3.2 中危 M1–M9 核对

| 基线编号 | 基线问题 | 状态 |
|---|---|---|
| M1 | setStartupType win32 未查保护名单 | ✅ 已修复（JS 层，脚本端留低危残留） |
| M2 | retryFailed 运行中改 phase 绕并发守卫 | ✅ 已修复 |
| M3 | needsAdmin 收紧仅 UI 生效、UI 与执行分裂 | ✅ 已修复 |
| M4 | apply 后被拒条目从 UI 消失 | ✅ 已修复 |
| M5 | 配方 deepCleanup 恒走 normal 不按 admin 路由 | ✅ 已修复（留低危） |
| M6 | autoDownload=false 时 available 态无下载出口 | ⚠️ 部分修复（出口已补，文案 N-M1 已修） |
| M7 | PAL execFile 无超时，脚本 hang 永不 resolve | ✅ 已修复（引入 N-H1，已再修） |
| M8 | firewall 禁用 Public 配置文件无二次确认 | ✅ 已修复（unix 分支留低危） |
| M9 | escapeDesktopExecArg 无单元测试 | ✅ 已修复 |

### 3.3 点名低危核对（关键项）

- ✅ 已修：optimizer else 兜底走 parseActionOutcome；toggleStartup 失败即 throw；journal/apt/brew `; echo OK`；win-explorer-thumb 无条件 OK；monitor.snapshot 改 Promise.all；hardware 复用单次 si.graphics()；process 保护名单补 svchost/explorer/dwm；tasks 新增 PROTECTED_TASKS；parsePing 以丢包为权威；nodeIntegration:false；render-process-gone 恢复；OneKeyPhase 去掉 idle；sleep 后补 cancel 判断。
- ❌ 仍在：darwin/linux 回收站 `; echo OK` 恒成功（optimizer.ts）；retryFailed 与 `onekey:retry` 命名不对称（内部自洽，仅命名问题）。

---

## 四、依赖升级兼容性核查（electron 33→39 / vitest 5 / builder 26 / tar 7）

| 升级项 | 结论 | 证据 |
|---|---|---|
| Electron 33→39（实装 39.8.10） | ✅ 健康 | 主进程所用 API（single-instance / will-navigate / setWindowOpenHandler / render-process-gone / contextBridge）在 39 均现行；无 remote、无 allowRendererProcessReuse；openExternal 走 Promise 链；update.electron.ts 对 39 新 WebInstaller 做了 optional cast 兜底 |
| vitest 4→5（实装 5.0.1） | ✅ 健康 | vitest.config.ts 字段均 v5 现行；vite 6.4.3 满足 peer；实测 555 passed / 0 failed |
| electron-builder / app-builder-lib →26 | ✅ 配置层健康 | electron-builder.yml 无废弃键；未实跑完整打包，产物级兼容标注 unknown |
| tar 6→7（实装 7.5.22） | ✅ 健康 | 源码零 `import 'tar'`，仅 builder 链传递依赖 |

---

## 五、契约三方对账（confirmed）

`shared/types.ts` 的 `GaleApi` 契约 **68 个 invoke 方法 + 2 个事件订阅**：preload 暴露 68+2，main 注册 68 个 `ipcMain.handle` + 2 个广播——孤儿 handler **0**、契约缺口 **0**。相较基线净增 1 个 `app:downloadUpdate`（M6 修复）。

---

## 六、新发现问题完整清单（报告时口径）

**高**：N-H1（30s 硬超时误杀 SFC/DISM/winget 长任务）——后续已修。
**中**：N-M1（useAppUpdate.ts available 态文案）——后续已修。

**低（按模块归并）**：
1. render-process-gone 无条件 reload，确定性崩溃会 reload 死循环——应按 reason 计数、连续崩溃则停止自动 reload。
2. webPreferences 未显式声明 `webSecurity: true`（默认即 true，缺纵深）。
3. describeUpdateError 未覆盖 ENOSPC 磁盘满 / 用户取消。
4. 进入 error 态时残留 percent/transferred/total 脏字段。
5. setStartupType 的 PS 脚本未做 `$protected` 二次复检（与 stop() 纵深不对称）。
6. monitor.net 字段仍无 `Number.isFinite` 兜底，NaN 可透传。
7. firewall M8 确认位只在 win32，unix `ufw disable`/`pfctl -d` 仍一键放行无确认。
8. shell 硬超时只杀直接子进程，Windows 无 Job Object，孙进程可能成孤儿（inferred）。
9. darwin/linux 回收站脚本仍 `; echo "OK"` 使退出码恒 0。
10. parseVcRedistResult 仍回退 res.code、winget 退出码未映射。
11. runCleanup 每次全量重扫垃圾目录，与 30s 超时叠加可能逼近上限。
12. 未提权运行含 admin-only deep-cleanup id 的远端配方时中途弹 UAC，违背统一预检设计。
13. capabilityFeed 头部安全注释仍写"远端可覆盖 needsAdmin"，与现行实现矛盾（文档漂移）。
14. DllRepair.vue openExternal 无 try/catch。
15. theme.css dark 块 `--accent*` 死代码。
16. vitest jsdom 每文件重建 31 次的性能提示（非错误）。
17. 其他边角：redirect:'follow'；releasedBytes 跨 attempt 不累加；autolaunch writeFileSync 无 try/catch；toolbox clearClipboard 无 try/catch；history 无去重；gamemode macOS pgrep 误报；process unix ERR 后 exit 0。

---

## 七、分模块走读明细

### 7.1 契约层 / 主进程入口 / 更新状态机 / 提权链路

- `shared/types.ts`：`GaleApi` 68 invoke + 2 event；`runCleanup`/`runDeepCleanup` 只收 id；`OptCapabilityMetaPatch` Omit 掉 needsAdmin。
- `preload.ts`：contextBridge 逐方法映射，`app.downloadUpdate`(:113) 已补；`retryFailed → 'onekey:retry'` 命名不对称仍在。
- `main.ts`：H1 单实例锁、H2 will-navigate/setWindowOpenHandler/render-process-gone、H4 repairSystemFiles 走 adminDiskService；openExternal 白名单（github.com / objects.githubusercontent.com / aka.ms / learn.microsoft.com / support.microsoft.com）。
- `update.ts`：八态状态机，`downloadUpdate()` 仅 available 态触发。
- `update.electron.ts`：autoUpdater 六事件归一；Windows `disableWebInstaller=true` 兜底。
- `elevate.ts`：asInvoker + 按需 ShellExecute runas / pkexec / sudo；BOM 写 payload；sweepStaleTemp 清 >1h 残留。
- `useAppUpdate.ts` + `UpdateCard.vue`：单例镜像；"下载更新"按钮 available 态渲染。

### 7.2 一键优化编排三件套（onekey / optlib / capabilityFeed）

- `onekey.ts`：start() 同步守卫 isActive；cancel 在 sleep 后再判；retryFailed 开头 isActive() 守卫（M2 已修）。
- `optlib.ts`：needsAdmin 不参与 override 覆盖（提权边界恒本地值）；重名拒绝；路径不进能力层。
- `capabilityFeed.ts`：七条安全红线健在（takeExact 不截断、hasOwnProperty 挡原型链、内置 id 禁覆盖、防降级、minAppVersion/体积/条数上限、needsAdmin 三处独立守卫且口径升级为恒本地值、类型层 Omit）。M3/M4/M5 已修。

### 7.3 清理 / 磁盘 / 修复集群（optimizer / disk / space / dllrepair）

- `optimizer.ts`：runCleanup 只收 ids，服务端重扫权威清单（H3 已修）；unix 回收站 `; echo OK` 仍在。
- `disk.ts`：buildDeepCatalog 权威 id 清单；DISM StartComponentCleanup 不带 /ResetBase；repairSystemFiles 只依赖注入 runner。
- `space.ts`：清理前后真实可用空间差值，available 优先。
- `dllrepair.ts`：DLL 三态互斥穷尽；vcRedist 走 adminRunner。

### 7.4 PAL 执行层 + 监控/采集 + 系统工具类

- `shell.ts`：PowerShell/bash 双 runner，UTF-8/LC_ALL 强制；30s 硬超时（M7 已修，N-H1 后续再修）。
- `actionResult.ts`：ERR: 优先、OK 独立成行、空输出失败，无 includes('OK')。
- `desktopEntry.ts`：.desktop Exec= 统一转义（M9 已修，补 13 条单测）。
- `monitor.ts`：七项 Promise.all 并发；net 字段 NaN 兜底留低危。
- `hardware.ts`：graphics/displays 共享单次 si.graphics()。
- `process.ts`：PROTECTED_NAMES 补 svchost/explorer/dwm/fontdrvhost/sihost/taskhostw。
- `network.ts`：host 白名单；parsePing 以 loss<100 为权威。
- `gamemode.ts`：三平台还原凭据正则全锚定，未削弱。
- `winservices.ts`：M1 JS 层补 PROTECTED_SERVICES；setStartupType 脚本端缺二次复检留低危。
- `tasks.ts`：新增 PROTECTED_TASKS（8 项）。
- `firewall.ts`：M8 confirmDisablePublic 三方闭合；unix 分支留低危。

### 7.5 渲染层 + 升级兼容

- 15 路由 ↔ 15 页面一一对应，无孤儿；4 composables、4 组件、主题层 4 文件全部核对。
- 渲染层零裸 ipcRenderer / require / Node process；77 处 IPC 全走 window.gale.*。
- Electron 39 / vitest 5 / builder 26 / tar 7 四条升级线均无 API 误用或兼容隐患；typecheck 0 错、vitest 555 过为硬证据。

---

**结论**：本报告为 2026-10-06 二轮全项目读取快照。报告中识别的 N-H1 / N-M1 已在当日修复并推送 master；其余低危项记录在案，按优先级后续处理。
