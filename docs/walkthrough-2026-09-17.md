# 疾风引擎 gale-engine v0.1.10 全模块源码级走读与改进报告

> 走读日期：2026-09-17 ｜ 基线：Electron 33 + Vue 3 + TS strict + electron-vite + vitest 498/498 全绿
> 走读方式：6 个并行子代理逐行打开源码核对，全部结论带 `file:line` 证据；事实标注 `confirmed`（源码直接可见）/ `inferred`（由装配关系推断）/ `unknown`（未在本轮验证）。
> 已修复项基线：`docs/code-review-2026-09-16.md` 的 H1 + M1–M10 + L1–L12 共 23 项，本报告只确认其闭合情况，不重复计为新问题。

---

## 〇、执行摘要

本次走读覆盖主进程全部 25 个服务模块、`main.ts`/`preload.ts`/`shared/types.ts` 契约层、4 个 composables、4 个组件、15 个页面与主题层，三个旗舰链路（onekey 编排、capabilityFeed 安全校验、更新状态机）做了状态机级深度展开。

**总体结论：架构骨架与安全红线扎实，23 项历史修复全部闭合；但本轮新发现 4 个高危、9 个中危、若干低危问题，集中在三处——(a) 主进程启动/窗口安全缺防御纵深，(b) 诚实回执口径在 optimizer/disk 仍有零星残留，(c) 跨模块语义不对称（提权路由、保护名单、needsAdmin 收紧）。**

### 最高优先级（建议立即修）

| # | 严重度 | 问题 | 位置 |
|---|---|---|---|
| H1 | 高 | **无单实例锁**：未调 `app.requestSingleInstanceLock()`，多实例可并发写 electron-store、竞争 onekey 状态机 | `electron/main.ts`（全文） |
| H2 | 高 | **无导航安全守卫**：`createWindow()` 未设 `will-navigate` 与 `setWindowOpenHandler`，一旦渲染层 XSS 可被劫持导航 | `electron/main.ts:299-330` |
| H3 | 高 | **深度清理路径穿越**：`optimizer.runCleanup` 仍接收渲染层 `path`，`isSafePath` 仅字符串前缀比对，可被 `根\..\..\` 穿越；与 disk 侧"只收 id、未知 id 拒绝"不对齐 | `optimizer.ts:557-562`；契约 `shared/types.ts:212` |
| H4 | 高 | **SFC/DISM 提权跨页不一致**：`disk:repairSystemFiles` 走普通 `diskService`（不弹 UAC），而同机已建的 `adminDiskService` 只被 dll 通道使用——从磁盘修复页跑 SFC 必失败，从 DLL 修复页正常 | `main.ts:159-163` vs `main.ts:73,80` |

### 中优先级

| # | 严重度 | 问题 | 位置 |
|---|---|---|---|
| M1 | 中 | `setStartupType` win32 分支未查 `PROTECTED_SERVICES`（`stop()` 有 JS 白名单+脚本端+AcceptStop 三重门，它只有 `isSafeServiceName`），可把 RpcSs 等关键服务设为 Disabled | `winservices.ts:296-303`（unix 分支有 `isProtectedUnixUnit`，不对称） |
| M2 | 中 | `retryFailed()` 运行中调用先把 `state.phase` 置 `'done'` 再 `start()`，绕过并发守卫，新旧两轮交错；UI 按钮已隐藏但 IPC `onekey:retry` 无守卫 | `onekey.ts:306`；`main.ts:148` |
| M3 | 中 | needsAdmin"收紧"方向仅 UI 生效：`mergedMetas` 允许远端把内置项 false→true，但 `metaOverrides()` 不下发、optlib 不接受——CapabilityLibraryPanel 显示"需管理员"而 OneKeyPanel/预检不显示，UI 与执行不一致 | `capabilityFeed.ts:560,685-689`；`optlib.ts:308` |
| M4 | 中 | apply 后被 manifest 校验拒绝的条目从 UI 消失：`pendingRejected` 置 null，`state()` 不展示被拒条目及原因 | `capabilityFeed.ts:656` |
| M5 | 中 | 配方运行时 `disk.deepCleanup` 恒用 `ctx.normal`，不按 admin 路由；远端配方传 admin-only id 必失败（内置 `deep-update-cache` 路由正确，配方接口做不到） | `capabilityFeed.ts:284-289`；对照 `optlib.ts:237` |
| M6 | 中 | 更新状态机死态：`autoDownload=false` 时 `available` 态无手动下载出口（`UpdaterApi` 无 `downloadUpdate()`、main 无 IPC），但 UpdateCard 仍显示"正在下载…" | `update.ts:11-36`；`UpdateCard.vue:159` |
| M7 | 中 | PAL 执行无超时：`execFile` 未设 `timeout`，脚本 hang 时 Promise 永不 resolve，整个编排被挂住 | `shell.ts:47,74` |
| M8 | 中 | firewall 禁用 Public 配置文件无二次确认，UI 一点即关（profile/rule 白名单已堵注入面） | `firewall.ts:210` |
| M9 | 中 | `desktopEntry.escapeDesktopExecArg` 被 autolaunch/optimizer 消费但无单元测试 | `desktopEntry.ts:17-20` |

### 低优先级（诚实回执残留与性能/一致性）

- **M5 假成功口径零星残留**：`optimizer.ts:603` else 兜底仍 `code===0 && stdout.includes('OK')`；`toggleStartup` 跑完直接 `return listStartup()` 吞掉脚本成败（`optimizer.ts:625-627`）；unix 回收站与 linux 脚本的 `; echo OK` 使复合命令退出码恒 0、journal/apt 失败仍报成功（`optimizer.ts:322,324`；`disk.ts:245,272,283`）；`win-explorer-thumb` 无条件输出 `"OK"`（`disk.ts:170`）。
- **性能**：`monitor.snapshot()` 七项串行 await 未用 `Promise.all`（`monitor.ts:115-126`）；`hardware.graphics()`/`displays()` 各调一次 `si.graphics()` 重复采集（`hardware.ts:127,141`）。
- **保护名单覆盖面**：process 保护名单仅 10 个 Windows 进程名，未含 svchost/explorer/dwm；tasks 模块无系统关键任务保护名单，与 winservices 不对称。
- **边角**：`parsePing` 的 `avg>0` 在 localhost 0ms 可能误判（`network.ts:186`）；cancel 在 `retryDelayMs` sleep 期间被请求时仍多跑一次（`onekey.ts:161-162`）；`OneKeyPhase` 含 `'idle'` 但代码从未 emit（`shared/types.ts:598`）；`nodeIntegration` 未显式置 false（Electron 33 默认安全，缺纵深）、无 `render-process-gone` 恢复；方法名 `retryFailed` vs channel `onekey:retry` 命名不一致。

### 已确认健康（本轮有装配证据）

- **契约三方对账零漂移**：`shared/types.ts:193-341` 的 69 方法 + 2 事件，与 `preload.ts` 暴露面、`main.ts:114-247` 注册的 67 个 handler 逐一核对，无孤儿 handler、无契约缺口。
- **提权红线只收不松**：needsAdmin 三处独立守卫（配方编译 OR `capabilityFeed.ts:415`、`mergedMetas` OR `:560`、`metaOverrides` 不下发 `:685`），类型层 `OptCapabilityMetaPatch` 编译期剔除 needsAdmin（`shared/types.ts:441-443`）。
- **capabilityFeed 配方白名单**：id `takeExact` 不截断（`:106-110`）、`hasOwnProperty` 挡原型链键（`:394-400`）、内置 id 带 recipe 整条拒绝（`:132-135`）、防降级（`:635`）、minAppVersion 与体积/条目上限齐备。
- **更新状态机八态完整**：idle/checking/up-to-date/available/downloading/downloaded/unsupported/error，核心守卫 `isDownloadedOrDownloading()` 防下载态回退（`update.ts:164-165`），`interpretCheckResult` 正确区分"未启用(null)"与"已是最新"。
- **gamemode 还原凭据**三平台全锚定正则（十六进制 GUID / `[a-z0-9_-]` governor / 纯数字 PID），分号/`$()`/反引号/换行/大写/超长注入向量全拒。
- **dllrepair 三态** present/partial/missing 互斥穷尽（`dllrepair.ts:419-424`），修复回退闭合；启动项禁用为可逆搬停车键/`.disabled`/`Hidden=true`，DISM 不带 `/ResetBase`；space 清理前后 fsSize 实测。
- **渲染层零裸用**：全 `src/` grep 无 `ipcRenderer`/`require(`/`process.` 裸调用，77 处 IPC 全走 `window.gale.*`；`openExternal` 仅放行 HTTPS + 5 主机白名单（`main.ts:282-297`）。

### 已知限制（如实标注，非缺陷）

ARM64 三平台实机验证待用户侧；代码签名 / macOS 公证处于休眠；Linux deb 不支持自更新（AppImage 才行，已诚实降级到 unsupported）；Win7/8/8.1 与鸿蒙不支持；dependabot PR#1（electron ^33→^39）为独立迁移工程。

---

## 目录

1. 第一节：onekey 编排链路 / optlib / capabilityFeed（旗舰）
2. 第二节：更新状态机与 elevate 提权（旗舰）
3. 第三节：PAL 与系统监控类服务（shell/actionResult/desktopEntry/monitor/hardware/process/network）
4. 第四节：清理 / 磁盘 / 修复集群（optimizer/disk/space/dllrepair）
5. 第五节：系统工具类服务（gamemode/toolbox/winservices/tasks/firewall/autolaunch/settings/history）
6. 第六节：契约与渲染层（main/preload/types + composables + 组件 + 主题 + 15 页面）

---


# 第一节：onekey 编排链路 / optlib / capabilityFeed 源码级走读

> 走读日期：2026-09-17
> 项目：疾风引擎 gale-engine v0.1.10（Electron 33 + Vue3 + TS strict + electron-vite + vitest 498 全绿）
> 走读范围：`electron/services/onekey.ts`、`electron/services/optlib.ts`、`electron/services/capabilityFeed.ts` 及同名 `.test.ts`，交叉核对 `electron/main.ts`、`electron/preload.ts`、`shared/types.ts`、`src/composables/useOneKey.ts`、`src/components/OneKeyPanel.vue`、`src/components/CapabilityLibraryPanel.vue`。
> 事实标注纪律：**confirmed** = 本次实际打开源码逐行核对；**inferred** = 依据注释/文档推断；**unknown** = 未找到装配证据。

---

## 模块一：onekey.ts —— 一键优化编排器

### 文件路径与关键导出符号

| 符号 | file:line | 说明 |
|---|---|---|
| `NEED_ADMIN_REASON` | `onekey.ts:29-30` | 未提权时管理员项的统一跳过文案（常量） |
| `OneKeyDeps` 接口 | `onekey.ts:32-44` | 依赖注入：library / isElevated / maxRetries / retryDelayMs / now / sleep |
| `RunState` 接口 | `onekey.ts:46-60` | 单轮运行的内部状态结构 |
| `OneKeyService` 接口 | `onekey.ts:62-74` | 对外 API：start / cancel / retryFailed / onProgress / getState / isRunning |
| `toSummary()` | `onekey.ts:84-96` | RunState → OneKeySummary 的纯函数转换 |
| `createOneKeyService()` | `onekey.ts:98-323` | 工厂函数，返回闭包服务实例 |

### 职责一句话

按序串行执行一组优化能力，实时向界面推送进度，支持协作式取消与失败自动重试，整轮共享一份扫描缓存。**（confirmed）**

### 关键链路

```
渲染层 start()（useOneKey.ts:96-113）
  → window.gale.onekey.start(ids)（preload.ts:37）
  → ipcRenderer.invoke('onekey:start', ids)
  → main.ts:144-146 ipcMain.handle('onekey:start')
  → oneKeyService.start(ids)

start() 内部（onekey.ts:186-280）：
  1. 同步守卫：isActive() || starting → 立即返回 rejected(RUNNING_MSG)（:188）
  2. starting = true（同步占位锁，:189）
  3. try 块内：
     a. listCapabilities() → 建 metaMap（:196-197）
     b. requested = ids 或 defaultEnabled 全量（:198-201）
     c. plan = 去重 + 过滤未知 id（:204）
     d. plan.length === 0 → rejected（:205）
     e. await isElevated()（:207）
     f. createContext() → 新建共享 OptContext（:209）
     g. 构造 RunState，state = run，emit()（:211-226）
  4. finally：starting = false（:228-230）
  5. 主循环 for (id of plan)（:233-265）：
     a. run.cancelRequested → break（:234）
     b. needsAdmin && !elevated → 标记 skipped（:243-253）
     c. 否则 runWithRetry(ctx, id)（:255）
     d. push outcome, completed++, releasedBytes+=, emit（:259-264）
  6. finally：收尾 phase = cancelled/done，emit（:266-277）
  7. return toSummary(run)（:279）
```

**进度推送链路（主→渲染）：**
- `emit()`（:133-143）遍历 `listeners` 调 `cb(snapshot())`，回调异常被 try/catch 吞掉不中断主流程。**（confirmed, onekey.ts:136-141）**
- main.ts:239-241 在 `registerIpc()` 内订阅一次 `oneKeyService.onProgress` → `broadcast('onekey:progress', progress)`，向所有存活窗口推送。**（confirmed, main.ts:239-241）**
- preload.ts:41-45 `onProgress` 注册 `ipcRenderer.on('onekey:progress', listener)`，返回退订函数。**（confirmed, preload.ts:41-45）**
- useOneKey.ts:53-59 `subscribe()` 只订阅一次（`if (unsub) return`），模块级单例，组件卸载不退订（OneKeyPanel.vue:64-66 注释明确说明）。**（confirmed）**

### 状态机

```
state = null（从未运行）
  │  start()
  ▼
phase = 'running'（state 建立）
  │  ├── cancel() 被调 → phase = 'cancelling'，cancelRequested = true
  │  │     └── 当前项跑完后，循环检测 cancelRequested → break
  │  ├── 正常跑完所有 plan 项 → phase = 'done'
  │  └── 中途抛异常 → finally 块兜底：phase = 'done' 或 'cancelled'
  ▼
phase = 'done' / 'cancelled'（终态，state 保留供 getState/retryFailed 读取）
```

**关键设计点：**
- **同步占位锁 `starting`**（:114, :188-189, :228-230）：在任何 `await` 之前完成占位，杜绝双击/快速连续 start 的并发窗口。M8 修复已落地。**（confirmed，回归测试 onekey.test.ts:94-126 验证）**
- **协作式取消**（:282-287）：`cancel()` 只置 `cancelRequested = true` + `phase = 'cancelling'`，不强杀子进程（注释 :20-22 说明 ExecRunner 无 abort 通道）。当前项跑完后循环检测 `cancelRequested` 退出。**（confirmed）**
- **权限预检**（:243-253）：未提权时 needsAdmin 项统一标记 skipped，不逐项弹 UAC。**（confirmed）**

### 全部交互边界枚举

| 边界 | 分支 | 行为 | file:line |
|---|---|---|---|
| **并发：重复 start / start 进行中** | 守卫拦截 | `isActive()` 检查 phase==='running'\|'cancelling' || starting → 返回 rejected(RUNNING_MSG)，total=0 | :188, :170-171 |
| **并发：start 卡在 await isElevated 时第二次 start** | 守卫拦截 | starting 锁在同步阶段占位，第二次调用被挡。回归测试验证 | :188-189; test:94-126 |
| **取消：cancel() 对进行中子任务** | 协作式中止 | 置 cancelRequested=true，当前 runWithRetry 跑完后，外层循环 :234 break；runWithRetry 内 :161 也检测 cancelRequested 提前退出重试 | :282-287, :234, :161 |
| **取消：cancel() 在 idle/终态调用** | no-op | `!state \|\| phase 不在 running/cancelling → return` | :283 |
| **重试：retryFailed() 选哪些项** | partial-success | 取 state.outcomes 中 status==='failed' 的 id 列表，传给 start(failedIds) | :289-307 |
| **重试：无失败项** | rejected | 返回空摘要 + error='没有需要重试的失败项' | :291-303 |
| **重试：retryFailed 在运行中调用** | **⚠ 见改进建议 M-O1** | 先 `state.phase = 'done'`（:306），再调 start(failedIds)；此时原循环仍在执行 | :306-307 |
| **失败恢复：单项失败自动重试** | conditional | runWithRetry 按 maxRetries（默认1）重试；失败时 sleep(retryDelayMs=400ms)；已请求取消则不重试 | :146-167 |
| **失败恢复：重试期间取消** | partial | cancel 在 retryDelayMs sleep 期间被请求 → sleep 跑完后再执行一次 runInContext，失败后才退出（多跑一次） | :161-162 |
| **未知 id** | filtered-out | plan 构建时 `.filter(id => metaMap.has(id))`，渲染层传任意 id 被静默过滤 | :204 |
| **ids 为空/未传** | default-all | `ids 为空 → caps.filter(defaultEnabled)` | :198-201 |
| **plan.length === 0** | rejected | 返回 '没有可执行的优化项'，不建立 state | :205 |
| **runInContext 抛异常** | error-swallowed | optlib.runInContext 内部 catch 并返回 status='failed'（optlib.ts:353-362），不会逃逸到 onekey 主循环 | optlib.ts:353-362 |
| **主循环体抛异常** | 兜底收尾 | finally 块（:266-277）无条件收尾 phase，防止 state 永久停在 running | :266-277 |
| **onProgress 回调抛异常** | error-swallowed | emit() 内 try/catch 吞掉，不中断编排 | :137-141 |
| **订阅者订阅时补发状态** | pass-through | onProgress 立即调一次 cb(snapshot())，避免界面刷新后空白 | :316-317 |

### 与 optlib 的调用关系

- `deps.library.listCapabilities()` → optlib.ts:366-370（实时组装注册表）**（confirmed）**
- `deps.library.createContext()` → optlib.ts:323-329（新建 OptContext + 独立 cache）**（confirmed）**
- `deps.library.runInContext(ctx, id)` → optlib.ts:331-363（解析注册表→执行→包装 outcome）**（confirmed）**
- onekey 不直接调 `runSingle`（它是 runInContext + createContext 的快捷封装）**（confirmed）**

### 与 capabilityFeed 的关系

- onekey 不直接引用 capabilityFeed。装配在 main.ts:97-108：optLibrary 通过 `externalCapabilities: () => capabilityFeed.externalCapabilities()` 和 `metaOverrides: () => capabilityFeed.metaOverrides()` 间接获取远端能力。**（confirmed, main.ts:106-107）**
- onekey 的权限预检读取的 `meta.needsAdmin` 来自 optlib.listCapabilities()，而 optlib 的 needsAdmin 对内置项**不接受远端覆盖**（optlib.ts:308）。详见交叉一致性章节。

### 安全边界

| 边界 | 位置 | 机制 |
|---|---|---|
| 并发守卫 | onekey.ts:188 | 同步 starting 锁 + isActive() 双重判断 |
| 未知 id 过滤 | onekey.ts:204 | 渲染层传任意 id 先过 metaMap.has() |
| 提权预检 | onekey.ts:243 | needsAdmin 项未提权直接 skipped，不逐项弹 UAC |
| 收尾兜底 | onekey.ts:266-277 | finally 无条件重置 phase，防永久 running |
| 回调隔离 | onekey.ts:137-141 | 订阅者异常不中断主流程 |

### 改进建议

| # | 严重度 | 问题 | file:line | 理由与最小改动方案 |
|---|---|---|---|---|
| M-O1 | **中** | `retryFailed()` 在运行中调用时，先把 `state.phase` 改为 `'done'`（:306），再调 `start(failedIds)`。此时原 run 的 for 循环仍在执行（local 变量 `run` 与 `state` 同对象引用），守卫 isActive() 读到 phase='done' 放行，导致两轮交错执行：原循环继续 push outcomes 到旧 run 对象，新 run 覆盖 `state`，进度推送指向新 run，原循环剩余项对订阅者不可见。UI 层（OneKeyPanel.vue:120）虽隐藏按钮（`v-if="!running"`），但 IPC `onekey:retry`（main.ts:148）无守卫，恶意/故障渲染层可触发。 | onekey.ts:306-307 | **最小改动**：retryFailed 开头加 `if (isActive()) return rejected('任务正在执行，请等待完成后再重试')`。约 2 行。 |
| L-O1 | 低 | `runWithRetry` 中 cancel 在 `sleep(retryDelayMs)` 期间被请求时，sleep 跑完后仍会执行一次额外的 `runInContext`（:162→:156），多跑一次才在 :161 退出。延迟窗口 400ms，影响小。 | onekey.ts:161-162 | **最小改动**：在 `await sleep(retryDelayMs)` 后、下次循环开头加 `if (state?.cancelRequested) break`。 |
| L-O2 | 低 | `runWithRetry` 的 `releasedBytes` 取自最后一次 attempt 的 spread（:165），不跨次累加。若首次失败已部分释放空间，重试成功后该部分被丢弃。实际影响小（失败项通常释放 0）。 | onekey.ts:165 | 如需精确，改为跨 attempt 累加 releasedBytes。非必须。 |
| L-O3 | 低 | `OneKeyPhase` 类型包含 `'idle'`（shared/types.ts:598），但代码中从未 emit 过 idle 状态——state=null 时 snapshot() 返回 null，非 idle。类型声明与实现不一致。 | shared/types.ts:598; onekey.ts:116-131 | 从 `OneKeyPhase` 中移除 `'idle'`，或在初始状态时 emit 一次 idle。非必须，不影响功能。 |

---

## 模块二：optlib.ts —— 优化能力动态库

### 文件路径与关键导出符号

| 符号 | file:line | 说明 |
|---|---|---|
| `OptContext` 接口 | optlib.ts:62-71 | ABI 输入：platform / normal / admin 服务集 / isElevated / cache |
| `OptRunResult` 接口 | optlib.ts:74-79 | 能力原始返回（id/label/耗时由库统一补齐） |
| `OptCapability` 接口 | optlib.ts:81-84 | meta + run(ctx) |
| `OptLibrary` 接口 | optlib.ts:86-95 | listCapabilities / runSingle / createContext / runInContext |
| `OptLibraryDeps` 接口 | optlib.ts:97-113 | normal/admin 服务集 / isElevated / platform / externalCapabilities / metaOverrides |
| `createOptCache()` | optlib.ts:51-59 | 简单 Map 缓存 |
| `aggregateResults()` | optlib.ts:128-142 | 多项 CleanupResult 聚合：空→skipped，有失败→failed |
| `pickDeep()` | optlib.ts:171-173 | 按 id 过滤深度清理计划，只保留 safe 项 |
| `buildCapabilityRegistry()` | optlib.ts:199-270 | 内置 9 项能力注册表 |
| `createOptLibrary()` | optlib.ts:276-375 | 工厂函数 |

### 职责一句话

把每项优化封装成独立可调用单元（注册表 + 稳定 ABI），支持一键批量编排与单项独立调用，运行期按需装配内置 + 远端附加能力。**（confirmed）**

### 关键链路

```
listCapabilities()（optlib.ts:366-370）
  → resolveRegistry()（:287-321）：
    1. buildCapabilityRegistry() → 9 项内置（:289）
    2. metaOverrides() → 改 label/description/defaultEnabled（:291-313）
    3. externalCapabilities() → 追加远端配方能力，重名拒绝（:315-319）
  → .map(c => ({...c.meta, source: c.meta.source ?? 'builtin'}))

runSingle(id)（optlib.ts:371）
  → runInContext(createContext(), id)

runInContext(ctx, id)（optlib.ts:331-363）：
  1. key = String(id)，resolveRegistry().get(key)
  2. 未找到 → failed + '未知优化项'（:334-341）
  3. await c.run(ctx) → r
  4. 包装：{ id, label, needsAdmin, durationMs, ...r }（:346-352）
  5. catch → failed + error message（:353-362）
```

**9 项内置能力清单**（buildCapabilityRegistry, :199-270）：

| id | needsAdmin | defaultEnabled | 执行路径 |
|---|---|---|---|
| clean-temp | false | true | runCleanupKind(ctx, 'temp') |
| clean-recycle | false | true | runCleanupKind(ctx, 'recycle') |
| clean-browser | false | true | runCleanupKind(ctx, 'browser') |
| deep-system-cache | false | true | runDeepIds(ctx, [...], false) |
| deep-user-cache | false | true | runDeepIds(ctx, [...], false) |
| deep-update-cache | **true** | true | runDeepIds(ctx, ['win-update-cache'], true) → admin set |
| net-flush-dns | false | true | ctx.normal.toolbox.flushDns() |
| deep-component-store | true | **false** | runDeepIds(ctx, ['win-dism-cleanup'], true) |
| repair-system-files | true | **false** | ctx.admin.disk.repairSystemFiles('sfc') |

**（confirmed，逐项核对 :201-269）**

### 状态机/数据流

optlib 无内部状态机——它是无状态注册表工厂。`createContext()` 每次新建独立 `OptCache`（:328），确保一轮一键优化内扫描只执行一次。`resolveRegistry()` 每次调用实时求值 `externalCapabilities()` 和 `metaOverrides()`，使远端清单生效后无需重启。**（confirmed, optlib.ts:287-321）**

**缓存语义：**
- `cached(ctx, key, load)`（:119-125）：ctx.cache.get 命中即返回，否则 load 后 set。
- 清理类缓存 key：`'cleanup-plans'`（:152），深度清理按权限分 key：`'deep-plans-admin'` / `'deep-plans-normal'`（:162）。
- **跨能力共享**：同一轮内 clean-temp / clean-recycle / clean-browser 共用同一份 scanCleanup 结果（:152）。**（confirmed）**

### 安全边界

| 边界 | 位置 | 机制 |
|---|---|---|
| 远端重名拒绝 | optlib.ts:317 | `reg.has(id) → continue`，内置实现优先，远端无法替换 |
| metaOverrides 不创造能力 | optlib.ts:295 | `if (!base) continue`，不能凭空加元信息 |
| needsAdmin 不参与覆盖 | optlib.ts:308 | 注释明确，spread 后不设 needsAdmin 字段（保留 base.meta.needsAdmin） |
| 路径不进能力层 | optlib.ts:160-169 | runDeepIds 只收 id 数组，路径由服务端权威清单解析（pickDeep + safe 过滤） |
| 未知 id 诚实失败 | optlib.ts:334-341 | 返回 failed 而非 throw |
| run() 异常不逃逸 | optlib.ts:353-362 | catch 后包装为 failed outcome |

### 改进建议

| # | 严重度 | 问题 | file:line | 理由与最小改动方案 |
|---|---|---|---|---|
| M-O2 | **中** | **配方运行时 `disk.deepCleanup` 始终用 `ctx.normal`（:284-289），不按 id 路由到 admin set。** 内置 `deep-update-cache` 正确使用 `ctx.admin`（optlib.ts:237 → runDeepIds with needsAdmin=true），但远端配方若引用 `disk.deepCleanup` 传 ids=['win-update-cache']，会走 normal 执行器（未提权），清理系统更新缓存必然失败。这是 partial-success 语义缺口：配方能调的接口比内置能做的窄。 | optlib.ts:279-291（capabilityFeed.ts:279-291） | **最小改动**：在 `disk.deepCleanup` 的 run 中，对 pickDeep 结果检查是否有 needsAdmin 项，若有则改用 `ctx.admin.disk`。或在 RecipeCall 接口增加 `resolveContext(args) → 'normal'\|'admin'`。当前不构成安全漏洞（会诚实失败），但配方能力表达力受限。 |
| L-O4 | 低 | `runCleanupKind` 的缓存 key 固定为 `'cleanup-plans'`（:152），不区分 platform。同一 OptContext 跨平台不可复用（但 createContext 每次新建，实际不会跨平台复用）。 | optlib.ts:152 | 非必须，当前无 bug。 |

---

## 模块三：capabilityFeed.ts —— 可独立更新的能力库通道

### 文件路径与关键导出符号

| 符号 | file:line | 说明 |
|---|---|---|
| `DEFAULT_FEED_URL` | capabilityFeed.ts:36-37 | 默认清单地址（GitHub raw） |
| `BUILTIN_LIBRARY_VERSION` | capabilityFeed.ts:40 | 内置版本标识 '0.0.0' |
| `SUPPORTED_SCHEMA` | capabilityFeed.ts:43 | 只接受 schema=1 |
| `MAX_MANIFEST_BYTES` | capabilityFeed.ts:46 | 256 KB 体积上限 |
| `MAX_CAPABILITIES` | capabilityFeed.ts:48 | 200 条目上限 |
| `MAX_RECIPE_STEPS` | capabilityFeed.ts:50 | 8 步骤上限 |
| `ID_RE` | capabilityFeed.ts:52 | `/^[a-z][a-z0-9-]{2,47}$/` |
| `VERSION_RE` | capabilityFeed.ts:54 | `/^\d+(\.\d+){0,2}$/` |
| `parseVersion()` | capabilityFeed.ts:61-66 | 版本号数值化 |
| `compareVersions()` | capabilityFeed.ts:69-76 | 数值比较（非字典序） |
| `validateRemoteCapability()` | capabilityFeed.ts:113-165 | 单条校验 |
| `validateManifest()` | capabilityFeed.ts:170-231 | 整份清单校验 |
| `createRecipeRuntime()` | capabilityFeed.ts:264-357 | 白名单调用表（8 个方法） |
| `compileRemoteCapabilities()` | capabilityFeed.ts:370-434 | 远端定义 → OptCapability[] |
| `createHttpManifestFetcher()` | capabilityFeed.ts:443-467 | 带超时+体积检查的 fetch |
| `createCapabilityFeedService()` | capabilityFeed.ts:515-695 | 服务工厂 |

### 职责一句话

从远端拉取能力清单 JSON，经严格 schema/白名单/版本/体积校验后落盘生效，把远端定义编译为可注册进 optlib 的配方能力或内置元信息覆盖，全程防降级、防注入、防替换内置实现。**（confirmed）**

### 关键链路

```
check()（capabilityFeed.ts:596-643）：
  1. 重置状态（checkedAt/lastError/availableVersion/pending）
  2. fetchManifest() → text（超时 10s，体积 ≤256KB）
  3. JSON.parse
  4. validateManifest(parsed, {appVersion, builtinIds, rawBytes})
  5. 整体性错误 → lastError，返回（不生效）
  6. 版本 > 当前 → pending = manifest，availableVersion
  7. 版本 ≤ 当前 → 不接受（防降级）

apply()（:645-659）：
  1. 无 pending → 报错
  2. storage.set(STORAGE_KEY, record) → 持久化
  3. pending = null

state()（:579-594）：
  → loadCached() 读持久化 → mergedMetas(active) → 完整状态

externalCapabilities()（:670-675）：
  → compileRemoteCapabilities(非内置 id 的 defs, runtime) → OptCapability[]

metaOverrides()（:677-692）：
  → 遍历内置 id 的 defs → {label, description, defaultEnabled}（不含 needsAdmin）
```

### 全部校验规则与反例

#### 3.1 清单级校验（validateManifest, :170-231）

| # | 规则 | file:line | 反例输入 → 拒绝行为 |
|---|---|---|---|
| R1 | 体积 > 256KB → 整份作废 | :175-177 | `rawBytes=300000` → errors=['清单体积超过上限...'] |
| R2 | schema 必须精确等于 1 | :180-183 | `{schema:2}` → errors=['不支持的清单 schema...'] |
| R3 | libraryVersion 必须匹配 VERSION_RE（takeExact 不截断） | :185-189 | `libraryVersion:'v1.0.0'` → errors=['libraryVersion 格式非法...'] |
| R4 | capabilities 必须是数组 | :191-194 | `{capabilities:{}}` → errors=['capabilities 必须是数组'] |
| R5 | 条目数 > 200 → 整份作废 | :195-197 | 201 条 → errors=['能力条目过多...'] |
| R6 | 单条失败不拖垮整份，但 rejected 如实记录 | :203-220 | 1 好 + 1 坏 → manifest 保留好条目，rejected 记录坏条目 |
| R7 | id 去重 | :210-213 | 两条同 id → 第二条 rejected（'id 重复'） |
| R8 | minAppVersion 高于当前应用版本 → 拒绝该条 | :214-217 | appVersion='1.0.0', def.minAppVersion='9.0.0' → rejected（'要求应用版本 ≥ 9.0.0'） |
| R9 | 全部条目被拒 → 视为整体错误 | :222-224 | 所有条目不合法 → errors=['清单中没有任何可用条目'] |

#### 3.2 单条校验（validateRemoteCapability, :113-165）

| # | 规则 | file:line | 反例输入 → 拒绝行为 |
|---|---|---|---|
| R10 | id 长度 ≤ 48（takeExact 不截断） | :118-121 | `id:'a'+'b'.repeat(60)`（61字符）→ 'id 长度非法（上限 48）' |
| R11 | id 匹配 ID_RE（小写字母开头，字母数字连字符，3-48 字符） | :123 | `id:'Clean-Temp'`（大写）→ 'id 不合法'；`id:'ab'`（2字符）→ 不匹配 `{2,47}` → 拒绝；`id:'9start'`（数字开头）→ 拒绝 |
| R12 | 必须有 label（非空字符串） | :125-126 | 无 label → '缺少 label' |
| R13 | 内置 id 带 recipe → 拒绝（防劫持） | :132-135 | `{id:'repair-system-files', recipe:[...]}` → '内置能力的实现不可被远端覆盖' |
| R14 | recipe 必须是数组 | :136 | `recipe:'not-array'` → 'recipe 必须是数组' |
| R15 | recipe 非空 | :137 | `recipe:[]` → 'recipe 不能为空' |
| R16 | recipe 步骤 ≤ 8 | :138-140 | 9 步 → 'recipe 步骤过多（上限 8）' |
| R17 | 每步必须有 call | :144-145 | `{args:{}}`（无 call）→ 'recipe 步骤缺少 call' |
| R18 | needsAdmin / defaultEnabled / enabled 仅接受 boolean | :152-154 | `needsAdmin:'yes'` → 不赋值（undefined），不拒绝但不下发 |
| R19 | minAppVersion 格式合法（takeExact ≤16 字符 + VERSION_RE） | :155-161 | `minAppVersion:'v1'` → 'minAppVersion 格式非法' |

#### 3.3 配方编译期校验（compileRemoteCapabilities, :370-434）

| # | 规则 | file:line | 反例输入 → 拒绝行为 |
|---|---|---|---|
| R20 | enabled=false → 整条拒绝（下线） | :378-381 | `{id:'x', enabled:false, recipe:[...]}` → rejected（'已下线'） |
| R21 | 无 recipe 的新 id → 不产出实现（不凭空造能力） | :382-385 | `{id:'meta-noimpl'}`（无 recipe）→ capabilities 为空，rejected 也为空 |
| R22 | call 必须是 runtime 自有属性（hasOwnProperty） | :394-400 | `{call:'toString'}` / `{call:'constructor'}` / `{call:'__proto__'}` → '引用了白名单外的调用' |
| R23 | 未知 call → 整条拒绝（不静默丢某一步） | :397-405 | `{call:'child_process.exec'}` → rejected（'引用了白名单外的调用'） |
| R24 | needsAdmin 只收紧不放宽：`steps.some(needsAdmin) \|\| def.needsAdmin===true` | :408, :415 | 远端 `needsAdmin:false` 但 recipe 含 `disk.repairSystemFiles`（needsAdmin=true）→ 最终 needsAdmin=true |
| R25 | 远端新能力默认 defaultEnabled=false | :416 | 无 defaultEnabled → false（不纳入一键优化） |

#### 3.4 白名单调用表参数校验（createRecipeRuntime, :264-357）

| 调用名 | needsAdmin | 参数校验 | file:line | 反例 |
|---|---|---|---|---|
| `optimizer.cleanupKind` | false | kind ∈ [temp, recycle, browser] | :269-270 | `kind:'../../etc'` → badArgs |
| `disk.deepCleanup` | false | ids 非空字符串数组（≤32个） | :282-283 | `ids:[]` → badArgs('ids 必须是非空字符串数组') |
| `toolbox.flushDns` | false | 无参数 | :293-299 | — |
| `toolbox.emptyRecycleBin` | false | 无参数 | :300-306 | — |
| `toolbox.clearClipboard` | false | 无参数 | :307-313 | — |
| `disk.repairSystemFiles` | **true** | kind ∈ [sfc, dism-restore] | :317-318 | `kind:'bootrec'` → badArgs |
| `dll.scan` | false | 无参数；未接入 dll → skipped | :325-338 | deps.dll 未注入 → skipped |
| `dll.repairMissing` | **true** | kinds ⊆ [sfc, dism-restore, vcredist-x64, vcredist-x86] | :343-345 | `kinds:['malware']` → badArgs |

**路径安全：** `disk.deepCleanup`（:284-289）和内置 `runDeepIds`（optlib.ts:160-169）都通过 `pickDeep(plans, ids)` 从服务端权威 scanDeepCleanup() 结果中解析路径，远端/客户端给不出任意路径。**（confirmed）**

#### 3.5 版本与降级防护

| 规则 | file:line | 说明 |
|---|---|---|
| 只增不减 | :635 | `compareVersions(manifest.libraryVersion, currentVersion) > 0` 才接受旧清单不会覆盖新版本 |
| 防降级测试 | test:409-419 | 已 apply 0.5.0 后，check 0.4.0 → updateAvailable=false |
| 损坏缓存忽略 | :529-537 | VERSION_RE 不通过或 schema 不符 → loadCached 返回 null → 回落内置 |

#### 3.6 拉取与缓存

| 规则 | file:line | 说明 |
|---|---|---|
| 超时 10s | :437, :449-450 | AbortController + setTimeout，finally clearTimeout |
| fetch 体积预检 | :459-461 | text.length > 256KB → throw（在 validateManifest 之前） |
| 持久化存储 key | :473 | `'capabilityLibrary'`，存于 electron-store |
| 缓存无 TTL | :529-537 | appliedAt 存储但从未用于过期判断；清单一旦 apply 永久生效，直到 check/apply/reset |

### 状态机/数据流

```
[初始] source='builtin', libraryVersion='0.0.0'
  │  check()（手动触发，无自动轮询）
  ├── 拉取失败/JSON非法/校验不通过 → lastError，source 不变
  └── 校验通过 + 版本更高 → pending=manifest, updateAvailable=true
        │  apply()（手动确认）
        ▼
[生效] storage.set → source='remote'，externalCapabilities/metaOverrides 即时生效
  │  reset()（手动回退）
  ▼
[回退] storage.set(null) → source='builtin'
```

**无自动检查/自动 apply**：CapabilityLibraryPanel.vue 只有用户点击"检查能力库更新"按钮才触发 check()，apply 也需用户手动确认。**（confirmed, CapabilityLibraryPanel.vue:35-75）**

### 安全边界汇总

| 红线 | 代码位置 | 机制 |
|---|---|---|
| 远端不下发可执行代码 | capabilityFeed.ts:26-30（注释）; :394-400（hasOwnProperty 白名单） | 远端只能引用 createRecipeRuntime 表中 8 个方法 |
| 内置实现不可替换 | :132-135; optlib.ts:317 | 内置 id 带 recipe → 拒绝；重名 → continue |
| needsAdmin 只收不松 | :408, :415, :560, :677-692; optlib.ts:308 | 三处独立守卫：配方编译 OR、mergedMetas OR、metaOverrides 不下发 |
| id 不截断/不碰撞 | :106-110（takeExact）; :210-213（seen 去重） | 超长直接拒绝，不静默截断 |
| 防降级 | :635 | 版本只增不减 |
| 体积/条目上限 | :46, :48, :50, :175, :195 | 多层防御 |
| 整份作废策略 | :168（注释） | 整体性错误宁可回落内置，不接受半可信清单 |
| **已知限制** | :30（注释） | 无签名校验 + 无沙箱；注释明确"做真正代码级热更新需签名+沙箱，属后续里程碑" |

### 改进建议

| # | 严重度 | 问题 | file:line | 理由与最小改动方案 |
|---|---|---|---|---|
| M-C1 | **中** | **state() 在 source='remote' 时不展示 validateManifest 阶段被拒的条目。** apply() 后，持久化的 manifest 只含校验通过的条目；state() 的 rejected 来自 compileRemoteCapabilities(已通过校验的 defs)（:588, :565-568），而 validateManifest 阶段 rejected 的条目（格式非法、minAppVersion 不够、id 重复等）不在 manifest 中，apply 后 `pendingRejected` 被 apply() 置 null（:656）。用户 apply 后切到"能力库"面板，看不到哪些条目被拒及原因。 | capabilityFeed.ts:588, :656 | **最小改动**：apply() 时把 pendingRejected 一并写入 CachedManifest（如 `rejectedAtApply: [...]`），state() 在 remote 时合并展示。或在 storage 中单独存一份上次校验的 rejected。约 5-8 行。 |
| M-C2 | **中** | **内置 needsAdmin 的"收紧"路径是 UI-only，执行层不生效。** mergedMetas（:560）对内置项计算 `needsAdmin: m.needsAdmin \|\| o.needsAdmin === true`，允许远端把内置项从 false 收紧为 true。但 metaOverrides()（:677-692）不下发 needsAdmin，optlib.resolveRegistry()（optlib.ts:308）也不接受覆盖。结果：CapabilityLibraryPanel 显示"需管理员"标签，但 OneKeyPanel（用 optlib.listCapabilities）不显示该标签，onekey 预检也不会跳过。UI 与执行行为不一致。 | capabilityFeed.ts:560, :685-689; optlib.ts:308 | **方案 A（推荐）**：mergedMetas 对内置项的 needsAdmin 改为 `m.needsAdmin`（纯本地值，不收紧），与 optlib 对齐。理由：optlib 注释已明确"提权边界只能由本地代码定义"，远端收紧是死代码。约改 :560 一行。**方案 B**：让 optlib 也接受"收紧"方向的 needsAdmin 覆盖。改动大，不推荐。 |
| L-C1 | 低 | `redirect: 'follow'`（:454）允许 fetch 跟随重定向到任意 URL。虽然初始 URL 受 env var 控制，且响应内容经过白名单校验，但重定向链上的中间 URL 不受限。 | capabilityFeed.ts:454 | 如需加固，改为 `redirect: 'manual'` 并手动校验 Location 头的 hostname。当前风险低（响应内容仍受白名单约束）。 |
| L-C2 | 低 | 缓存无 TTL：apply 后清单永久生效，除非用户手动 check/apply/reset。若远端清单被撤回或撤回某能力，本地不会自动感知。 | capabilityFeed.ts:529-537 | 增加定期 check（如启动后延迟 N 分钟自动 check 一次，仅更新 pending 不自动 apply）。当前无自动轮询是设计选择。 |
| L-C3 | 低 | `listRecipeCalls()`（:360-362）创建一个不带 dll deps 的新 runtime 来枚举键名。虽然键是静态对象字面量所以不影响结果，但语义上略有误导。 | capabilityFeed.ts:360-362 | 非必须，可改为导出静态数组。 |

---

## 交叉一致性核对：onekey ↔ optlib ↔ capabilityFeed

### 接口契约对齐

| 契约 | shared/types.ts | optlib 实现 | onekey 调用 | capabilityFeed 产出 | 一致？ |
|---|---|---|---|---|---|
| `listCapabilities(): OptCapabilityMeta[]` | :218 | :366-370 | :196 | —（metaOverrides 供 optlib 消费） | ✅ |
| `runSingle(id): OptOutcome` | :219 | :371 → runInContext | —（onekey 用 runInContext） | — | ✅ |
| `runInContext(ctx, id): OptOutcome` | — | :331-363 | :156, :255 | — | ✅ |
| `createContext(): OptContext` | — | :323-329 | :209 | — | ✅ |
| `externalCapabilities(): OptCapability[]` | —（deps 接口） | :315-319 消费 | — | :670-675 产出 | ✅ |
| `metaOverrides(): Map<id, OptCapabilityMetaPatch>` | :441-443（Omit needsAdmin） | :291-313 消费 | — | :677-692 产出 | ✅ |
| `OneKeyPhase` | :598 | — | :48, :272, :285 | — | ⚠ 含未使用的 'idle'（L-O3） |
| `OptOutcome` | :401-419 | :346-362 产出 | :84-96 消费 | — | ✅ |
| `OptCapabilityMetaPatch` | :441-443 Omit id/needsAdmin/source | :296-311 消费 | — | :685-689 产出 | ✅ |

### 装配证据链（main.ts）

```
main.ts:86-95  createCapabilityFeedService({...})
main.ts:97-108 createOptLibrary({
                 externalCapabilities: () => capabilityFeed.externalCapabilities(),  // :106
                 metaOverrides:       () => capabilityFeed.metaOverrides()           // :107
               })
main.ts:109-112 createOneKeyService({ library: optLibrary, ... })
main.ts:136    ipcMain.handle('optlib:listCapabilities', () => optLibrary.listCapabilities())
main.ts:137    ipcMain.handle('optlib:runSingle', (_e, id) => optLibrary.runSingle(String(id)))
main.ts:139-142 optlib:libraryState/checkLibrary/applyLibrary/resetLibrary → capabilityFeed
main.ts:144-149 onekey:start/cancel/retry/state → oneKeyService
main.ts:239-241 oneKeyService.onProgress → broadcast('onekey:progress')
```

**三处同步检查**（契约源 shared/types.ts → main.ts handler → preload）：
- optlib 4 接口（listCapabilities/runSingle/libraryState/checkLibrary/applyLibrary/resetLibrary）：preload.ts:27-34 全部映射 ✅（H1 已修）
- onekey 4 接口（start/cancel/retryFailed/state）+ onProgress：preload.ts:36-46 全部映射 ✅

### 不一致点汇总

| # | 不一致 | 影响 | 严重度 |
|---|---|---|---|
| X1 | 内置 needsAdmin 收紧路径 UI-only（M-C2） | CapabilityLibraryPanel 显示"需管理员"但 OneKeyPanel 不显示，onekey 预检不跳过 | 中 |
| X2 | retryFailed 运行中调用的并发间隙（M-O1） | 两轮交错，进度推送指向新 run | 中（UI 层已挡，IPC 层无守卫） |
| X3 | OneKeyPhase 含未使用的 'idle'（L-O3） | 类型声明与实现不符，无功能影响 | 低 |

---

## 前序评审修复确认

| 编号 | 原始问题 | 本次走读确认 |
|---|---|---|
| M8 | 一键优化并发竞态（守卫与占位间有 await 窗口） | ✅ 已修：`starting` 同步占位锁（onekey.ts:114, :188-189, :228-230），回归测试 onekey.test.ts:94-126 验证 |
| M9 | 远端可放宽 needsAdmin，两处口径不一致 | ✅ 已修：compiled 配方 `needsAdmin \|\| def.needsAdmin===true`（:415）；mergedMetas `m.needsAdmin \|\| o.needsAdmin===true`（:560）；metaOverrides 不下发 needsAdmin（:685-689）；optlib 不接受覆盖（:308）。**但发现新的不一致（X1/M-C2）：收紧方向是 UI-only** |
| H1 | preload 未实现 optlib 四接口 | ✅ 已修：preload.ts:30-33 补齐 libraryState/checkLibrary/applyLibrary/resetLibrary |

---

## 已知限制（如实标注，非缺陷）

- 远端清单无签名校验（capabilityFeed.ts:30 注释明确，属后续里程碑）。**（confirmed）**
- 无自动定期 check/apply，全靠用户手动触发。**（confirmed）**
- ARM64 三平台实机待验证。**（inferred，来自项目说明）**
- 配方 `disk.deepCleanup` 不路由到 admin set（M-O2），admin-only 深度清理项在配方中无法执行。**（confirmed）**


# 旗舰走读之二：更新状态机与 elevate 提权模块

> 走读日期：2026-09-17 ｜ 项目：疾风引擎 gale-engine v0.1.10（Electron33 + Vue3 + TS strict）
> 走读方式：逐行打开源码核对，所有结论带 `file:line` 证据。事实标注：`[confirmed]`=源码直接可见；`[inferred]`=由代码语义推断；`[unknown]`=无法从源码确证。
> 基线：`docs/code-review-2026-09-16.md` 的 H1+M1–M10+L1–L12 已全部修复，本文只确认修复是否真闭合、不重复上报已关闭项。

---

## 0. 模块总览与端到端接线核对

### 0.1 调用链全景（confirmed）

```
渲染进程 (Vue3)
  └─ useAppUpdate.ts (单例镜像)
       ├─ check()        → window.gale.app.checkUpdate()
       ├─ install()      → window.gale.app.installUpdate()
       ├─ setPrefs()     → window.gale.app.setUpdatePrefs()
       └─ onUpdateEvent  ← window.gale.app.onUpdateEvent(cb)   (主进程→渲染广播)
            │
            ▼ contextBridge (preload.ts)
  window.gale.app.*  ── ipcRenderer.invoke / ipcRenderer.on
            │
            ▼ 主进程 (electron/main.ts)
  ipcMain.handle('app:checkUpdate', …)        → updateService.checkUpdate()
  ipcMain.handle('app:getUpdateState', …)     → updateService.state()
  ipcMain.handle('app:getUpdateCapability',…) → updateService.capability()
  ipcMain.handle('app:getUpdatePrefs', …)      → appPrefsService.get()
  ipcMain.handle('app:setUpdatePrefs', …)      → appPrefsService.set() + updaterApi.configure()
  ipcMain.handle('app:installUpdate', …)      → updateService.installUpdate()
  ipcMain.handle('app:isElevated', …)         → elevator.isElevated()
  ipcMain.handle('app:restartElevated', …)    → elevator.restartElevated()
  ipcMain.handle('app:openExternal', …)       → isAllowedExternal() + shell.openExternal
  updateService.onState(state → broadcast('app:update', state))   ← 主→推渲染
            │
            ▼ 纯逻辑服务层
  createUpdateService(updaterApi)             [update.ts]
  createElectronUpdaterApi()                  [update.electron.ts] → electron-updater autoUpdater
  detectUpdateCapability()/interpretCheckResult()/describeUpdateError()  [update.capability.ts]
  createElevator(deps)                        [elevate.ts]
  createElectronElevator(runner)              [elevate.electron.ts]
```

### 0.2 三处同步契约核对（confirmed）

| 契约字段 | shared/types.ts | preload.ts | main.ts handler | 一致？ |
|---|---|---|---|---|
| `app.checkUpdate` | types.ts:313 | preload.ts:102 | main.ts:207 | ✅ |
| `app.getUpdateState` | types.ts:315 | preload.ts:103 | main.ts:208 | ✅ |
| `app.getUpdateCapability` | types.ts:317 | preload.ts:104 | main.ts:209 | ✅ |
| `app.onUpdateEvent` | types.ts:319 | preload.ts:107-111 | main.ts:244-246(广播) | ✅ |
| `app.getUpdatePrefs` | types.ts:321 | preload.ts:105 | main.ts:210 | ✅ |
| `app.setUpdatePrefs` | types.ts:323 | preload.ts:106 | main.ts:211-216 | ✅ |
| `app.installUpdate` | types.ts:325 | preload.ts:112 | main.ts:217-219 | ✅ |
| `app.isElevated` | types.ts:331 | preload.ts:115 | main.ts:222 | ✅ |
| `app.restartElevated` | types.ts:333 | preload.ts:116 | main.ts:223 | ✅ |
| `app.openExternal` | types.ts:339 | preload.ts:117 | main.ts:224-235 | ✅ |

结论：更新与提权的 IPC 三处契约**完全同步，无脱节** [confirmed]。preload 暴露的 `app` 命名空间（preload.ts:100-118）与 `GaleApi['app']`（types.ts:309-340）逐项对齐。

---

## 1. 模块：update.ts —— 纯逻辑更新状态机

- **文件路径**：`electron/services/update.ts`；关键导出 `createUpdateService` (update.ts:98)、`UpdateService` 接口 (update.ts:47)、`UpdaterApi` 接口 (update.ts:11)、`UpdaterEvent` 类型 (update.ts:39)、`DEFAULT_CAPABILITY` (update.ts:67)。
- **职责一句话**：把底层 `UpdaterApi`（electron-updater 的抽象）的事件与 Promise 返回值，归一化为前端友好的 `AppUpdateResult` 状态机；不依赖 Electron/网络，可注入假实现单测。

### 1.1 关键链路

`trigger(渲染层 checkUpdate / 主进程启动静默自检 / onState 事件) → 运行时装配(createUpdateService 注入 updater + deps) → 变换/状态(emit patch current) → 边界(canAutoUpdate 拦截 / 下载态守卫 / silent 抑制) → 可观察结果(state() 快照 + onState 订阅广播到渲染层)`

- 装配：`createUpdateService(updater, deps)`，`deps` 可注入 `now/sleep/retries/retryDelayMs`（update.ts:74-83），测试用 `noWait`（update.test.ts:56）。
- 初始状态：`{ status:'idle', currentVersion, capability, at }`（update.ts:109-114）[confirmed]。
- `emit(patch)`：合并 patch 到 current、刷新 `at`、深拷贝推给所有订阅者；**订阅者回调异常被 try/catch 隔离**，不中断状态机（update.ts:116-126）[confirmed]。

### 1.2 完整更新状态机（本任务重点）

**状态枚举**（types.ts:738-754）：`idle | checking | up-to-date | available | downloading | downloaded | unsupported | error`

#### 进入条件、转移边、终止条件、触发者

| 状态 | 进入条件（代码位置） | 出边转移 | 终止条件 | 触发者 |
|---|---|---|---|---|
| **idle** | 初始（update.ts:109-114） | →checking / →unsupported | 永不终止（初始态） | 服务构造 |
| **checking** | `canAutoUpdate=true` 且非下载态时 `checkUpdate()` 发出 `emit({status:'checking',silent,error:undefined})`（update.ts:179）；底层事件 `checking` 仅在 `!current.silent` 时补发（update.ts:136） | →available（有更新）/ →up-to-date（无更新）/ →error（重试耗尽）/ 被事件推进到 downloading | checkForUpdates Promise resolve/reject | 渲染层点「检查更新」(update.ts:167) / 启动静默自检(main.ts:266) |
| **up-to-date** | `checkForUpdates()` 返回 `isUpdateAvailable=false`（update.ts:196） | 无出边（终态，等下次 checkUpdate 重新进 checking） | 终止（用户下次手动/后台检查才离开） | checkUpdate 循环成功返回 |
| **available** | `isUpdateAvailable=true` 且带版本号（update.ts:193）；或底层 `update-available` 事件（update.ts:138-140） | →downloading（progress 事件）/ →downloaded（downloaded 事件，快下载跳帧） | autoDownload=true 时瞬态；autoDownload=false 时**停留在此态**（见 1.4 隐患） | checkUpdate / 底层事件 |
| **downloading** | 底层 `download-progress` 事件（update.ts:141-148），percent 经 `clampPercent` 钳到 0-100 一位小数（update.ts:85-88） | →downloaded（downloaded 事件）/ →error（非静默 error 事件） | downloadProgress 流结束 | electron-updater 事件 |
| **downloaded** | 底层 `update-downloaded` 事件，percent=100（update.ts:150-151） | **无出边**（终态，等用户点 installUpdate）；installUpdate 调 `quitAndInstall(false,true)` 退出进程（update.ts:211-213） | 终止（进程退出安装） | electron-updater 事件 / 用户点安装 |
| **unsupported** | `!cap.canAutoUpdate` 时 checkUpdate 立即返回（update.ts:170-176），**不发网络请求**（test: update.test.ts:146 断言 checkCalls===0） | 无出边（终态） | 终止 | checkUpdate 前置拦截 |
| **error** | 重试耗尽（update.ts:203）；或非静默时底层 error 事件（update.ts:153-156） | 无自动出边（用户手动「重试」→ 再进 checking） | 终止（用户重试才离开） | checkUpdate catch / 底层 error 事件 |

#### 关键守卫与抑制逻辑

1. **下载态不被回退**（update.ts:164-165 `isDownloadedOrDownloading()`）：
   - 进入 checkUpdate 时若已在下载/已下载，**不**擦成 checking（update.ts:178-179）。
   - checkForUpdates 返回有更新时，若版本一致且已在下载，直接 `return {...current}` 不覆盖（update.ts:190-191）。
   - 若无更新但已在下载，也 `return {...current}`（update.ts:195）。
   - 测试 update.test.ts:171-179 确认「已下载时检查结果不回退到 available」[confirmed]。

2. **silent 抑制**：
   - 静默自检不把界面切到 checking（update.ts:136 `if (!current.silent)`）。
   - 静默期间底层 error 事件不进入用户可见 error 态（update.ts:155）。
   - 静默检查**不重试**（update.ts:181 `attempts = silent ? 1 : retries+1`）。
   - 测试 update.test.ts:125-131（静默不重试）、:181-187（静默 error 不打扰）[confirmed]。

3. **重试**：前台默认 `retries=2` 共 3 次尝试，间隔 `retryDelayMs=1200ms`（update.ts:104-105, 184-201）；测试 :108-123 [confirmed]。

### 1.3 安全边界

- 状态机本身不执行外部代码，只归一化底层结果 [confirmed]。
- `installUpdate()` 固定 `quitAndInstall(false, true)`（非静默、安装后重启应用）（update.ts:212）；UI 层仅在 `ready`（downloaded）时才显示安装按钮（UpdateCard.vue:84 `v-if="ready"`）[confirmed]。
- 不下发默认偏好——偏好由主进程从持久化读取后经 `updaterApi.configure()` 注入，避免默认值覆盖用户设置（update.ts:128-129 注释）[confirmed]。

### 1.4 隐患与改进建议

- **【中】`available` 态在 `autoDownload=false` 时无手动下载出口**
  - 问题：`UpdaterApi` 接口（update.ts:11-36）**没有 `downloadUpdate()` 方法**；IPC 也没有 `app:downloadUpdate` handler（main.ts:207-219 只有 check/getState/getCapability/getPrefs/setPrefs/install）。当用户关闭「发现新版本后自动下载」（prefs.autoDownload=false），`checkUpdate()` 会停在 `available` 态（UpdateCard.vue:159 显示「正在下载…」文案，但实际并未下载），而 `installUpdate()` 直接调 `quitAndInstall`——此时未下载完成，electron-updater 行为未定义（可能直接退出不安装）。文案「正在下载…」与实际未下载**自相矛盾**。
  - 理由：默认 autoDownload=true（settings.ts:8）掩盖了此路径，但用户一旦关闭自动下载就进入死态。
  - 最小改动方案：在 `UpdaterApi` 增加 `downloadUpdate(): Promise<void>`（update.electron.ts 里映射 `autoUpdater.downloadUpdate()`），main.ts 增 `app:downloadUpdate` handler + preload 暴露；UpdateCard 在 `autoDownload=false && status==='available'` 时把「正在下载…」改为「立即下载」按钮。涉及 update.ts:35 接口、update.electron.ts:71 return、main.ts:217 附近、preload.ts:112 附近、UpdateCard.vue:159。

- **【低】error 态残留下载进度字段**
  - 问题：下载中断进入 error 时，`emit({status:'error',error})`（update.ts:155）只 patch status/error，不清理 percent/transferred/total/version。当前 UI 的 `percent` computed 仅在 `status==='downloading'` 时取值（useAppUpdate.ts:145-147），故不可见；但 `state()` 快照会带陈旧下载字节，若未来 UI 误读会出错。
  - 最小改动方案：error 分支补 `transferred:undefined,total:undefined,bytesPerSecond:undefined`（update.ts:155）。

- **【低】跨版本下载竞争未完全守卫**
  - 问题：update.ts:190 的守卫要求 `current.version === version`；若下载中发现了**不同**版本号的更新，会穿透到 line 193 用新版本覆盖下载态。实际 electron-updater 同会话内不会并发两个版本，属理论边界。
  - 最小改动方案：line 190 改为「已在下载/已下载即返回 current」，不比较版本（版本变更本就极罕见）。

---

## 2. 模块：update.electron.ts —— electron-updater 适配层

- **文件路径**：`electron/services/update.electron.ts`；关键导出 `createElectronUpdaterApi` (update.electron.ts:17)，并 re-export `detectUpdateCapability/describeUpdateError`（:7）。
- **职责一句话**：包装 electron-updater 单例 `autoUpdater`，配置自动下载/安装策略，把其原生事件归一化为 `UpdaterEvent` 推给状态机。

### 2.1 关键链路

`createElectronUpdaterApi() → detectUpdateCapability({platform,isPackaged,appImagePath}) → 配置 autoUpdater(allowDowngrade=false/autoDownload=true/autoInstallOnAppQuit=true/disableWebInstaller=true) → 订阅 6 个原生事件归一化为 UpdaterEvent → 返回 UpdaterApi 实现`

- 配置证据（confirmed）：
  - `allowDowngrade=false`（update.electron.ts:25）——防止手动装旧版被自动推回新版。
  - `autoDownload=true`、`autoInstallOnAppQuit=true`、`autoRunAppAfterInstall=true`（:26-28）。
  - Windows 强制 `disableWebInstaller=true`（:31，try/catch 兜底非 NSIS 平台无此属性）——只走静默 NSIS 包，不走需浏览器交互的 web 安装器。
- 事件映射（confirmed）：`checking-for-update→checking`(:47)、`update-available→available`(:48-50)、`update-not-available→none`(:51)、`download-progress→progress`(:52-60)、`update-downloaded→downloaded`(:61-63)、`error→error`（message 经 `describeUpdateError` 翻译，:64-69）。
- `checkForUpdates()` 用 `.then(interpretCheckResult)` 把易踩错的返回值统一解释（:76）。
- `configure(prefs)` 把 `autoDownload`/`autoInstallOnQuit` 下发（:85-88）。

### 2.2 状态机/数据流

本层不维护状态，只做「原生事件 → UpdaterEvent」的翻译与转发；状态机在 update.ts。`update-not-available` 被翻译成 `none` 事件，而 update.ts 显式忽略 `none`（update.ts:157-160）——因为「无更新」由 `checkForUpdates()` 的 Promise 返回值统一处理，避免事件与 Promise 两处互相覆盖 [confirmed]。

### 2.3 安全边界

- `autoUpdater` 是单例，注释明确「只应在主进程初始化时调用一次」（:15）[confirmed]。
- 错误事件 message 必经 `describeUpdateError` 翻译，不把原始技术错误直接抛给用户（:67）。
- 订阅者异常隔离（:38-44 try/catch）。

### 2.4 改进建议

- 未发现明显问题。配置项与注释自洽，事件归一化完整覆盖 electron-updater 主要生命周期。

---

## 3. 模块：update.capability.ts —— 平台能力探测与错误翻译（纯函数）

- **文件路径**：`electron/services/update.capability.ts`；关键导出 `detectUpdateCapability` (:17)、`interpretCheckResult` (:78)、`describeUpdateError` (:91)。
- **职责一句话**：纯函数（无 Electron 依赖，可单测），负责平台/安装方式的自更新能力探测、`checkForUpdates()` 返回值的正确解释、原始错误到可行动文案的翻译。

### 3.1 关键链路

`detectUpdateCapability({platform,isPackaged,appImagePath}) → UpdateCapability{canAutoUpdate,platform,packageKind,reason}`

**平台能力矩阵**（confirmed，update.capability.ts:23-65）：

| 平台 | 打包后判定 | packageKind | canAutoUpdate | 原因/说明 |
|---|---|---|---|---|
| 未打包（任一） | `!isPackaged`（:26-33） | unknown | false | 开发模式无更新源 |
| win32 | :35-37 | nsis | true | NSIS 安装包（perMachine 用户目录）支持应用内自更新 |
| darwin | :39-42 | mac-zip | true | electron-updater **只认 zip**，dmg 是给人手动拖拽的；签名失败由错误翻译兜底 |
| linux + 有 APPIMAGE 环境变量 | :44-47 | appimage | true | AppImage runtime 注入 `APPIMAGE` 定位自身文件，可自更新 |
| linux 无 APPIMAGE（deb/rpm） | :48-56 | deb | false | 归系统包管理器管辖，诚实降级并指引 `sudo apt …` 或改用 AppImage |
| 未知平台 | :59-64 | unknown | false | `当前平台（x）不支持` |

**为什么 deb 不支持自更新而 AppImage 支持** [confirmed，注释 :14-15]：AppImage 是单文件自包含格式，electron-updater 靠 `APPIMAGE` 环境变量定位自身文件并原子替换；deb/rpm 安装到系统目录归包管理器所有，应用内无权也不应自行覆盖，故诚实降级。这是上游能力边界，非本项目缺陷（与 code-review 已知限制一致）。

### 3.2 interpretCheckResult 语义逐行讲清（update.capability.ts:78-88）

这是本模块最关键、最易踩错的函数。注释（:67-77）明确区分**两种「没有更新」**：

1. `res == null / undefined` → 更新器未启用（未打包或 `isUpdaterActive()=false`）→ 返回 `{isUpdateAvailable:false}`（:81）。
2. `res.isUpdateAvailable === false` → **确实已是最新**，此时 `res.versionInfo` 装的是仓库最新版信息，**不是**「有可更新版本」→ 绝不能拿 versionInfo 存在与否判断有无更新 → 返回 `{isUpdateAvailable:false}`（:81）。
3. `isUpdateAvailable=true` 但 `versionInfo.version` 为空/未定义/空串 → 声称有更新却没版本号，**按无更新处理比误报更安全**（:83-86）。
4. 正常有更新 → `{isUpdateAvailable:true, updateInfo:{version}}`（:87）。

回归测试（update.capability.test.ts:77-106）：曾因「非 null 即视为有更新」导致「已是最新」永不出现、永远误报有新版；现在 `isUpdateAvailable=false` 即使带 versionInfo 也不误报（:84-91）[confirmed]。

### 3.3 describeUpdateError 错误翻译覆盖（update.capability.ts:91-106）

| 正则匹配 | 翻译为 | 覆盖类别 |
|---|---|---|
| `code signature/signature invalid/not signed/could not get code signature` | macOS 未签名，请到 Release 手动下 dmg | **签名**（:93-95） |
| `net::/ENOTFOUND/ETIMEDOUT/ECONNREFUSED/ECONNRESET/socket hang up/getaddrinfo/fetch failed` | 网络不可达，请检查网络/代理 | **网络**（:96-98） |
| `404/Cannot find/not found/no published versions/latest*.yml` | 更新源缺当前平台 latest*.yml，确认 Release 已发包 | **元数据缺失**（:99-101） |
| `EPERM/EACCES/permission/拒绝访问` | 无权限写安装目录，请以管理员身份运行 | **权限**（:102-104） |
| 其余 | 原样返回，不丢信息（:105） | 兜底 |

测试 update.capability.test.ts:50-74 四类均覆盖 [confirmed]。

### 3.4 update.capability.ts 与主更新链路的关系

`update.capability.ts` 是**纯函数层**，被 `update.electron.ts` 引用：
- `detectUpdateCapability` 在 `createElectronUpdaterApi()` 启动时调用一次，结果挂到 `UpdaterApi.capability`（update.electron.ts:18-22, 73）。
- `interpretCheckResult` 包装 `checkForUpdates()` 返回值（:76）。
- `describeUpdateError` 用于 error 事件翻译（:67）。

它**不是**「能力化更新（capability-based update）」——即不是远端下发能力清单那种热更新通道；那个是 `capabilityFeed.ts`/`optlib.ts`（本项目的「DLL 热更新」）。此处的 "capability" 仅指**平台自更新能力探测**（能不能自更新、走哪种包），用于诚实地把不支持的平台降级到 `unsupported` 态。两者命名相近但职责完全不同 [inferred from code structure]。

### 3.5 安全边界

- 纯函数无副作用、无 I/O 注入面 [confirmed]。
- 错误翻译只追加上下文，不吞掉原始 message（各分支都把 `${m}` 拼进结果，:97/100/103）[confirmed]。

### 3.6 改进建议

- **【低】错误翻译未覆盖磁盘满（ENOSPC）与用户取消下载**
  - 问题：`describeUpdateError`（:91-106）四类正则未匹配 `ENOSPC/no space left`，也未区分 electron-updater 的「用户取消」。这类错误会落到兜底原样返回，用户看到英文技术串。
  - 理由：磁盘满在下载大包时可能出现；当前不算静默失败（原样返回了），仅体验粗糙。
  - 最小改动方案：在 :101 后加一条 `/ENOSPC|no space/i` → '磁盘空间不足，无法下载更新，请清理磁盘后重试：${m}'。

---

## 4. 模块：elevate.ts —— 纯逻辑提权模块

- **文件路径**：`electron/services/elevate.ts`；关键导出 `createElevator` (:199)、`buildIsElevatedScript` (:83)、`parseIsElevated` (:95)、`buildElevatedRunScript` (:107)、`buildRelaunchElevatedScript` (:145)、`macAppPath` (:164)、`safeUnlink`（内部 :211）、`sweepStaleTemp`（内部 :229）、`TMP_PREFIX` (:44)、`STALE_TEMP_MS` (:47)。
- **职责一句话**：以 asInvoker 启动 + 按需 `ShellExecute(runas)`（Windows 弹 UAC）/pkexec/sudo（unix）提权执行脚本，并回收输出、清理临时文件。

### 4.1 关键链路

`createElevator({runner,platform,io,tmpDir,exePath,quit}) → isElevated()/runElevated(script)/restartElevated()`

**runElevated 完整流程**（elevate.ts:259-307）：
1. 进程级只做一次 `sweepStaleTemp()`（:260-263，`swept` 标志 :257）。
2. 生成唯一 id，拼出 `gale-elev-<id>.{ps1|sh}` / `.out` / `.err` 三条临时路径（:264-267）。
3. Windows 写 payload 时**显式加 BOM**（:271）——因 PS5.1 读无 BOM 的 .ps1 按 GBK 解码，中文路径会乱码/解析失败。
4. 构造外层提权脚本 `buildElevatedRunScript`：
   - win32（:114-124）：`Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput <out> -RedirectStandardError <err> -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File' <scriptPath>; exit $p.ExitCode`。
   - unix（:126-137）：优先 `pkexec bash <script>`，次选 `sudo -n bash <script>`，都无则 `echo "ERR: …" >&2; exit 127` 诚实降级。
5. 普通权限 `runner.run(outer)` 执行外层（:276）。
6. win32 从落盘文件读 stdout/stderr（:278-290）；**非零退出且无输出**推断为「用户取消了 UAC」（:292-294）；unix 直接用 runner 回收结果（:298-299）。
7. `finally` 里 `safeUnlink` 逐项清理（:300-306）。

### 4.2 提权边界与临时文件清理语义

- **asInvoker 启动 + ShellExecute runas 按需提权** [confirmed，注释 :9-19]：
  - 打包清单 `requestedExecutionLevel` 用 asInvoker，双击不弹 UAC（保证开机自启/自动更新可用）。
  - 运行时不能给自己提权，故通过 `Start-Process -Verb RunAs` 拉起**子进程**提权执行。
  - 高权限项（SFC/DISM/WinSxS/更新缓存）走 `adminRunner`（main.ts:71 包装 `elevator.runElevated`），不要求整个应用常驻管理员。

- **safeUnlink 逐项互不拖累**（elevate.ts:211-219）：for 循环逐个 `io.unlink`，单个 catch 不影响其余 [confirmed]。

- **sweepStaleTemp 兜底残留**（elevate.ts:229-255）：
  - 背景（注释 :221-228）：Windows `RunAs -Wait` 时 UAC 长时间无应答/进程被杀，`finally` 不执行，临时脚本（含本机路径）永久残留 %TEMP%。
  - 只清理 `TMP_PREFIX='gale-elev-'` 前缀（:240）、且 `now - mtime >= STALE_TEMP_MS(1h)`（:243）的文件——**避免误删并发实例正在用的新文件**。
  - 读不到 mtime 时 `continue` 不动它（:244-246，「宁可留着也不误删」）。
  - IO 不支持 list/mtime 时直接返回 0 不报错（:230）。
  - 测试 elevate.test.ts:165-254 全量覆盖：清理陈旧/保留新文件/保留无关文件/读不到时间不删/不支持列目录不报错/进程级只扫一次 [confirmed]。这正是 L7 修复的落地。

### 4.3 needsAdmin 如何被收紧、为何不允许远端修改

本模块（elevate.ts）本身不涉及 needsAdmin；needsAdmin 收紧发生在**能力库层**（capabilityFeed.ts / optlib.ts），与 elevate 配合形成「提权边界只收不松」：

- **类型层编译期排除**：`OptCapabilityMetaPatch = Partial<Omit<OptCapabilityMeta, 'id' | 'needsAdmin' | 'source'>>`（types.ts:441-443）——远端补丁类型**根本不含 needsAdmin 字段** [confirmed]。
- **运行期合并只收不松**：
  - 内置能力合并远端元信息时：`needsAdmin: m.needsAdmin || o.needsAdmin === true`（capabilityFeed.ts:560）——内置已声明 needsAdmin=true 时，远端无法改成 false（OR 语义只能收紧不能放宽）。
  - 远端配方能力：`needsAdmin: needsAdmin || def.needsAdmin === true`（capabilityFeed.ts:415）——步骤实现已声明 needsAdmin 时同样不放宽。
  - `metaOverrides()` 显式不下发 needsAdmin（capabilityFeed.ts:682-684 注释：继续下发只会成死数据）。
  - optlib 注释（optlib.ts:308）：「needsAdmin 有意不参与覆盖：提权边界只能由本地代码定义」。
- **为何不允许远端修改** [confirmed，capabilityFeed.ts:25-29 注释]：若远端能把 `disk.repairSystemFiles`/`dll.repairMissing`（needsAdmin=true）声明为 false，一键优化预检据此放行 → 未提权时触发 UAC 弹窗轰炸，违背「不轰炸 UAC」设计；且远端配置可能被篡改，放开提权边界等于给远程提权开后门。

### 4.4 restartElevated 语义（elevate.ts:309-331）

- 已提权 → 直接返回 `{ok:true, 无需重启}`（:311-313）。
- 构造提权重启脚本：win32 `Start-Process <exe> -Verb RunAs`（:151）；darwin `osascript … open -a <app> with administrator privileges`（:155，先经 `macAppPath` 从二进制路径还原 .app，:164-168）；linux 返回 null 并诚实提示「请手动 sudo 启动，应用内不代持 root 凭据」（:316-321）。
- 成功后调 `deps.quit?.()` 退出旧实例，由系统拉起新实例（:329）。
- 失败时 `stderr.trim() || 默认文案` 诚实回执（:325-327），不静默 OK。

### 4.5 安全边界

- 脚本注入面：`psSingleQuote`（:23-25）把 `'` 转 `''`、`shq`（:28-30）把 `'` 转 `'\''`，外层脚本路径参数字面量转义 [confirmed]。
- 临时文件前缀固定 `gale-elev-`，清理不越界（:240）[confirmed]。
- UAC 取消识别：`code!==0 && !stdout && !stderr` → 明确文案（:292-294），不假成功 [confirmed]。
- `parseIsElevated`：退出码非 0 保守按「未提权」处理（:96），不冒进 [confirmed]。
- 提权脚本只执行**本地传入的 script 字符串**，不接受远端 URL/远程载荷；远端能力库只能编排白名单方法（见 4.3）[confirmed]。

### 4.6 隐患与改进建议

- **【低】UAC 取消启发式可能误判合法失败**
  - 问题：elevate.ts:292 用「非零退出且无输出」推断 UAC 取消。若提权子脚本本身执行失败且**完全不产生任何 stdout/stderr**（例如脚本第一行就抛错、且外层 -Redirect 重定向文件为空），会被误标为「用户取消了 UAC 授权，或提权执行失败」。
  - 理由：该文案已用「或提权执行失败」兜底语义（:293），用户不会得到假成功，仅诊断略模糊。
  - 最小改动方案：在 :293 文案补一句「（若已确认授权，请查看脚本输出）」，或让外层脚本把 `$p.ExitCode` 也写进 err 文件以便区分。

- **【低】runElevated 未对并发提权次数做上限**
  - 问题：`sweepStaleTemp` 进程级只跑一次，但并发 `runElevated` 不限制。若渲染层短时间触发多个高权限项，会叠加多个 UAC 弹窗。
  - 理由：当前调用方（optlib/onekey）有预检与排队；属理论面。
  - 最小改动方案：可在 `createElevator` 内加一个简单的串行队列，或由 onekey 的 `starting` 占位锁（M8 修复）继续兜底——现状已可接受。

---

## 5. 端到端一致性交叉核对（update ↔ elevate ↔ preload ↔ useAppUpdate ↔ UpdateCard）

### 5.1 主进程装配（main.ts，confirmed）

- 更新：`updaterApi = createElectronUpdaterApi()`（main.ts:59）→ `updateService = createUpdateService(updaterApi)`（:60）→ `updaterApi.configure?.(appPrefsService.get())`（:62）下发持久化偏好。
- 启动静默自检：`scheduleStartupUpdateCheck()`（:262-272）——仅当 `autoCheck` 开且 `canAutoUpdate` 为真，延迟 8000ms（:275），`checkUpdate({silent:true})`，`timer.unref()` 不阻止退出。
- 状态广播：`updateService.onState(state → broadcast('app:update', state))`（:244-246），所有窗口一致。
- 提权：`elevator = createElectronElevator(runner)`（:70）；`adminRunner = {run: s => elevator.runElevated(s)}`（:71）；`adminDiskService = createDiskService(adminRunner, platform)`（:73）供 SFC/DISM/DLL 修复复用。
- openExternal 白名单：`ALLOWED_EXTERNAL_HOSTS`（:282-288）含 `github.com` 等；`isAllowedExternal` 强制 `protocol==='https:'` 且 hostname 在集合内（:290-297）。UpdateCard 的 `releasesUrl='https://github.com/afdk1991/gale-engine/releases/latest'`（UpdateCard.vue:26）命中白名单 [confirmed]。

### 5.2 渲染层单例（useAppUpdate.ts，confirmed）

- 模块级 `state/capability/prefs/prefError/checking` 单例 ref（:14-20），`inited` 防重复初始化（:22, :30-31）。
- `init()`：依次拉 capability → state 快照 → prefs → 订阅 onUpdateEvent，每步 try/catch 独立降级（:34-57）。
- 订阅回调里 `if (s.status !== 'checking') checking.value = false`（:53）——主进程推终态即解除前台 busy。
- `check()` 不向上抛异常（:67-85），失败收敛成 `{status:'error'}`——与 L3 修复一致（UpdateCard/Settings 已有 try/catch）。
- `setPrefs` 失败时 prefs 保持原值并记 `prefError`，UI 据此回滚勾选（UpdateCard.vue:58 显式拨回 `el.checked`），不制造「看着开了其实没开」[confirmed]。
- computed 派生：`busy=checking||downloading`（:139）、`hasUpdate=available||downloading`（:140-142）、`ready=downloaded`（:143）、`supported=canAutoUpdate!==false`（:144）、`canCheck=!busy&&!ready`（:173）。
- 两处使用：Home.vue:133 `<UpdateCard compact />`（首页内嵌，隐藏偏好与包格式）；Settings.vue:96 `<UpdateCard />`（完整，含偏好开关）[confirmed]。

### 5.3 状态文案与 UI（UpdateCard.vue，confirmed）

- `label` computed（useAppUpdate.ts:149-171）八态全覆盖：idle/checking/up-to-date/available/downloading/downloaded/unsupported/error。
- 注意文案 `available` 显示「发现新版本 vX，**正在下载…**」（:159）——这在 autoDownload=true 时属实，但 autoDownload=false 时与 1.4 隐患一致。
- 进度条 `v-if="percent!==null"`（:76）带 `role="progressbar"` 与 aria 值；错误/unsupported/下载完成三档 hint 分别用 bad/warn/ok 色（:89-91）。
- `openReleases` 已有 try/catch（:44-50），对应 L3 修复 [confirmed]。

### 5.4 与 code-review 已修复项的闭合确认

| 编号 | 修复项 | 本走读确认 |
|---|---|---|
| M9 | 远端不可放宽 needsAdmin | ✅ 类型 `OptCapabilityMetaPatch` 编译期剔除 needsAdmin（types.ts:441-443）；运行期 OR 只收不松（capabilityFeed.ts:560/415）；metaOverrides 不下发（:682）。真闭合。 |
| L3 | UpdateCard/Settings 无 try/catch | ✅ UpdateCard.openReleases（:45-49）、Settings.restartElevated（:30-36）/toggleAutoLaunch（:42-49）均有 try/catch。真闭合。 |
| L7 | UAC 无响应临时文件残留 | ✅ safeUnlink（elevate.ts:211）+ sweepStaleTemp（:229）+ 进程级一次（:257-263）+ 测试覆盖（elevate.test.ts:165-254）。真闭合。 |
| 已知限制 | Linux deb 不可自更新 | ✅ detectUpdateCapability 诚实降级（update.capability.ts:48-56），UI unsupported 态展示原因（UpdateCard.vue:89）。如实标注，非缺陷。 |

---

## 6. 枚举状态机隐患汇总（partial-success / error-swallowed / 无转移边）

| 隐患类别 | 位置 | 现状 | 严重度 |
|---|---|---|---|
| **死态（无出边）** | `available` + autoDownload=false | 无手动下载出口（见 §1.4） | 中 |
| **无出边终态** | `downloaded` / `error` / `up-to-date` / `unsupported` | 均为设计终态，靠用户动作离开；合理 | 健康 |
| **error-swallowed（静默失败）** | 静默自检 error（update.ts:155） | 有意抑制，带 silent 标记，非静默仍报错；有测试锁定 | 健康（设计如此） |
| **error-swallowed（订阅者异常）** | emit/onEvent try/catch（update.ts:119-123, 217-221） | 隔离订阅方异常，保护状态机；有测试（:224-235） | 健康 |
| **partial-success** | checkUpdate 重试 | 部分失败重试、最终 error 带 lastError；不出现「半截成功」 | 健康 |
| **partial-success** | runElevated UAC 取消 | 非零+无输出→明确文案，不假成功（elevate.ts:292） | 健康 |
| **陈旧字段残留** | error 态残留 percent/version（update.ts:155） | UI 不读，但快照带脏字段 | 低 |
| **错误翻译缺口** | 磁盘满/用户取消未分类（update.capability.ts:91） | 原样返回不静默 | 低 |

---

## 7. 总体结论

更新状态机（update.ts + update.electron.ts + update.capability.ts）与 elevate 提权模块（elevate.ts + elevate.electron.ts）的**纯逻辑/适配分层清晰**，平台能力探测、返回值解释、错误翻译均有纯函数单测锁定，关键历史 bug（「已是最新误报有更新」、UAC 临时文件残留、needsAdmin 远端放宽、静默失败）均已真闭合。端到端 IPC 三处契约（types.ts→main.ts→preload）完全同步，渲染层单例镜像与 UpdateCard/Settings/Home 接线一致。

**最值得跟进的一处中风险**：`autoDownload=false` 时 `available` 态缺少手动下载触发（§1.4），导致「正在下载…」文案与实际不符。其余为低严重度打磨项。


# Section 3 — PAL 与系统监控类服务模块逐行走读

- 走读日期：2026-09-17
- 项目：疾风引擎 gale-engine v0.1.10（Electron 33 + Vue3 + TS strict）
- 走读文件：`electron/services/shell.ts`、`actionResult.ts`、`desktopEntry.ts`、`monitor.ts`、`hardware.ts`、`process.ts`、`network.ts`（及同名 `.test.ts`）
- 对照文档：`docs/code-review-2026-09-16.md`（H1+M1–M10+L1–L12 共 23 项已修复，本节仅核实修复是否闭合）
- 事实标记：**confirmed**（源码逐行核对）/ **inferred**（注释或文档推断）/ **unknown**（未找到装配证据）

---

## 3.1 shell.ts — 平台抽象层（PAL）执行器

- **文件路径**：`electron/services/shell.ts`
- **关键导出符号**：
  - `ExecResult` 接口 — `shell.ts:4-9`
  - `ExecRunner` 接口 — `shell.ts:17-20`
  - `Platform` 类型 — `shell.ts:23`
  - `detectPlatform()` — `shell.ts:25-31`
  - `createPowershellRunner()` — `shell.ts:39-56`
  - `createBashRunner()` — `shell.ts:65-84`
  - `createPlatformRunner(platform?)` — `shell.ts:95-105`
  - `isWindows` — `shell.ts:108`

### 职责一句话
统一封装跨平台子进程执行：Windows 走 PowerShell（强制 UTF-8 输出），macOS/Linux 走 bash（强制 `LC_ALL=C.UTF-8`），是所有 service 的运行时底座。

### 关键链路
1. **装配点**：`main.ts:35` 调用 `createPlatformRunner()`（无参）→ 内部 `detectPlatform()` 读 `process.platform` → 按 `switch` 分发：
   - `'win32'` → `createPowershellRunner()`（`shell.ts:97-98`）— confirmed
   - `'darwin'` / `'linux'` / `'other'` / `default` → `createBashRunner()`（`shell.ts:99-103`）— confirmed
2. **PowerShell 执行路径**（`shell.ts:42-54`）：
   - `execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', UTF8_PREFIX + script])`
   - `UTF8_PREFIX = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;'`（`shell.ts:40`）— confirmed 编码真为 UTF-8
   - `windowsHide: true`、`maxBuffer: 16MB`（`shell.ts:47`）
   - err.code 为 number 时透传，否则归一为 1（`shell.ts:49`）
3. **Bash 执行路径**（`shell.ts:67-83`）：
   - `execFile('bash', ['-c', script], { env: { ...process.env, LC_ALL: 'C.UTF-8' }, maxBuffer: 16MB })`
   - 不设 `LANG`（注释说明精简容器无 locale，设 LANG 会告警）— confirmed
4. **平台分发真按平台**：`createPlatformRunner` 的 switch 覆盖全部四个 Platform 值，无隐式 fallthrough 到错误分支 — confirmed
5. **分支枚举**：
   - `pass-through`：runner.run(script) 原样执行调用方构造的脚本字符串
   - `error-swallowed`：execFile 回调中 err 被转为 code 字段，不 throw（Promise 永远 resolve）— confirmed
   - 无 `partial-success` / `conditional` 分支

### 状态机/数据流
无内部状态。`ExecRunner.run(script)` → `Promise<ExecResult>`，纯函数式。

### 安全边界
- **命令注入面**：runner 本身不对 script 做任何过滤/转义，完全依赖调用方（各 service）自行消毒。这是 PAL 的正确职责——PAL 不做业务决策。— confirmed
- **编码**：PowerShell 端通过 `[Console]::OutputEncoding=UTF8` 前缀强制 UTF-8（`shell.ts:40`）；bash 端通过 `LC_ALL=C.UTF-8`（`shell.ts:73`）。均有装配证据。— confirmed
- **白名单**：shell.ts 本身无白名单逻辑（白名单在各 service 层）。
- **失败判定**：runner 不做业务成败判定，只回传 `code`。业务判定交给 `actionResult.ts`。— confirmed

### 改进建议
- **[中] execFile 无 timeout 参数**（`shell.ts:47`、`shell.ts:73-75`）
  - 问题：`execFile` options 未设 `timeout`。若脚本卡死（如 `Get-CimInstance` 在死网盘上 hang、或 bash 脚本阻塞在 `ping` 无超时），runner 的 Promise 永远不 resolve，renderer 侧 IPC 调用挂起。当前脚本多有内部超时（process list 有 `Start-Sleep 600ms`、network ping 有 count 限制），但 `network:interfaces` 的 `Get-CimInstance Win32_NetworkAdapter*` 在极端系统状态下可能长时间不返回。
  - 理由：渲染层可反复触发 IPC 调用，无超时会导致子进程堆积（虽有 M7 的 usePolling 跳帧，但那只防前端叠加，不防单次 hang）。
  - 最小改动：`shell.ts:47` 和 `shell.ts:74` 的 options 中加 `timeout: 30_000`（30s），超时后 execFile 自动 kill 子进程并回调 err。约 2 行改动。
- **[低] `isWindows` 为模块加载时常量**（`shell.ts:108`）
  - 问题：`isWindows = os.platform() === 'win32'` 在模块 import 时求值。测试中若跨平台 import 此模块（mock process.platform），isWindows 不会随之变化。
  - 理由：当前项目中 `isWindows` 未在 services 内部被 import 使用（grep 确认仅 shell.ts 自身定义），影响极小。
  - 最小改动：无需改动；若后续需要，改为函数 `isWindows()` 即可。
- **[低] `other` 平台兜底走 bash 但行为未保证**（`shell.ts:101-103`）
  - 问题：`createPlatformRunner` 对 `'other'` 走 `createBashRunner()`，但 `process.platform` 返回 `'aix'` / `'sunos'` 等非标准值时 bash 可能不存在。
  - 理由：Electron 只官方支持 win32/darwin/linux，`'other'` 实际不会出现。注释已说明"行为未保证"。
  - 最小改动：无需改动；注释已诚实标注。

---

## 3.2 actionResult.ts — 全项目成败判定唯一口径

- **文件路径**：`electron/services/actionResult.ts`
- **关键导出符号**：
  - `ActionOutcome` 接口 — `actionResult.ts:23-26`
  - `parseActionOutcome(stdout, code?)` — `actionResult.ts:34-63`
  - `fromExitCode(code, stdout, stderr, okMsg, failMsg)` — `actionResult.ts:69-79`

### 职责一句话
将脚本输出（stdout + 退出码）统一判定为 `{ok, message, raw}`：ERR: 优先认错、OK 必须独立成行、空输出如实报失败。

### 关键链路
1. **输入**：`stdout`（脚本原始输出）+ `code`（退出码，默认 0）
2. **预处理**（`actionResult.ts:35-39`）：`String(stdout ?? '').trim()` → 按 `\n` split → 每行 trim → 过滤空行
3. **第一遍扫描：ERR: 优先**（`actionResult.ts:42-46`）
   - 正则 `/^ERR:(.*)$/s` 逐行匹配
   - 命中即返回 `{ok: false, message: 捕获组 || '操作失败', raw}`
   - 多行 ERR: 取第一条（根因），其余留在 raw 里 — confirmed
4. **第二遍扫描：OK 独立成行**（`actionResult.ts:49-52`）
   - 正则 `/^OK(?::(.*))?$/` 逐行匹配
   - 整行恰为 `OK` 或 `OK:细节` 才判成功
   - 子串 `xxx OK yyy` 不命中 — confirmed
5. **兜底：无令牌**（`actionResult.ts:55-62`）
   - raw 为空 → `code===0 ? '脚本无输出' : '退出码 N'`
   - raw 非空但无 OK/ERR → `code===0 ? raw : '退出码 N：raw'`
6. **分支枚举**：
   - `error-swallowed`：无 catch——本函数是纯解析器，不触发异常
   - `partial-success`：不存在——输出要么 ok=true 要么 ok=false，无中间态

### 状态机/数据流
```
stdout → trim/split → [扫描 ERR:] → 命中? → 失败
                      ↓未命中
                   [扫描 OK] → 命中? → 成功
                      ↓未命中
                   [无令牌] → 空? → 失败(无输出)
                             → 非空? → 失败(原样/退出码)
```

### 安全边界
- **禁止 includes('OK')**：源码中无任何 `includes('OK')` 子串匹配；全项目 grep 确认 process/firewall/tasks/winservices/toolbox/gamemode/disk/optimizer(recycle 分支) 均已改用 `parseActionOutcome` — confirmed
- **残留的 includes('OK')**：`optimizer.ts:603` 在 else 分支（code===0 且 stats 解析失败的兜底）仍有 `stdout.includes('OK')`。这是路径清理脚本既未输出 JSON 统计也未输出明确 OK/ERR 时的防御性兜底，非主路径。— confirmed
- **诚实回执**：空输出必失败（`actionResult.ts:55-60`）；退出码 0 但无 OK 令牌仍判失败（`actionResult.ts:62`）— confirmed
- **CRLF 兼容**：`.trim()` 会去掉行尾 `\r`，测试 `actionResult.test.ts:85-88` 覆盖 — confirmed

### 改进建议
- **[低] `ERR_RE` 的 `s` 标志冗余**（`actionResult.ts:20`）
  - 问题：`/^ERR:(.*)$/s` 中的 `s`（dotAll）标志使 `.` 匹配换行符，但 lines 已按 `\n` split，单行内不可能有 `\n`。
  - 理由：冗余但无害；留着也不影响正确性。
  - 最小改动：可删 `s` 标志，无需改逻辑。
- **[低] optimizer.ts:603 残留 `includes('OK')` 兜底**（不在本走读模块内，但属同口径问题）
  - 问题：`optimizer.ts:603` 的 else 分支仍用 `code === 0 && stdout.includes('OK')`。
  - 理由：该分支是 `parseCleanupStats` 失败且 code===0 时的降级路径，理论上脚本应输出 JSON 统计或 ERR:，此分支极难触发。但按"全项目统一口径"原则，应改用 `parseActionOutcome`。
  - 最小改动：`optimizer.ts:603` 改为 `const outcome = parseActionOutcome(stdout, code); const ok = outcome.ok`，约 2 行。
- **未发现明显问题**（核心判定逻辑：ERR 优先、OK 独立成行、空输出失败、退出码兜底——均与注释和测试一致）。

---

## 3.3 desktopEntry.ts — .desktop 文件字段转义

- **文件路径**：`electron/services/desktopEntry.ts`
- **关键导出符号**：
  - `escapeDesktopExecArg(arg)` — `desktopEntry.ts:17-20`
  - `escapeDesktopValue(value)` — `desktopEntry.ts:23-27`

### 职责一句话
为 Linux `.desktop` 文件的 `Exec=` 字段和普通字符串字段提供统一转义，防止路径中含 `"`/`$`/反斜杠/反引号时被 desktop 解析器按 shell 语义求值。

### 关键链路
1. **`escapeDesktopExecArg(arg)`**（`desktopEntry.ts:17-20`）：
   - 第一步：`replace(/[\r\n]/g, '')` 剔除换行符（防止文件结构破坏）
   - 第二步：`replace(/[\\"$`]/g, ch => '\\' + ch)` 对 `"`、`\`、`$`、反引号加反斜杠前缀
   - 第三步：整体用双引号包裹 `"..."`
2. **`escapeDesktopValue(value)`**（`desktopEntry.ts:23-27`）：
   - `replace(/[\r\n]/g, ' ')` 换行→空格
   - `.trim()` 去首尾空白
3. **消费方**：
   - `autolaunch.ts:44-45`：`Name=${escapeDesktopValue(appName)}` + `Exec=${escapeDesktopExecArg(execPath)}` — confirmed
   - `optimizer.ts:284-285`：`Name=${escapeDesktopValue(name)}` + `Exec=${escapeDesktopExecArg(cmd)}` — confirmed
4. **分支枚举**：纯函数，无运行时分支。

### 状态机/数据流
无。纯字符串变换。

### 安全边界
- **转义完整性**：按 Desktop Entry 规范，引号内 `"` `` ` `` `$` `\` 必须转义。源码 `desktopEntry.ts:19` 的字符类 `[\\"$`]` 覆盖这四个字符 — confirmed
- **换行注入**：`\r`/`\n` 直接剔除（ExecArg）或替换为空格（Value），防止注入额外的 `.desktop` 键值对 — confirmed
- **无测试文件**：`desktopEntry.test.ts` 不存在（目录列表确认）。两个消费方（autolaunch/optimizer）的测试是否覆盖了转义后的 `.desktop` 内容，需回看对应测试。— unknown

### 改进建议
- **[中] 缺少单元测试**
  - 问题：`desktopEntry.ts` 无同名 `.test.ts`。`escapeDesktopExecArg` 的正则和字符类若被误改（如漏掉 `$`），无测试兜底。
  - 理由：L9 修复（`buildAutostartContent` 转义）的正确性依赖此函数，但没有直接测试它。
  - 最小改动：新增 `desktopEntry.test.ts`，覆盖：含空格路径、含 `$` 路径、含引号路径、含换行输入、反引号注入。约 15 行测试。
- **[低] `escapeDesktopValue` 不转义 `=` 或 `#`**
  - 问题：`.desktop` 规范中 `Key=` 的 `=` 是分隔符，`#` 是注释起始。若 value 以 `=` 或 `#` 开头，可能被解析为新键。
  - 理由：当前调用方传入的是应用名（如"疾风引擎"），以 `=`/`#` 开头的概率极低。但严格按规范，Name 字段不应含换行（已处理），不应以 `#` 开头。
  - 最小改动：若需严格，在 `escapeDesktopValue` 中对开头的 `#` 做处理；当前可接受。

---

## 3.4 monitor.ts — 实时监控快照（字段级降级）

- **文件路径**：`electron/services/monitor.ts`
- **关键导出符号**：
  - `MonitorFetcher` 接口 — `monitor.ts:14-22`
  - `createSystemInformationFetcher()` — `monitor.ts:30-84`
  - `createMonitorService(fetcher?)` — `monitor.ts:86-143`
  - `pct(n)` 内部函数 — `monitor.ts:25-28`

### 职责一句话
基于 systeminformation 采集 CPU/内存/磁盘/网络/温度/电池/uptime 七项实时指标，单项失败时按字段降级并记入 `degraded[]`，不让整页空白。

### 关键链路
1. **装配点**：`main.ts:40` `createMonitorService()`（无参，用默认 si fetcher）— confirmed
2. **采集链路**（`monitor.ts:112-140` `snapshot()`）：
   - 依次 `await attempt(...)` 七项：cpu → mem → disks → net → temp → battery → uptime
   - 每项经 `attempt<T>(label, fn, fallback, degraded)` 包裹（`monitor.ts:97-110`）
   - `attempt` 内部：try `await fn()` → 返回值；catch → `degraded.push(label)` + 返回 fallback
   - **注意：七项是串行 await，不是 Promise.all** — confirmed
3. **数据变换**（`monitor.ts:129-139`）：
   - `cpu.load` 和 `cpu.cores[]` 经 `pct()` 钳制到 0-100
   - `mem.percent` 经 `pct()`
   - `disks[].percent` 经 `pct()`
   - `net` / `temp` / `battery` / `uptimeSec` 不钳制（非百分比字段）
   - `at: Date.now()` 时间戳
4. **degraded[] 消费方**：
   - `src/pages/Home.vue:72` `degradedText()` 拼接 degraded 数组 — confirmed
   - `src/pages/Home.vue:103-104` 模板显示"部分数据采集失败（xxx），已按 0 显示"
   - `src/pages/Monitor.vue:41` + `:52-53` 同样消费 — confirmed
5. **分支枚举**：
   - `pass-through`：fetcher 正常返回 → 经 pct 变换后入快照
   - `partial-success`：单项 throw → fallback 值 + degraded.push — confirmed
   - `no-op`：fetcher 返回 null/undefined → attempt 内 `v ?? fallback` 走 fallback，但**不写 degraded**（`monitor.ts:105`：`return v ?? fallback`，null 时返回 fallback 但不进 catch）— confirmed。测试 `monitor.test.ts:98-109` 覆盖此语义。

### 状态机/数据流
```
snapshot()
  ├─ attempt('cpu')    → {load, cores} | fallback{0,[]} | degraded+='cpu'
  ├─ attempt('mem')    → {used,total,percent} | fallback | degraded+='mem'
  ├─ attempt('disks')  → DiskSnapshot[] | [] | degraded+='disks'
  ├─ attempt('net')    → {rxSec,txSec} | fallback | degraded+='net'
  ├─ attempt('temp')    → number|null | null | degraded+='temp'
  ├─ attempt('battery') → number|null | null | degraded+='battery'
  └─ attempt('uptime')  → number | 0 | degraded+='uptime'
  → pct 钳制百分比字段 → {..., degraded, at}
```

### 安全边界
- **无命令注入面**：monitor 不经过 ExecRunner，直接调用 systeminformation 的 JS API，不构造 shell 脚本 — confirmed
- **降级语义**：M6 修复确认——原 cpu/mem/disks/net/uptime 无 try/catch，现在全部经 `attempt` 包裹 — confirmed
- **pct 钳制**：在快照边界统一钳制（`monitor.ts:128-132`），不依赖数据源是否守规矩 — confirmed

### 改进建议
- **[低] snapshot() 串行 await 七项，延迟可优化**（`monitor.ts:115-126`）
  - 问题：七项采集是串行 `await`，总延迟 = sum(各项)。在机械盘+网络盘环境下，`si.fsSize()` 可能单独耗时 2-3s，导致整个 snapshot 耗时 3-5s。
  - 理由：M7 修复了前端轮询的并发叠加（usePolling 跳帧），但单次 snapshot 内部串行仍是延迟瓶颈。用 `Promise.all` 可将延迟降到 max(各项)。
  - 最小改动：将七行 `await attempt(...)` 改为 `Promise.all([attempt(...), attempt(...), ...])`。约 10 行重构，语义不变（attempt 内部各自独立）。
- **[低] net 字段不做钳制**（`monitor.ts:133`）
  - 问题：`net` 直接返回，未经任何变换。若 systeminformation 返回 NaN/Infinity（极端情况下），会透传到渲染层。
  - 理由：rxSec/txSec 是字节/秒，非百分比，pct 不适用。但应至少用 `Number.isFinite` 兜底归零。
  - 最小改动：在 `monitor.ts:133` 处加 `net: { rxSec: Number.isFinite(net.rxSec) ? net.rxSec : 0, txSec: ... }`，约 2 行。
- **未发现明显问题**（降级机制、degraded 字段消费、pct 钳制均与代码审查 M6 修复一致）。

---

## 3.5 hardware.ts — 静态硬件信息采集

- **文件路径**：`electron/services/hardware.ts`
- **关键导出符号**：
  - `HardwareFetcher` 接口 — `hardware.ts:22-30`
  - `createSystemInformationHardwareFetcher()` — `hardware.ts:54-202`
  - `createHardwareService(fetcher?)` — `hardware.ts:204-230`
  - `archLabel()` — `hardware.ts:33-40`
  - `s(v)` / `n(v)` 内部安全取数 — `hardware.ts:43-52`

### 职责一句话
采集 7 类静态硬件信息（主板/CPU/内存/显卡/显示器/磁盘/电源），每项独立 try/catch 兜底，无权限时返回空值而非抛错。

### 关键链路
1. **装配点**：`main.ts:41` `createHardwareService()`（无参）— confirmed
2. **聚合链路**（`hardware.ts:207-227` `info()`）：
   - `Promise.all([motherboard(), cpu(), memory(), graphics(), displays(), disks(), power()])` — 并行采集 — confirmed
   - 返回 `{motherboard, cpu, memory, graphics, displays, disks, power, at: Date.now()}`
3. **各 fetcher 的降级策略**：
   - `motherboard()`（`hardware.ts:56-81`）：外层 try/catch 返空字符串；内层 BIOS 单独 try/catch — confirmed
   - `cpu()`（`hardware.ts:83-98`）：try/catch 返空 vendor/brand + arch + 0 核数
   - `memory()`（`hardware.ts:100-123`）：mem 失败兜底 `os.totalmem()`（`hardware.ts:107`）；memLayout 无权限返空数组
   - `graphics()`（`hardware.ts:125-137`）：失败返 `[]`
   - `displays()`（`hardware.ts:139-161`）：失败返 `[]`；sizeInch 从 mm 对角线换算（`hardware.ts:148`）
   - `disks()`（`hardware.ts:163-177`）：失败返 `[]`
   - `power()`（`hardware.ts:179-200`）：
     - 有电池 → `designedCapacity` mWh ÷ 1000 → Wh（`hardware.ts:192`）— **L5 修复确认**
     - 无电池/台式机 → `type: 'unknown'`, `powerW: null`（`hardware.ts:199`）
4. **分支枚举**：
   - `pass-through`：si API 正常 → 经 `s()`/`n()` 清洗 → 入结果
   - `error-swallowed`：每个 fetcher 独立 try/catch，失败返安全默认值 — confirmed
   - `partial-success`：`info()` 的 `Promise.all` 不会 reject（因为每个 fetcher 内部已 catch），所以不存在整体失败

### 状态机/数据流
```
info() → Promise.all([7 fetcher 并行])
  每项: try { si.xxx() → s()/n() 清洗 } catch { 空值兜底 }
→ {7 类硬件, at}
```

### 安全边界
- **无命令注入面**：同 monitor，直接调 systeminformation JS API — confirmed
- **电池单位换算**：mWh → Wh（÷1000）在 `hardware.ts:192`，与 L5 修复一致 — confirmed
- **内存总量兜底**：`si.mem()` 失败时用 `os.totalmem()`（`hardware.ts:107`），不会返 0 — confirmed

### 改进建议
- **[低] `info()` 无外层 try/catch**（`hardware.ts:207-227`）
  - 问题：虽然每个 fetcher 内部都有 try/catch，`Promise.all` 理论上不会 reject。但若未来新增 fetcher 忘记加 try/catch，`Promise.all` 会整体 reject，`hardware:info` IPC 会 reject 到渲染层。
  - 理由：当前 7 个 fetcher 均有 try/catch，实际不会触发。这是防御性建议。
  - 最小改动：在 `info()` 外包一层 try/catch，catch 时返回全空默认值。或加注释提醒"新增 fetcher 必须自带 try/catch"。
- **[低] `displays()` 和 `graphics()` 各调一次 `si.graphics()`**（`hardware.ts:127` + `:141`）
  - 问题：graphics() 和 displays() 都调用 `si.graphics()`，导致同一次 `info()` 中 `si.graphics()` 被调用两次。
  - 理由：systeminformation 内部有缓存（inferred），第二次调用应该很快。但这是不必要的重复调用。
  - 最小改动：在 `createSystemInformationHardwareFetcher` 内部缓存 `si.graphics()` 结果，两个方法共享。约 5 行改动。
- **未发现明显问题**（7 类硬件、电池换算、降级策略均与代码审查 L5 修复一致）。

---

## 3.6 process.ts — 进程列表/结束/挂起/恢复/优先级

- **文件路径**：`electron/services/process.ts`
- **关键导出符号**：
  - `PROTECTED_NAMES`（Windows）— `process.ts:12-23`
  - `PROTECTED_UNIX_NAMES` — `process.ts:43-52`
  - `PRIORITY_CLASS` / `PRIORITY_NICE` — `process.ts:25-40`
  - `buildListScript(platform)` — `process.ts:183-185`
  - `buildKillScript(pid, platform)` — `process.ts:187-191`
  - `buildSuspendScript(pid, platform)` — `process.ts:193-197`
  - `buildResumeScript(pid, platform)` — `process.ts:199-203`
  - `buildPriorityScript(pid, level, platform)` — `process.ts:205-218`
  - `parseProcessList(stdout)` — `process.ts:224-234`
  - `sortProcesses(list, sort?)` — `process.ts:250-266`
  - `parseActionResult(stdout, code?)` — `process.ts:268-273`
  - `createProcessService(runner, platform?)` — `process.ts:275-304`
  - `buildGuardWin(pid)` — `process.ts:96-102`
  - `buildGuardUnix(pid)` — `process.ts:169-177`

### 职责一句话
跨平台进程管理：list（双采样估算 CPU%）、kill（Stop-Process/kill -9）、suspend/resume（NtSuspendProcess/kill -STOP）、priority（PriorityClass/renice），带系统关键进程保护名单。

### 关键链路
1. **装配点**：`main.ts:51` `createProcessService(runner, platform)` — confirmed
2. **IPC 入口**（`main.ts:179-183`）：
   - `process:list` → `processService.list(sort)`
   - `process:kill` → `processService.kill(Number(pid))`
   - `process:suspend` → `processService.suspend(Number(pid))`
   - `process:resume` → `processService.resume(Number(pid))`
   - `process:priority` → `processService.priority(Number(pid), level)`
   - **pid 经 `Number(pid)` 转换** — confirmed。若 renderer 传字符串 `"123;rm"`，`Number()` 返 NaN，插值到脚本为 `Get-Process -Id NaN`，PowerShell 报错而非执行注入 — confirmed
3. **kill 链路**（Windows）：
   - `buildGuardWin(pid)`（`process.ts:96-102`）：
     1. `Get-Process -Id ${pid} -ErrorAction SilentlyContinue` → 不存在则 `ERR:进程不存在`
     2. `$p.Id -le 4` → 内核进程，拒绝
     3. `$PROTECTED_PS_LIST -contains $p.ProcessName` → 受保护名，拒绝
   - 接着 `try { Stop-Process -Id ${pid} -Force -ErrorAction Stop; "OK" } catch { "ERR:..." }`（`process.ts:189`）
   - **M5 修复确认**：不再是 `SilentlyContinue; "OK"`，改为 try/catch + ErrorAction Stop — confirmed
4. **kill 链路**（Unix）：
   - `buildGuardUnix(pid)`（`process.ts:169-177`）：
     1. `kill -0 "$pid"` → 不存在则 `ERR:进程不存在; exit 0`
     2. `ps -o comm= -p "$pid"` → 取进程名
     3. `case "$name" in kernel_task|launchd|...)` → 拒绝
   - 接着 `kill -9 "$pid" && echo "OK" || { echo "ERR:..."; exit 0; }`（`process.ts:190`）
5. **suspend/resume 链路**（Windows）：
   - 先 `Add-Type` P/Invoke 定义 `NtSuspendProcess`/`NtResumeProcess`（`process.ts:105-116`）
   - guard 后 `OpenProcess(0x1F0FFF, false, pid)` → `NtSuspendProcess(h)` → `CloseHandle`
   - 返回码 0 → "OK"，否则 "ERR:系统调用失败（代码 $r）"
6. **priority 链路**：
   - Windows：`(Get-Process -Id ${pid}).PriorityClass = "${cls}"`（`process.ts:214`）
   - Unix：`renice -n ${nice} "$pid"`（`process.ts:217`）
   - 非法 level → `PRIORITY_CLASS[level]` 为 undefined → 返回空脚本 → service 返 `{ok:false, message:'无效的优先级等级'}`（`process.ts:213`、`:216`、`:298`）— confirmed，不执行 runner
7. **list 链路**：
   - Windows：双采样 `Get-Process` CPU 累计时间差 / 0.6s / cores × 100%（`process.ts:67-93`）
   - Unix：双采样 `ps -axo time` + awk 换算（`process.ts:129-166`）
   - 输出 JSON 数组 → `parseProcessList` 解析 → `sortProcesses` 排序
8. **分支枚举**：
   - `pass-through`：guard 通过 + 操作成功 → "OK"
   - `conditional`：guard 拒绝 → "ERR:..."（进程不存在/受保护）
   - `error-swallowed`：stop-process 失败 → catch 块输出 "ERR:..."（不吞错误，如实报告）
   - 无 no-op 分支

### 状态机/数据流
```
kill(pid)
  → buildGuardWin/Unix(pid)
    ├─ 进程不存在? → ERR:进程不存在
    ├─ 受保护? → ERR:受保护的系统进程
    └─ 通过 → Stop-Process/kill -9
       ├─ 成功 → OK
       └─ 失败 → ERR:...（catch 捕获）
  → parseActionResult(stdout) → {ok, message}
```

### 安全边界
- **pid 注入面**：pid 类型为 `number`，main.ts 经 `Number(pid)` 转换。非数字输入 → NaN → 脚本中 `Get-Process -Id NaN` 报错退出，不执行注入 — confirmed
- **level 注入面**：level 从 `PRIORITY_CLASS`/`PRIORITY_NICE` 字典查表，非法键返回 undefined → 空脚本 → 不执行 runner — confirmed
- **保护名单双保险**：JS 侧（list 脚本中标 `protected: true` 供 UI 展示）+ 脚本端权威校验（guard 中的 `-contains` / `case`）— confirmed
- **保护名单可绕过性**：
  - Windows：`$p.ProcessName` 是无扩展名的进程名。攻击者进程可重命名为非保护名（如 `notepad`）来绕过 JS 侧的 UI 禁用，但脚本端 guard 仍会执行 Stop-Process。保护名单只防"误操作杀系统关键进程"，不防恶意进程自改名。这是设计意图（inferred）。
  - Unix：`ps -o comm=` 可被进程自身通过 `prctl(PR_SET_NAME)` 修改。但 OS 层 `kill -9` 对其他用户进程需要 root，普通用户无法杀不属于自己的进程。— confirmed
- **诚实回执**：M5 修复确认——kill 脚本不再 `SilentlyContinue; "OK"`，改为 try/catch + ErrorAction Stop — confirmed
- **parseActionResult 委托**：`process.ts:271` 直接调 `parseActionOutcome(stdout, code)`，不再自己写 `includes('OK')` — confirmed

### 改进建议
- **[低] 保护名单覆盖面有限**（`process.ts:12-23`）
  - 问题：Windows 保护名单仅 10 个进程名（System/Idle/Registry/smss/csrss/wininit/winlogon/services/lsass/Memory Compression）。未包含 `svchost`、`explorer`、`dwm`、`fontdrvhost`、`sihost`、`taskhostw` 等。
  - 理由：这些虽非内核关键进程，但误杀会导致任务栏消失、桌面黑屏等用户可见故障。当前 UI 层会把 `protected: true` 的进程禁用按钮（inferred from list 脚本的 `protected` 字段），但非保护名单的系统进程仍可被一键 kill。
  - 最小改动：在 `PROTECTED_NAMES` 中补充 `'svchost'`、`'explorer'`、`'dwm'`、`'sihost'`、`'taskhostw'`。约 5 行。注意：svchost 是宿主进程，用户通常不需要杀它。
- **[低] Unix guard 的 `exit 0` 退出码语义**（`process.ts:171`、`:175`、`:190`、`:196`、`:202`、`:217`）
  - 问题：Unix 脚本在输出 ERR: 后用 `exit 0` 收尾，导致退出码恒为 0。`parseActionOutcome` 优先扫 ERR: 行所以不受影响，但 `fromExitCode` 或其他按 code 判定的调用方会误判。
  - 理由：当前所有 process 操作均走 `parseActionResult`（内部 `parseActionOutcome`），不直接看 code。但 `exit 0` 让退出码失去诊断价值。
  - 最小改动：将 `exit 0` 改为 `exit 1`（guard 失败时）和 `exit 1`（kill/renice 失败时的 `||` 分支）。约 6 处。改后 parseActionOutcome 仍能正确判定（ERR: 优先），且 code 更诚实。
- **[低] Windows suspend/resume 的 `OpenProcess` 句柄泄漏理论面**（`process.ts:195`、`:201`）
  - 问题：`OpenProcess` 后若 `NtSuspendProcess` 抛异常（理论上 P/Invoke 不应抛），`CloseHandle` 不会执行。
  - 理由：代码结构是 `if ($h -eq Zero) { ERR } else { $r = NtSuspend; CloseHandle | Out-Null; if ($r -eq 0) OK else ERR }`。NtSuspendProcess 返回 NTSTATUS 码而非抛异常，所以 CloseHandle 总会执行。— confirmed
  - 最小改动：无需改动。
- **未发现明显问题**（M5 假成功修复已闭合、保护名单双保险、pid 类型安全、actionResult 委托均与代码审查一致）。

---

## 3.7 network.ts — 网络诊断（ping / 网卡列表）

- **文件路径**：`electron/services/network.ts`
- **关键导出符号**：
  - `HOST_RE` — `network.ts:6`
  - `sanitizeHost(host)` — `network.ts:8-12`
  - `sanitizeCount(count?)` — `network.ts:14-18`
  - `buildPingScriptWin(host, count)` — `network.ts:25-57`
  - `buildPingScriptUnix(host, count)` — `network.ts:67-92`
  - `buildPingScript(host, count, platform?)` — `network.ts:95-99`
  - `INTERFACES_SCRIPT_WIN` — `network.ts:102-124`
  - `INTERFACES_SCRIPT_UNIX` — `network.ts:132-159`
  - `buildInterfacesScript(platform?)` — `network.ts:162-164`
  - `parsePing(stdout, host)` — `network.ts:170-198`
  - `parseInterfaces(stdout)` — `network.ts:208-218`
  - `createNetworkService(runner, platform?)` — `network.ts:224-239`

### 职责一句话
跨平台网络诊断：ping（Test-Connection / ping -c）+ 网卡列表（Win32_NetworkAdapter* / ip/ifconfig），host 白名单消毒后再注入脚本。

### 关键链路
1. **装配点**：`main.ts:52` `createNetworkService(runner, platform)` — confirmed
2. **IPC 入口**（`main.ts:184-185`）：
   - `network:ping` → `networkService.ping(host, count)`
   - `network:interfaces` → `networkService.interfaces()`
3. **ping 链路**（`network.ts:225-231`）：
   - `sanitizeHost(host)` → 不合法直接返 `{ok:false, loss:100}`，**不调用 runner** — confirmed
   - `sanitizeCount(count)` → 默认 4，钳制 1-20 — confirmed
   - `buildPingScript(safeHost, n, platform)` → 分发 win/unix
   - `runner.run(script)` → `parsePing(stdout, safeHost)`
4. **Windows ping 脚本**（`network.ts:25-57`）：
   - `Test-Connection -ComputerName $host_ -Count $count -ErrorAction SilentlyContinue`
   - ResponseTime 逐个 `[double]::TryParse`，非法值丢弃（`network.ts:37`）
   - loss 计算后钳制 0-100（`network.ts:44-45`）— **L11 修复确认**
   - 无结果 → `{min:0, avg:0, max:0, loss:100, ok:false}`
5. **Unix ping 脚本**（`network.ts:67-92`）：
   - `ping -c "$count" "$host"`（不带 -W，注释说明跨平台单位差异）
   - grep `time=X` 提取时延
   - loss 用 awk 钳制 0-100（`network.ts:89`）— **L11 修复确认**
6. **parsePing**（`network.ts:170-198`）：
   - 再钳制 loss 到 0-100（`network.ts:181`）——脚本端 + 解析端双重 clamp — confirmed
   - 时延 `nonNeg` 归零（`network.ts:182`）
   - `ok = loss < 100 && (raw.ok === true || raw.ok === 'True' || avg > 0)`（`network.ts:186`）——**ok 与 loss 自洽**，丢包 100% 时即使脚本自称 ok 也翻为 false — confirmed
7. **interfaces 链路**：
   - Windows：`Win32_NetworkAdapterConfiguration`（IPEnabled）+ `Win32_NetworkAdapter`（物理+未连接）去重（`network.ts:102-124`）
   - Unix：优先 `ip -o addr show`，fallback `ifconfig -a`（`network.ts:139-154`）
8. **分支枚举**：
   - `pass-through`：host 合法 → 构造脚本 → 执行 → 解析
   - `conditional`：host 非法 → 直接返失败结果，不执行 runner
   - `error-swallowed`：JSON.parse 失败 → 返全零 + ok:false

### 状态机/数据流
```
ping(host, count)
  → sanitizeHost(host)
    ├─ 非法 → {ok:false, loss:100}（不调 runner）
    └─ 合法 → sanitizeCount(count)
       → buildPingScript(host, count, platform)
       → runner.run(script)
       → parsePing(stdout, host)
          ├─ JSON 解析失败 → {ok:false, loss:100}
          └─ 正常 → clamp loss/avg → ok 自洽 → PingResult
```

### 安全边界
- **host 白名单**：`HOST_RE = /^[A-Za-z0-9._:-]+$/`（`network.ts:6`），拒绝空格、分号、引号、换行等注入字符。`sanitizeHost` 还检查长度 ≤253 — confirmed
- **host 注入面**：host 消毒后注入脚本为 `'${host}'`（PowerShell 单引号）和 `host='${host}'`（bash 单引号）。即使白名单被绕过，单引号包裹也提供二次防护。— confirmed
- **count 注入面**：count 经 `sanitizeCount` 转为整数并钳制 1-20，插值为 `$count = ${count}` / `count=${count}`，无注入面 — confirmed
- **openExternal**：不在本模块，但 `main.ts:224-235` 的 `app:openExternal` 走 `isAllowedExternal(url)`（HTTPS + 主机白名单 5 个域）— confirmed

### 改进建议
- **[低] `parsePing` 的 ok 判定在极端边界可能误判**（`network.ts:186`）
  - 问题：`ok = loss < 100 && (raw.ok === true || raw.ok === 'True' || avg > 0)`。若 ping 成功但所有响应时间为 0ms（localhost 极快响应），且脚本未输出 `"ok": true`，则 `avg > 0` 为 false，ok 被翻为 false。
  - 理由：localhost ping 响应时间通常 0-1ms，`avg > 0` 在恰好全部为 0 时不成立。实际概率极低（Test-Connection 的 ResponseTime 一般 ≥1ms），但理论上存在。
  - 最小改动：将条件改为 `ok = loss < 100 && (raw.ok === true || raw.ok === 'True' || min > 0 || avg > 0 || max > 0)`。或直接 `ok = loss < 100 && raw.ok !== false`。约 1 行。
- **[低] Unix interfaces 脚本的 `first` 变量作用域**（`network.ts:137`、`:146`、`:152`）
  - 问题：`first=1` 在 awk 外部 shell 中设置，但 awk 内部的 `first` 是 awk 变量（通过 `(first?"":",")` 引用）。awk 不会自动继承 shell 的 `first` 变量。实际看代码，awk 块内 `first=0` 是 awk 内部赋值，但初始值在 awk 中是 0（未初始化变量为 0/空）。
  - 等一下，重新看：`emit '['` 后接 awk，awk 的 `(first?"":",")` 中 first 在 awk 初始时是空字符串（falsy），所以第一个网卡会输出 `{...}` 不加逗号。然后 `first=0`（awk 中为假），后续网卡加逗号。这是正确的——awk 的 `first` 初始为空/falsy。shell 的 `first=1` 实际上没被 awk 使用（awk 用自己的 first）。— confirmed，逻辑正确，只是 shell 的 `first=1` 是死代码。
  - 最小改动：可删除 shell 层的 `first=1`（`network.ts:137`），但不影响正确性。
- **未发现明显问题**（host 白名单、count 钳制、loss 双重 clamp、ok/loss 自洽、L11 修复均已闭合）。

---

## 附：跨模块一致性核查

### A. actionResult 口径在 process/network 调用方的遵守情况
| 调用方 | 判定方式 | 是否合规 |
|---|---|---|
| `process.ts:271` kill/suspend/resume/priority | `parseActionOutcome(stdout, code)` | ✅ |
| `network.ts` ping | 不走 actionResult（PingResult 有独立结构），但 `parsePing` 内部自洽 clamp | ✅（语义不同，非操作型回执） |
| `optimizer.ts:573` recycle | `parseActionOutcome(stdout, code)` | ✅ |
| `optimizer.ts:603` path cleanup 兜底 | `code === 0 && stdout.includes('OK')` | ⚠️ 残留（见 3.2 改进建议） |
| `firewall.ts:67` | `parseActionOutcome` | ✅ |
| `tasks.ts:46` | `parseActionOutcome` | ✅ |
| `winservices.ts:86` | `parseActionOutcome` | ✅ |
| `toolbox.ts:27` | `parseActionOutcome` | ✅ |
| `disk.ts:631` | `parseActionOutcome` | ✅ |
| `gamemode.ts:244`/`:267` | `parseActionOutcome` | ✅ |

### B. 脚本产出是否符合 OK/ERR: 口径
- `process.ts:189` kill：`try {...; "OK"} catch {"ERR:..."}` ✅
- `process.ts:195` suspend/resume：`if ($r -eq 0) { "OK" } else { "ERR:..." }` ✅
- `process.ts:214` priority：`try {...; "OK"} catch {"ERR:..."}` ✅
- `process.ts:99`/`:100` guard：`"ERR:进程不存在"` / `"ERR:受保护的系统进程"` ✅
- Unix 端：`echo "OK"` / `echo "ERR:..."` ✅
- network ping：不走 OK/ERR: 口径（输出 JSON），parsePing 独立判定 ✅

### C. monitor degraded[] 是否被渲染层消费
- `Home.vue:72` `degradedText()` → 拼接 degraded 数组 ✅
- `Home.vue:103-104` 模板提示"部分数据采集失败" ✅
- `Monitor.vue:41` + `:52-53` 同样消费 ✅
- 未发现"服务端产出 degraded 但渲染层不读"的断链。

### D. process 关键进程保护是否可绕过
- **JS 侧**：list 脚本标 `protected: true`，UI 层应据此禁用操作按钮（inferred）
- **脚本端权威**：guard 在每次 kill/suspend/resume/priority 时重新校验，不依赖 UI 状态 ✅
- **绕过路径**：
  1. 渲染层直接调 IPC `process:kill` 传 pid → guard 脚本端校验，无法绕过 ✅
  2. pid 传 NaN → `Get-Process -Id NaN` 报错 → "ERR:进程不存在" ✅
  3. 进程改名（prctl/ProcessName）→ 保护名单是硬编码的进程名，不在名单中的系统进程（svchost/explorer）确实可被杀。这是名单覆盖问题，不是绕过漏洞。⚠️ 见 3.6 改进建议。

### E. 代码审查文档 H1+M1–M10+L1–L12 闭合状态（本节涉及项）
| 编号 | 涉及模块 | 闭合状态 |
|---|---|---|
| M5（假成功） | process.ts:189 | ✅ 已改为 try/catch + ErrorAction Stop |
| M6（监控无兜底） | monitor.ts:97-110 | ✅ attempt() 字段级降级 + degraded[] |
| M7（轮询无守卫） | 非本节 | ✅ usePolling（前端，不在源码走读范围） |
| L4（.desktop 转义） | desktopEntry.ts | ✅ escapeDesktopExecArg 被 autolaunch/optimizer 消费 |
| L5（电池 mWh→Wh） | hardware.ts:192 | ✅ mWh / 1000 |
| L9（autostart 转义） | desktopEntry.ts + autolaunch.ts:45 | ✅ Exec= 经 escapeDesktopExecArg |
| L11（ping 丢包率 clamp） | network.ts:44-45 + :89 + :181 | ✅ 脚本端 + 解析端双重 clamp |


# 第四章 清理 / 磁盘 / 修复集群逐行走读（optimizer · disk · space · dllrepair）

> 走读基线：疾风引擎 gale-engine v0.1.10，Electron33 + Vue3 + TS strict。
> 成败判定唯一口径 = `electron/services/actionResult.ts`（`parseActionOutcome`：`ERR:` 任意行优先、`OK` 必须独立成行、空输出如实判失败）。confirmed = 已逐行打开源码核对；inferred = 由装配关系推断；unknown = 未在本轮直接验证。
> 前置：`docs/code-review-2026-09-16.md` 的 H1 + M1–M10 + L1–L12 已在源码中复核，下文只确认是否真闭合，不重复当新问题上报。

---

## 4.1 optimizer.ts（垃圾扫描清理 + 启动项管理）

- **文件 / 关键导出**：`electron/services/optimizer.ts`
  - `parseCleanupStats(stdout)` → `CleanupStats | null`（`optimizer.ts:25`）
  - `buildScanScript(platform)`（`:293`）、`buildRecycleCleanupScript(platform)`（`:297`）、`buildPathCleanupScript(path, platform)`（`:335`）
  - `buildStartupListScript(platform)`（`:378`）、`buildToggleStartupScript(id, enable, command, platform)`（`:406`）
  - `createOptimizerService(runner, platform, meter?)`（`:547`）
- **职责一句话**：扫描用户级垃圾（临时目录 / 回收站 / Chrome·Edge 缓存）并逐项清理，外加开机启动项的列出与可逆启停。**(confirmed)**

### 关键链路

**垃圾清理 `scanCleanup → runCleanup`**
- trigger：`src/pages/Optimizer.vue:40` 调 `optimizer.scanCleanup()`；清理 `Optimizer.vue:58` 调 `optimizer.runCleanup(items)`。IPC：`main.ts:129-130` 直转 `optimizerService`。**(confirmed)**
- 扫描装配：`buildScanScript(platform)`（`:293`）按平台二选一——win `SCAN_SCRIPT_WIN`（`:94`）/ unix `SCAN_SCRIPT_UNIX`（`:157`）。脚本内固定枚举 temp（`$env:TEMP`、`%SystemRoot%\Temp`，win `:95`；unix `:163`）、回收站（win COM `NameSpace(10)` `:103-108`；unix `~/.Trash` / XDG Trash `:173-181`）、浏览器缓存（仅 Chrome/Edge 的 `Cache` 与 `Code Cache`，`:109-122` / `:189-202`）。id 编码为 `temp:<base64(path)>` / `browser:<base64(path)>` / 固定 `recycle`（`:100,107,119`）。
- 变换：`parseJsonArray`（`:496`，非法 JSON → 空数组，**error-swallowed 分支 confirmed**）→ `toPlan`（`:506`）把未知 kind 降级为 `temp`、`safe` 只认布尔/字符串 `True`。
- 边界：`runCleanup` 对每项先 `meter.freeBytesForPath(before)`（`:566`）；`kind==='recycle'` 走 `buildRecycleCleanupScript` + `parseActionOutcome`（`:569-578`，**诚实令牌判定 confirmed**）；其余先过 `isSafePath`（`:579`），不在白名单则 `ok:false` 且**不调执行器**（`:580`，测试 `optimizer.test.ts:185-193` 覆盖 calls.length===0）；在白名单则 `buildPathCleanupScript` → `parseCleanupStats`（`:582-583`）。
- `stats` 分支（`:584-605`）枚举闭合：
  - `code!==0 && !stats` → 失败（`:584-585`）；
  - 有 `stats` → `ok = failedCount===0 || deletedCount>0`（`:588`）：全被占用且一个没删 → 如实失败；删了一部分 → 成功但带 locked 警告；空目录（0/0）→ 成功（幂等）。**(confirmed)**
  - `code===0 && !stats` → 兜底 `ok = code===0 && stdout.includes('OK')`（`:603`）——见改进建议。
- 可观察结果：`after` 测量 + `diffReleasedBytes` 追加 `releasedBytes`（`:608-610`）；UI 汇总 `已清理 x/y 项`（`Optimizer.vue:63`）。

**启动项 `listStartup → toggleStartup`**
- trigger：`Optimizer.vue:83/93`；IPC `main.ts:131-133`。
- 列出：win 同时读 live Run 键与自有 `Software\GaleEngine\DisabledStartup` 停车键（`STARTUP_SCRIPT_WIN` `:128-148`）；mac 枚举 `~Library/LaunchAgents/*.plist{,.disabled}`（`:214-226`）；linux 枚举 `~/.config/autostart/*.desktop` 并按 `Hidden=true` 判禁用（`:228-238`）。
- 切换脚本 `buildToggleStartupScript`（`:406`）：入参先过 `STARTUP_NAME_RE`（`:389`）与 `STARTUP_LOCATIONS` 白名单（`:392`），非法返回 `null`（调用方按失败）。win 启用=从停车键取回原命令写回 live、再删停车键（`:437-445`）；禁用=把 live 值搬到停车键后删 live（`:446-454`）。mac 用 `.plist` ↔ `.plist.disabled` 改名（`:462-472`）；linux 写 `Hidden=true`（`:486`）。脚本尾部 ` "OK"` / ` "ERR:…"`（`:455-456,470,472,483,486`）。

### 状态 / 数据流
扫描 JSON（id/kind/path/size/safe）→ 渲染层勾选回传 `{id,path,kind}` → 服务端按项 before/after 实测 → 结果带 `releasedBytes/deletedCount/failedCount/locked`。启动项：脚本列 JSON → `toStartupItem`（`:521`，未知 location 归 `HKCU`）→ toggle 后**重新 `listStartup()`** 作为 ground truth 返回（`:627`）。**(confirmed)**

### 安全边界
- 路径白名单：`allowedTempRoots`（`:51`）+ `allowedBrowserRoots`（`:62`），`isSafePath` 做字符串前缀比对（`:561-562`）。**见改进建议 4.1-1**。
- 注入面：启动项 name 走正则白名单（`:389`），注册表/文件路径全部 `psSingleQuote` 单引号字面量（`:249,431-433`），plist 用 `xmlEsc`（`:254`），.desktop 用 `escapeDesktopValue/escapeDesktopExecArg`（`:281-287`）。L4 修复**(confirmed 闭合)**。
- 可逆性：禁用三件套均为「搬位/改名/标记」而非删除，且 list 脚本把停车键/`.disabled`/`Hidden=true` 一并列出，可原地再启用。L8 修复**(confirmed 闭合)**。

### 改进建议
- **【中】4.1-1 渲染层 `path` 可被 `..` 穿越白名单。** 问题与理由：`runCleanup` 仍把渲染层传来的 `path` 当权威路径（签名见 `shared/types.ts:212`、`optimizer.ts:557-559`），`isSafePath` 仅做**字符串前缀**比对（`optimizer.ts:561-562`），不做规范化。构造 `path = <浏览器根>\..\..\Windows\System32` 既通过 `startsWith(root+'\\')`，又会被 `Remove-Item -LiteralPath` 在文件系统层解析出 `..` 落到根外——磁盘深度清理（disk.ts L6）已收紧为「只收 id、服务端查清单」，此处却没对齐。理由：渲染层 IPC 在本项目既被当作不可信面（L4 注释 `:386-388`）。最小改动：清理项的 id 本就把路径 base64 编码在 `temp:/browser:` 段里（`:99,118`），在 `runCleanup` 内改为**解码 base64(id) 还原服务端权威路径**，或对 `path` 先 `Path.GetFullPath` 规范化再比对规范化后的根；删除 `items[].path` 契约字段（`shared/types.ts:212`）。涉及 `optimizer.ts:557-562`、`src/pages/Optimizer.vue:55-57`。
- **【中】4.1-2 `toggleStartup` 丢弃脚本成败，ERR 不上浮。** 问题与理由：`buildToggleStartupScript` 已按约定产出 `OK`/`ERR:`（`:455-456`），但 service 层 `toggleStartup` 只 `await runner.run(script)` 后直接 `return listStartup()`（`:625-627`），**返回值被丢弃**。HKLM 写权限不足、或启用时 `throw "缺少可恢复的启动命令"`（`:441`）都不会冒泡；UI（`Optimizer.vue:93-98`）只把返回列表覆盖回去，失败时按钮原样不动且无任何错误提示——与 M5「诚实回执」纪律不一致。测试 `optimizer.test.ts:241-260` 只断言脚本含 `Set-ItemProperty/Remove-ItemProperty`，未覆盖失败分支。最小改动：`toggleStartup` 内对 `runner.run` 结果用 `parseActionOutcome(stdout, code)`，非 OK 时 `throw new Error(outcome.message)`（UI 已有 try/catch，`Optimizer.vue:104`）。涉及 `optimizer.ts:625-627`。
- **【低】4.1-3 unix 回收站脚本仍无条件 `echo "OK"`。** 问题与理由：win 回收站已改逐盘 try/catch + `ERR:`（`:306-320`），但 darwin/linux 分支仍是 `… 2>/dev/null; echo "OK"`（`:322,324`），Finder 空废纸失败或 rm 被占用时 `parseActionOutcome` 照样收到独立 `OK` → 假成功（M5 的 unix 残留）。最小改动：与 win 对齐，捕获失败并在失败时 `echo "ERR:…"`，或改用 `parseActionOutcome` 之外的退出码判定。涉及 `optimizer.ts:321-325`。
- **【低】4.1-4 兜底仍用 `stdout.includes('OK')`。** 问题与理由：`:603` 的 `else` 分支 `ok = code===0 && stdout.includes('OK')` 与 actionResult 注释（`actionResult.ts:6-9` 明令禁止 `includes('OK')`）及 disk.ts:630 的同类注释相悖。当前 `buildPathCleanupScript` 恒回 JSON，该分支实际不可达，属潜伏反模式。最小改动：把该兜底也换成 `parseActionOutcome(stdout, code)`。涉及 `optimizer.ts:602-605`。

---

## 4.2 disk.ts（卷枚举 / 深度释放 / chkdsk / SFC / DISM）

- **文件 / 关键导出**：`electron/services/disk.ts`
  - `buildDeepCatalog(platform, env?)`（`:85`）、`buildDeepScanScript(platform, catalog?)`（`:346`）、`buildDeepCleanScript(entry, platform)`（`:367`）
  - `buildCheckVolumeScript(mount, fix, platform)`（`:438`）、`buildSystemRepairScript(kind, platform)`（`:459`）、`toWinDrive(mount)`（`:426`）
  - `createDiskService(runner, platform, fetcher?)`（`:531`）
- **职责一句话**：卷空间总览、服务端权威 id 清单的深度释放、文件系统检查/在线修复（chkdsk/diskutil）、系统文件修复（sfc/DISM）。**(confirmed)**

### 关键链路

**深度释放 `scanDeepCleanup → runDeepCleanup`**
- trigger：`DiskRepair.vue:76/92`；IPC `main.ts:151-154`（**只把 id 数组透传，`main.ts:153-154` confirmed**）。
- 扫描装配：`buildDeepCatalog`（`:85`）按平台硬编码 id→目标（win 9 项 `:93-207`、mac 3 项 `:213-247`、linux 3 项 `:251-285`）。`buildDeepScanScriptWin/Unix` 只对 `kind==='path'` 项测量体积（`:309,334`），`action` 项体积由 JS 直接补 `sizeBytes:0`（`:556-567`）。
- 变换：`parseJsonArray` 对 PowerShell 单元素对象容错包成数组（`:477-478`）；`toDeepPlan`（`:484`）。
- 边界（**深度清理 id 白名单 confirmed 闭合**）：`runDeepCleanup(ids)` 先 `Set` 去重（`:576`），逐项 `catalog.find(id)`——**未知 id 直接 `ok:false` 且不调执行器**（`:577-581`，测试 `disk.test.ts:241-248`）；`path` 项再 `isSafeRoot` 二次校验（`:582-583`）。客户端**只能传 id，路径由服务端权威清单解析**。
- 执行：`buildDeepCleanScript`（`:367`）——`action` 项直接回 `entry.action`（`:368`）；`path` 项逐项 try/catch 统计 JSON（`:379-399`）。
- `action` 项判定（`:594-608`）：`explicitErr = /^ERR:/m.test(stdout)`，`ok = code===0 && !explicitErr`——**action 项按退出码为主、显式 ERR 必须认错**（注释 `:596-597`）。
- `path` 项判定与 optimizer 同构（`:610-633`），并在无 stats 兜底处**明确用 `parseActionOutcome` 而非 `includes('OK')`**（`:630-632`）。
- 可观察结果：`probe`（path 项用自身路径，action 项 win→`C:\`、unix→`/`，`:587`）before/after 实测 → `releasedBytes`。

**卷检查 / 系统修复**
- `checkVolume`（`:643`）：win 检查=只读 `chkdsk X:`、修复=`chkdsk X: /scan`（`buildCheckVolumeScript` `:446`，**无 `/f /r`，测试 `disk.test.ts:279-284` confirmed**）；`toWinDrive` 正则拒绝 `C: && rm` 这类注入（`:426-429`，测试 `:271,287`）；linux 在线 fsck 不安全 → 诚实 `unsupported:true` 且不调执行器（`:647-656`，测试 `:299-305`）。
- `repairSystemFiles`（`:695`）：非 win 返回 `unsupported`（`:698-708`）；win 跑 `sfc /scannow` 或 `Dism /RestoreHealth`（`:464-465`），用中英文正则识别 clean/fixed/needAdmin（`:712-714`）。

### 状态 / 数据流
`fsSize` → `toVolume`（`:507`，`clampPct` 0–100，`lowSpace` = ≥90% 或 <10GiB，`:523`）→ 渲染层选 id → 服务端查清单执行 → before/after 实测挂 `releasedBytes`。**(confirmed)**

### 安全边界
- id 白名单：见上，**纵深防御双层（清单查表 + isSafeRoot）**，`allowedRoots` 收敛到 SystemRoot/LOCALAPPDATA/ProgramData 或 HOME（`:74-82`）。**(confirmed)**
- 路径注入：扫描/清理脚本里所有 `e.path`、`e.patterns`、`e.id` 均经 `psSingleQuote`（`:293,310,371`）/`shq`（`:298,335`）。`chkdsk`/`diskutil` 入参走 `toWinDrive`/`UNIX_MOUNT_RE` 白名单（`:422,444,449`）。
- 可逆性 / 提权：DISM 用 `StartComponentCleanup` **不带 `/ResetBase`**（`:193-194`，保留更新卸载能力，测试 `:130`）；`powercfg /hibernate off` 把恢复方式写进 detail（`:200`）；`win-explorer-thumb` 无论成败都**拉起 explorer**（`:169`）。
- 高风险操作提权边界：见改进建议 4.2-1（**此处有未闭合分支**）。

### 改进建议
- **【中】4.2-1 直连 IPC 的 SFC/DISM 未接提权执行器，与 DLL 页行为不一致。** 问题与理由：`main.ts:159-163` 的 `disk:repairSystemFiles` 用的是**普通** `diskService`（`main.ts:48`，无 UAC）；而同机已创建提权版 `adminDiskService`（`main.ts:73`，注释明言「SFC/DISM 这类必须管理员权限的操作复用它」），且 `dll:repair` 的 sfc/dism 经 `main.ts:80` 注入确实走了 `adminDiskService`。结果：**同一 SFC/DISM 操作，从「磁盘修复」页点会因未提权直接失败并只提示「请以管理员身份运行」，从「DLL 修复」页点却会弹 UAC 正常执行**（对比 `DiskRepair.vue:137` vs `DllRepair.vue:71`）。`checkVolume(fix=true)` 的 `chkdsk /scan` 同理走普通 runner（`main.ts:156-157`），未提权时只回 `needsAdmin` 而不弹 UAC。最小改动：`disk:repairSystemFiles` 与 `disk:checkVolume(fix)` 在未提权时改走 `adminDiskService`（与 dll 通道复用同一 elevator），或在 UI `needsAdmin=true` 时提供「以管理员重试」入口。涉及 `main.ts:156-163`。
- **【中】4.2-2 linux action 脚本 `… && cmd; echo OK` 使权限失败被记为成功。** 问题与理由：`mac-brew-cleanup`（`:245`）、`linux-journal-vacuum`（`:272`）、`linux-apt-clean`（`:283`）均为 `command -v X && X …; echo OK`。复合命令的退出码取最后一条 `echo OK`（恒 0），且脚本从不输出 `ERR:`；于是 `runDeepCleanup` 的 `ok = code===0 && !explicitErr`（`:599`）在 journalctl/apt **因非 root 失败时仍判成功**——`; echo OK` 是 M5 明令禁止的模式（mac 的「未装 brew 静默跳过」可接受，但 needsAdmin 的 journal/vacuum 静默成功不可接受）。最小改动：把 `; echo OK` 改为按 `&&` 链退出码收尾（成功 `echo OK`，失败 `echo "ERR:…"; exit 1`），让 `explicitErr`/非零码生效。涉及 `disk.ts:245,272,283`。
- **【低】4.2-3 `win-explorer-thumb` action 尾部无条件 `"OK"`。** 问题与理由：脚本 `:158-171` 对 `Stop-Process`/`Remove-Item` 全用 `SilentlyContinue`，最后无条件 `"OK"`（`:170`）；缩略图删除失败不会让 `explicitErr`/非零码出现 → 报成功。关键安全兜底（拉起 explorer `:169`）确实无条件执行，故风险可控。最小改动：删除后统计命中/失败，有失败则输出 `ERR:`。涉及 `disk.ts:158-171`。
- 其余：深度清理 id 白名单、`isSafeRoot` 双判、chkdsk 不锁盘、linux fsck 诚实降级、DISM 不 ResetBase——**未发现明显问题**（均有测试锁定）。

---

## 4.3 space.ts（清理前后卷可用空间实测）

- **文件 / 关键导出**：`electron/services/space.ts`
  - `createSystemInformationSpaceFetcher()`（`:23`）、`mountOfPath(path, platform)`（`:39`）、`createSpaceMeter(fetcher)`（`:55`）、`diffReleasedBytes(before, after)`（`:95`）
- **职责一句话**：把「释放了多少」从「信命令退出码」改为「清理前后真实卷可用空间差值」。**(confirmed)**

### 关键链路
- trigger：optimizer.runCleanup / disk.runDeepCleanup 在每项前后各调一次 `meter.freeBytesForPath`。
- 装配：`mountOfPath` 把路径映射到挂载点——win 取盘符（`:41-44`，`WIN_MOUNT_RE`），unix **统一归 `/`**（`:45`，注释 `:36` 说明分区场景罕见且无稳定前缀映射）；`freeBytes` 调 `fetcher.fsSize()`，按 `normalizeMount`（`:86`，去尾斜杠、小写）匹配，优先 `available`，缺失则 `size-used` 回退（`:69-72`）。
- 边界：`fetcher` 抛错 → `freeBytes` 返回 `null`（`:60-64`）；匹配不到挂载点 → `null`（`:65-66`）；`size>0||free>0` 才出数，否则 `null`（`:73`）。
- 变换：`diffReleasedBytes` 两端任一为 null/非有限 → `undefined`（不显示释放量）；否则 `Math.max(0, after-before)` 把其他进程写入导致的负差钳到 0（`:95-99`）。
- 可观察结果：返回 `undefined` 时调用方不挂 `releasedBytes`（`optimizer.ts:610`、`disk.ts:638`），界面不显示「释放 0 B」。

### 状态 / 数据流
无内部状态，纯无状态测量工具；`main.ts:46` 全应用共享一份 `spaceMeter`，三个 optimizer 实例与 disk 服务共用。**(confirmed)**

### 安全边界
只读 `fsSize`，无命令执行、无路径入参注入面。**(confirmed)**

### 改进建议
- **未发现明显问题**。测试覆盖负差钳 0、null 透传、NaN/Infinity、`available` 缺失回退、fetcher 抛错兜底（`space.test.ts:9-71`）。仅备注：unix 多分区场景统一归 `/`（`space.ts:45`）会把跨分区释放量混算，注释已声明该取舍，非缺陷。

---

## 4.4 dllrepair.ts（DLL 三态检测 + VC++ 运行库 / sfc / dism 修复）

- **文件 / 关键导出**：`electron/services/dllrepair.ts`
  - 清单 `DLL_CATALOG`（`:158`）、`unixDllCatalog(platform)`（`:204`）
  - `buildDllScanScript(platform)`（`:252`）、`buildSharedLibProbeScript(platform)`（`:299`）
  - `parseDllScanOutput(stdout)`（`:336`）、`toScanResult(probe, catalog, platform, now)`（`:411`）
  - `buildDllAdvice(scan)`（`:467`）、`buildVcRedistScript(arch, platform)`（`:551`）、`parseVcRedistResult(res)`（`:567`）、`createDllService(deps)`（`:635`）
- **职责一句话**：枚举关键系统/运行库/UCRT/图形/媒体 DLL 的存在性与位数完整性，产出可执行修复建议，并经 sfc/DISM/winget 执行修复。**(confirmed)**

### 关键链路
**扫描 `scan`**
- trigger：`DllRepair.vue:58`；IPC `main.ts:165`。非 win 用 `buildSharedLibProbeScript`（mac 判 `/usr/lib` 文件、linux 走 `ldconfig -p`，`:299-321`）。
- 协议：`R` 根 / `D` 命中 / `V` VC++ 版本（`DLL_SCAN_PROTOCOL` `:235-239`，制表符分隔）。win 扫描 `System32`(64) 与 `SysWOW64`(32)，32 位系统把 System32 标 32（`:263-269`）。
- 解析：`parseDllScanOutput`（`:336`）→ `found`(Map) / `missing`(Set) / `vc`；**跨位数去重**：某文件部分位数命中时从 `missing` 移除（`:377-380`）。
- 三态闭合（**confirmed**）：`toScanResult` 每项 `rootCount = roots.length||1`（`:419`），`present = hits.length>0`，`partial = present && hits.length<rootCount`（`:420-424`）。三分划分互斥且穷尽：
  - hits=0 → present=false、partial=false → **缺失**；
  - 0<hits<rootCount → present=true、partial=true → **位数不全**；
  - hits=rootCount → present=true、partial=false → **正常**。
  `scan.missing/partial` 由 items 派生（`:444-445`），与 UI `problems = !present || partial`（`DllRepair.vue:38-39`）一致。空 roots（System32 不可达）时不发 D 行 → 全部落入「缺失」，属悲观诚实降级（inferred：提示用户跑 SFC，不静默报正常）。
- 路径诚实性：win/mac 拼真实路径，linux ldconfig 给不出唯一路径则 `paths=[]` 不编造（`hitPaths` `:391-408`，测试 `dllrepair.test.ts:130`）。

**建议 `advice` → 修复 `repair`**
- `buildDllAdvice`（`:467`）：非 win 或无 missing/partial → `[]`（`:468-470`）；按 runtime/crt → vcredist-x64/x86（`:491-510`），system 缺失 → sfc+dism-restore（`:511-525`），graphics/media/legacy 或仅 partial → sfc（`:526-534`），按 priority 排序。
- 修复闭合（**confirmed**）：repair kind 只 4 种，与 `main.ts:168` 白名单 `['sfc','dism-restore','vcredist-x64','vcredist-x86']` 完全一致，越界收敛为 `sfc`。sfc/dism 委托注入的 `repairSystemFiles`（`:680`，main 侧接 `adminDiskService`，`main.ts:80`）；vcredist 走 `adminRunner`（`:699`，测试 `dllrepair.test.ts:235-244` 验证普通 runner 不被调用）。
- winget：无 winget → 输出 `NO_WINGET; exit 2`（`:557`），service 回官方 aka.ms 链接作手动兜底（`:703-717`，`VCREDIST_URLS` `:457-460`）；不自行下载执行 DLL（设计声明 `:32-34`）。

### 状态 / 数据流
`cached` 缓存最近一次 `DllScanResult`（`:638,657`），`advice()` 基于缓存、`lastScan()` 返回缓存（`:661,735`）；repair 成功后 UI 自动复扫（`DllRepair.vue:80-83`）。非 win 修复走 `unsupportedRepair`（`:616-633`）诚实降级。**(confirmed)**

### 安全边界
- 不下载执行任意 DLL；修复只走 sfc/DISM/winget/官方安装包（`:32-34,457-460`）。
- VC++ id 用 `psq` 单引号字面量（`:553,242`）；winget 命令固定为官方 id，无渲染层注入。
- 提权：vcredist per-machine 安装强制走 `adminRunner`（`:694-699`），普通 runner 仅用于只读扫描。

### 改进建议
- **【低】4.4-1 winget 结果在缺 `WINGET_EXIT=` 标记时会误判成功。** 问题与理由：脚本尾部无条件 `exit 0`（`:562`），故 `runner.run(...).code` 恒 0；`parseVcRedistResult` 在解析不到 `WINGET_EXIT=` 时回退到 `res.code`（`:570-571`），于是 `installed = !noWinget && (… || code===0)` 恒真（`:574`）。仅当 winget 真正执行且输出了标记串时才可靠；若 winget 异常未输出 `WINGET_EXIT=` 且未输出 `NO_WINGET`，会把失败报成成功。最小改动：`parseVcRedistResult` 要求必须命中 `WINGET_EXIT=` 才允许按退出码判定，否则 `installed=false` 并把 detail 带回。涉及 `dllrepair.ts:570-574`。
- 三态判定闭合性、advice→repair kind 闭合、非 win 诚实降级、不编造 linux 路径——**未发现明显问题**（有 `dllrepair.test.ts` 锁定三态/排序/提权通道）。

---

## 4.5 跨模块一致性核对

| 维度 | 结论 | 证据 |
|---|---|---|
| **谁算释放量** | 一致：optimizer.runCleanup 与 disk.runDeepCleanup 都在每项前后用同一份 `space.ts` `freeBytesForPath` 实测，`diffReleasedBytes` 钳负为 0 | `optimizer.ts:566,608-610`；`disk.ts:588,636-638`；`space.ts:95-99` |
| **谁算扫描项** | 作用域互补不重叠计费：optimizer 扫用户级 `%TEMP%`/回收站/浏览器缓存；disk 扫系统级清单（`SoftwareDistribution\Download`、`Prefetch`、WER 等）。两者都碰 `%SystemRoot%\Temp`（optimizer `:95` ↔ disk `win-system-temp` `:106-115`），但分属两次独立扫描，单次运行内不重复计费 | `optimizer.ts:95`；`disk.ts:106-115` |
| **重复清理是否安全** | 安全且幂等：空目录二次删 → `failedCount=0,deletedCount=0` → `ok=true`（`optimizer.ts:588`、`disk.ts:614`）；回收站已空被 win 脚本 `catch "empty"` 吞掉（`optimizer.ts:315`）；DISM/hibernate/winget 均幂等 | confirmed |
| **释放量归属** | 回收站跨卷释放无法归因：optimizer recycle 的 `path="RecycleBin"` → `mountOfPath` 无盘符 → `null` → 不挂 `releasedBytes`（诚实不显示 0） | `optimizer.ts:107,569-578`；`space.ts:39-46`；测试 `optimizer.test.ts:154-162` |
| **启动项「禁用=可逆」** | 真可逆：win 搬停车键 / mac 改 `.disabled` / linux 写 `Hidden=true`，且 list 脚本把三者都读回，可原地再启用；未发现漏改（HKCU/HKLM 双写）或误删（无 `Remove-ItemProperty` 删 live 后不留存档） | 写 `optimizer.ts:446-454,472,486`；读回 `:142-147,214-218,233-235`；测试 `:301-309` |
| **深度清理 id 白名单** | disk 侧已闭合（只收 id、查清单、未知 id 拒绝、isSafeRoot 双判）；**optimizer 侧 runCleanup 仍收 path**，存在 `..` 穿越，见 4.1-1 | `disk.ts:571-585` vs `optimizer.ts:557-562`、`shared/types.ts:212` |
| **SFC/DISM 提权** | **不一致**：DLL 页走 `adminDiskService`（弹 UAC），磁盘修复页直连普通 `diskService`（不弹 UAC）。见 4.2-1 | `main.ts:80` vs `main.ts:159-163`；`DllRepair.vue:71` vs `DiskRepair.vue:137` |

### 与 code-review-2026-09-16.md 23 项的复核结论
- 真闭合（已源码复核）：H1(preload optlib 四接口，不在本簇范围但类型对齐)、M3(meter 默认实现 `optimizer.ts:550`)、M4(`[long]`/`[int64]` `optimizer.ts:100,119`、`disk.ts:304`)、M5 的 win 回收站与启动项脚本侧、L4(启动项白名单+单引号)、L6(深度清理只传 id)、L8(可逆禁用)。
- **未完全闭合 / 残留**：M5「假成功」在 unix 回收站（4.1-3）、linux action 脚本（4.2-2）、`win-explorer-thumb`（4.2-3）仍有 `; echo OK` / 无条件 OK 残留；M5 的 service 层 `toggleStartup` 吞 ERR（4.1-2）。这些与本轮新发现合并列为改进建议，不重复计入「已修复」。


# 第五章 · 系统工具类服务模块走读

> 走读范围：`electron/services/` 下 `gamemode.ts`、`toolbox.ts`、`winservices.ts`、`tasks.ts`、`firewall.ts`、`autolaunch.ts`、`settings.ts`、`history.ts`（及同名 `.test.ts`）。
> 事实标记：**confirmed** = 源码逐行核实；**inferred** = 从代码结构推断；**unknown** = 未在本走读范围内验证。
> 前置依赖：`actionResult.ts`（成败判定唯一口径）、`shell.ts`（ExecRunner / Platform 分发）、`desktopEntry.ts`（.desktop 转义）。

---

## 0. 公共前置：成败判定口径（actionResult.ts）

- **文件路径**：`electron/services/actionResult.ts`
- **关键导出**：`parseActionOutcome(stdout, code)` `:34`、`fromExitCode(code, stdout, stderr, okMsg, failMsg)` `:69`
- **职责一句话**：全项目脚本回执的唯一判定口径，消除「includes('OK') 子串匹配 + 静默失败」。
- **判定规则**（confirmed, `:42-62`）：
  1. **ERR: 优先**：逐行扫描，任何一行以 `ERR:` 开头即判失败，取第一条 ERR 的原因作为 message。
  2. **OK 须独立成行**：整行恰为 `OK` 或 `OK:细节` 才算成功（`OK_RE = /^OK(?::(.*))?$/`，`:18`）。
  3. **空输出算失败**：无任何行时，`code === 0` 返回「脚本无输出」，非零返回「退出码 N」。
  4. **无法识别的输出**：有内容但既无 ERR 也无 OK 时，如实回传原文或「退出码 N：原文」。
- **安全边界**：纯函数，无外部依赖；ERR_RE 用 `s` flag 支持多行。**未发现明显问题**。

---

## 1. gamemode.ts — 游戏模式（高性能电源/CPU/防休眠）

- **文件路径**：`electron/services/gamemode.ts`（282 行）
- **关键导出**：
  - `HIGH_PERFORMANCE_GUID` `:8`、`PERFORMANCE_GOVERNOR` `:11`
  - `parseScheme(output)` `:48`、`parseUnixStatus(output)` `:57`
  - `buildStatusScript(platform)` `:130`、`buildBoostScript(platform)` `:138`、`buildRestoreScript(prev, platform)` `:146`
  - `createGameModeService(runner, storage?, platform?)` `:174`
- **职责一句话**：跨平台切换高性能模式——Windows 走 `powercfg` 电源计划、Linux 走 CPU `scaling_governor`、macOS 走 `caffeinate` 防休眠；记录 boost 前状态用于还原。

### 关键链路

**status()**（confirmed, `:187-210`）：
- trigger：IPC `gameMode:status`（main.ts:172）→ `runner.run(buildStatusScript(platform))`
- 运行时选择：win32 → `powercfg /getactivescheme`；darwin → `pgrep -x caffeinate`；linux → 读 `scaling_governor`
- 变换：win32 用 `parseScheme` 正则提取 GUID + 括号内计划名；unix 用 `parseUnixStatus` 匹配 `ACTIVE:xxx`
- 边界：win32 无匹配 GUID 时 `active=''`；unix `NONE` 或空输出时 `active=''`
- 可观察结果：`{ active, activeName, boosted, previous }`；`boosted` 从 storage 读，`previous` 按平台分键读

**boost()**（confirmed, `:212-251`）：
1. 先调 `status()` 获取当前状态
2. **首次 boost**（win/linux 且 `!cur.boosted && cur.active`）：把当前 GUID/governor 写入 `KEY_PREVIOUS`（`:218-219`）
3. **macOS 重复 boost**（`platform==='darwin' && cur.boosted`）：先读旧 PID，用 `buildRestoreScript(oldPid, 'darwin')` 收掉上一轮 caffeinate；若 kill 失败，记 `cleanupWarning`（`:220-230`）
4. 执行 `buildBoostScript(platform)`
5. **macOS 回执判定**：stdout 用 `PID_RE.test(pid)` 验证为纯数字才认为成功，合法才落盘 PID（`:237-242`）
6. **其他平台**：走 `parseActionOutcome` 严格判定（`:244-246`）
7. 写 `KEY_BOOSTED = ok`；如有 cleanupWarning 拼入 message（`:248-249`）
- 分支：pass-through（status 解析）、conditional（平台分键存储、macOS 重复 boost 清理）、partial-success（新 boost 成功但旧进程残留 → message 含警告）、error-swallowed（旧 caffeinate kill 失败用 `.catch(() => null)` 吞掉但通过 warning 上报）

**restore()**（confirmed, `:253-278`）：
1. 按平台读 `previous` 凭据（darwin 读 `KEY_CAFF_PID`，其余读 `KEY_PREVIOUS`）
2. **无凭据**：直接校正 `boosted=false`，返回「无需还原」（`:260-263`）—— no-op 分支
3. 有凭据：调 `buildRestoreScript(prev, platform)` 生成脚本（**内部先过白名单**）
4. `parseActionOutcome` 判定
5. **失败时保留凭据**（`:268-271`）：不清 `KEY_PREVIOUS` / `KEY_CAFF_PID`，用户可重试
6. **成功才清除**凭据与 `boosted`（`:274-276`）

### 状态/数据流

- 存储键（confirmed）：
  - `gamemode.boosted`（boolean）：当前是否处于高性能模式
  - `gamemode.previous`（string|null）：boost 前的电源计划 GUID（win）或 governor 名（linux）
  - `gamemode.caffeinatePid`（string|null）：macOS caffeinate PID
- 存储后端：生产用 electron-store（main.ts:49 注入 `store`），测试用内存 `mem` 对象（`:179-185`）
- 数据流：IPC → service → runner.run(script) → stdout → parseScheme/parseUnixStatus/parseActionOutcome → 返回 Vue

### 安全边界

**还原凭据白名单校验**（confirmed, `:32-45`）：
- `SCHEME_RE` `:33-34`：`/^\{?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}?$/` —— 整串锚定 `^...$`，只接受十六进制 GUID，可选花括号包裹
- `GOVERNOR_RE` `:37`：`/^[a-z][a-z0-9_-]{0,31}$/` —— 小写字母开头，仅小写字母/数字/下划线/连字符
- `PID_RE` `:40`：`/^\d{1,10}$/` —— 纯数字，1-10 位
- `buildRestoreScript` `:146-165`：三平台分支都**先 `.test(raw)` 再拼接**；不合法走 `invalidPrevScript(what)`（`:43-45`），该函数**不插值任何输入**，只回传固定 ERR 文案

**凭据能否逃出白名单？**（confirmed）：
- Windows：校验通过后，`buildWinRestoreScript` `:77-78` 从 `SCHEME_RE` 匹配组提取 GUID 本体并 `.toLowerCase()`，拼入 `powercfg /setactive ${guid}`。GUID 只含 `[0-9a-f-]`，无空格/分号/引号，无法逃逸。
- Linux：`buildLinuxRestoreScript` `:122` 用 `echo "${prev}" | tee "$f"`，prev 经 GOVERNOR_RE 校验仅 `[a-z0-9_-]`，双引号内无 `$`/反引号可求值。
- macOS：`buildMacRestoreScript` `:95` 用 `kill -0 ${pid}` / `kill ${pid}`，pid 经 PID_RE 校验纯数字。
- **结论：三平台白名单均为 `^...$` 全锚定，构造凭据无法逃出。** 测试 `gamemode.test.ts:147-188` 覆盖了分号/`$()`/反引号/换行/大写/超长/空串等注入向量，全部被拒绝。

**macOS caffeinate 进程泄漏修复**（confirmed）：
- M10 修复后，PID 独立存储于 `KEY_CAFF_PID`（`:17`），不再与 `KEY_PREVIOUS` 共用键
- 重复 boost 时先 kill 旧 PID（`:222-230`），测试 `gamemode.test.ts:298-317` 验证旧 PID 被 kill

**平台分发**（confirmed）：`buildStatusScript`/`buildBoostScript`/`buildRestoreScript` 均按 `platform` switch 分发；`other` 平台返回 `echo NONE` 或 `echo "ERR:不支持的平台"`。

### 改进建议

1. **[低] Linux boost 脚本对所有 CPU 核心写 governor，单个核心失败不中断**
   - 位置：`gamemode.ts:106-115`
   - 问题：`for f in ...; do ... || err=1; done` 遍历所有 `cpu*/cpufreq/scaling_governor`，如果部分核心可写、部分不可写，`err=1` 最终报失败，但已成功的核心已切到 performance。这是 partial-success 但回执为整体失败，用户可能误以为什么都没发生。
   - 理由：实际影响小（绝大多数设备所有核心权限一致），但回执粒度可更细。
   - 最小改动方案：在脚本末尾统计成功核心数，`echo "OK:已切换 N/M 个 CPU 核心"`，`parseActionOutcome` 的 OK:细节 已支持回传。

2. **[低] macOS status 脚本用 `pgrep -x caffeinate` 判断，无法区分本应用启动的 caffeinate 与系统/其他应用的**
   - 位置：`gamemode.ts:86`
   - 问题：如果用户手动跑了 `caffeinate`，status 会误报「游戏模式 ACTIVE」。
   - 理由：inferred——这是探测局限而非安全问题。当前架构下 boost 时记录了 PID，但 status 不查 PID 是否存活，只看 pgrep。
   - 最小改动方案：status 时同时检查 `KEY_CAFF_PID` 对应的进程是否存在（`kill -0 $PID`），而非全局 `pgrep`。

---

## 2. toolbox.ts — 工具箱小工具

- **文件路径**：`electron/services/toolbox.ts`（128 行）
- **关键导出**：
  - `buildFlushDnsScript(platform)` `:38`、`buildEmptyRecycleBinScript(platform)` `:56`、`buildClearClipboardScript(platform)` `:70`、`buildToggleDarkModeScript(enable, platform)` `:82`
  - `createToolboxService(runner, platform?)` `:108`
- **职责一句话**：提供四个安全幂等的小工具——刷新 DNS 缓存、清空回收站、清空剪贴板、切换系统深浅色主题。

### 关键链路

**runTool 统一包装**（confirmed, `:17-32`）：
- 先检测 stdout 是否含 OK/ERR 令牌行（`tokenized` 正则 `:25`）
- 有令牌 → 走 `parseActionOutcome` 严格判定
- 无令牌 → 按退出码判定（`code === 0` 即成功），stderr 透传为失败原因
- 这个设计同时兼容两种脚本风格：带回执令牌的（回收站/剪贴板/主题）和只有退出码的（`ipconfig /flushdns`）

**flushDns**（confirmed）：
- win32 → `ipconfig /flushdns`（无令牌，按退出码判定）
- darwin → `dscacheutil -flushcache` + `killall -HUP mDNSResponder`，失败显式 `exit 1`（`:46-49`）
- linux → `resolvectl flush-caches` 或 `systemd-resolve --flush-caches`，找不到工具报 ERR（`:52`）
- 分支：conditional（工具存在性检测）、pass-through

**emptyRecycleBin**（confirmed）：
- win32 → `try { Clear-RecycleBin -Force -ErrorAction Stop; "OK" } catch { "ERR:..." }`（`:60`）—— M5 修复，不再 SilentlyContinue
- darwin → 先 Finder `empty trash`，失败回退 `rm -rf "$HOME/.Trash/"*`（`:63`）
- linux → `rm -rf "$HOME/.local/share/Trash/files/"*`（`:66`）
- 分支：partial-success（macOS Finder 失败后 rm 回退）

**clearClipboard**（confirmed）：
- win32 → `Set-Clipboard -Value ""`（无令牌，按退出码）
- darwin → `pbcopy < /dev/null`（`:75`）
- linux → `wl-copy` / `xclip` / `xsel` 三级探测（`:78`）
- 分支：conditional（工具探测）

**toggleDarkMode**（confirmed）：
- win32 → 写注册表 `AppsUseLightTheme`（0=深色，1=浅色），`-ErrorAction Stop`（`:87`）
- darwin → `defaults write -g AppleInterfaceStyle -string Dark`；切浅色用 `defaults delete`（键不存在也算成功，`:95`）
- linux → `gsettings set org.gnome.desktop.interface color-scheme prefer-dark/light`；无 gsettings 报 ERR（`:99-100`）
- 分支：conditional（桌面环境检测）、诚实降级（非 GNOME 不支持）

### 状态/数据流

- 无持久化状态；每次操作即发即忘
- IPC：`toolbox:flushDns` / `toolbox:emptyRecycleBin` / `toolbox:clearClipboard` / `toolbox:toggleDarkMode`（main.ts:175-178）
- 数据流：Vue 按钮点击 → IPC → service → runner.run → runTool 判定 → ToolResult

### 安全边界

- **无用户输入插值**：四个工具的参数均为硬编码（注册表路径固定、命令固定），渲染层只传 `enable: boolean`（`:118`）
- **M5 修复确认**：win32 回收站用 `try/catch` + `-ErrorAction Stop`（`:60`），不再 `SilentlyContinue; "OK"`；macOS/linux 回收站脚本显式 `&& echo "OK" || echo "ERR:..."`
- **runTool 的令牌检测**（`:25`）：`/^[ \t]*(OK(?::.*)?|ERR:.*)$/m` —— 用 `m` flag 匹配多行中的任一行，但这只是**检测是否有令牌**，真正判定仍走 `parseActionOutcome`（ERR 优先、OK 独立成行）
- **平台分发**：四个 `build*Script` 均按 platform switch；`other` 平台走 default 分支

### 改进建议

1. **[低] win32 clearClipboard 无成功令牌，依赖退出码；若 Set-Clipboard 异常但退出码仍为 0 会误判**
   - 位置：`toolbox.ts:73`
   - 问题：`Set-Clipboard -Value ""` 无 try/catch 包裹，不像回收站那样显式 `"OK"`。如果 PowerShell 执行时 Set-Clipboard 抛非终止错误但退出码为 0，runTool 会按 `code===0` 判成功。
   - 理由：实际影响极小（Set-Clipboard 极少静默失败），但与其他工具的诚实回执风格不一致。
   - 最小改动方案：改为 `try { Set-Clipboard -Value "" -ErrorAction Stop; "OK" } catch { "ERR:$($_.Exception.Message)" }`。

---

## 3. winservices.ts — Windows 系统服务管理

- **文件路径**：`electron/services/winservices.ts`（319 行）
- **关键导出**：
  - `PROTECTED_SERVICES` `:10-21`、`PROTECTED_UNIX_UNITS` `:24-38`
  - `isSafeServiceName(name)` `:47`、`isSafeUnixUnitName(name)` `:56`、`isProtectedUnixUnit(name)` `:254`
  - `parseServiceList(stdout)` `:61`、`parseServiceResult(stdout, code)` `:84`
  - `buildServicesListScript(platform)` `:137`、`buildServiceOpScript(op, name, platform)` `:154`
  - `createWinServicesService(runner, platform?)` `:258`
- **职责一句话**：枚举/启动/停止/修改系统服务启动类型，JS 白名单 + PowerShell 端双重保护关键服务。

### 关键链路

**list()**（confirmed, `:261-264`）：
- win32 → `Get-CimInstance Win32_Service | Select-Object -First 400`，输出 JSON（`:92-111`）
  - 每行计算 `canStop = [bool]$_.AcceptStop`、`protected = ($protected -contains $_.Name)`
- darwin → `launchctl list`（用户域）+ `sudo -n launchctl list`（系统域，best-effort）（`:144`）
- linux → `systemctl list-units --type=service --all`（限 200 条）（`:147`）
- 解析：win32 走 `parseServiceList`（JSON → WinService[]）；unix 走 `parseUnixServiceList`（文本行解析）

**stop(name)**（confirmed, `:278-294`）：
- **JS 第一道**：`isSafeServiceName(name)` 校验（`:280`）——拒绝单引号/分号/`$`/管道/控制字符
- **win32 第二、三道（PowerShell 端权威）**：`buildGuard(name, 'stop')` `:114-125` 生成：
  1. `if ($protected -contains $s.Name) { "ERR:系统关键服务，已拒绝停止"; exit }` —— PROTECTED_SERVICES 名单检查（`:117`）
  2. `if (-not $s.AcceptStop) { "ERR:该服务当前不可停止"; exit }` —— AcceptStop 能力检查（`:117`）
- 然后 `try { Stop-Service -Name '${name}' -Force -ErrorAction Stop; "OK" } catch { "ERR:..." }`（`:281`）
- **unix**：JS 先查 `isProtectedUnixUnit(name)`（`:286`），受保护直接拒绝；macOS stop 诚实降级（`:287-290`），linux 走 `systemctl stop`

**start(name)**（confirmed, `:266-276`）：
- win32：JS `isSafeServiceName` → `buildGuard(name, 'start')`（只查 `if ($s.State -eq 'Running')` 防重复启动，`:118`）→ `Start-Service`
- unix：JS `isSafeUnixUnitName` → darwin `launchctl kickstart` / linux `systemctl start`

**setStartupType(name, startType)**（confirmed, `:296-315`）：
- win32：JS `isSafeServiceName` → 映射 `auto/manual/disabled` → `Set-Service -StartupType`
- **注意：win32 分支没有 PROTECTED_SERVICES 检查**（详见改进建议 #1）
- unix：JS `isSafeUnixUnitName` + `isProtectedUnixUnit`（`:306`）→ macOS 诚实降级 / linux `systemctl enable/disable`

### 状态/数据流

- 无持久化状态；每次操作实时查询系统
- IPC：`winServices:list` / `winServices:start` / `winServices:stop` / `winServices:setStartupType`（main.ts:200-204）
- PROTECTED_SERVICES 为编译时常量（`:10-21`）：RpcSs, RpcEptMapper, DcomLaunch, Winmgmt, Schedule, EventLog, WinLogon, ProfSvc, CryptSvc, msiserver

### 安全边界

**PROTECTED_SERVICES 与 AcceptStop 双重门槛是否真能挡住关键服务被停？**（confirmed）：
- stop() 的 win32 路径有**三重门**：
  1. JS `isSafeServiceName`（防注入）
  2. PS `$protected -contains $s.Name`（PROTECTED_SERVICES 名单）
  3. PS `-not $s.AcceptStop`（服务本身是否允许被停）
- 即使渲染层传入 `RpcSs`：JS 白名单通过（RpcSs 不含非法字符），但 PS 端 `$protected -contains 'RpcSs'` 为 true → 输出 `ERR:系统关键服务，已拒绝停止` → `parseServiceResult` 判失败。**confirmed：挡得住。**
- 即使某服务不在 PROTECTED_SERVICES 名单但 `AcceptStop=false`（如部分内核驱动服务），第二道门也会挡住。**confirmed：双重门槛有效。**
- PS 端 `$s = Get-Service -Name '${name}'` 用单引号包裹 name，且 JS 已拒绝单引号字符，无法逃逸。

**setStartupType 的保护缺口**（confirmed，详见改进建议）：
- win32 setStartupType 只查了 `isSafeServiceName`，**未查 PROTECTED_SERVICES**。这意味着可以把 RpcSs 的启动类型设为 Disabled——虽然需要重启才生效，但下次重启后 RPC 服务不启动，系统将不可用。

**unix 保护**：`PROTECTED_UNIX_UNITS`（`:24-38`）+ `isProtectedUnixUnit`（`:254`）在 stop/setStartupType 路径都有 JS 检查。`isSafeUnixUnitName` 用 `/^[A-Za-z0-9._@-]{1,200}$/`（`:57`），拒绝空格/分号/`$`。

### 改进建议

1. **[中] win32 setStartupType 缺少 PROTECTED_SERVICES 保护——可将 RpcSs 等关键服务设为禁用启动**
   - 位置：`winservices.ts:296-303`
   - 问题：stop() 有三重门（JS 白名单 + PS PROTECTED + PS AcceptStop），但 setStartupType() 的 win32 分支只做了 JS `isSafeServiceName` 校验和 `STARTUP_TYPE_MAP` 映射，PowerShell 脚本（`:301`）只查服务是否存在，未查 `$protected -contains $s.Name`。渲染层可传 `('RpcSs', 'disabled')`，JS 白名单通过（RpcSs 是合法服务名），直接生成 `Set-Service -Name 'RpcSs' -StartupType Disabled`。重启后 RPC 服务不启动，系统关键功能全失。
   - 理由：这是与 stop() 不对称的保护缺口。stop 挡得住但 setStartupType 挡不住，攻击面虽小（需要应用已安装且用户点了按钮），但后果严重。
   - 最小改动方案：在 `:301` 的 PS 脚本前加一行保护检查，与 stop 对称：
     ```powershell
     $protected = @('RpcSs','RpcEptMapper','DcomLaunch','Winmgmt','Schedule','EventLog','WinLogon','ProfSvc','CryptSvc','msiserver')
     if ($protected -contains $s.Name) { "ERR:系统关键服务，不允许修改启动类型"; exit }
     ```
     或在 JS 层 `setStartupType` win32 分支加 `if (PROTECTED_SERVICES.includes(name)) return { ok:false, message:'...' }`。

2. **[低] PROTECTED_SERVICES 名单可能不全——缺少 WinDefend / BITS / Themes 等常见关键服务**
   - 位置：`winservices.ts:10-21`
   - 问题：当前 10 个服务覆盖了 RPC/COM/WMI/计划任务/事件日志/登录/配置文件/加密/安装器，但未包含 Windows Defender (WinDefend)、Background Intelligent Transfer (BITS)、Windows Update (wuauserv)、Themes 等。这些服务被停止或禁用虽不致系统瘫痪，但会显著影响可用性。
   - 理由：inferred——这是产品决策而非代码缺陷。当前名单是「被停会直接导致系统失去基础能力」的最小集。
   - 最小改动方案：产品侧确认是否需要扩充；若扩充，只需在 `PROTECTED_SERVICES` 数组加字符串，PS 端 `PROTECTED_PS_LIST` 自动同步（`:90`）。

3. **[低] unix setStartupType 对 manual 类型用 systemctl disable 近似，语义不精确**
   - 位置：`winservices.ts:312`
   - 问题：Windows 的「手动」(Manual) 与 Linux 的 `systemctl disable`（禁止开机启动）不完全等同——Linux 仍可被依赖关系触发启动。代码注释已承认这是近似（`:311`）。
   - 理由：诚实降级，注释已说明。非安全问题。
   - 最小改动方案：无需改动，注释已足够。

---

## 4. tasks.ts — 计划任务管理

- **文件路径**：`electron/services/tasks.ts`（239 行）
- **关键导出**：
  - `isSafeTaskToken(token)` `:11`、`isSafeUnixUnit(token)` `:76`
  - `parseTaskList(stdout)` `:22`、`parseTaskResult(stdout, code)` `:45`
  - `buildTasksListScript(platform)` `:86`、`buildTaskOpScript(op, name, platform)` `:102`
  - `createTasksService(runner, platform?)` `:186`
- **职责一句话**：枚举/启动/停止/启用禁用计划任务，Windows 走 `Get-ScheduledTask`，unix 走 launchd/systemd --user。

### 关键链路

**list()**（confirmed, `:189-192`）：
- win32 → `Get-ScheduledTask | Get-ScheduledTaskInfo`，输出 JSON（`:51-63`），含 taskPath/taskName/state/lastRunTime/nextRunTime
- darwin → `launchctl list`（`:92`）
- linux → `systemctl --user list-timers --all` + `crontab -l`（`:95`）

**setEnabled(path, name, enable)**（confirmed, `:194-207`）：
- win32：`taskLocator(path, name)` 先过 `isSafeTaskToken`（path 和 name 各过一次），生成 `-TaskPath '...' -TaskName '...'`（`:66-69`）
- 然后 `try { Enable-ScheduledTask/Disable-ScheduledTask ${loc} -ErrorAction Stop; "OK" } catch { "ERR:..." }`（`:200`）
- unix：`isSafeUnixUnit(name)` → `buildTaskOpScript('enable'/'disable', name, platform)`

**run(path, name)**（confirmed, `:209-221`）：
- win32：`taskLocator` → `Start-ScheduledTask ${loc}`
- unix：darwin `launchctl kickstart -k gui/$(id -u)/${unit}`；linux `systemctl --user start ${unit}`

**stop(path, name)**（confirmed, `:223-235`）：
- win32：`taskLocator` → `Stop-ScheduledTask ${loc}`
- unix：macOS 诚实降级（`:115-118`）；linux `systemctl --user stop ${unit}`

### 状态/数据流

- 无持久化状态；实时查询
- IPC：`tasks:list` / `tasks:setEnabled` / `tasks:run` / `tasks:stop`（main.ts:194-199）
- 任务定位用 `taskLocator(path, name)` 组合 `-TaskPath '...' -TaskName '...'`（`:66-69`）

### 安全边界

**名称白名单**（confirmed）：
- `isSafeTaskToken` `:11-19`：长度 ≤260，拒绝 `['\`;|$&<>\r\n]` 和控制字符 `[\x00-\x1f]`
- `taskLocator` `:67`：path 和 name **都**必须通过 `isSafeTaskToken`，任一不合法返回 null → service 返回「包含非法字符」
- 插值方式：`-TaskPath '${path}' -TaskName '${name}'`（`:68`）——单引号包裹，且 JS 已拒绝单引号字符，无法逃逸
- unix：`isSafeUnixUnit` `:76-78`：`/^[A-Za-z0-9._@/-]{1,200}$/`，拒绝空格/分号/`$`

**M1 修复确认**：代码评审 M1 指出 Tasks.vue 状态键拼接不一致（`|` vs 不带），已修复为统一 `taskKey()`。服务端 `taskLocator` 本身无此问题——它直接用 path+name 生成 PowerShell 参数，不涉及状态键拼接。

**无 PROTECTED_TASKS 名单**（confirmed）：与 winservices 不同，tasks 模块**没有**关键任务保护名单。任何任务只要名称通过白名单校验，都可以被停止/禁用/运行。这包括 `\Microsoft\Windows\...` 下的系统计划任务。

### 改进建议

1. **[低] 无系统关键计划任务保护名单——可禁用 Windows Update 等系统任务**
   - 位置：`tasks.ts`（全文无 PROTECTED 常量）
   - 问题：与 winservices 的 PROTECTED_SERVICES 不对称，计划任务模块没有保护名单。渲染层可对 `\Microsoft\Windows\WindowsUpdate\Scheduled Start` 等系统任务执行 Disable-ScheduledTask。
   - 理由：inferred——计划任务的影响通常不如系统服务致命（禁用一个任务不立即影响系统运行），但长期禁用安全更新任务仍有风险。
   - 最小改动方案：若产品侧认为需要，可仿照 winservices 增加 `PROTECTED_TASKS` 名单，在 setEnabled/stop 前 JS 层检查 `if (PROTECTED_TASKS.includes(`${path}${name}`)) return ...`。当前 v1 可不做。

2. **[低] unix crontab 行解析直接截取前 60 字符作为 name**
   - 位置：`tasks.ts:170`
   - 问题：`tasks.push({ path: 'cron', name: line.slice(0, 60), ... })`——crontab 行的完整内容被截断为 60 字符显示，但后续如果对 cron 行执行操作（实际不会——unix 操作只接受 unit name），截断可能导致操作错误。
   - 理由：当前 unix 操作路径 `buildTaskOpScript` 对 cron 行无对应操作（只支持 systemd --user），所以截断不影响安全。但展示层看到的 name 是截断的。
   - 最小改动方案：无需改动（cron 行只展示不操作），或加注释说明。

---

## 5. firewall.ts — 防火墙配置

- **文件路径**：`electron/services/firewall.ts`（234 行）
- **关键导出**：
  - `FIREWALL_PROFILES` `:7`（`['Domain','Private','Public']`）、`isSafeFirewallToken(token)` `:11`
  - `parseProfiles(stdout)` `:20`、`parseRules(stdout)` `:42`、`parseFirewallResult(stdout, code)` `:65`
  - `buildProfilesScript(platform)` `:109`、`buildRulesScript(platform)` `:134`、`buildSetEnabledScript(enable, platform)` `:148`
  - `createFirewallService(runner, platform?)` `:191`
- **职责一句话**：枚举防火墙配置文件和规则，并支持整体启用/禁用与单条规则开关。

### 关键链路

**profiles()**（confirmed, `:194-197`）：
- win32 → `Get-NetFirewallProfile` 输出 JSON（`:71-80`），含 name/enabled/inbound/outbound
- darwin → `pfctl -s info | grep 'Status: Enabled'`（`:115`）
- linux → `ufw status` 或 `iptables -L` 粗略判断（`:118-122`）
- unix 解析：`parseUnixProfiles` 将 ON/OFF 映射为单一 "Firewall" 配置文件（`:166-170`）

**listRules()**（confirmed, `:199-202`）：
- win32 → `Get-NetFirewallRule | Sort-Object DisplayName | Select-Object -First 200`（`:83-97`）
- darwin → `pfctl -sr`（`:139`）
- linux → `ufw status` 或 `iptables -S`（`:141`）
- unix 解析：`parseUnixRules` 逐行映射为 FirewallRule[]（`:175-189`）

**setProfileEnabled(profile, enable)**（confirmed, `:204-217`）：
- win32：**先白名单校验** `FIREWALL_PROFILES.includes(profile)`（`:206`），不合法直接拒绝
  - 合法则 `Set-NetFirewallProfile -Name ${profile} -Enabled ${state}`（`:210`）—— **这是写操作**
- unix：忽略 profile 参数，走 `buildSetEnabledScript(enable, platform)`（`:215`）
  - darwin：`pfctl -e` / `pfctl -d`（需 root）
  - linux：`ufw enable` / `ufw disable`；无 ufw 则诚实降级（`:156-157`）

**toggleRule(name, enable)**（confirmed, `:219-230`）：
- win32：`isSafeFirewallToken(name)` → `Enable-NetFirewallRule/Disable-NetFirewallRule -Name '${name}'`（`:224`）—— **这也是写操作**
- unix：诚实降级返回「暂不支持单条防火墙规则开关」（`:229`）

### 状态/数据流

- 无持久化状态；实时查询和操作
- IPC：`firewall:profiles` / `firewall:listRules` / `firewall:setProfileEnabled` / `firewall:toggleRule`（main.ts:186-192）

### 安全边界

**是否真的只读不写？**（confirmed——**不是只读**）：
- 走读前 hint 称「仅枚举三配置文件，不做远程下发规则」。逐行核实后：
  - `profiles()` 和 `listRules()` 确实是只读枚举
  - 但 `setProfileEnabled()` 调用 `Set-NetFirewallProfile`（`:210`）——**写操作**，可禁用防火墙
  - `toggleRule()` 调用 `Enable-NetFirewallRule`/`Disable-NetFirewallRule`（`:224`）——**写操作**，可启用/禁用单条规则
- **关键澄清**：hint 说的「不做远程下发规则」是对的——代码不做远程下发，所有操作都在本机执行。但「仅枚举」不准确，模块有受控的本机写操作。
- **写操作的保护**：
  - `setProfileEnabled` win32：profile 参数经 `FIREWALL_PROFILES` 白名单（`:206`），只接受 Domain/Private/Public 三个固定值，无法注入其他参数
  - `toggleRule` win32：name 经 `isSafeFirewallToken`（`:221`），拒绝单引号/分号/`$` 等
  - 脚本用 `try/catch -ErrorAction Stop`（`:210`/`:224`），失败输出 ERR 而非静默

**FIREWALL_PROFILES 白名单**（confirmed, `:7`）：`['Domain','Private','Public']` 编译时常量。`setProfileEnabled` 用 `(FIREWALL_PROFILES as readonly string[]).includes(profile)` 严格匹配（`:206`）。

**isSafeFirewallToken**（confirmed, `:11-17`）：长度 ≤260，拒绝 `['\`;|$&<>\r\n]` 和控制字符。与 tasks/winservices 的白名单函数同构。

**M2 修复确认**：代码评审 M2 指出 Firewall.vue 条件语义反转（`:class` 把布尔量做相等比较），已修复为 `useFlash` 结构化 tone。服务端 `firewall.ts` 本身无此问题。

### 改进建议

1. **[中] setProfileEnabled 可禁用防火墙——缺少「禁用 Public 配置文件」的二次确认/保护**
   - 位置：`firewall.ts:204-217`
   - 问题：渲染层传 `('Public', false)` 即可关闭公共网络防火墙，这在不可信网络（咖啡厅/酒店 WiFi）下会暴露所有入站端口。当前实现无任何确认或保护，UI 按钮一点即执行。
   - 理由：这不是注入漏洞（profile 已白名单），而是**安全操作的 UX 保护缺失**。系统自带的 Windows 安全中心关闭防火墙时会弹 UAC 确认，此处直接执行。
   - 最小改动方案：UI 层（Firewall.vue）在用户关闭 Public/防火墙时弹确认对话框；或服务端对 `enable=false && profile==='Public'` 要求额外确认标志。这是产品决策，但建议至少在 UI 层加二次确认。

2. **[低] unix parseUnixProfiles 的 ON 检测正则可能误判**
   - 位置：`firewall.ts:168`
   - 问题：`/\bON\b/i.test(text)` 会匹配任何包含独立 "ON" 单词的行（如 "Connection: on" 或 "Action: allow" 中的 allow 不含 on 独立词，但 "Deny on" 这类会误匹配）。
   - 理由：inferred——实际 ufw/pfctl 输出格式较固定，误判概率低。
   - 最小改动方案：无需改动，当前解析已覆盖 ON/OFF/Status: active 三种常见格式。

---

## 6. autolaunch.ts — 开机自启

- **文件路径**：`electron/services/autolaunch.ts`（100 行）
- **关键导出**：
  - `AUTOSTART_FILE_NAME` `:29`、`autostartDir(baseDir?)` `:32`、`autostartFilePath(baseDir?)` `:36`
  - `buildAutostartContent(execPath, appName?)` `:41`
  - `createAutoLaunchService(api, platform?, opts?)` `:55`
  - `createElectronLoginItemApi(electronApp)` `:94`
  - 重导出 `escapeDesktopExecArg` / `escapeDesktopValue`（`:13`，来自 `desktopEntry.ts`）
- **职责一句话**：管理开机自启——win32/macOS 走 Electron 登录项 API，Linux 写 XDG autostart .desktop 文件。

### 关键链路

**get()**（confirmed, `:64-67`）：
- win32/darwin → `api.getLoginItemSettings().openAtLogin === true`（走 Electron 原生 API）
- linux → `fs.existsSync(autostartFilePath())`（检查 .desktop 文件是否存在）

**set(enable)**（confirmed, `:69-88`）：
- win32/darwin → `api.setLoginItemSettings({ openAtLogin: next })`（Electron 原生 API，内部写注册表/LaunchAgents）
- linux：
  - `enable=true`：`fs.mkdirSync` 创建目录 → `fs.writeFileSync` 写入 `buildAutostartContent(exec)`（`:77-78`）
  - `enable=false`：`fs.unlinkSync` 删除文件，不存在视为已关闭（`:80-84`）
  - **回读真实状态**：`return get()`（`:87`）——不回显意图，写入失败时如实返回 false

**buildAutostartContent(execPath, appName)**（confirmed, `:41-47`）：
- 生成标准 `.desktop` 文件：
  ```
  [Desktop Entry]
  Type=Application
  Name=<escapeDesktopValue(appName)>
  Exec=<escapeDesktopExecArg(execPath)>
  X-GNOME-Autostart-enabled=true
  ```
- `escapeDesktopExecArg`（`desktopEntry.ts:17-20`）：双引号包裹，转义 `\` `"` `$` `` ` ``，剔除 `\r`/`\n`
- `escapeDesktopValue`（`desktopEntry.ts:23-27`）：剔除换行、trim

### 状态/数据流

- 无 electron-store 持久化；状态即系统状态（注册表/LaunchAgents/.desktop 文件）
- IPC：`app:getAutoLaunch` / `app:setAutoLaunch`（main.ts:220-221）
- execPath 来源：`process.execPath`（`:62`）或 `opts.execPath`；main.ts:64 调用时未传 opts，所以用 `process.execPath`
- baseDir 默认 `homedir()`（`:32`），测试可注入

### 安全边界

**三平台路径解析是否有注入面？**（confirmed）：
- **win32/darwin**：走 Electron `setLoginItemSettings` API，无 shell 插值，无路径拼接。**无注入面。**
- **linux**：
  - 文件路径：`autostartFilePath` = `path.join(homedir(), '.config', 'autostart', 'gale-engine.desktop')`——文件名固定为 `gale-engine.desktop`（`:29`），目录固定为 `~/.config/autostart`。`homedir()` 返回用户主目录，不接受渲染层输入。**路径无注入面。**
  - 文件内容：`Exec=` 行用 `escapeDesktopExecArg(execPath)` 转义。execPath 来自 `process.execPath`（Node 进程自身路径），虽然理论上可被 `opts.execPath` 覆盖，但 main.ts 未传该参数。即使传入恶意路径：
    - `escapeDesktopExecArg` 转义了 `$`、`` ` ``、`"`、`\`（`desktopEntry.ts:19`）
    - 剔除 `\r`/`\n`（`:18`）——防止注入额外的 `.desktop` 行
    - 测试 `autolaunch.test.ts:99-117` 覆盖了 `$HOME`/反引号/双引号/反斜杠/换行等注入向量
  - **结论：三平台无注入面。** L4/L9 修复已确认生效。

**L4 修复确认**：代码评审 L4 指出 `buildToggleStartupScript` 的 name/location 注入面，已修复为白名单校验。这属于 optimizer.ts 的启动项管理，autolaunch.ts 是独立的「应用自身开机自启」，不涉及渲染层传入的 name/location。

**L9 修复确认**：代码评审 L9 指出 `buildAutostartContent` 未转义 execPath 中的引号。当前 `:45` 调用 `escapeDesktopExecArg(execPath)`，测试 `autolaunch.test.ts:106-109` 验证了双引号/反斜杠转义。**confirmed 已修复。**

### 改进建议

1. **[低] linux set(true) 写入 .desktop 文件时未校验目录是否可写——写入失败会抛异常而非返回 false**
   - 位置：`autolaunch.ts:77-78`
   - 问题：`fs.mkdirSync` 和 `fs.writeFileSync` 没有 try/catch。如果 `~/.config/autostart` 目录不可写（极端权限情况），会抛未捕获异常，IPC handler 返回 rejected promise。
   - 理由：正常环境下用户主目录可写，这是极端边界情况。但 L3 修复要求 Settings/History 等有 try/catch，此处风格可对齐。
   - 最小改动方案：将 `fs.writeFileSync` 包在 try/catch 中，失败时 `return false`（`:87` 的 `get()` 回读自然返回 false）。

2. **[低] linux set(false) 删除 .desktop 文件时，如果文件存在但删除失败（权限不足），catch 会吞掉错误仍返回 get()=false**
   - 位置：`autolaunch.ts:80-84`
   - 问题：`fs.unlinkSync` 失败时 `catch {}` 静默吞掉，然后 `return get()`——如果文件仍存在（删除失败），`get()` 返回 true，所以实际上是正确的。但 catch 块没有记录错误。
   - 理由：当前行为其实是对的（删除失败 → 文件仍在 → get()=true → 返回 false），只是 catch 静默。
   - 最小改动方案：无需改动，当前逻辑正确。

---

## 7. settings.ts — 主题与更新偏好设置

- **文件路径**：`electron/services/settings.ts`（67 行）
- **关键导出**：
  - `DEFAULT_SETTINGS` `:3`、`DEFAULT_APP_PREFS` `:6`
  - `StorageAdapter` 接口 `:16-19`
  - `normalizeSettings(raw)` `:22`、`normalizeAppPrefs(raw)` `:46`
  - `createSettingsService(storage)` `:33`、`createAppPrefsService(storage)` `:57`
- **职责一句话**：管理应用主题（外观/强调色）和自动更新偏好，带损坏数据归一化。

### 关键链路

**get()**（confirmed, `:34`/`:58`）：
- `storage.get('theme', DEFAULT_SETTINGS)` → `normalizeSettings(raw)` 归一化
- `storage.get('appPrefs', DEFAULT_APP_PREFS)` → `normalizeAppPrefs(raw)` 归一化

**set(patch)**（confirmed, `:36-40`/`:60-64`）：
- 先 `get()` 当前值 → 合并 patch → `normalizeSettings({...get(), ...patch})` → 写回 storage
- 非法字段被归一化函数丢弃，不会写入损坏数据

**normalizeSettings**（confirmed, `:22-31`）：
- `appearance`：只接受 `['system','light','dark']`，否则回退 `'system'`
- `accent`：只接受 `['blue','cyan','violet','green','orange','gradient']`，否则回退 `'blue'`
- 非对象输入（null/string/number）整体回退默认

**normalizeAppPrefs**（confirmed, `:46-51`）：
- 三个字段都只接受 `boolean`，非布尔回退默认值（全部 true）
- 损坏数据不抛异常，静默回退

### 状态/数据流

- 存储键：`'theme'` 和 `'appPrefs'`（分离存储，主题损坏不影响更新配置）
- 存储后端：生产用 electron-store（main.ts:38 注入 `store`），测试用内存 storage
- IPC：`settings:get` / `settings:set`（main.ts:115-121）
- main.ts:120 有 try/catch：持久化失败时返回当前设置而非抛异常

### 安全边界

- **无 shell 执行**：纯数据读写，不涉及脚本生成
- **无用户输入插值到系统命令**：主题设置只存到 electron-store，不直接调用系统命令
- **枚举白名单**：appearance 和 accent 都有固定枚举列表，不在列表内的值被丢弃
- **L3 修复确认**：main.ts:116-121 的 `settings:set` 有 try/catch，失败时 console.error 并返回当前设置。confirmed 已修复。

### 改进建议

**未发现明显问题。** 归一化逻辑完备，存储分离合理，IPC 有 try/catch。

---

## 8. history.ts — 操作历史记录

- **文件路径**：`electron/services/history.ts`（69 行）
- **关键导出**：
  - `normalizeEntry(raw)` `:10`
  - `createHistoryService(storage, makeId?)` `:30`
  - `HistoryInput` 接口 `:24-28`
- **职责一句话**：记录用户操作历史（清理/启动项/游戏模式/工具箱/优化），持久化到 electron-store，最多 200 条。

### 关键链路

**list()**（confirmed, `:44`）：
- `read()` → `normalizeEntry` 逐条过滤损坏项 → 按 `at` 时间倒序排序

**add(input)**（confirmed, `:46-57`）：
- 生成新 entry：`id = makeId()`、`at = Date.now()`
- 新 entry 插到数组头部 → `slice(0, MAX_ENTRIES)` 裁剪到 200 条 → 写回 storage

**clear()**（confirmed, `:59-61`）：
- 写空数组 `[]`

**normalizeEntry**（confirmed, `:10-22`）：
- 必须是对象、`id` 必须是 string、`type` 必须在 `['cleanup','startup','gameMode','toolbox','optimize']` 内
- 损坏项返回 null（被 filter 丢弃）
- `label`/`detail` 容错：非 string 时 label 回退空串、detail 回退 undefined

### 状态/数据流

- 存储键：`'history'`，值为 `HistoryEntry[]`
- 上限：`MAX_ENTRIES = 200`（`:5`）
- 存储后端：生产用 electron-store（main.ts:42 注入），测试用内存 storage
- IPC：`history:list` / `history:add` / `history:clear`（main.ts:126-128）
- ID 生成：`defaultId()` = `Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8)`（`:66-68`）

### 安全边界

- **无 shell 执行**：纯数据读写
- **type 枚举白名单**：`TYPES` `:7` 固定五个类型，不在列表内的项被丢弃
- **损坏数据容错**：`read()` 用 `normalizeEntry` 逐条过滤，即使 storage 中被手动写入损坏 JSON 也不会导致崩溃
- **L3 修复确认**：History.vue 的 clearAll 有 try/catch（代码评审 L3）。服务端 history.ts 本身不涉及 shell，IPC `history:clear` 是同步操作。

### 改进建议

1. **[低] add() 无去重——快速连续操作会产生大量相邻相似条目**
   - 位置：`history.ts:46-57`
   - 问题：每次 add 都无条件插入新条目，不检查与最近一条是否同 type+label。如果用户快速点了两次「刷新 DNS」，历史会有两条几乎相同的记录。
   - 理由：这是产品体验问题而非安全问题。200 条上限会自然裁剪。
   - 最小改动方案：可选——add 时检查 `read()[0]` 的 type+label 是否与新条目相同且时间差 <5s，若是则更新 at 而非插入新条目。v1 可不做。

---

## 9. 跨模块安全总结

### 9.1 名称白名单正则一览

| 模块 | 函数 | 位置 | 正则/规则 | 锚定 |
|---|---|---|---|---|
| gamemode | `SCHEME_RE` | `:33` | GUID 十六进制格式 | `^...$` |
| gamemode | `GOVERNOR_RE` | `:37` | `[a-z][a-z0-9_-]{0,31}` | `^...$` |
| gamemode | `PID_RE` | `:40` | `\d{1,10}` | `^...$` |
| winservices | `isSafeServiceName` | `:47` | 拒绝 `['\`;|$&<>\r\n]` + 控制字符，≤80 字符 | 黑名单 |
| winservices | `isSafeUnixUnitName` | `:56` | `[A-Za-z0-9._@-]{1,200}` | `^...$` |
| tasks | `isSafeTaskToken` | `:11` | 拒绝 `['\`;|$&<>\r\n]` + 控制字符，≤260 字符 | 黑名单 |
| tasks | `isSafeUnixUnit` | `:76` | `[A-Za-z0-9._@/-]{1,200}` | `^...$` |
| firewall | `isSafeFirewallToken` | `:11` | 拒绝 `['\`;|$&<>\r\n]` + 控制字符，≤260 字符 | 黑名单 |
| firewall | `FIREWALL_PROFILES` | `:7` | 固定三值 `includes()` 检查 | 白名单 |
| autolaunch | `escapeDesktopExecArg` | `desktopEntry.ts:17` | 转义 `\` `"` `$` `` ` ``，剔除换行 | 转义式 |

### 9.2 凭据校验

- **gamemode 还原凭据**：三平台全锚定正则白名单，非法时 `invalidPrevScript` 不插值任何输入。**confirmed：无绕过。**
- **autolaunch .desktop 内容**：`escapeDesktopExecArg` 转义所有 shell 元字符。**confirmed：无注入面。**
- **settings/history**：无凭据，纯数据归一化。

### 9.3 保护名单

| 保护 | 位置 | 覆盖范围 | stop | setStartupType | 其他操作 |
|---|---|---|---|---|---|
| `PROTECTED_SERVICES` | winservices `:10` | 10 个 Windows 关键服务 | ✅ PS 端检查 | ❌ **缺失** | — |
| `PROTECTED_UNIX_UNITS` | winservices `:24` | 12 个 unix 关键单元 | ✅ JS 端检查 | ✅ JS 端检查 | — |
| `FIREWALL_PROFILES` | firewall `:7` | 3 个配置文件 | — | — | ✅ setProfileEnabled 白名单 |
| 无 PROTECTED_TASKS | tasks.ts | — | — | — | ❌ 无保护名单 |

### 9.4 诚实回执（M5/L12 修复确认）

- 所有服务操作均走 `parseActionOutcome`（ERR 优先、OK 独立成行、空输出算失败）
- gamemode macOS boost 用 `PID_RE` 验证 stdout 而非盲信
- toolbox win32 回收站用 `try/catch -ErrorAction Stop`
- winservices/tasks/firewall 的 PS 脚本均用 `try/catch -ErrorAction Stop` 输出 `"OK"` / `"ERR:..."`
- **confirmed：未发现残留的 `includes('OK')` 或 `SilentlyContinue + 无条件 OK` 模式**

### 9.5 修复项闭合确认

| 编号 | 描述 | 状态 | 走读证据 |
|---|---|---|---|
| M5 | 假成功/静默失败 | ✅ 闭合 | toolbox.ts:60 try/catch；各服务统一 parseActionOutcome |
| M10 | macOS caffeinate 进程泄漏 | ✅ 闭合 | gamemode.ts:17 独立 KEY_CAFF_PID；:220-230 重复 boost 先 kill |
| L4 | 启动项注入面 | ✅ 闭合 | autolaunch.ts:45 escapeDesktopExecArg；desktopEntry.ts:17 |
| L9 | .desktop 未转义 | ✅ 闭合 | autolaunch.test.ts:106-109 验证转义 |
| L12 | gamemode 还原凭据注入 | ✅ 闭合 | gamemode.ts:146-165 三平台白名单 + invalidPrevScript |
| M1 | Tasks 状态键不一致 | ✅ 闭合 | 服务端 taskLocator 统一（Vue 端 taskKey 在渲染层修复） |
| M2 | Firewall 条件反转 | ✅ 闭合 | 服务端无此问题（Vue 层 useFlash 修复） |
| L3 | Settings/History 无 try/catch | ✅ 闭合 | main.ts:116-121 settings:set 有 try/catch |


# 第 6 节：契约与渲染层逐行走读

> 走读日期：2026-09-17
> 走读范围：`electron/main.ts`、`electron/preload.ts`、`shared/types.ts`、4 个 composables、`src/router/index.ts`、4 个组件、`src/theme/*`（4 文件）、15 个 `.vue` 页面
> 校验手段：逐行打开磁盘源码文件，非凭印象；契约对账以 `shared/types.ts` 的 `GaleApi` 接口为唯一源
> 前置文档：`docs/code-review-2026-09-16.md`（H1+M1–M10+L1–L12 共 23 项，本节仅确认是否真修复，不重复当新问题上报）

---

## 一、契约源：`shared/types.ts`

- **文件路径**：`shared/types.ts`（`GaleApi` 接口定义在 `:193-341`）
- **职责一句话**：定义渲染进程经 `window.gale` 可调用的全部 IPC 面及其入参/返回类型，是三处同步（types → main handler → preload 暴露）的唯一源。
- **关键链路**：无运行时链路，纯类型声明。`GaleApi` 聚合 17 个命名空间（settings / monitor / hardware / history / optimizer / optlib / onekey / disk / dll / gameMode / toolbox / process / network / firewall / tasks / winServices / app），共 69 个方法签名 + 2 个事件订阅（`onekey.onProgress`、`app.onUpdateEvent`）。
- **状态/数据流**：类型层定义了完整的 DTO 体系——`SystemSnapshot`（含 `degraded[]` 降级字段 `:55`）、`OneKeyProgress`/`OneKeySummary`、`AppUpdateResult`（状态机 8 态 `:738-754`）、`CapabilityLibraryState`、`DllScanResult` 等。
- **安全边界**：`OptCapabilityMetaPatch`（`:441-443`）用 `Omit<..., 'id'|'needsAdmin'|'source'>` 类型层面排除了远端覆盖 `needsAdmin` 的可能——提权边界只能由本地代码定义，M9 修复在类型层落地。
- **改进建议**：
  - 未发现明显问题。契约类型完备，DTO 注释清晰，`degraded[]` 与 `unsupported` 诚实降级字段都在类型层约束。

---

## 二、主进程入口：`electron/main.ts`

- **文件路径**：`electron/main.ts`（全文 344 行；`registerIpc()` 在 `:114-247`；`createWindow()` 在 `:299-330`；白名单在 `:282-297`）
- **职责一句话**：装配全部 service 实例、注册 67 个 `ipcMain.handle`、创建 BrowserWindow、管理生命周期与 openExternal 白名单。
- **关键链路**：
  - 窗口创建：`createWindow()` `:300-315` 配置 `webPreferences`，`ready-to-show` 后 `win.show()`（`:317`）。
  - IPC 注册：`registerIpc()` `:114-247` 一次性注册全部 handler，每个 handler 把渲染层入参做 `String()` / `Boolean()` 收敛后转发给 service。
  - 事件推送：`oneKeyService.onProgress()` `:239-241` 和 `updateService.onState()` `:244-246` 在 `registerIpc` 内只订阅一次，经 `broadcast()` `:250-254` 向所有存活窗口 `webContents.send`。
  - openExternal：`app:openExternal` handler `:224-235` 先过 `isAllowedExternal()` `:290-297`（协议必须 `https:` + hostname 必须在 `ALLOWED_EXTERNAL_HOSTS` `:282-288` 白名单：`github.com`、`objects.githubusercontent.com`、`aka.ms`、`learn.microsoft.com`、`support.microsoft.com`），不通过直接返回 `{ok:false}`。
  - 生命周期：`app.whenReady()` `:332-339` → registerIpc → createWindow → scheduleStartupUpdateCheck；`window-all-closed` `:341-343`（非 macOS 退出）；`activate` `:336-338`（macOS 无窗口时重建）。
- **状态/数据流**：
  - service 装配在模块顶层 `:35-112`，全部单例。`spaceMeter` 全应用共享（`:46`）。`adminRunner`（`:71`）走提权子进程。
  - `scheduleStartupUpdateCheck()` `:262-272` 延迟 8s 静默检查更新，`timer.unref()` 不阻止退出。
- **安全边界**（逐行核对）：
  - `contextIsolation: true` —— `:310`，✅ 已开。
  - `nodeIntegration` —— **未显式设置**（`:308-314` 的 webPreferences 块中无此行）。Electron 33 默认 `nodeIntegration: false`，实际安全但缺少显式声明。
  - `sandbox: false` —— `:313`，有注释说明原因（preload 仅用 contextBridge/ipcRenderer，沙箱可用，但未来里程碑可能引入 Node 能力）。
  - `exposeInMainWorld` —— preload.ts:121 只暴露 `gale` 一个对象，无多余暴露面。
  - `openExternal` 白名单 —— ✅ HTTPS + 5 主机白名单（`:282-297`）。
  - **无 `will-navigate` 守卫** —— 渲染层若被 XSS，攻击者可导航 webContents 到任意 URL。
  - **无 `setWindowOpenHandler`** —— 无 `window.open` / `target="_blank"` 拦截策略。
  - **无单实例锁** —— 全文无 `app.requestSingleInstanceLock()`，用户可同时启动多个实例。
  - **无进程崩溃恢复** —— 无 `render-process-gone` / `gpu-process-crashed` / `uncaughtException` 监听。
- **改进建议**：
  - **高**：**缺少单实例锁**。`main.ts` 全文无 `app.requestSingleInstanceLock()`（confirmed）。多实例并发会导致 electron-store 竞争写入、`oneKeyService` 单例状态机跨实例不一致。最小改动：在 `app.whenReady()` 前加 `const gotLock = app.requestSingleInstanceLock(); if (!gotLock) { app.quit(); }`，并补 `app.on('second-instance')` 聚焦已有窗口。文件位置：`main.ts:332` 之前。
  - **高**：**缺少导航安全守卫**。无 `win.webContents.on('will-navigate', ...)` 和 `win.webContents.setWindowOpenHandler(...)`（confirmed，`createWindow()` `:299-330` 全文无此二行）。渲染层一旦 XSS，攻击者可劫持导航。最小改动：在 `createWindow()` 的 `win.on('ready-to-show')` 附近加 `win.webContents.on('will-navigate', (e, url) => { if (url !== win.webContents.getURL()) e.preventDefault() })` 和 `win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))`。
  - **中**：`nodeIntegration` 未显式声明。`main.ts:308-314` webPreferences 块缺 `nodeIntegration: false`（confirmed）。虽 Electron 33 默认安全，但显式声明可防未来升级回退。最小改动：在 `:310` `contextIsolation: true` 旁加 `nodeIntegration: false`。
  - **中**：**无渲染进程崩溃恢复**。`main.ts` 无 `render-process-gone` / `uncaughtException` 处理（confirmed）。渲染层白屏时用户只能手动重启。最小改动：`createWindow()` 内加 `win.webContents.on('render-process-gone', () => win.reload())` 或至少 `console.error` 记录。
  - **低**：IPC 入参收敛到位。`main.ts` 对每个参数做 `String()` / `Boolean()` / `Number()` 收敛（如 `:154` `ids.map((v) => String(v))`、`:168-170` DllRepairKind 白名单校验、`:161` repairSystemFiles 白名单收敛），渲染层传任意值不会透传为脚本参数。✅ 此项健康。

---

## 三、Preload 桥接层：`electron/preload.ts`

- **文件路径**：`electron/preload.ts`（全文 122 行；`contextBridge.exposeInMainWorld('gale', api)` 在 `:121`）
- **职责一句话**：用 `contextBridge` 把 `GaleApi` 契约逐方法映射到 `ipcRenderer.invoke` / `ipcRenderer.on`，暴露面严格等于契约。
- **关键链路**：
  - 双向映射：每个契约方法 → 一个 `ipcRenderer.invoke('channel:...', ...args)`。
  - 事件订阅：`onekey.onProgress` `:41-45` 包装 `ipcRenderer.on('onekey:progress', listener)` 返回 `removeListener` 退订函数；`app.onUpdateEvent` `:107-111` 同理包装 `app:update`。
- **状态/数据流**：无状态，纯转发层。`api` 对象在 `:4` 构造，`contextBridge.exposeInMainWorld` 在 `:121` 一次性注入。
- **安全边界**：
  - `contextBridge` + `contextIsolation: true`（主进程 `:310`）—— 渲染层拿到的是隔离代理对象，无法访问 `ipcRenderer` 本体。
  - 暴露面 = `GaleApi` 类型：TypeScript 在 `:4` 用 `const api: GaleApi = {...}` 做类型约束，漏实现会编译报错（H1 修复即靠此机制暴露）。
  - **无多余暴露**：除 `gale` 外无其他 `exposeInMainWorld` 调用。
  - 事件 listener 签名 `(_event: unknown, progress: ...) => cb(progress)` —— 丢弃 `event` 对象，不把 Electron 内部对象泄漏到渲染层。
- **改进建议**：
  - 未发现明显问题。暴露面与 `GaleApi` 完全对齐（见下方对账表）。H1（optlib 四接口缺失）已修复：`preload.ts:30-33` 补齐了 `libraryState / checkLibrary / applyLibrary / resetLibrary`。

---

## 四、契约三方对账（types ↔ preload ↔ main handler）

### 对账方法

以 `shared/types.ts:193-341` 的 `GaleApi` 为基准，逐方法核对三处是否同步：

| # | 契约方法 (types.ts) | preload invoke channel (preload.ts) | main handler (main.ts) | 状态 |
|---|---|---|---|---|
| 1 | `settings.get` (`:195`) | `'settings:get'` (`:6`) | `:115` | ✅ |
| 2 | `settings.set` (`:196`) | `'settings:set'` (`:7`) | `:116` | ✅ |
| 3 | `monitor.snapshot` (`:199`) | `'monitor:snapshot'` (`:10`) | `:124` | ✅ |
| 4 | `hardware.info` (`:203`) | `'hardware:info'` (`:13`) | `:125` | ✅ |
| 5 | `history.list` (`:206`) | `'history:list'` (`:16`) | `:126` | ✅ |
| 6 | `history.add` (`:207`) | `'history:add'` (`:17`) | `:127` | ✅ |
| 7 | `history.clear` (`:208`) | `'history:clear'` (`:18`) | `:128` | ✅ |
| 8 | `optimizer.scanCleanup` (`:211`) | `:21` | `:129` | ✅ |
| 9 | `optimizer.runCleanup` (`:212`) | `:22` | `:130` | ✅ |
| 10 | `optimizer.listStartup` (`:213`) | `:23` | `:131` | ✅ |
| 11 | `optimizer.toggleStartup` (`:214`) | `:24` | `:132` | ✅ |
| 12 | `optlib.listCapabilities` (`:218`) | `:28` | `:136` | ✅ |
| 13 | `optlib.runSingle` (`:219`) | `:29` | `:137` | ✅ |
| 14 | `optlib.libraryState` (`:221`) | `:30` | `:139` | ✅ |
| 15 | `optlib.checkLibrary` (`:223`) | `:31` | `:140` | ✅ |
| 16 | `optlib.applyLibrary` (`:225`) | `:32` | `:141` | ✅ |
| 17 | `optlib.resetLibrary` (`:227`) | `:33` | `:142` | ✅ |
| 18 | `onekey.start` (`:231`) | `:37` | `:144` | ✅ |
| 19 | `onekey.cancel` (`:232`) | `:38` | `:147` | ✅ |
| 20 | `onekey.retryFailed` (`:234`) | `'onekey:retry'` (`:39`) | `'onekey:retry'` (`:148`) | ✅ |
| 21 | `onekey.state` (`:236`) | `:40` | `:149` | ✅ |
| 22 | `onekey.onProgress` (`:238`) | `'onekey:progress'` 事件 (`:43`) | broadcast `:240` | ✅ |
| 23 | `disk.volumes` (`:242`) | `:48` | `:150` | ✅ |
| 24 | `disk.scanDeepCleanup` (`:244`) | `:49` | `:151` | ✅ |
| 25 | `disk.runDeepCleanup` (`:252`) | `:50` | `:153` | ✅ |
| 26 | `disk.checkVolume` (`:254`) | `:51` | `:156` | ✅ |
| 27 | `disk.repairSystemFiles` (`:256`) | `:52` | `:159` | ✅ |
| 28 | `dll.scan` (`:261`) | `:56` | `:165` | ✅ |
| 29 | `dll.advice` (`:263`) | `:57` | `:166` | ✅ |
| 30 | `dll.repair` (`:265`) | `:58` | `:167` | ✅ |
| 31 | `gameMode.status` (`:279`) | `:61` | `:172` | ✅ |
| 32 | `gameMode.boost` (`:281`) | `:62` | `:173` | ✅ |
| 33 | `gameMode.restore` (`:283`) | `:63` | `:174` | ✅ |
| 34 | `toolbox.flushDns` (`:286`) | `:66` | `:175` | ✅ |
| 35 | `toolbox.emptyRecycleBin` (`:287`) | `:67` | `:176` | ✅ |
| 36 | `toolbox.clearClipboard` (`:288`) | `:68` | `:177` | ✅ |
| 37 | `toolbox.toggleDarkMode` (`:289`) | `:69` | `:178` | ✅ |
| 38 | `process.list` (`:268`) | `:72` | `:179` | ✅ |
| 39 | `process.kill` (`:269`) | `:73` | `:180` | ✅ |
| 40 | `process.suspend` (`:270`) | `:74` | `:181` | ✅ |
| 41 | `process.resume` (`:271`) | `:75` | `:182` | ✅ |
| 42 | `process.priority` (`:272`) | `:76` | `:183` | ✅ |
| 43 | `network.ping` (`:275`) | `:79` | `:184` | ✅ |
| 44 | `network.interfaces` (`:276`) | `:80` | `:185` | ✅ |
| 45 | `firewall.profiles` (`:292`) | `:83` | `:186` | ✅ |
| 46 | `firewall.listRules` (`:293`) | `:84` | `:187` | ✅ |
| 47 | `firewall.setProfileEnabled` (`:294`) | `:85` | `:188` | ✅ |
| 48 | `firewall.toggleRule` (`:295`) | `:86` | `:191` | ✅ |
| 49 | `tasks.list` (`:298`) | `:89` | `:194` | ✅ |
| 50 | `tasks.setEnabled` (`:299`) | `:90` | `:195` | ✅ |
| 51 | `tasks.run` (`:300`) | `:91` | `:198` | ✅ |
| 52 | `tasks.stop` (`:301`) | `:92` | `:199` | ✅ |
| 53 | `winServices.list` (`:304`) | `:95` | `:200` | ✅ |
| 54 | `winServices.start` (`:305`) | `:96` | `:201` | ✅ |
| 55 | `winServices.stop` (`:306`) | `:97` | `:202` | ✅ |
| 56 | `winServices.setStartupType` (`:307`) | `:98` | `:203` | ✅ |
| 57 | `app.getVersion` (`:311`) | `:101` | `:206` | ✅ |
| 58 | `app.checkUpdate` (`:313`) | `:102` | `:207` | ✅ |
| 59 | `app.getUpdateState` (`:315`) | `:103` | `:208` | ✅ |
| 60 | `app.getUpdateCapability` (`:317`) | `:104` | `:209` | ✅ |
| 61 | `app.onUpdateEvent` (`:319`) | `'app:update'` 事件 (`:109`) | broadcast `:245` | ✅ |
| 62 | `app.getUpdatePrefs` (`:321`) | `:105` | `:210` | ✅ |
| 63 | `app.setUpdatePrefs` (`:323`) | `:106` | `:211` | ✅ |
| 64 | `app.installUpdate` (`:325`) | `:112` | `:217` | ✅ |
| 65 | `app.getAutoLaunch` (`:327`) | `:113` | `:220` | ✅ |
| 66 | `app.setAutoLaunch` (`:329`) | `:114` | `:221` | ✅ |
| 67 | `app.isElevated` (`:331`) | `:115` | `:222` | ✅ |
| 68 | `app.restartElevated` (`:333`) | `:116` | `:223` | ✅ |
| 69 | `app.openExternal` (`:339`) | `:117` | `:224` | ✅ |

**对账结论**：69 个方法 + 2 个事件全部三方对齐。无孤儿 handler（main.ts 注册了但 preload 未暴露的），无契约缺口（preload 暴露了但 main.ts 未注册的）。H1（optlib 四接口）已修复确认。

- **改进建议**：
  - **低**：`onekey.retryFailed` 方法名（契约 `:234`）与 IPC channel 名 `'onekey:retry'`（preload.ts:39 → main.ts:148）不一致（confirmed）。内部一致不影响运行，但维护时易误找 `'onekey:retryFailed'`。最小改动：统一 channel 名为 `'onekey:retryFailed'`，需同步改 preload.ts:39 和 main.ts:148。

---

## 五、Composables 层

### 5.1 `useOneKey.ts`

- **文件路径**：`src/composables/useOneKey.ts`（导出 `useOneKey()` `:187`；模块级单例 ref 在 `:16-25`）
- **职责一句话**：一键优化的跨页面共享状态单例——首页 Hero 按钮与 OneKeyPanel 面板操作同一份进度/汇总/能力清单。
- **关键链路**：
  - 渲染触发：用户点「开始一键优化」→ `start()` `:96-113` → `window.gale.onekey.start(ids)` → 主进程 `oneKeyService.start()` → 返回 `OneKeySummary`。
  - 进度推送：主进程 `broadcast('onekey:progress')` → preload `onekey.onProgress` → `subscribe()` `:53-59` 的回调写入 `progress.value`；`phase` 为 `done/cancelled` 时自动复位 `busy=false`（`:57`）。
  - 取消：`cancel()` `:115-121` → `window.gale.onekey.cancel()`。
  - 重试失败项：`retryFailed()` `:123-136` → `window.gale.onekey.retryFailed()`（channel `onekey:retry`）。
  - 状态恢复：`restore()` `:83-94` → `window.gale.onekey.state()` 读主进程内快照，切页面回来不空白。
  - 取消/卸载分支：`subscribe()` 守卫 `if (unsub) return`（`:54`）防重复订阅；`OneKeyPanel.vue:64-66` 的 `onUnmounted` 为空——**故意不退订**，因模块级单例需跨页面持续接收推送。
- **状态/数据流**：模块级 `progress / summary / capabilities / selected / elevated / error / busy` 七个 ref（`:16-22`）。`running` / `finished` / `outcomes` / `failedIds` / `percent` 为 computed 派生（`:27-50`）。
- **安全边界**：仅经 `window.gale` 调用，无裸 IPC。✅
- **改进建议**：
  - 未发现明显问题。并发守卫（主进程 M8 已修）+ 模块级单例 + 防重复订阅 + 状态恢复，闭环完整。

### 5.2 `useAppUpdate.ts`

- **文件路径**：`src/composables/useAppUpdate.ts`（导出 `useAppUpdate()` `:136`；模块级单例 `state` 在 `:14`）
- **职责一句话**：应用更新状态机的全局唯一渲染层镜像——后台静默检查、侧边栏入口、设置页偏好共用同一份状态。
- **关键链路**：
  - 初始化：`useAppUpdate()` 调用时 `void init()`（`:137`）→ `init()` `:29-58` 串行拉取 capability / state / prefs，然后 `a.onUpdateEvent(cb)` 订阅推送。`inited` 守卫防重复（`:30-31`）。
  - 主动检查：`check()` `:67-85` → `a.checkUpdate()`，`checking=true` 起手、`finally` 复位。失败收敛为 `status:'error'` 状态而非抛异常（`:76-81`）——因 Vue `@click` 绑定不捕获 promise rejection。
  - 事件推送：主进程 `broadcast('app:update')` → preload `app.onUpdateEvent` → 回调写 `state.value`，`status!=='checking'` 时复位 `checking=false`（`:53`）。
  - 偏好写入：`setPrefs()` `:97-107`，失败时保留原值并记 `prefError`（不制造假成功）。
- **状态/数据流**：模块级 `state / capability / checking / prefs / prefError` 五个 ref。`busy / hasUpdate / ready / supported / percent / label / canCheck` 为 computed（`:139-173`）。
- **安全边界**：仅经 `window.gale.app.*` 调用。✅
- **改进建议**：
  - 未发现明显问题。终态复位路径（`finally` + 事件回调双重收敛）覆盖完整，偏好写入失败有回拨。

### 5.3 `usePolling.ts`

- **文件路径**：`src/composables/usePolling.ts`（导出 `usePolling(task, intervalMs)` `:17`）
- **职责一句话**：带并发守卫的定时轮询——上一次未返回就跳帧而非排队。
- **关键链路**：
  - `start()` `:43-47` → `setInterval(() => void tick(), intervalMs)`。
  - `tick()` `:27-41`：`busy` 为 true 则 `skipped++` 跳过；否则置 `busy=true` → `await task()` → `finally busy=false`。
  - 卸载清理：`getCurrentInstance()` 探测后 `onUnmounted(stop)`（`:59`），`stop()` 清 timer 并复位 `active/skipped`（`:49-56`）。
- **状态/数据流**：局部 `busy / skipped / active` ref + `timer` 闭包变量。
- **安全边界**：无 IPC，纯定时器。
- **改进建议**：
  - 未发现明显问题。M7 修复落地，Monitor.vue（1s）和 Home.vue（2s）均已接入。

### 5.4 `useFlash.ts`

- **文件路径**：`src/composables/useFlash.ts`（导出 `useFlash(ttlMs)` `:53`；`inferTone` `:35`）
- **职责一句话**：页面操作反馈（成功/失败提示）的统一实现——定时器随卸载清理、语气结构化、键格式统一。
- **关键链路**：
  - `flash(key, message, tone?)` `:60-77`：先清同 key 旧定时器 → 写 `feedback/tones` → 设新 TTL 定时器（到期删 key）。
  - `clear()` `:79-84`：清全部定时器 + 清空 feedback/tones。
  - 卸载清理：`getCurrentInstance()` 探测后 `onUnmounted(clear)`（`:88`）。
- **状态/数据流**：局部 `feedback / tones` ref + `timers` Map。
- **安全边界**：无 IPC。
- **改进建议**：
  - 未发现明显问题。L1 修复落地。`inferTone` 正则兜底（`:24-25`）+ 结构化 `tone` 参数双轨，M2 的 Firewall 语义反转已通过结构化 tone 根除。

---

## 六、路由层：`src/router/index.ts`

- **文件路径**：`src/router/index.ts`（导出 `router` `:3`）
- **职责一句话**：Hash 模式路由，15 个页面懒加载 + 通配重定向到首页。
- **关键链路**：
  - `createWebHashHistory()` `:4` —— Electron 下用 hash 路由避免 file:// 协议路径问题。
  - 15 条路由 `:6-20`，每条 `component: () => import(...)` 懒加载。
  - 通配 `/:pathMatch(.*)*` → redirect `/`（`:21`）。
  - `afterEach` `:25-27` 设 `document.title`。
- **状态/数据流**：无。
- **安全边界**：无 IPC、无动态导航注入。路由 path 均为静态字符串，无用户输入直达路由。
- **改进建议**：
  - 未发现明显问题。

---

## 七、组件层（4 个）

### 7.1 `AppSidebar.vue`

- **文件路径**：`src/components/AppSidebar.vue`（`navItems` `:4-20`；更新入口 `:114-137`）
- **职责一句话**：左侧导航栏，15 个路由链接 + 底部全局更新检查/安装按钮。
- **关键链路**：`useAppUpdate()` 单例 → `check / install` 按钮 → `window.gale.app.*`。
- **状态/数据流**：直接消费 `useAppUpdate()` 的 `state / busy / ready / hasUpdate / canCheck`。
- **安全边界**：仅经 composable 间接调 IPC。L10 无障碍修复确认：`aria-label` / `title` / `aria-label="主导航"` 均已补（`:27, :39-40`）。
- **改进建议**：未发现明显问题。

### 7.2 `OneKeyPanel.vue`

- **文件路径**：`src/components/OneKeyPanel.vue`（`useOneKey()` 解构 `:6-30`；模板 `:69-161`）
- **职责一句话**：一键优化执行面板——能力勾选列表 + 进度条 + 逐项结果 + 汇总报告 + 提权提示。
- **关键链路**：`onMounted` `:59-63` → `loadCapabilities()` + `refreshElevated()` + `restore()`。
- **状态/数据流**：全量消费 `useOneKey()` 的单例状态。
- **安全边界**：提权按钮 `restartElevated()` `:34-43` 调 `window.gale.app.restartElevated()`，有 try/catch。
- **改进建议**：
  - 未发现明显问题。`onUnmounted` 空函数有注释说明意图（`:64-66`），模块级单例不退订是正确设计。

### 7.3 `UpdateCard.vue`

- **文件路径**：`src/components/UpdateCard.vue`（`releasesUrl` 常量 `:26`；`openReleases` `:44-50`）
- **职责一句话**：更新卡片——当前版本/状态/进度条/检查安装按钮/偏好开关，compact 模式用于首页。
- **关键链路**：`useAppUpdate()` 单例 → `check / install / setPrefs`。
- **状态/数据流**：消费 `useAppUpdate()` 的 `state / capability / prefs / prefError`。
- **安全边界**：`openReleases` `:44-50` 调 `window.gale.app.openExternal(releasesUrl)`，try/catch 兜住 rejection（L3 修复确认）。`releasesUrl = 'https://github.com/afdk1991/gale-engine/releases/latest'`（`:26`）——主机 `github.com` 在白名单内（main.ts:283）。✅
- **改进建议**：未发现明显问题。偏好回拨逻辑 `:58` 在写入失败时显式还原 checkbox 状态，防假成功。

### 7.4 `CapabilityLibraryPanel.vue`

- **文件路径**：`src/components/CapabilityLibraryPanel.vue`（`refresh` `:27-33`；`check/apply/reset` `:35-75`）
- **职责一句话**：能力库管理面板——展示来源/版本/远端能力/被拒条目，支持检查更新/应用/回退。
- **关键链路**：`onMounted(refresh)` `:77` → `window.gale.optlib.libraryState()`。
- **状态/数据流**：局部 `state / busy / message` ref。
- **安全边界**：仅经 `window.gale.optlib.*` 调用，全部有 try/catch + finally 复位 busy。
- **改进建议**：
  - 未发现明显问题。被拒条目显式列出（`:112-117`），远端能力与覆盖元信息分区展示。

---

## 八、主题层（4 文件）

### 8.1 `tokens.ts`

- **文件路径**：`src/theme/tokens.ts`（`ACCENTS` `:15-22`；`resolveTheme` `:31-34`；`applyAccentToDocument` `:37-44`）
- **职责一句话**：定义 6 个强调色 token + system/light/dark 三模式解析 + CSS 变量注入。
- **关键链路**：`applyAccentToDocument(accent)` `:37-44` 把 `--accent / --accent-bg / --accent-hover / --accent-soft` 内联到 `documentElement`。
- **状态/数据流**：纯函数 + 常量。
- **安全边界**：无 IPC。
- **改进建议**：
  - **低**：`theme.css:17-30` 的 `[data-theme='dark']` 块也定义了 `--accent` 等变量（`:25-28`），但这些值**总是被 `applyAccentToDocument()` 的内联样式覆盖**（confirmed）——`applyResolved()` 在每次 init/setAppearance/setAccent 时都调用 `applyAccentToDocument`。dark 模式下的 accent CSS 变量是死代码。最小改动：要么从 theme.css dark 块移除 `--accent*` 四行，要么让 `applyAccentToDocument` 根据 `resolved` 模式选不同色板。

### 8.2 `useTheme.ts`

- **文件路径**：`src/theme/useTheme.ts`（`createThemeController(opts)` `:22-74`）
- **职责一句话**：可注入的主题控制器工厂——loadSettings/saveSettings/media 均可替换，便于测试。
- **关键链路**：
  - `init()` `:43-55` → `opts.loadSettings()` → 写 `appearance/accent` → `applyResolved()` → 监听 `media.change`。
  - `setAppearance(mode)` `:57-61` → 更新 ref → `applyResolved()` → `opts.saveSettings({appearance})`。
  - `setAccent(key)` `:63-67` → 同理持久化。
  - `dispose()` `:69-71` → 移除 media listener。
- **状态/数据流**：`appearance / accent / resolved` 三个 ref。
- **安全边界**：loadSettings/saveSettings 由注入方提供（themeController.ts 接 `window.gale.settings`）。
- **改进建议**：
  - 未发现明显问题。3 模式（system/light/dark）× 6 色（blue/cyan/violet/green/orange/gradient）在 tokens 中全定义（confirmed：`AccentKey` 类型 `shared/types.ts:3` = 6 键，`AppearanceMode` `:1` = 3 值），且 `setAppearance/setAccent` 经 IPC 持久化到 electron-store。

### 8.3 `themeController.ts`

- **文件路径**：`src/theme/themeController.ts`（单例 `themeController` `:3-6`）
- **职责一句话**：把 `createThemeController` 接到 `window.gale.settings`，导出全局单例。
- **关键链路**：`loadSettings: () => window.gale.settings.get()` / `saveSettings: (patch) => window.gale.settings.set(patch)`（`:4-5`）。
- **状态/数据流**：单例，`src/main.ts:8` 在应用启动时 `await themeController.init()`。
- **安全边界**：仅经 `window.gale.settings.*`。
- **改进建议**：未发现明显问题。

### 8.4 `theme.css`

- **文件路径**：`src/theme/theme.css`（light `:1-15`，dark `:17-30`）
- **职责一句话**：CSS 变量的基础值（背景/边框/文字/阴影），accent 变量会被运行时内联覆盖。
- **关键链路**：无 JS 链路，纯样式。
- **状态/数据流**：`documentElement.dataset.theme` 由 `useTheme.ts:39` 设置为 `'light'` / `'dark'`，CSS 据此切换变量。
- **安全边界**：无。
- **改进建议**：见 8.1 的低严重度建议（dark 块 accent 变量死代码）。

---

## 九、路由层入口与渲染层安全扫描

### 9.1 `src/main.ts`（渲染入口）

- **文件路径**：`src/main.ts`（全文 10 行）
- **职责一句话**：`await themeController.init()` → 创建 Vue 应用 → 挂路由 → mount。
- **关键链路**：`themeController.init()` 在 mount 前完成，确保首屏无主题闪烁。
- **改进建议**：未发现明显问题。

### 9.2 `src/App.vue`

- **文件路径**：`src/App.vue`（全文 16 行）
- **职责一句话**：`<AppSidebar />` + `<RouterView />` 布局壳。
- **改进建议**：未发现明显问题。

### 9.3 `src/env.d.ts`

- **文件路径**：`src/env.d.ts`（全文 10 行）
- **职责一句话**：`declare global { interface Window { gale: GaleApi } }` —— 让渲染层 TypeScript 认得 `window.gale`。
- **改进建议**：未发现明显问题。

### 9.4 渲染层裸用扫描结论

对 `src/` 全目录 grep `ipcRenderer|require(|nodeIntegration|__dirname|process\.`：
- **零命中**（confirmed）。唯一命中的是 `window.gale.process.*`（进程管理模块），非 Node `process` 对象。
- 全部 77 处 IPC 调用均经 `window.gale.*` 前缀（grep 确认）。✅

---

## 十、15 个页面走读（按页归类）

### A 组：表格列表 + useFlash 操作页（4 页）

共性：均 `onMounted` 拉列表 → `act()` 辅助函数统一 try/catch/finally → 成功写 history → `useFlash` 提示。

| 页面 | 职责一句话 | 关键确认 |
|---|---|---|
| **Process.vue** | 进程列表（排序/结束/挂起/恢复/优先级），系统关键进程保护 | `useFlash` ✅；`confirmKill` 二次确认 ✅；`busy=pid` 并发守卫 ✅ |
| **Services.vue** | Windows 服务列表（启动/停止/启动类型），关键服务保护 | `useFlash` ✅；`confirmStop` 二次确认 ✅；`canStop/protected` 双重门控 ✅ |
| **Tasks.vue** | 计划任务列表（启用/禁用/运行/结束） | **M1 修复确认**：`taskKey()` `:19` 唯一函数，脚本 `:48` 与模板 `:100/112/115/116/118` 共用 ✅ |
| **Firewall.vue** | 防火墙配置文件开关 + 规则列表 | **M2 修复确认**：模板 `:108` 用 `tone(key)==='bad'` 结构化判断，不再 `includes('拒绝')` ✅ |

### B 组：诊断/单操作页（5 页）

| 页面 | 职责一句话 | 关键确认 |
|---|---|---|
| **Network.vue** | Ping 延迟测试 + 网卡接口列表 | `quickHosts` 快捷主机 ✅；无 useFlash（结果直接渲染）✅ |
| **Hardware.vue** | 静态硬件型号规格展示（主板/CPU/内存/显卡/显示器/硬盘/电源） | `orDash` 空值兜底 ✅；电池 Wh 标注（L5 修复确认 `:133`）✅ |
| **GameMode.vue** | 游戏模式电源计划切换（boost/restore） | **L12 修复确认**：按 `r.ok` 回执决定提示与留痕（`:31-36`），不再假成功 ✅ |
| **Toolbox.vue** | 系统小工具（DNS/回收站/剪贴板/深浅色） | **L2 修复确认**：深色/浅色按钮共用 `busy==='dark'\|\|busy==='light'`（`:83,88`）✅ |
| **History.vue** | 优化记录列表 + 清空 | **L3 修复确认**：`clearAll` `:36-46` 有 try/catch，失败如实报错不 reload ✅ |

### C 组：复杂多区块页（6 页）

| 页面 | 职责一句话 | 关键确认 |
|---|---|---|
| **Home.vue** | 首页 Hero + 健康评分 + OneKeyPanel + UpdateCard + 模块入口 | **M7 修复确认**：`usePolling(refresh, 2000)` `:59` ✅；`degradedText()` 降级提示 `:72` ✅ |
| **Monitor.vue** | 硬件监控面板（CPU/内存/网络/温度/磁盘，1s 刷新） | **M7 修复确认**：`usePolling(refresh, 1000)` `:33` ✅ |
| **Optimizer.vue** | 优化中心（垃圾扫描清理 + 启动项管理 + CapabilityLibraryPanel） | `runCleanup` 传 `{id,path,kind}` ✅；`toggleStartup` 传 `item.command` 仅启用时 ✅ |
| **DiskRepair.vue** | 磁盘空间总览 + 深度释放 + 卷检查修复 + SFC/DISM | **L6 修复确认**：`runDeepCleanup` 只传 `ids`（`:91`），不传 `detail` ✅；**M3 修复确认**：`spaceMeter` 已注入 main.ts:47 ✅ |
| **DllRepair.vue** | DLL 缺失扫描 + 修复建议 + 执行修复 + 自动复扫 | `openExternal` `:85-87` 调 `window.gale.app.openExternal`（URL 来自 `nextSteps`，主进程白名单兜底）✅ |
| **Settings.vue** | 主题外观 + 主题色 + UpdateCard + 管理员权限 + 开机自启 | **L3 修复确认**：`toggleAutoLaunch` `:39-50` 有 try/catch，以主进程回传值为准 ✅ |

### 页面共性问题

- **未发现跨页面的共性 bug**。H1/M1–M10/L1–L12 全部 23 项修复在渲染层逐页确认闭合，无未修复分支。
- **小观察**：DllRepair.vue `:85` 的 `openExternal(url)` 直接调 `window.gale.app.openExternal(url)` 而无 try/catch——URL 来自主进程 `DllRepairResult.nextSteps`，主进程白名单已兜底拒绝非白名单主机，此处 rejection 风险极低。低优先级。

---

## 十一、安全边界总览

| 检查项 | 状态 | 证据 |
|---|---|---|
| `contextIsolation: true` | ✅ | main.ts:310 |
| `nodeIntegration` 显式关闭 | ⚠️ 未显式写（默认 false） | main.ts:308-314 无此行 |
| `sandbox: false` | ⚠️ 已知项（有注释） | main.ts:313 |
| 渲染层无裸 `ipcRenderer` | ✅ | grep src/ 零命中 |
| 渲染层无裸 `require(` | ✅ | grep src/ 零命中 |
| `exposeInMainWorld` 仅暴露 `gale` | ✅ | preload.ts:121 |
| `openExternal` HTTPS + 主机白名单 | ✅ | main.ts:282-297, 224-235 |
| `will-navigate` 守卫 | ❌ 缺失 | main.ts createWindow() 无 |
| `setWindowOpenHandler` | ❌ 缺失 | main.ts createWindow() 无 |
| 单实例锁 | ❌ 缺失 | main.ts 全文无 `requestSingleInstanceLock` |
| 渲染进程崩溃恢复 | ❌ 缺失 | main.ts 无 `render-process-gone` |

---

## 十二、改进建议汇总

| # | 严重度 | 问题 | 位置 | 最小改动 |
|---|---|---|---|---|
| 1 | **高** | 无单实例锁，多实例并发写 electron-store / 竞争 onekey 状态机 | main.ts（全文无 `requestSingleInstanceLock`） | `app.whenReady()` 前加 `const got=app.requestSingleInstanceLock(); if(!got){app.quit();}` + `app.on('second-instance')` 聚焦窗口 |
| 2 | **高** | 无 `will-navigate` / `setWindowOpenHandler`，XSS 后可劫持导航 | main.ts createWindow() `:299-330` | 加 `win.webContents.on('will-navigate', ...)` 限同源 + `setWindowOpenHandler(()=>({action:'deny'}))` |
| 3 | **中** | `nodeIntegration` 未显式声明（默认安全但缺防御纵深） | main.ts:308-314 | webPreferences 块加 `nodeIntegration: false` |
| 4 | **中** | 无渲染进程崩溃恢复，白屏无感知 | main.ts createWindow() | 加 `win.webContents.on('render-process-gone', () => win.reload())` |
| 5 | **低** | `onekey.retryFailed` 方法名 vs channel `onekey:retry` 不一致 | preload.ts:39 / main.ts:148 | 统一 channel 为 `onekey:retryFailed` |
| 6 | **低** | theme.css dark 块 `--accent*` 四行被内联样式覆盖，属死代码 | theme.css:25-28 | 移除或改为按模式选色板 |
| 7 | **低** | DllRepair.vue `openExternal(url)` 无 try/catch | DllRepair.vue:85-87 | 包 `try/catch`，与 UpdateCard.openReleases 对齐 |

**已确认修复的历史问题（不再当新问题）**：H1（optlib 四接口）、M1（taskKey）、M2（Firewall tone）、M3（spaceMeter 注入）、M7（usePolling 并发守卫）、M8（onekey 占位锁，主进程侧）、L1（useFlash 卸载清理）、L2（Toolbox busy 键）、L3（三处 try/catch）、L5（电池 Wh）、L6（runDeepCleanup 只传 id）、L10（aria-label）、L12（GameMode 回执）——全部在渲染层逐文件确认闭合。


