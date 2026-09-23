# 项目记忆 - 疾风引擎 (gale-engine / 项目002)

## 版本与发布（核心规则）
- 版本阶梯 **v0.1.0 → … → v0.1.9**（v0.1.9 = 当前 Latest）。**v0.2.0/v0.3.0 是错误产物，已删除，切勿再建**。下次发版 **v0.1.10**。
- 主通道 = CI tag 触发：改 `package.json` 版本并提交 → 打 `v*` tag 推送 → `.github/workflows/release.yml` 六矩阵构建发布。备用：用户侧 `pwsh scripts/publish-release.ps1`（须含 exe + `.blockmap` + `latest.yml`，否则自动更新静默失效；改脚本先用 `-DryRun`）。
- backfill（`release-backfill.yml`，workflow_dispatch 输 tag）**一律 checkout master** 构建，仅按 tag 名 sed 注入版本号，仅打 Windows x64。
- 每次重建/补发后**复查 Latest 归属**，必要时 `gh release edit v0.1.9 --latest`。
- 发版说明唯一来源 `scripts/extract-changelog.py`（token 级精确匹配，**勿改 CHANGELOG 标题格式**）；两侧工作流用 `body_path`。release job 里 `checkout` 必须在 `download-artifact` 之前。backfill 跑 windows-latest，Python 需 `reconfigure(encoding='utf-8')`，解释器用 `PY=$(command -v python3 || command -v python)` 探测。
- 资产哈希不用下载：`gh release view <tag> --json assets --jq '.assets[] | "\(.name) | \(.digest)"'`。
- electron-builder 配置**不接受顶层 `version:` 字段**。构建需 `ELECTRON_BUILDER_BINARIES_MIRROR`（结尾带斜杠）+ `7za.exe` 在 PATH；沙箱**无法构建/上传** 76MB 包，走 CI。

## 构建/沙箱环境
- 一键打包：`scripts/package-win.cmd`。
- 沙箱：GitHub/npmmirror 可达；推送需 `GIT_SSL_NO_VERIFY=1`。Git `safe-bin` 拦截含 `/` 的分支名 ref，绕过写 `.git/packed-refs`（完整 SHA）。
- ⚠️ **本机 Git Bash 的 coreutils 会整体失效**（报 `dirname/ls/head: command not found`）。**一行即可全部恢复**：
  `export PATH="/usr/bin:/bin:$PATH"; cd <repo> && <命令>`。PortableGit 的 coreutils 就在 `usr/bin`，只是没进 PATH。
  CLI shim 的 stderr 噪声每条命令都出现，**与成败无关，直接忽略**；shell 状态不跨调用保留，故每条命令都要带。
  **修正旧结论**：此前记的"Git Bash 缺 head/tail/grep/sed/cat/wc/mkdir/cp"是 PATH 问题，不是工具缺失——修好后这些都能用（`grep -c/-n`、`tail -N` 比 python 更顺手）。
- 临时脚本/日志统一放 `_t/`（已在 `.gitignore`）。**收尾时清掉 `_t/` 与根目录 `_tc.log`**。
- 本地验证跨平台分支：临时 `vitest.linux.config.ts`（mergeConfig + setupFiles 里 `Object.defineProperty(process,'platform',{value:'linux'})`）+ `node node_modules/vitest/vitest.mjs run -c vitest.linux.config.ts`。vitest CLI **不认 `--setupFiles`**。**验完必须删掉根目录配置文件**。
- 疑似并发写入者：用 `ls -la --time-style=full-iso <文件>` 看 mtime；若集中在你操作间隙且内容非你所写 → 改逐条定向替换，勿整文件覆写。

## 脚本编码
- 含中文的 `.ps1` 必须 **UTF-8 with BOM + CRLF**（PS5.1 按 GBK 解码会吞引号/大括号）。语法校验用 `[System.Management.Automation.Language.Parser]::ParseFile`。
- PowerShell 调 python 别用管道传中文，用 `--out FILE` 落盘；读 UTF-8 无 BOM 用 `-Encoding UTF8`；python 读 PS 写的清单用 `utf-8-sig`。

## 里程碑
- M1 完成（tag v0.1.0）；M2 五大模块完成；M3a 自动更新+开机自启完成；M3b 主页面视觉校验完成（提交 `9732f78`）。
- 后续新增：DLL 修复页（`src/pages/DllRepair.vue` + `electron/services/dllrepair.ts`，路由 `/dll`）、远端能力库（`electron/services/capabilityFeed.ts`）、更新卡片（`UpdateCard.vue` + `useAppUpdate.ts`）。侧边栏已由 14 项变 **15 项**（新增「DLL 修复」）。

## 质量门禁现状（2026-09-17 复检，**以此为准**）
- ✅ **`vue-tsc --noEmit` 0 错误**、✅ **`vitest run` 498 项 / 29 文件全绿**、✅ **`electron-vite build` exit 0**。
- 数字增长快，**引用前先实跑**：`npx vue-tsc --noEmit -p tsconfig.json`、`npx vitest run --reporter=basic`、`node node_modules/electron-vite/bin/electron-vite.js build`。
- ⚠️ **门禁判定必须用 Bash 直连 + 落盘**（`cmd > _t/x.log 2>&1; echo "EXIT=$?"`）。PowerShell 里 `& node ... | Out-String` 取 `$LASTEXITCODE` 会**假报 exit=1**（管道末端污染），曾据此误判 build 失败。
- **CI 已在仓库常驻**：`.github/workflows/ci.yml`（push/PR 到 master|main → typecheck + vitest），已升 `actions/checkout@v7` / `actions/setup-node@v7`。`release.yml` 另有 quality job 作为 build 的前置。最近两次 run（`35124739937` / `35124970218`）**均全绿**。
- ⚠️ **测试必须显式传 platform**：`createXxxService(runner, 'win32')`，**不要**依赖 `detectPlatform()`。不传时本地 Windows 走 win32 断言通过、CI ubuntu 走 unix 而**整片挂**（曾 9 文件 36 fail）。批量核对：`grep -rn "create[A-Za-z]*Service(runner)" electron/services/*.test.ts` **应返回空**。
- 审查报告 `docs/code-review-2026-09-16.md`：**H1 + M1–M10 + L1–L12 共 23 项全部修复**，§〇 进度表已全 ✅。
- **启动项「禁用」语义已定案**：置 `Hidden=true`（macOS 置 `Disabled`），项**保留在列表**、**可原地再启用**，不再是"删除即丢失"。此前记忆里"唯一未改的已知限制"**已作废**。
- **未发布**：本轮加固内容仍在 CHANGELOG「开发中」章节。**发版 v0.1.10 前必须把该章节改名为 `## v0.1.10 — <日期>`**，否则 `extract-changelog.py` 按 tag 找不到章节 → Release body 为空（electron-updater 弹窗无内容）。
- **待处理 PR#1（dependabot）**：跨 6 大版本 `electron ^33→^39` + `electron-builder ^25→^26` + `vitest ^3→^5`，基线停在 `0.1.8`，需 rebase；属独立迁移工程，勿与其它改动混做。默认分支有 46 个 dependabot 告警。

## 关键实现约定（改代码前先看）
- **判定脚本成败**：统一走 `electron/services/actionResult.ts` 的 `parseActionOutcome`（`ERR:` 优先、OK 必须独立成行、空输出算失败）。**禁止** `includes('OK')` 或 `SilentlyContinue` + 无条件 `echo OK`。
- **操作回执要"诚实"**：服务层返回结构化 `ok`（如 `GameModeActionResult`），UI **按 `ok` 决定提示与是否写历史**；失败显示 `error` 不显示 `hint`。
- **PowerShell 容量换算**：一律 `[long]`（Int64）；`[int]` 上限 2.1GB 会静默溢出。
- **`.desktop` 转义**：`Exec=` 走 `electron/services/desktopEntry.ts` 的 `escapeDesktopExecArg`；启动项 `name`/`location` 走白名单。
- **脚本参数注入面**：会把渲染层输入拼进 shell 的地方（游戏模式还原凭据、启动项、盘符）一律**先正则白名单校验再拼**，非法值回 `ERR:` 且**不回显原始输入**。
- **提权边界**：`needsAdmin` **只许收紧不许放宽**（`m.needsAdmin || o.needsAdmin === true`），远端清单不得把它改成 false；`metaOverrides()` 干脆不下发该字段。
- **提权临时文件**：`elevate.ts` 有 `safeUnlink` + 进程级一次性 `sweepStaleTemp`（清 >1h 陈旧残留）。
- **轮询**用 `src/composables/usePolling`（上一次未返回就跳帧）；**提示文案**用 `src/composables/useFlash`（结构化 tone + `onUnmounted(clear)`，不要 `includes('拒绝')`，也不要各页自写 `setTimeout`）。
- `monitor` 快照带 `degraded[]`：单项采集失败按字段降级，不整页报错。
- **单位**：电池 `designedCapacity` 是 **mWh** → `/1000` 得 Wh，界面按 type 标 `Wh`/`W`；网络丢包率恒 clamp 0–100 且 `ok` 与 `loss` 自洽。

## 工具/环境坑
- **`Read` 工具可能返回旧版本文件内容**（历史上多个文件首轮读到旧快照）。**结论必须经 Grep 或 python 读盘复核**，尤其涉及行号时。
- **`os.walk` 打印长列表会被截断** → 枚举文件一律用 **Glob 工具**。
- **memory 目录下某些文件会被工具侧误判为 GBK**（Read 显示乱码，但实际是合法 UTF-8，python 校验通过）。此时 **`Edit` 会匹配失败**——改用 **python 读写**（`open(p, encoding='utf-8')` + 落盘），**不要**反复重试 Edit。

## 其他约定
- 冒烟清单：`docs/smoke-test-checklist.md`（**154 项**，可自动/脚本验证 **106 项**）；**`.html` 由 `scripts/gen-smoke-html.py` 生成，改 md 后必须重跑**。生成器只认 `##` 与 `- [ ]`。侧边栏 **15 项**（源 `src/components/AppSidebar.vue`）。
- 落地页：EdgeOne Makers 项目 `gale-engine-landing`，ProjectId `makers-rleonupjhtz0`，源目录 `landing/`，用连接器 `deploy_folder` 部署。发版后同步徽标/下载链接/更新日志/页脚/`var V`。
- 验证线上：两步 cookie jar（先带 query 建会话，再裸域名请求），jar 用相对路径。
- 相关技能：`restricted-shell-ci-triage`（受限 shell/CI 排障：PATH 修复、CI 宿主 OS 依赖、退出码失真）、`edgeone-makers-live-verify`、`github-release-notes-from-changelog`。
