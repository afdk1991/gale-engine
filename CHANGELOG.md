# 疾风引擎 (gale-engine) 更新日志

> 版本格式遵循语义化版本（SemVer）：`主版本.次版本.修订`。
> 发版流程：在 `package.json` 升级版本后打 Git tag（如 `v0.1.9`）并推送，`.github/workflows/release.yml` 自动在 win/macos/linux × x64/arm64 六矩阵构建并发布到 GitHub Releases；也可在本机运行 `scripts/publish-release.ps1`（支持 `-DryRun` 预演）构建上传。历史版本补发走 `release-backfill.yml`（基于 master 构建，仅按 tag 钉定版本号）。各通道的 Release 说明统一由 `scripts/extract-changelog.py` 从本文件对应版本章节生成。

---

## 开发中（当前 master 工作区，未发布）

以下改进已提交，将随下次 **v0.1.10** 发布合并进版本说明：

### 新增功能

- **三端自动更新真正打通（此前 macOS / Linux 实际不可用）**：
  - macOS 构建目标补 `zip`。**electron-updater 在 macOS 上只认 zip**（靠 zip 做增量替换），原来只出 `dmg` 会导致「提示有新版本，却永远装不上」。dmg 仍保留给用户手动拖拽安装，两者并存。
  - Linux 区分安装方式：仅 **AppImage** 可应用内自更新（依赖 `APPIMAGE` 环境变量定位自身）；`deb/rpm` 归系统包管理器管辖，应用内诚实降级并给出可执行命令（`sudo apt update && sudo apt install --only-upgrade …`）与改用 AppImage 的建议。
  - 未打包的开发模式明确提示「没有可用更新源」，不再出现「点了没反应」。
  - `latest*.yml` 缺对应平台元数据、macOS 签名失败、权限不足、网络不可达等底层错误统一翻译成**可行动的**中文提示（`update.capability.ts`）。
- **更新入口铺到所有端 + 全自动流程**：新增 `src/composables/useAppUpdate.ts`（模块级单例状态 + 事件订阅）与 `src/components/UpdateCard.vue`。
  - 三个入口：**侧边栏底部**、**首页**（compact 版）、**设置页**（完整版，含偏好开关），任意页面都能检查更新。
  - 检查→发现→**自动下载（带真实进度条）**→下载完可一键「立即安装并重启」；失败可重试；启动后按偏好后台静默自检（失败不打扰用户、不重试轰炸）。
  - 偏好落盘：启动自动检查 / 自动下载 / 退出时自动安装，经 `updater.configure()` 下发到底层。
  - 主进程把更新状态广播到所有窗口，任意页面打开都能直接读到当前进展。
- **DLL 缺失检测与修复（新页面「DLL 修复」）**：新增 `electron/services/dllrepair.ts`。
  - Windows 扫描 `System32` / `SysWOW64` 关键系统 DLL、**VC++ 运行库**（`msvcp140` / `vcruntime140` / `vcruntime140_1` / `concrt140` 等）与 UCRT，做「存在 / **位数不全（32 位有 64 位无）** / 缺失」三态判定，并读取 VC++ Redistributable 注册表版本。
  - 按缺失项产出可执行修复建议：`sfc /scannow`、`DISM /RestoreHealth`、`winget install` 或官方下载链接；修复统一走既有**提权通道**（UAC），不在无权限时静默失败。
  - macOS / Linux 诚实降级为**只读共享库探针**（macOS 查 `/usr/lib` 系统库，Linux 用 `ldconfig -p` 解析缓存），并明确说明「系统库由包管理器/系统维护，本工具不改动」。
  - 页面内附 DLL（动态链接库）知识说明（核心作用 / 常见使用场景），把概念与工具能力对应起来。
- **能力库改造为可独立更新（本项目的「DLL」语义落地）**：新增 `electron/services/capabilityFeed.ts` 与 `capabilities/manifest.json`。
  - 这正是 DLL 的核心价值——**替换某个模块即可升级该功能，无需重新编译整个程序**：新增/调整一项优化能力，只需更新远端清单，**不必重新发版应用**；清单生效后无需重启即可用上新能力。
  - ★ **安全边界（不可放宽）**：远端清单**不能下发可执行代码**。它只能 ① 覆盖内置能力的 `label`/`description`/`defaultEnabled`；② 用**配方（recipe）编排白名单内的既有服务方法**，参数逐字段校验，未知调用**整条拒绝**。
    - 内置能力的**实现不可被替换**（命中内置 id 且带 `recipe` 直接拒绝），重名远端能力被忽略；`needsAdmin` 不允许被远端修改——**提权边界只能由本地代码定义**；远端新能力**默认不纳入一键优化**，须显式 `defaultEnabled: true`。
  - 防护：清单 `schema` 版本校验、体积上限 256 KB、条目上限 200、单配方步数上限 8、`libraryVersion` **只增不减**（防降级攻击）、`minAppVersion` 过滤；任何整体性问题一律**整份作废并回落内置**，被拒条目及原因在界面**如实列出**（不静默吞掉）。
  - 界面：优化中心新增「能力库（可独立更新）」面板，展示来源（内置/远端）、版本、可用能力数、远端能力清单、被拒条目；支持检查更新 / 应用 / **回退内置**。

### 质量加固（全量代码审查 H1 / M1–M10 / L1–L12 全数修复）

依据 `docs/code-review-2026-09-16.md` 的逐条复核结果修复，**三个门禁同时达标**：`vue-tsc --noEmit` 0 错误、`vitest run` **498/498 通过**、`electron-vite build` 通过。

- **H1｜preload 接口脱节（曾阻断 typecheck）**：`electron/preload.ts` 补齐 `optlib:libraryState / checkLibrary / applyLibrary / resetLibrary` 四个映射，与 `shared/types.ts` 契约对齐。根因是「改了类型与主进程、漏了 preload」，测试不覆盖 preload 所以 413 项全绿也发现不了——现已把 `typecheck` 纳入 CI 必过项。
- **M5 / L12｜「假成功」系统性根治（本轮最大风险项）**：
  - 新增严格回执解析 `parseActionOutcome`（**`ERR:` 优先、`OK` 必须独立成行**、空输出如实报失败），替换 `process.ts` / `firewall.ts` / `tasks.ts` / `winservices.ts` / `toolbox.ts` / `optimizer.ts` 中所有 `text.includes('OK')` 松散判定——此前错误信息里只要含 "OK" 字样就会被误判为成功。
  - 回收站清空（win/mac/linux 三处）由 `SilentlyContinue; "OK"` 改为 `try { … "OK" } catch { "ERR:…" }`；此前 `-ErrorAction SilentlyContinue` 下 `$?` 恒为真，清空失败也报成功。
  - **游戏模式不再假成功**：`boost()` / `restore()` 返回值由裸状态改为 `GameModeActionResult`（含 `ok` / `message` / `status`），UI 按 `r.ok` 决定提示与是否写历史；失败显示 `error` 而非 `hint`。重复进入游戏模式时若上一轮 caffeinate 残留回收失败，会在提示里**如实说明**而不静默吞掉。
- **L4 / L9｜脚本注入面收口**：新增共享模块 `electron/services/desktopEntry.ts`（`escapeDesktopExecArg` / `escapeDesktopValue`），`.desktop` 的 `Exec=` 统一走转义（引号、`$`、反引号、反斜杠）；启动项 `name` / `location` 走白名单校验；`buildToggleStartupScript` 修正 `$` 展开漏转义（曾导致编译报 TS1109）。
- **L12｜还原凭据注入面**：`buildRestoreScript` 对 Windows 电源计划 GUID、Linux governor、macOS caffeinate PID 分别做白名单 `test()` 校验，非法值一律回 `ERR:还原凭据非法` 且**不泄露原输入**；macOS 另加 `kill -0` 先探活，避免把「进程已退出」当成失败。
- **L8｜启动项可逆**：禁用不再删除注册表值 / plist / `.desktop`，改为置 `Hidden=true`（macOS 置 `Disabled`），项保留在列表中，**可原地重新启用**，消除「禁用即丢失、只能手动补命令」的死角。
- **L7｜提权临时文件残留**：`elevate.ts` 的 `finally` 改为逐项 `safeUnlink`；并新增进程级一次性的 `sweepStaleTemp`，清理 `%TEMP%` 中**超过 1 小时未改动**的历史残留（UAC 长时间无响应、进程被强杀时 `finally` 不会执行，此前含本机路径的临时脚本会永久残留）。
- **L6｜接口语义收紧**：`runDeepCleanup` 契约由「对象数组（含 kind/path）」收紧为**只收 `id` 数组**，渲染层与服务层签名同步，消除「把展示文案当路径传」的误读面。
- **L5｜电池容量单位**：`hardware.ts` 按 `mWh / 1000` 换算为 Wh，界面按 type 分别标注 `Wh` / `W`；此前把电池设计容量（mWh）当瓦特显示，笔记本会出现「45000 W」。
- **L11｜网络数值健壮性**：ping 丢包率在 PowerShell、awk、JS 解析三处均 clamp 到 0–100，并让 `ok` 与 `loss` 自洽（丢包 100% 即判定不通，不因脚本自称 ok 而翻转）。
- **L1 / L2 / L10｜前端一致性与无障碍**：
  - 新增 `src/composables/useFlash.ts`：统一各页操作反馈的**语气判定**（结构化 `tone`，不再靠 `includes('拒绝')` 嗅探）与**定时器生命周期**（`onUnmounted(clear)`），根治「组件卸载后回调仍写 ref」。
  - `Toolbox.vue` 深浅色按钮改用统一 busy 判定；侧边栏导航项与版本按钮补 `aria-label` / `title`，`nav` 补 `aria-label`。
- **L3｜未捕获 rejection**：`Settings.vue` / `History.vue` / `UpdateCard.vue` 三处 IPC 调用补 try/catch，失败如实报错，不再产生未处理的 promise rejection。
- **测试**：新增组件层回归 `src/pages/GameMode.test.ts`（6 项，锁死「切换失败不提示成功、不写历史」）；`gamemode.test.ts` 扩充「还原凭据校验（防注入）」「还原失败保留凭据」等用例，共 28 项。vitest 476 → **498**。
- **文档同步**：
  - `docs/code-review-2026-09-16.md` §〇 修复进度表补全至 **H1 / M1–M10 / L1–L12 全 23 项**（此前只列到 L2），并更新「已知限制」与「主要风险」——两处原本过期的表述（启动项禁用不可逆、构建门禁为红）已按修复后实况改写。
  - `docs/smoke-test-checklist.md` 补 **59 项**新校验（95 → **154** 项，可自动/脚本验证项 84 → **106**）：新增「诚实回执与注入防护」专节，并在监控/进程/网络/优化中心/游戏模式/工具箱/设置各节补入 M4/M6/M7/M8/M9/L1/L2/L5/L8/L11/L12 的可观测验收点；测试数 417 → **498**。HTML 交互版经 `scripts/gen-smoke-html.py` 重新生成。
  - `README.md` 测试数 417/265 → **498**、冒烟项 121 → **154**，`已知限制` 补 Linux `deb` 不可自更新、启动项隐藏保留语义，并写明「假成功」判定的统一口径供后续开发遵守。

### 修复
- **「已是最新版本」永远不会出现、永远误报有新版本**：`autoUpdater.checkForUpdates()` 在「无更新」时**并不返回 null**，而是返回 `{ isUpdateAvailable: false, versionInfo: … }`，且此时 `versionInfo` 装的是仓库里的**最新版**信息。原实现「非 null 即视为有更新」，导致该状态机分支实际不可达。现抽出纯函数 `interpretCheckResult()` 统一解释（并区分 `null`=更新器未启用），补回归单测。
- **能力库 id 被静默截断（安全缺陷）**：`validateRemoteCapability` 原先用 `asString(o.id, 48)` 先截断再校验正则，导致 ① 超长 id 被截断后反而通过；② 前 48 位相同的不同 id **碰撞成同一条能力**（可被用来覆盖/绕过校验）。现改为超长直接判非法，`libraryVersion` / `minAppVersion` 同理。
- **本地发布通道漏传更新元数据**：`scripts/publish-release.ps1` 原先只上传 `.exe`，缺 `latest.yml` 与 `.blockmap`。而本项目冒烟清单本来就要求「exe + `.blockmap` + `latest.yml` 三件齐全」，且 `electron-updater` 依赖 `latest.yml` 才能发现新版本——**走该通道发出去的版本，自动更新会静默失效**。现改为自动收集三者一并上传，缺失时明确告警；发版说明改由 `scripts/extract-changelog.py` 从 CHANGELOG 生成（不再是一行硬编码文案）；新增 `-DryRun` 预演模式，可在不产生任何远端写操作的前提下校验资产与说明。
- **PowerShell 脚本编码**：`publish-release.ps1` 原为 UTF-8 **无 BOM** 且含中文注释，Windows PowerShell 5.1 会按 GBK 解码，存在「引号被吞、报解析错误」的风险（本项目已踩过此类坑）。已统一为 **UTF-8 with BOM + CRLF**，并在 PowerShell 5.1 下通过语法解析校验。
- `scripts/extract-changelog.py` 新增 `--out`（直接落盘、不经控制台管道，避免代码页乱码）；资产清单读取改为 `utf-8-sig` 以容忍 BOM。
- **GitHub Release 说明为空**（影响自动更新体验）：`release.yml` 原使用 `generate_release_notes`，仓库无 PR 时只会生成一行 `Full Changelog` 链接，使 10 个 Release 的 body 全部为空。而 `electron-updater` 会把 Release body 当作更新弹窗的 `releaseNotes` 展示——即用户点「检查更新」时看不到任何发版内容。
  - 新增 `scripts/extract-changelog.py`：从 `CHANGELOG.md` 按 tag 抽取对应版本章节，支持 `v0.1.5 / v0.1.4` 这类合并标题的 **token 级精确匹配**（避免 `v0.1.1` 误命中 `v0.1.10`），并按实际产物生成「平台 / 架构 / 文件」下载表。
  - `release.yml` 发布 job 改为 `body_path: release-notes.md`。⚠️ checkout 必须置于**下载构建产物之前**：`actions/checkout` 默认 `clean: true` 会执行 `git clean`，放在其后将清空 `dist/`。
  - `release-backfill.yml` 同步改用该脚本，并强制 `--mode backfill` 附「代码来源说明」。

### 工程
- `shared/types.ts` 新增更新状态机（`UpdateState` / 进度 / 能力探测）、`AppUpdatePrefs`、DLL 扫描与修复、能力库清单与状态等契约；IPC 新增 `optlib:libraryState/checkLibrary/applyLibrary/resetLibrary` 与 `dll:*`、`app:openExternal`（带 host 白名单）等 handler。
- 新增单测：`update.capability.test.ts`（返回值解释 + 平台能力探测 + 错误翻译）、`capabilityFeed.test.ts`（清单校验 / 配方白名单 / 安全边界 / 降级回退）、`dllrepair.test.ts`、`optlib.test.ts` 扩充远端能力与覆盖边界用例。vitest 309 → **417**。
- `capabilities/README.md` 说明清单结构、**安全边界**与配方白名单（白名单权威来源是代码里的 `createRecipeRuntime()`，只能由主程序扩大、不能由远端扩大）。

### 文档
- **历史 Release 说明回填**：v0.1.0–v0.1.9 共 10 个 Release 的说明由 74–83 字符补全为 978–2513 字符，含真实下载表。
  - `v0.1.1`–`v0.1.6` 的说明中显式声明：本包由当前 `master` 源码构建、**并非该版本的历史快照**，并给出真实的 tag → commit → `package.json` 版本对照（其中 `v0.1.4` 与 `v0.1.5` 实际指向同一 commit）。
- 落地页（EdgeOne Makers / `makers-rleonupjhtz0`）重新部署，线上版本更新至 v0.1.9。
- **冒烟清单与实现脱节，已补全**：`docs/smoke-test-checklist.md` 修正多处过期内容——测试数 142 → **309**、产物名补上 `${arch}`、导航项 12 → **14**（补「硬件信息」「磁盘修复」）；并补齐此前**完全没有**覆盖的冒烟项：首页一键优化（v0.1.9）、硬件信息（v0.1.5）、磁盘修复（v0.1.8）；§五 新增「Release 说明非空」「Latest 归属正确」「本地通道必须含 `latest.yml`」等发版校验项。HTML 交互版经 `scripts/gen-smoke-html.py` 重新生成（**72 → 95 项**）。

---

## v0.1.9 — 2026-09-16（首页一键优化 + DLL 能力库 + 运行时提权 + 空间实测释放）

四项任务正式发布（commit `12a492f`）：

### 新增功能
- **首页一键全部优化**：首页 Hero 区新增「⚡ 一键优化」入口，按序执行所有可优化项，实时展示进度、每项结果（成功/失败/跳过）与汇总报告；支持中途取消与失败重试（默认 1 次）。
- **DLL 单项目优化能力库（optlib）**：将各优化能力封装为可动态装载的能力库，对外提供 `listCapabilities()` 列清单与 `runSingle(id)` 独立调用；统一返回执行状态、耗时、错误信息与实测释放空间（ABI 为纯 JSON，后续可替换为原生后端）。
- **运行时提权通道（elevate）**：新增 `isElevated` / `runElevated`（Windows `ShellExecute runas` 弹 UAC、回收子进程输出、识别用户取消）/ `restartElevated`；设置页新增「以管理员身份重启」。打包清单改为 `asInvoker` + NSIS `perMachine:false` + `allowElevation:true`，默认装到用户目录不弹 UAC、自更新可用。
- **磁盘空间实测释放修复**：新增 `space.ts` 以清理前后 `fsSize` 空闲字节差作为真实释放量；清理脚本改为逐项 try/catch 并回传 JSON 统计（删除字节/条目数/失败数/被占用样例路径），回收站按卷逐个清空；新增「资源管理器缩略图缓存清理」（停外壳→删缓存→必重启外壳，避免桌面消失）。

### 工程
- IPC 新增 optlib / onekey / 提权 等 handler（共 55 个），`window.gale` 契约同步扩展（`onekey:start/cancel/retry/state` + 进度推送）。
- 新增 `src/composables/useOneKey.ts`（模块级单例状态）、`src/components/OneKeyPanel.vue`（勾选 / 进度 / 结果 / 汇总 / 停止 / 重试）。
- vitest 265 → 309（新增 space / elevate / optlib / onekey 单测；修正 `disk.test.ts` 过时断言）。

---

## v0.1.8 — 2026-09-15（磁盘修复模块：空间总览 + 深度释放 + 磁盘修复 + DLL/系统文件修复）

新增第 14 个页面「磁盘修复」与第 14 个 service `disk.ts`，沿用可注入依赖 + 平台脚本分发 + 白名单安全范式。

### 新增功能
- **磁盘空间总览**：基于 systeminformation fsSize 跨平台展示各卷容量/已用/剩余与占用条；已用 ≥90% 或可用 <10GiB 自动判定「空间不足」并顶部告警。
- **硬盘空间深度释放**：服务端权威清单（客户端只能传 id，无法注入路径）+ 白名单纵深防御。
  - Windows：Windows 更新下载缓存、系统临时文件、缩略图/图标缓存（仅删 thumbcache/iconcache）、错误报告 WER、传递优化缓存、Prefetch，以及 DISM `StartComponentCleanup` 组件存储清理与关闭休眠释放 hiberfil.sys（后两项需管理员、默认不勾、不用激进的 ResetBase）。
  - macOS：~/Library/Caches、~/Library/Logs、`brew cleanup -s`。
  - Linux：~/.cache、`journalctl --vacuum-size=100M`、`apt-get clean`。
- **硬盘错误检查与修复**：Windows `chkdsk`（只读检查 / NTFS 在线 `/scan` 修复，不锁定、不自动安排重启，不做需离线的 /f /r）；macOS `diskutil verifyVolume/repairVolume`；Linux 挂载态 fsck 有数据风险，诚实降级不执行。盘符/挂载点经严格白名单校验防注入。
- **DLL / 系统文件修复（仅 Windows）**：`sfc /scannow` 扫描还原受保护系统文件（含 DLL），`DISM /Online /Cleanup-Image /RestoreHealth` 修复组件存储；按中英文输出关键词给出「完整/已修复/需管理员」结论与原始输出尾部；非 Windows 诚实降级。

### 工程
- IPC 新增 5 个 handler（`disk:volumes/scanDeepCleanup/runDeepCleanup/checkVolume/repairSystemFiles`），共 47 个；preload `window.gale.disk` 与 `shared/types.ts` 契约同步扩展。
- 新增路由 `/disk`、侧边栏第 14 项（硬盘图标），AppSidebar 测试同步更新为 14 项。
- vitest 231 → 265（新增 disk.test.ts 34 项，覆盖空间阈值、三平台清单/脚本、白名单拒绝、chkdsk/diskutil、SFC/DISM 与诚实降级）；vue-tsc 0 错误；electron-vite build 通过。

---

## v0.1.7 — 2026-09-08（跨平台收尾：测试修复 + 文档同步 + 落地页多平台）

在 v0.1.6 跨平台代码 100% 完成基础上，修复跨平台测试在多环境下的失败、全面同步文档至跨平台现状、落地页适配多平台下载。

### 修复
- **optimizer 测试失败**：本机 `TMPDIR` 指向 Windows 路径导致 `allowedTempRoots('linux')` 白名单失效，linux 分支 `isSafePath('/tmp')` 误判为 false。测试 `beforeAll` 固化 `TMPDIR='/tmp'` + `HOME='/home/tester'`，`afterAll` 改用 `delete` 恢复（避免写入字符串 `"undefined"` 污染跨平台 CI）。零对外契约变更。

### 工程
- vitest 231/231 全绿（修复后恢复）。
- package.json 版本 bump 0.1.6 → 0.1.7。
- 落地页改造为按 OS 推荐 + 架构分段器 + UA 检测；资产名精确映射（exe/dmg x64+arm64、AppImage x86_64+arm64、deb amd64）。
- README / CROSSPLATFORM-ROADMAP / platform-support-verification / MEMORY 全面对齐 v0.1.7 跨平台现状。

---

## v0.1.6 — 2026-09-07（macOS arm64 构建修复）

修复 macOS arm64（Apple Silicon）CI 构建失败。

### 修复
- macOS arm64 构建链路：entitlements 路径与 hardenedRuntime 配置修正，dmg arm64 产物正常产出。
- 批次3 跨平台迁移代码合入（gamemode/firewall/tasks/winservices 三平台脚本分发）。

---

## v0.1.5 / v0.1.4 — 2026-09-06（跨平台迁移批次 1-2 + CI 流水线修复）

跨平台架构级重写的首批落地：批次1（toolbox/process）与批次2（optimizer/autolaunch）迁移完成，CI 6 矩阵构建首次打通。

### 新增
- **平台抽象层（PAL）**：`shell.ts` 新增 `createBashRunner`（mac/linux）+ `createPlatformRunner` 工厂 + `detectPlatform`，按 OS 自动选择执行器。
- **硬件信息模块**：`hardware.ts` 用 systeminformation 跨平台采集主板/CPU/内存/显卡/显示器/硬盘/电源型号规格，新增 Hardware.vue 页面（第 13 个页面），导航 13 项。
- **批次1 迁移**：toolbox（DNS 刷新/回收站/剪贴板/深色模式按平台分发）、process（kill/signal 跨平台）。
- **批次2 迁移**：optimizer（清理白名单与启动项按平台：Win 注册表 / mac launchd plist / Linux XDG autostart）、autolaunch（三平台开机自启）。
- **6 矩阵 CI**：release.yml 改为 win/macos/linux × x64/arm64 矩阵，Linux arm64 装 qemu 交叉编译；electron-builder.yml 增 mac/linux target + arm64。

### 修复
- v0.1.4 发布流水线两个问题（CI 触发与产物上传），v0.1.5 补发修复。

### 工程
- vitest 142 → 171（批次1）→ 185（批次2）全绿；vue-tsc 0 错误。
- 新增 docs/HARMONYOS-FEASIBILITY.md（鸿蒙版调研：Electron 不兼容，需 ArkTS 重写）、docs/CROSSPLATFORM-ROADMAP.md（迁移路线图）。

---

## v0.1.3 — 2026-09-04（M4 系统深度管理里程碑）

在 v0.1.2 基础上，新增**计划任务**、**服务管理**、**防火墙**三大系统级模块。服务层延续可注入依赖范式，vitest 142 项全绿，所有用户输入（任务路径 / 服务名 / 规则名）经字符白名单校验防 PowerShell 注入。

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

## v0.1.2 — 2026-09-03（M3 深度优化里程碑）

在 v0.1.1 基础上，新增**进程管理**与**网络诊断**两大模块，并补齐浏览器缓存清理。服务层延续可注入依赖范式，纯函数 vitest 覆盖（100 项全绿），核心 PowerShell 命令在真实 Windows 直测通过。

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

## v0.1.1 — 2026-08-30（M2 功能里程碑）

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
