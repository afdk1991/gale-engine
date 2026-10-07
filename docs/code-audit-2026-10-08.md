# 疾风引擎 — 全仓缺陷审计报告

**审计日期**：2026-10-08
**审计基准**：`master` @ `18b4c9a`
**审计范围**：`electron/main.ts`、`electron/preload.ts`、`shared/types.ts`、22 个非测试 service、`src/pages/` 15 个页面、`src/router/`、`src/components/` 3 个组件、`src/composables/` 4 个
**结果**：9 项确认缺陷，全部已修复；新增 12 项回归测试。

---

## 一、缺陷清单

| # | 级别 | 位置 | 问题 | 状态 |
|---|---|---|---|---|
| 1 | 🔴 | `electron/services/update.electron.ts:61-70` | 更新下载完成后**无条件** 3 秒强杀重启，完全不读 `autoInstallOnQuit` 偏好 | ✅ 已修 |
| 2 | 🔴 | `electron/services/update.electron.ts:26-27` | 构造期写死 `autoDownload` / `autoInstallOnAppQuit` = true，用户偏好失去约束力 | ✅ 已修 |
| 3 | 🟠 | `electron/services/optimizer.ts:288,290` | unix 回收站清理 `A \|\| B; echo "OK"` —— `;` 后恒成功，清理失败也报成功 | ✅ 已修 |
| 4 | 🟠 | `electron/services/optimizer.ts:431-436` | macOS 启用启动项时先还原再**无条件覆盖** plist，原始配置永久丢失 | ✅ 已修 |
| 5 | 🟠 | `electron/services/process.ts:217` | `PRIORITY_CLASS[level]` 可被原型链成员绕过白名单 | ✅ 已修 |
| 6 | 🟠 | `electron/services/winservices.ts:303` | `STARTUP_TYPE_MAP[startType]` 同类问题 | ✅ 已修 |
| 7 | 🟠 | `src/pages/Process.vue:133` | 优先级下拉 `:value="'normal'"` 写死，不反映真实优先级 | ✅ 已修 |
| 8 | 🟡 | `electron/services/history.ts:46-57` | `add()` 不校验入参，写入脏记录后被读取时静默过滤 | ✅ 已修 |
| 9 | 🟡 | `electron/services/process.ts:139-172` | unix 采集临时文件无 `trap`，超时被杀时残留 | ✅ 已修 |
| 10 | 🟡 | `UpdateCard.vue:45` / `DllRepair.vue:86` | `openExternal` 返回值被丢弃，失败静默 | ✅ 已修 |

### 附：清理项

| 文件 | 性质 |
|---|---|
| `after-build.txt` / `after-test.txt` / `after-typecheck.txt` / `baseline-test.txt` / `baseline-typecheck.txt` | 命令输出快照，**含本机绝对路径** `D:/网站全栈项目/项目002` |
| `sync.ps1` | 指向已不存在路径 `D:\网站全栈项目\scripts\sync-to-github.ps1` 的失效脚本 |
| `.superpowers/` | 头脑风暴临时状态（含 `state/server-stopped`），项目计划文档本就将其列为应忽略项 |

`.gitignore` 已补 `after-*.txt`、`baseline-*.txt`、`sync.ps1`、`.superpowers/`、`.trae/` 规则防复发。
`verify-ui.html` **保留**——它是有意的 7 页面可视化验证工具（项目记忆中有明确记载），非垃圾产物。

---

## 二、逐项修复说明

### 🔴 1+2 更新强杀重启

**修复前**

```ts
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true
// ...
autoUpdater.on('update-downloaded', (info) => {
  emit({ type: 'downloaded', version: String(info?.version ?? '') })
  if (app.isPackaged) {
    setTimeout(() => { autoUpdater.quitAndInstall(false, true) }, 3000)   // 无条件
  }
})
```

**修复后**：偏好存进闭包 `prefs` 并由 `configure()` 统一赋予；自动重启仅在 `prefs.autoInstallOnQuit === true` 时安排；定时器句柄保存，手动「立即重启」与关闭开关时 `clearTimeout`，保证只执行一次。

### 🟠 3 unix 回收站假成功

```diff
- osascript ... || rm -rf "$HOME/.Trash/"* 2>/dev/null; echo "OK"
+ if osascript ...; then        echo "OK"
+ elif rm -rf "$HOME/.Trash/"*; then echo "OK"
+ else                          echo "ERR:清空回收站失败"
+ fi
```

Windows 分支此前已用 `try/catch` + `$failed` 数组修好，unix 两条是漏网。

### 🟠 4 macOS plist 覆盖

```diff
- mv -f ${plist}.disabled ${plist} 2>/dev/null
- cat > ${plist} <<'GALE_PLIST_EOF' ... GALE_PLIST_EOF
+ if   [ -f ${plist}.disabled ]; then mv -f ${plist}.disabled ${plist} && echo "OK" || echo "ERR:..."
+ elif [ -f ${plist} ];          then echo "OK"
+ else                                cat > ${plist} <<'GALE_PLIST_EOF' ... GALE_PLIST_EOF
+ fi
```

### 🟠 5+6 原型链绕过

```diff
- const cls = PRIORITY_CLASS[level]
- if (!cls) return ''
+ const hasLevel = Object.prototype.hasOwnProperty.call(PRIORITY_CLASS, level)
+ const cls = hasLevel ? PRIORITY_CLASS[level] : undefined
```

`level = 'constructor'` 时旧代码取到原生 `Object` 构造函数（truthy），被插值成
`function Object() { [native code] }` 拼进命令。`winservices.ts` 同改。

### 🟠 7 进程优先级

补齐真实采集链路：`Get-Process.PriorityClass`（win）与 `ps -o ni`（unix，按与 `PRIORITY_NICE` 各档距离取最近档）→ `ProcessInfo.priority`（可选）→ 下拉 `:value="p.priority ?? ''"`。
**读不到时为 `undefined`，界面回落占位项，不谎报 normal。**

---

## 三、审计中确认「不存在」的类别

这些是同类项目常见坑，逐项查过，本项目**未发现**——特此记录，避免后续重复排查：

| 检查项 | 结论 |
|---|---|
| IPC 契约断裂 | 未发现。`preload.ts` 68 个 `invoke` 与 `main.ts` 68 个 `ipcMain.handle` **双向差集均为空** |
| 路由 / 侧边栏不一致 | 未发现。15 条业务路由与侧边栏 15 项逐项一致，`src/pages/` 无孤儿页面 |
| PowerShell `[int]` 溢出 | 未发现。容量字段全为 `[int64]`/`[long]`；`[int]` 仅用于 PID/核心数 |
| mWh / Wh 单位错误 | 未发现。`hardware.ts` 已显式 `/1000`，`Hardware.vue` 按 type 标 Wh/W |
| 百分比未 clamp | 未发现。`monitor` / `disk` / `network` / `update` 全部钳制 0–100 |
| 用 `includes('OK')` 判定 | 未发现。22 个 service 均走 `parseActionOutcome`（唯一漏网的 #3 是脚本端造假，非 JS 端误判） |
| 渲染层定时器泄漏 | 未发现。`usePolling` / `useFlash` / `useTheme` 均在 `onUnmounted` 清理 |
| 生产代码依赖 `detectPlatform()` | 未发现。全部由 `main.ts:36` 计算一次后显式注入 |

---

## 四、质量门禁（修复后实测）

| 门禁 | 结果 |
|---|---|
| `vue-tsc --noEmit` | ✅ 0 错误 |
| `vitest run` | ✅ **570 passed / 3 skipped**（31 文件） |
| `electron-vite build` | ✅ exit 0 |

回归测试新增 12 项（558 → 570），全部以「修复前会失败」的方式编写：

- `optimizer.test.ts`：launchd 不覆盖已有 plist；darwin / linux 回收站失败必回 ERR 且不得出现 `; echo "OK"`
- `process.test.ts`：原型链成员（4 个）在 win32 / linux 均被拒；PriorityClass 解析；nice 解析（含非标准值取最近档）；字段缺失时不谎报；unix 脚本带 `trap`
- `winservices.test.ts`：原型链成员（4 个）被拒
- `history.test.ts`：非法 `type` / 空 `label` / 空对象均抛错且不落库；非字符串 `detail` 被忽略

---

## 五、遗留事项

1. **推送仍被凭据阻塞** —— 本地 master 领先远端 6+ 提交，SSH 22 拒、443 `publickey denied`、无已存储 HTTPS 凭据。
2. **v0.1.13 尚未发版** —— CHANGELOG 章节已就绪；发版时执行：
   ```bash
   npm version 0.1.13
   git tag v0.1.13
   git push origin master && git push origin v0.1.13   # CI 六矩阵构建
   python scripts/sync-dist-hashes.py                  # 回填 scoop / homebrew 的真实 SHA256
   ```
3. **GitHub Release v0.1.11 / v0.1.12 的 body 仍是占位文案**（CHANGELOG 当时还没补章节）。可跑 `release-backfill.yml`，或直接 PATCH：
   ```bash
   curl -X PATCH -H "Authorization: Bearer <TOKEN>" \
     https://api.github.com/repos/afdk1991/gale-engine/releases/tags/v0.1.12 \
     -d '{"body": "<docs/release-notes-v0.1.12.md 内容>"}'
   ```
