## 疾风引擎 v0.1.11

本版主线为「**全自动升级**」：更新下载完成后不再需要用户点「安装」，延迟缓冲后自动退出并安装重启；同时修复一个会把长任务误判为失败的**提权超时缺陷**，并完成一次跨 6 个大版本的依赖迁移（Electron 33→39、vitest 3→5、electron-builder 25→26、tar 6→7）。

### 新增功能

- **全自动升级：下载完自动安装重启**（`electron/services/update.electron.ts`）：
  - `autoUpdater.on('update-downloaded')` 事件里，除照常广播 `downloaded` 状态外，新增在 **`app.isPackaged` 为真时延迟 3 秒调用 `quitAndInstall(false, true)`**，由主进程自动退出并完成安装重启。
  - 3 秒缓冲用于让界面有机会显示「已下载，即将自动重启」，避免下载完瞬间黑屏；**仅打包应用生效**，开发模式（`isPackaged=false`）不触发重启，便于本地调试。
  - `false, true` 参数组合表示「非静默安装 + 安装完成后重启」，与用户手动点击「安装并重启」的行为一致。

### 修复

- **N-H1｜提权长任务被 30 秒硬超时误杀（本版最严重的假失败）**（`electron/services/shell.ts`、`electron/services/elevate.ts`）：
  - **根因**：提权外层脚本是 `Start-Process -Verb RunAs -Wait`（unix 为 `pkexec`/`sudo`），会一直阻塞到提权子进程跑完才返回；而执行器沿用的是普通命令的硬超时 `EXEC_TIMEOUT_MS = 30s`。经此通道执行的 **`sfc /scannow`、`DISM /RestoreHealth`、`DISM /StartComponentCleanup`、`winget install` VC++ 运行库** 都是**数分钟级**长任务——30 秒一到 Node 就 kill 掉外层 PowerShell，**子进程还在正常跑却被判失败**，UI 报「修复未完成」，用户会误以为系统修复出了问题。
  - **修复**：`ExecRunner.run(script, opts?)` 新增可选 `ExecRunOptions.timeoutMs` **单次超时覆盖**，默认仍是 30 秒，不改变既有命令的行为；`elevate.ts` 导出 `ELEVATED_OUTER_TIMEOUT_MS = 30 分钟`，提权外层调用时显式放宽。PowerShell 与 bash 两个 runner 均已支持该覆盖。
  - **回归用例**：`shell.test.ts` 覆盖「未传 opts 时沿用构造默认超时」与「传入 timeoutMs 时覆盖生效」两条路径；`elevate.test.ts` 断言提权外层调用携带放宽后的超时值，防止将来被改回 30 秒。
- **N-M1｜更新文案自相矛盾**（`src/composables/useAppUpdate.ts`）：`autoDownload=false` 时 `available` 是稳定等待态，状态行却写「发现新版本 vX，正在下载…」，而同一张卡片上并有「下载更新」按钮——界面同时说「正在下载」和「点我下载」。已改为「发现新版本 vX，**可下载更新**」，「正在下载」只留给真正的 `downloading` 态。
- **CI｜部署分支名与实际默认分支不符**（`.github/workflows/`）：`deploy-pages` 触发分支由 `main` 对齐为 `master`（本仓库实际默认分支），此前该工作流在推送后不触发。

### 依赖与安全

- **依赖大版本迁移**（合并 dependabot PR `#1`，含 5 项更新 + 安全修复，并重新生成 `package-lock.json`）：
  - **Electron `^33` → `^39`**、**electron-builder `^25` → `^26`**、**vitest `^3` → `^5`**、传递依赖 **tar `6` → `7`**。
  - 逐项核对过迁移面：vitest 5 用到的 `test.*` 字段均为 v5 现行 API，无 v4→v5 更名/移除项；项目未启用 `globals: true`（测试显式 import），不受 v5 globals 语义变化影响；版本链为 vite 6.4.3 + vitest 5.0.1 + electron-vite 3.1.0 + `@vitejs/plugin-vue` 5.2.1，满足 vitest 5 的 peer 要求（Vite `^5 || ^6`）。**源码 grep 确认无任何 `import 'tar'`**，tar 仅作为 electron-builder 内部传递依赖（`dev: true`），不涉及业务代码。
  - 同时修复 H1–H4 高危与 M1–M9 中危安全告警（原默认分支存在 46 个 dependabot 告警）。

### 质量

- 三项门禁全绿：`vue-tsc --noEmit` 零错误、**`vitest run` 558 通过 / 3 跳过（31 个测试文件，较 v0.1.10 的 498 项增加 60，来自 N-H1/N-M1 回归用例与新增测试）**、`electron-vite build` 通过。
- 追加 `docs/walkthrough-2026-10-06.md`：对照 9-17 基线的二轮全项目读取核对报告（逐条复核 Electron/vitest/builder/tar 四条升级线，结论均为无 API 误用与兼容隐患）。

---

已安装用户可在「设置 → 关于」中检查更新，或直接下载上方安装包覆盖安装。

完整版本历史：[CHANGELOG.md](https://github.com/afdk1991/gale-engine/blob/master/CHANGELOG.md)
