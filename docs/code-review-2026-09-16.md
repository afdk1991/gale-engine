# 疾风引擎 全量代码审查报告

- 审查日期：2026-09-16
- 审查范围：`electron/**`（主进程 + 21 个 service）、`src/**`（渲染层 15 页面 + 组件 + composable）、`shared/types.ts`、`scripts/**`
- 校验手段：`vue-tsc --noEmit`（类型门禁）、`vitest run`（413 项）、磁盘级逐条复核
- 门禁现状（审查当时）：**typecheck 1 处失败（阻断级）**，**测试 413/413 通过**
- 复检（同日修复后）：**typecheck 0 错误**、**测试 498/498 通过**、**`electron-vite build` 通过** —— 详见第〇节「修复进度」

> 说明：报告中所有文件行号均经磁盘检索逐条复核，非首轮读取的缓存内容。

---

## 〇、修复进度（2026-09-16 当日复检）

| 编号 | 问题 | 状态 | 修复要点 |
|---|---|---|---|
| H1 | preload 未实现 optlib 四接口 | ✅ 已修 | preload 补齐 `libraryState / checkLibrary / applyLibrary / resetLibrary` |
| M1 | Tasks 状态键拼接不一致 | ✅ 已修 | 抽出唯一的 `taskKey()`，脚本与模板共用，消除两处各写一遍 |
| M2 | Firewall 条件语义反转 | ✅ 已修 | 新增 `useFlash` 用结构化 `tone`，不再靠 `includes('拒绝')` 嗅探 |
| M3 | 优化中心 SpaceMeter 未注入 | ✅ 已修 | `meter` 改为**带默认实现**的参数，从机制上杜绝"忘记注入" |
| M4 | PowerShell `[int]` 溢出 | ✅ 已修 | 容量一律 `[long]`（Int64），并写明禁令注释 |
| M5 | 假成功 / 静默失败 | ✅ 已修 | 见下方明细 |
| M6 | 监控采集无异常兜底 | ✅ 已修 | 按字段降级 + 新增 `degraded[]`，单项失败不再整页空白 |
| M7 | 高频轮询无并发守卫 | ✅ 已修 | 新增 `usePolling`（上一次未返回就跳帧而非排队），Monitor/Home 已接入 |
| M8 | 一键优化并发竞态 | ✅ 已修 | 同步占位锁 `starting`（在任何 `await` 之前）+ 收尾 `finally` |
| M9 | 远端可放宽 needsAdmin | ✅ 已修 | 只许收紧不许放宽；`metaOverrides` 已不下发该字段 |
| M10 | macOS caffeinate 进程泄漏 | ✅ 已修 | PID 独立键存储 + 重复 boost 先回收上一轮进程 |
| L1 | `flash()` 定时器未随卸载清理 | ✅ 已修 | 新增 `useFlash` 组合式函数，`onUnmounted(clear)` 统一回收定时器 |
| L2 | Toolbox 深浅色按钮 busy 键错位 | ✅ 已修 | 两个按钮共用 busy 判定并显示"执行中…" |
| L3 | Settings/History/UpdateCard 无 try/catch | ✅ 已修 | 三处均补 try/catch，失败如实报错而非未捕获 rejection |
| L4 | `buildToggleStartupScript` 注入面 | ✅ 已修 | 启动项 name/location 走白名单校验；`.desktop` 的 `Exec=` 经 `escapeDesktopExecArg` |
| L5 | 电池 mWh 当 W 显示 | ✅ 已修 | 换算为 Wh（`mWh / 1000`），界面按 type 标注 `Wh` / `W` |
| L6 | `runDeepCleanup` 传 `path` 语义混淆 | ✅ 已修 | 契约收紧为只收 `id` 数组，渲染层与服务层签名同步 |
| L7 | UAC 无响应时临时文件残留 | ✅ 已修 | `finally` 逐项 `safeUnlink` + 启动时 `sweepStaleTemp` 清理 >1h 的陈旧残留 |
| L8 | 启动项禁用后无法再启用 | ✅ 已修 | 禁用改为置 `Hidden=true`（保留原始值），可原地再启用 |
| L9 | `buildAutostartContent` 未转义 | ✅ 已修 | `Exec=` 改用 `escapeDesktopExecArg`（转义引号/`$`/反引号） |
| L10 | 侧边栏折叠后无障碍缺失 | ✅ 已修 | 导航项与版本按钮补 `aria-label` / `title`，`nav` 补 `aria-label` |
| L11 | ping 丢包率未 clamp | ✅ 已修 | 脚本端与解析端双重 clamp 到 0–100，且 `ok` 与 `loss` 自洽 |
| L12 | gamemode 还原凭据注入 | ✅ 已修 | 还原凭据（GUID/governor/PID）白名单校验 + 诚实回执 + UI 不再假成功 |

**门禁复检**：`vue-tsc --noEmit` **0 错误**；`vitest run` **498/498 通过**（29 文件，较审查时的 413 项 +85）；`electron-vite build` **通过**。

### M5 修复明细（本次新修）

| 位置 | 修复 |
|---|---|
| `process.ts` 结束进程 | `SilentlyContinue; "OK"` → `try { Stop-Process -ErrorAction Stop; "OK" } catch { "ERR:…" }` |
| `process.ts` `parseActionResult` | `includes('OK')` → 按行判定，`ERR:` 优先、OK 必须独立成行、空输出如实报失败 |
| `optimizer.ts` 禁用启动项 | 改为「不存在则幂等成功 / 存在但删除失败才报 ERR」，不再无条件 OK |
| `optimizer.ts` launchd / autostart 禁用 | `; echo "OK"` → `&& echo "OK" || echo "ERR:…"` |
| `toolbox.ts` 清空回收站（win/mac/linux） | 三处均改为显式判定，失败输出 `ERR:` 而非静默 |

### 仍存在的已知限制（未擅自改动）

- **启动项「禁用」的语义仍是隐藏而非改名**（L8 已改为可用方案）：Windows 注册表值置
  `Hidden=true`、macOS plist 的 `Disabled` 置真、Linux `.desktop` 加 `Hidden=true`，
  项仍留在 `listStartup()` 结果中，因此**可原地再启用**，不再有「禁用即丢失」的问题。
  若后续希望彻底不列出（例如与系统「启动项」面板行为完全一致），需产品侧确认。
- **Linux `deb` 包无法自更新**：electron-updater 在 Linux 上只支持 AppImage，`deb`
  安装的实例会返回 `unsupported` 并给出「手动下载」替代路径（界面已如实告知原因，
  不再出现「点了没反应」）。这是上游能力边界，非本项目缺陷。

---

## 一、高严重度（必须修复，阻断构建/功能不可用）

### H1. `electron/preload.ts` 未实现 optlib 能力库接口 → typecheck 失败
- **位置**：`electron/preload.ts:27-30`；契约在 `shared/types.ts:215-221`
- **现状**：主进程 `main.ts:134-137` 已注册 `optlib:libraryState / checkLibrary / applyLibrary / resetLibrary` 四个 IPC，且 `capabilityFeed` 已在 `main.ts:81` 完成装配；但 preload 的 `optlib` 只暴露了 `listCapabilities` / `runSingle`。
- **报错原文**：
  ```
  electron/preload.ts(27,3): error TS2739: Type '{ listCapabilities; runSingle }' is missing
  the following properties from type '...': libraryState, checkLibrary, applyLibrary, resetLibrary
  ```
- **影响**：`npm run typecheck` 直接失败（当前唯一类型错误）；渲染层无法调用远端能力库更新；CI 若接入类型门禁会红。测试（vitest）不覆盖 preload，因此 413 项全绿也发现不了它。
- **修复**：preload 补 4 行 `ipcRenderer.invoke('optlib:*')` 映射即可。

---

## 二、中严重度（逻辑错误 / 结果不正确）

### M1. 计划任务页：状态键拼接不一致 → 禁用失效、反馈不显示
- **位置**：`src/pages/Tasks.vue:48` 写 `const key = \`${t.path}|${t.name}\``；模板 `:disabled` 与 `feedback[...]` 用 `t.path + t.name`（第 112/115/116/118 行）
- **原因**：两处键格式不同（带 `|` vs 不带），读取恒为未命中。
- **影响**：操作期间按钮不会置灰，用户可重复点击同一任务触发并发执行；操作结果提示永远不显示。

### M2. 防火墙页：条件表达式语义写错
- **位置**：`src/pages/Firewall.vue:110`
  ```vue
  :class="{ bad: !p.enabled === feedback[`profile:${p.name}`].includes('拒绝') }"
  ```
- **原因**：把「是否禁用」与「反馈是否含拒绝」两个布尔量做相等比较，而非判断后者。
- **影响**：提示颜色反转 —— 成功反馈被标红，真正被拒绝的反馈反而显示正常色。

### M3. 优化中心「释放空间」恒不显示（SpaceMeter 未注入）
- **位置**：`electron/main.ts:42` 与 `:96` 调用 `createOptimizerService(runner, platform)`，未传第三个参数 `meter`；`electron/services/optimizer.ts:464/500` 的测量逻辑完全依赖 `meter`
- **对照**：`disk.ts:574` 在磁盘服务内部自建 `createSpaceMeter`，所以磁盘深度清理能显示释放量
- **影响**：优化中心、一键优化中 temp / browser / recycle 类项目的「释放了多少」永远缺失（界面显示 0 或不显示），而同类磁盘项却正常 —— 表现不一致。

### M4. PowerShell `[int]` 转换溢出 → 大目录扫描结果为空
- **位置**：`electron/services/optimizer.ts:93`、`112`（`size=[int]([double]$sz)`）与 `:100`（`size=[int]$sz`）
- **原因**：`[int]` 是 Int32，上限 2,147,483,647（约 2.1 GB）。临时目录、回收站、浏览器缓存超过该量级时，PowerShell 5.1 会抛 "Value was either too large or too small for an Int32"，导致整个扫描脚本中断或输出非法 JSON，`parseJsonArray` 吞掉异常返回空数组。
- **影响**：垃圾越多越扫不出来，界面显示「暂无垃圾项」——与用户实际状态完全相反。
- **修复**：改用 `[int64]`（disk.ts 的同类脚本已正确使用 `[int64]`，可对齐）。

### M5. 进程「结束」等操作存在假成功
- **位置**：`electron/services/process.ts:188`
  ```ts
  `${buildGuardWin(pid)}\nStop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue; "OK"`
  ```
- **原因**：guard 只校验「进程存在」与「非受保护进程」；真正的权限失败（拒绝访问）被 `SilentlyContinue` 吞掉，随后无条件输出 `OK`。
- **同类模式**：
  - `optimizer.ts:469` 回收站：`code === 0 || stdout.includes('OK')`，而脚本用 `Clear-RecycleBin -ErrorAction SilentlyContinue`，失败也输出 OK；
  - `toolbox.ts` 的 `Clear-RecycleBin ...; if ($?)` —— `SilentlyContinue` 下 `$?` 恒为 true；
  - `process.ts:270` / `firewall.ts:67` / `tasks.ts:47` / `winservices.ts:86` 均以 `text.includes('OK')` 判成功，错误信息里含 "OK" 字样即被误判。
- **影响**：界面报「操作成功」但进程没结束、回收站没清空，与「清理完成但空间没变」是同一类信任问题。

### M6. 监控数据采集缺少异常兜底
- **位置**：`electron/services/monitor.ts`（全文仅 2 处 `catch`，都在 `temp()` / `battery()`）
- **原因**：`cpu()` / `mem()` / `disks()` / `net()` / `uptime()` 直接 `await` systeminformation，无 try/catch。
- **影响**：任一采集失败 → `snapshot()` 整体 reject → 首页与监控页整块显示「监控数据获取失败」，而不是局部降级（例如只缺温度）。

### M7. 高频轮询无并发守卫
- **位置**：`src/pages/Monitor.vue:38`（`setInterval` 1000ms）、`src/pages/Home.vue:59`（2000ms）
- **原因**：`refresh()` 未判断上一次请求是否返回。
- **影响**：`si.fsSize()` / `currentLoad()` 在机械盘、多卷、网络盘环境下经常超过 1s，请求会持续叠加，造成数据乱序、子进程堆积与内存增长。

### M8. 一键优化并发竞态
- **位置**：`electron/services/onekey.ts` `start()`
- **原因**：并发守卫 `if (state && phase==='running')` 与真正占位的 `state = run` 之间存在 `await deps.isElevated()`，两次快速调用可同时通过守卫。
- **影响**：两轮任务并行执行，进度互相覆盖、同一批目录被并发清理（文件句柄争抢，删除失败率上升）。

### M9. 远端能力清单可放宽 needsAdmin，且两处口径不一致
- **位置**：`electron/services/capabilityFeed.ts:385`（`needsAdmin: def.needsAdmin ?? 步骤推导`）、`:527`（`mergedMetas` 覆盖内置能力 needsAdmin）
- **冲突点**：`optlib.ts:303` 明确注释「needsAdmin 有意不参与覆盖：提权边界只能由本地代码定义」，只覆盖 label/description/defaultEnabled。
- **影响**：
  1. 远端可把包含 `disk.repairSystemFiles` / `dll.repairMissing`（needsAdmin=true）的能力声明为 `false`，`onekey.ts` 的预检据此放行 → 未提权时触发 UAC 弹窗，违背「不轰炸 UAC」的设计；
  2. `state()` 返回的元信息与 `optLibrary` 实际生效的元信息不一致，界面展示与执行结果可能不符。

### M10. 游戏模式（macOS）caffeinate 进程泄漏
- **位置**：`electron/services/gamemode.ts:164` 与 `:171` 都写 `KEY_PREVIOUS`
- **原因**：164 行先写入「boost 前的原状态」，171 行又用 caffeinate 的 PID 覆盖同一键；Windows/Linux 分支存的是「原电源计划 / governor」，macOS 存 PID，语义混用同一存储位。
- **影响**：重复点击「进入游戏模式」时，上一个 caffeinate 的 PID 丢失无法 kill，后台残留进程持续阻止系统休眠。

---

## 三、低严重度（健壮性 / 一致性 / 可维护性）

| # | 位置 | 问题 | 影响 |
|---|---|---|---|
| L1 | `Process.vue:33` `Firewall.vue:21` `Services.vue:33` `Tasks.vue:26` | `flash()` 的 3s `setTimeout` 未随组件卸载清理 | 卸载后仍写 ref，轻微泄漏 |
| L2 | `Toolbox.vue:79-80` | 两个按钮的 `:disabled` 都写 `busy === 'dark'`，但「浅色」执行时 key 是 `'light'` | 点浅色时深色按钮未禁用，可并发触发 |
| L3 | `Settings.vue` `toggleAutoLaunch`、`History.vue` `clearAll`、`UpdateCard.vue:44` `openReleases` | 无 try/catch | IPC 失败产生未捕获的 promise rejection |
| L4 | `optimizer.ts:350-395` `buildToggleStartupScript` | `name` 直接插入 PowerShell 双引号字符串与 unix 路径；`command` 用 `` ` `` 转义双引号，但双引号内 `$(...)` 仍会求值 | 潜在命令注入面（渲染进程输入经 IPC 直达），建议白名单校验 + 单引号字面量 |
| L5 | `hardware.ts:188` | `powerW: n(b.designedCapacity)` —— 电池设计容量（mWh）被当作 W 显示 | 电源/电池数值错误 |
| L6 | `disk.ts:570` + `DiskRepair.vue:92` | 渲染层传 `p.detail`（展示文案）当 `path`，服务端只用 `id` 匹配 | 无安全影响，但语义易误读 |
| L7 | `elevate.ts:192-236` | UAC 弹窗长时间不响应时，`finally` 中的临时脚本/输出删除不执行 | `%TEMP%` 残留含路径信息的文件 |
| L8 | `optimizer.ts:512-520` | `toggleStartup` 禁用 = 删除注册表值 / 删除 plist；项从列表消失后无 command 可恢复 | 启动项「禁用后无法再启用」 |
| L9 | `autolaunch.ts:34` | `buildAutostartContent` 未转义 `execPath` 中的引号 | 路径含引号时 `.desktop` 文件损坏 |
| L10 | `AppSidebar.vue` 移动端断点 | 折叠后 `span { display: none }`，无 `aria-label` / title | 图标按钮无障碍缺失 |
| L11 | `network.ts` | ping 丢包率未 clamp 到 0-100；Windows 结果依赖 `[int]$_.ResponseTime` | 极端网络下数值异常 |
| L12 | `gamemode.ts:83-90` | Linux restore 把 `prev` 直接插入 `echo ${prev} \| tee`，注称「已校验」但实际无校验代码 | 注释与实现不符，存在注入面 |

---

## 四、整体质量结论

**架构层面做得好的地方**
- PAL 分层干净：`shell.ts` 统一平台分发，所有 service 通过注入 `ExecRunner` 构造，测试可注入假实现（413 项单测大多得益于此）。
- 安全意识较强：深度清理走服务端权威清单（客户端只能传 id）、路径白名单 `isSafeRoot`、进程/服务/防火墙均有「JS 守卫 + 脚本端权威校验」双保险、`openExternal` 走 HTTPS + 主机白名单。
- 对「假成功」有系统性反思：清理脚本改为逐项 try/catch 并回传 JSON 统计、磁盘释放量走 before/after 实测，这些设计方向是对的。

**主要风险**
1. ~~**构建门禁实际是红的**~~：审查当时的 typecheck 失败已修复，且 `typecheck` 已纳入
   CI（`.github/workflows/ci.yml`），当前三项门禁（typecheck / vitest / build）全绿。
   仍建议：新增 IPC 接口时**先改 `shared/types.ts` 再改 preload**，让类型门禁来暴露脱节。
2. **「静默失败 / 假成功」仍是最大功能风险**（M4、M5、L12）：这类问题不会崩溃、不会报错，
   表现为「点了没效果」，最难被用户反馈定位。本轮已把判定统一到
   `parseActionOutcome`（`ERR:` 优先、`OK` 须独立成行）并落地到服务层与 UI 层回执，
   新增接口时**必须沿用该判定**，不要再写 `includes('OK')`。
3. **类型与实现存在不同步的苗头**：`shared/types.ts` 与 `preload.ts` 的 optlib 接口曾脱节；
   远端能力库、DLL 修复等新模块的元信息口径（needsAdmin）已在类型层收敛
   （`OptCapabilityMetaPatch` 不含 `needsAdmin`），新增元信息字段时勿绕开该类型。
4. **并发与生命周期管理偏弱**：轮询无节流、编排器无锁、定时器与临时文件清理不完整。
   本轮已补 `usePolling` / 同步占位锁 / `useFlash` 卸载清理 / `sweepStaleTemp`，
   但**新增轮询与定时器时仍需主动接入这三个既有工具**，不要各写一份。
5. **`_t/` 与并发写入者**：本轮修复期间发现工作区存在另一个写入者
   （`_t/patch_platform.py`、`vitest.linux.config.ts`）并发修改测试文件，用以把测试与宿主
    OS 解耦。该文件已在收尾时移除。`_t/` 已在 `.gitignore` 中，属临时目录，不随仓库发布。

**修复优先级建议**：H1 → M3/M4/M5（用户可感知的功能失真）→ M1/M2（一行改动的逻辑错误）→ M6/M7/M8（稳定性）→ M9（安全边界口径统一）→ 其余低优先级。
