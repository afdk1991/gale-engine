# 疾风引擎 (Gale Engine)

Windows 桌面优化加速软件：硬件监控、进程管理、垃圾清理、启动项管理、游戏模式、系统服务与防火墙管理，集成在一个轻量 Electron 桌面应用里。

当前版本：**v0.4.0**（系统深度管理里程碑，十大功能模块全部可用）

- 仓库：https://github.com/afdk1991/gale-engine
- 最新安装包：https://github.com/afdk1991/gale-engine/releases

---

## 功能特性

| 模块 | 能力 |
| --- | --- |
| 📊 硬件监控 | 实时采集 CPU 负载/每核、内存、磁盘、网络收发速率、温度/电量/运行时长，页面每秒刷新仪表盘 |
| ⚙️ 进程管理 | 进程列表（双采样 CPU% / 内存 / 状态，按 CPU/内存/名称排序）；结束、挂起/恢复进程（NtSuspendProcess P/Invoke）、调整优先级；系统关键进程保护 |
| 🌐 网络诊断 | Ping 延迟测试（最小/平均/最大延迟、丢包率，host 白名单防注入）；本机网卡名称/IP/状态 |
| 🧹 优化中心 | 垃圾清理（Temp / 回收站 / Chrome、Edge 浏览器缓存，白名单安全路径，逐项回执 + 失败隔离）；启动项管理（HKCU / HKLM 注册表启停） |
| 🎮 游戏模式 | 一键切换高性能电源计划（`powercfg /setactive`），退出自动还原，安全可逆 |
| 🖥️ 服务管理 | Windows 服务列表（状态 / 启动类型 / 可停止标记）；启动 / 停止（二次确认）、切换启动类型；系统关键服务保护（RpcSs / DcomLaunch / Winmgmt 等 10 项拒绝停止） |
| ⏰ 计划任务 | 计划任务列表（状态 / 上次 / 下次运行时间，名称路径筛选）；启用 / 禁用、立即运行、结束运行中任务 |
| 🛡️ 防火墙 | Domain / Private / Public 三配置文件开关切换；规则列表（前 200 条 + 筛选）与单条规则启用 / 禁用 |
| 🧰 系统工具箱 | 刷新 DNS、清空回收站、清空剪贴板、切换深色模式，幂等且失败有反馈 |
| 🕘 优化记录 | 每次清理 / 模式切换 / 服务与防火墙操作持久化到时间线，倒序展示、可清空 |
| 🎨 主题设置 | 3 种外观（系统/浅/深）× 6 种强调色（蓝/青/紫/绿/橙/渐变），electron-store 持久化，跨重启保持 |
| 🔄 自动更新 | 应用内「设置 → 检查更新」，指向 GitHub Releases（`latest.yml` 驱动） |

## 技术架构

- **框架**：Electron 33 + Vue 3 + TypeScript（electron-vite 多进程构建）
- **渲染层**：`src/pages/` 十二个页面，左侧导航（720px 以下收窄为图标栏）
- **主进程**：`electron/main.ts` 注册 41 个 IPC handler，`electron/preload.ts` 桥接为 `window.gale`（`contextIsolation: true`）
- **服务层**：`electron/services/<module>.ts`，全部可注入依赖（fetcher / exec runner / storage），纯逻辑可单测
- **安全**：所有用户输入（进程 PID / 主机名 / 任务路径 / 服务名 / 规则名）经字符白名单校验，防 PowerShell 注入
- **持久化**：electron-store（设置与优化记录）
- **自动更新**：electron-updater，指向 GitHub Releases（`latest.yml` 驱动）
- **打包**：electron-builder NSIS，支持自定义安装目录，中文界面

```
项目002/
├── electron/            # 主进程 + 服务层（含 vitest 单测）
│   └── services/        # monitor / process / network / optimizer / gamemode / toolbox
│                        # / history / settings / winservices / tasks / firewall
│                        # / autolaunch / update（每个模块配套 .test.ts）
├── src/                 # 渲染层（Vue3 页面 + 主题令牌系统）
├── shared/              # 类型契约 GaleApi
├── landing/             # 静态落地页（EdgeOne Makers 部署）
├── scripts/             # package-win.cmd / publish-release.ps1 / generate-icon.mjs / verify-theme-persistence.mjs
├── docs/                # M2 / M3 / M4 计划、冒烟清单
├── build/               # 应用图标（icon.ico / icon.png，由 generate-icon.mjs 生成）
└── .github/workflows/   # release.yml（打 tag 自动构建发布）
                         # release-backfill.yml（为历史 tag 补发安装包）
```

## 开发

```bash
npm install              # 安装依赖
npm run dev              # 启动开发模式（electron-vite dev）
npm run typecheck        # vue-tsc 类型检查（发布准入）
npm test                 # vitest 全量单测（当前 142 项全绿）
```

## 打包与发布

### 本地一键打包（国内网络友好）

```bash
scripts/package-win.cmd
```

- 自动设置 npmmirror 的 electron-builder 二进制镜像，绕过 GitHub 下载阻塞
- 产出：`release/gale-engine-<version>-setup.exe`（NSIS，支持自定义安装目录）

### CI 自动发布（GitHub Actions）

推送 `v*` tag 即触发 `.github/workflows/release.yml`：

```bash
git tag v0.4.0 && git push origin v0.4.0
```

- 在 windows-latest 上构建 NSIS 安装包，自动发布到 GitHub Releases
- 上传产物含 `latest.yml`（electron-updater 依赖它检查与下载新版本）
- CI 会在构建前把 `electron-builder.yml` 中的 owner / repo 替换为真实仓库信息
- 本地手动发布可用 `scripts/publish-release.ps1`

> **文件名注意**：`artifactName` 必须用 ASCII（`gale-engine-${version}-setup.exe`）。若用中文名，electron-builder 会在 `latest.yml` 中生成净化名，与实际产物不一致导致自动更新 404。安装界面展示名仍取 `productName`（疾风引擎）。

### 补发历史版本

早期 tag（v0.1.0 / v0.2.0）在推送时并没有可用的发布工作流：v0.1.0 时仓库尚无 `.github/workflows`，v0.2.0 的 release.yml 依赖当时还不存在的 `package:ci` 脚本，且 v0.2.0 的 `artifactName` 是中文名（会导致自动更新 404）。这些版本由 `release-backfill.yml` 补发。

在 GitHub 仓库页面手动触发：**Actions → Release — 补发历史版本安装包 → Run workflow**，填入 tag（如 `v0.1.0`）。

```bash
# 等价的 API 调用方式
curl -X POST \
  -H "Authorization: token <PAT>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/afdk1991/gale-engine/actions/workflows/release-backfill.yml/dispatches \
  -d '{"ref":"master","inputs":{"tag":"v0.1.0"}}'
```

补发工作流与常规发版的区别：

- checkout **指定 tag 的源码**，但用当前规范的 `electron-builder.yml` 覆盖（ASCII 产物名 + 真实 owner/repo）
- 直接调用 `electron-vite build` 与 `electron-builder --win --publish never`，不依赖各 tag 的 npm script（v0.1.0 / v0.2.0 无 `package:ci`）
- 用 `npm install` 而非 `npm ci`，容忍历史 lockfile 与当前 Node 版本的解析差异

### 代码签名

未配置证书时跳过签名，Windows SmartScreen 会提示「未知发布者」。配置方式（无需改配置文件）：

```bash
set CSC_LINK=<证书 p12 路径或 base64>
set CSC_KEY_PASSWORD=<证书密码>
npm run package
```

## 验证与验收

- **单测**：`npm test`（142 项，覆盖全部 service 纯逻辑 + 主题系统 + 侧边栏组件）
- **类型**：`npm run typecheck`
- **核心命令直测**：服务层 PowerShell 命令可在本机 PowerShell 直接验证（进程采集 / 挂起恢复 / Ping / 网卡 / 服务查询 / 计划任务 / 防火墙配置）
- **主题持久化 E2E**（真实 GUI，Windows 实机）：
  ```bash
  node scripts/verify-theme-persistence.mjs
  ```
  通过 CDP 驱动真实应用：点击「深色 + 能量橙」→ 关闭 → 重启验证主题保持。
- **冒烟清单**：`docs/smoke-test-checklist.md`（Windows 实机逐项核验全部模块）

## 已知限制

- 进程 CPU% 为双采样估算值，短生命周期进程可能显示偏低
- 挂起/结束系统关键进程被保护拒绝；调整高优先级可能因权限失败（需管理员）
- 修改防火墙配置 / 停止部分服务需要管理员权限，普通权限下会返回明确错误信息
- 防火墙规则仅展示前 200 条（按显示名排序），海量规则场景建议使用筛选
- 计划任务未过滤 `\Microsoft\` 内部维护任务，建议按路径筛选查看第三方任务
- 代码签名未配置，Windows SmartScreen 会提示「未知发布者」，属预期

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。
