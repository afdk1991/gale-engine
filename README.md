# 疾风引擎 (Gale Engine)

Windows 桌面优化加速软件：硬件监控、垃圾清理、启动项管理、游戏模式与系统工具箱，集成在一个轻量 Electron 桌面应用里。

当前版本：**v0.2.0**（功能里程碑，五大模块全部可用）

---

## 功能特性

| 模块 | 能力 |
| --- | --- |
| 📊 硬件监控 | 实时采集 CPU 负载/每核、内存、磁盘、网络收发速率、温度/电量/运行时长，页面每秒刷新仪表盘 |
| 🧹 优化中心 | 垃圾清理（扫描 Temp / 回收站，白名单安全路径，逐项回执 + 失败隔离）；启动项管理（HKCU / HKLM 注册表启停） |
| 🎮 游戏模式 | 一键切换高性能电源计划（`powercfg /setactive`），退出自动还原，安全可逆 |
| 🧰 系统工具箱 | 刷新 DNS、清空回收站、清空剪贴板、切换深色模式，幂等且失败有反馈 |
| 🕘 优化记录 | 每次清理 / 模式切换持久化到时间线，倒序展示、可清空 |
| 🎨 主题设置 | 3 种外观（系统/浅/深）× 6 种强调色（蓝/青/紫/绿/橙/渐变），electron-store 持久化，跨重启保持 |

## 技术架构

- **框架**：Electron 33 + Vue 3 + TypeScript（electron-vite 多进程构建）
- **渲染层**：`src/pages/` 七个页面（首页/监控/优化/游戏模式/工具箱/记录/设置），左侧导航
- **主进程**：`electron/main.ts` 注册 22 个 IPC handler，`electron/preload.ts` 桥接为 `window.gale`（`contextIsolation: true`）
- **服务层**：`electron/services/<module>.ts`，全部可注入依赖（fetcher / exec runner / storage），纯逻辑可单测
- **持久化**：electron-store（设置与优化记录）
- **自动更新**：electron-updater，指向 GitHub Releases（`latest.yml` 驱动）
- **打包**：electron-builder NSIS，支持自定义安装目录，中文界面

```
项目002/
├── electron/            # 主进程 + 服务层（含 vitest 单测）
│   └── services/        # monitor / optimizer / gamemode / toolbox / history / settings / autolaunch / update
├── src/                 # 渲染层（Vue3 页面 + 主题令牌系统）
├── shared/              # 类型契约 GaleApi
├── landing/             # 静态落地页（EdgeOne Makers 部署）
├── scripts/             # package-win.cmd / publish-release.ps1 / generate-icon.mjs / verify-theme-persistence.mjs
├── docs/                # M2 计划 / 冒烟清单
├── build/               # 应用图标（icon.ico / icon.png，由 generate-icon.mjs 生成）
└── .github/workflows/   # release.yml（打 tag 自动构建发布）
```

## 开发

```bash
npm install              # 安装依赖
npm run dev              # 启动开发模式（electron-vite dev）
npm run typecheck        # vue-tsc 类型检查（发布准入）
npm test                 # vitest 全量单测（当前 62 项全绿）
```

## 打包与发布

### 本地一键打包（国内网络友好）

```bash
scripts/package-win.cmd
```

- 自动设置 npmmirror 的 electron-builder 二进制镜像，绕过 GitHub 下载阻塞
- 产出：`release/gale-engine-0.2.0-setup.exe`（NSIS，支持自定义安装目录）

### CI 自动发布（GitHub Actions）

推送 `v*` tag 即触发 `.github/workflows/release.yml`：

```bash
git tag v0.3.0 && git push origin v0.3.0
```

- 自动构建 NSIS 安装包并发布到 GitHub Releases（含 `latest.yml`，驱动应用内自动更新）
- CI 会在构建前把 `electron-builder.yml` 中的 `YOUR_GITHUB_OWNER` 占位符替换为真实仓库 owner/repo
- 本地手动发布可用 `scripts/publish-release.ps1`（需先配置真实 owner）

> **注意**：`electron-builder.yml` 中 `publish.owner` 目前为占位符 `YOUR_GITHUB_OWNER`。本地构建的安装包若未替换，应用内「检查更新」会 404；如需本地构建产物也能更新，请把 owner 改为你的 GitHub 用户名。

## 验证与验收

- **单测**：`npm test`（62 项，覆盖全部 service 纯逻辑 + 主题系统 + 侧边栏组件）
- **类型**：`npm run typecheck`
- **主题持久化 E2E**（真实 GUI，Windows 实机）：
  ```bash
  node scripts/verify-theme-persistence.mjs
  ```
  通过 CDP 驱动真实应用：点击「深色 + 能量橙」→ 关闭 → 重启验证主题保持。
- **冒烟清单**：`docs/smoke-test-checklist.md`（Windows 实机逐项核验六大模块）

## 已知限制

- 进程挂起类激进优化暂未纳入，避免影响系统稳定性
- 启动项 / 电源计划等真实 Windows 操作需在 Windows 实机验证
- 代码签名未配置，Windows SmartScreen 会提示「未知发布者」，属预期

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。
