# 疾风引擎 (Gale Engine)

跨平台桌面优化加速软件：硬件监控与型号规格、进程管理、垃圾清理、启动项管理、游戏模式、系统服务、计划任务与防火墙管理，集成在一个轻量 Electron 桌面应用里。支持 **Windows 10/11、macOS、Linux**（x64 + arm64）。

当前版本：**v0.1.7**（跨平台全平台支持，13 个系统服务全跨平台 + 6 矩阵 CI）

- 官网：https://gy.mixm.top
- 仓库：https://github.com/afdk1991/gale-engine
- 最新安装包：https://github.com/afdk1991/gale-engine/releases

---

## 安装方式

### Windows

| 方式 | 命令 / 链接 | 适用场景 |
| --- | --- | --- |
| **Scoop**（推荐） | `scoop bucket add gale https://github.com/afdk1991/gale-engine` → `scoop install gale-engine` | 命令行用户，自动更新 |
| **直接下载** | [GitHub Releases](https://github.com/afdk1991/gale-engine/releases/latest) → `gale-engine-0.1.7-x64-setup.exe` / `arm64-setup.exe` | 普通用户，双击安装 |

> Scoop manifest 位于仓库 `scoop/gale-engine.json`，支持 x64 + arm64，`checkver` + `autoupdate` 已配置，新版本发布后 `scoop update` 即可升级。

### macOS

| 方式 | 命令 / 链接 | 适用场景 |
| --- | --- | --- |
| **Homebrew**（推荐） | `brew tap afdk1991/gale-engine https://github.com/afdk1991/gale-engine` → `brew install --cask gale-engine` | 命令行用户，自动更新 |
| **直接下载** | [GitHub Releases](https://github.com/afdk1991/gale-engine/releases/latest) → `gale-engine-0.1.7-x64.dmg` / `arm64.dmg` | 普通用户，拖入 Applications |

> Homebrew Cask 位于仓库 `homebrew/gale-engine.rb`，自动按 CPU 架构（Intel / Apple Silicon）选择对应 DMG。应用未签名，首次打开需右键 → 打开。

### Linux

| 方式 | 命令 / 链接 | 适用场景 |
| --- | --- | --- |
| **AppImage**（推荐） | [下载](https://github.com/afdk1991/gale-engine/releases/latest) → `chmod +x gale-engine-0.1.7-x86_64.AppImage` → `./gale-engine-0.1.7-x86_64.AppImage` | 免安装，即下即用 |
| **deb** | [下载](https://github.com/afdk1991/gale-engine/releases/latest) → `sudo dpkg -i gale-engine-0.1.7-amd64.deb` | Debian / Ubuntu (x64) |
| **直接下载** | [GitHub Releases](https://github.com/afdk1991/gale-engine/releases/latest) | 全部产物 |

> AppImage 同时提供 x64 (`x86_64`) 和 arm64 两个架构。deb 仅支持 x64。

---

## 功能特性

| 模块 | 能力 |
| --- | --- |
| 📊 硬件监控 | 实时采集 CPU 负载/每核、内存、磁盘、网络收发速率、温度/电量/运行时长，页面每秒刷新仪表盘 |
| 🔧 硬件信息 | 主板/CPU/内存/显卡/显示器/硬盘/电源 型号规格采集（systeminformation 跨平台，x86/x64/arm64） |
| ⚙️ 进程管理 | 进程列表（双采样 CPU% / 内存 / 状态，按 CPU/内存/名称排序）；结束、挂起/恢复进程（Win NtSuspendProcess / unix signal）、调整优先级；系统关键进程保护 |
| 🌐 网络诊断 | Ping 延迟测试（最小/平均/最大延迟、丢包率，host 白名单防注入）；本机网卡名称/IP/状态（Win Test-Connection / unix ping+ip/ifconfig） |
| 🧹 优化中心 | 垃圾清理（Temp / 回收站 / 浏览器缓存，白名单安全路径，逐项回执 + 失败隔离）；启动项管理（Win 注册表 / mac launchd plist / Linux XDG autostart） |
| 🎮 游戏模式 | 一键切换高性能模式（Win powercfg 电源计划 / mac caffeinate 防休眠 / Linux CPU governor），退出自动还原，安全可逆 |
| 🖥️ 服务管理 | 系统服务列表（Win Win32_Service / mac launchctl / Linux systemctl）；启动 / 停止、切换启动类型；系统关键服务保护 |
| ⏰ 计划任务 | 计划任务列表（Win Get-ScheduledTask / mac launchd / Linux systemctl timer+cron）；启用 / 禁用、立即运行、结束运行中任务 |
| 🛡️ 防火墙 | Win NetFirewallProfile / mac pfctl / Linux ufw：配置文件开关、规则列表与启用/禁用（需管理员/root） |
| 🧰 系统工具箱 | 刷新 DNS、清空回收站、清空剪贴板、切换深色模式，按平台分发命令，幂等且失败有反馈 |
| 🕘 优化记录 | 每次清理 / 模式切换 / 服务与防火墙操作持久化到时间线，倒序展示、可清空 |
| 🎨 主题设置 | 3 种外观（系统/浅/深）× 6 种强调色（蓝/青/紫/绿/橙/渐变），electron-store 持久化，跨重启保持 |
| 🔄 自动更新 | 应用内「设置 → 检查更新」，指向 GitHub Releases（各平台 `latest*.yml` 驱动） |

## 技术架构

- **框架**：Electron 33 + Vue 3 + TypeScript（electron-vite 多进程构建）
- **渲染层**：`src/pages/` 十三个页面，左侧导航（720px 以下收窄为图标栏）
- **主进程**：`electron/main.ts` 注册 42 个 IPC handler，`electron/preload.ts` 桥接为 `window.gale`（`contextIsolation: true`）
- **服务层**：`electron/services/<module>.ts`，全部可注入依赖（fetcher / exec runner / storage），纯逻辑可单测；`shell.ts` 为平台抽象层（PAL），按 `process.platform` 选择 PowerShell / bash 执行器
- **跨平台**：13 个 service 全部跨平台（9 个手动 win/unix 脚本分发 + 4 个天然跨平台库）；支持 Win10/11 + macOS + Linux，x64 + arm64
- **安全**：所有用户输入（进程 PID / 主机名 / 任务路径 / 服务名 / 规则名）经字符白名单校验，防 shell 注入
- **持久化**：electron-store（设置与优化记录）
- **自动更新**：electron-updater，指向 GitHub Releases（各平台 `latest*.yml` 驱动）
- **打包**：electron-builder，Win NSIS / macOS dmg / Linux AppImage+deb，产物名带 `${arch}`

```
项目002/
├── electron/            # 主进程 + 服务层（含 vitest 单测）
│   └── services/        # monitor / hardware / process / network / optimizer / gamemode
│                        # / toolbox / history / settings / winservices / tasks
│                        # / firewall / autolaunch / update / shell(PAL)
│                        #（每个模块配套 .test.ts）
├── src/                 # 渲染层（Vue3 页面 + 主题令牌系统）
├── shared/              # 类型契约 GaleApi
├── landing/             # 静态落地页（EdgeOne Makers 部署，多平台下载适配）
├── scripts/             # package-win.cmd / gen-smoke-html.py / generate-icon.mjs / verify-theme-persistence.mjs
├── docs/                # M2/M3/M4 计划、冒烟清单、跨平台路线图、鸿蒙调研、平台验证
├── build/               # 应用图标 + entitlements.mac.plist
└── .github/workflows/   # release.yml（6 矩阵 CI：win/macos/linux × x64/arm64）
                         # release-backfill.yml（为历史 tag 补发安装包）
```

## 开发

```bash
npm install              # 安装依赖
npm run dev              # 启动开发模式（electron-vite dev）
npm run typecheck        # vue-tsc 类型检查（发布准入）
npm test                 # vitest 全量单测（当前 231 项全绿）
```

## 打包与发布

### 本地打包（按平台）

```bash
npm run package:win      # Windows（NSIS，x64+arm64）
npm run package:mac      # macOS（dmg，x64+arm64）
npm run package:linux    # Linux（AppImage+deb，x64+arm64）
```

- 自动设置 npmmirror 的 electron-builder 二进制镜像，绕过 GitHub 下载阻塞
- 产出：`release/gale-engine-<version>-<arch>-setup.exe` / `.dmg` / `.AppImage` / `.deb`

### CI 自动发布（GitHub Actions 6 矩阵）

推送 `v*` tag 即触发 `.github/workflows/release.yml`，在 win/macos/linux × x64/arm64 六个矩阵上并行构建：

```bash
git tag v0.1.7 && git push origin v0.1.7
```

- 6 个平台产物汇聚到同一 Release：exe / dmg / AppImage / deb + blockmap + 各平台 `latest*.yml`
- Linux arm64 在 x64 runner 上用 qemu 交叉编译
- CI 会在构建前把 `electron-builder.yml` 中的 owner / repo 替换为真实仓库信息

> **产物名**：`artifactName` 带 `${arch}`，按格式分：exe/dmg 用 `x64`/`arm64`，AppImage 用 `x86_64`/`arm64`，deb 用 `amd64`（仅 x64）。各平台独立 `latest*.yml` 驱动 electron-updater 按当前 OS+架构拉取对应增量包。

### 补发历史版本

早期 tag（v0.1.0 / v0.1.1）在推送时并没有可用的发布工作流：v0.1.0 时仓库尚无 `.github/workflows`，v0.1.1 的 release.yml 依赖当时还不存在的 `package:ci` 脚本，且 v0.1.1 的 `artifactName` 是中文名（会导致自动更新 404）。这些版本由 `release-backfill.yml` 补发。

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
- 直接调用 `electron-vite build` 与 `electron-builder --win --publish never`，不依赖各 tag 的 npm script（v0.1.0 / v0.1.1 无 `package:ci`）
- 用 `npm install` 而非 `npm ci`，容忍历史 lockfile 与当前 Node 版本的解析差异

### 代码签名

未配置证书时跳过签名，Windows SmartScreen 会提示「未知发布者」。配置方式（无需改配置文件）：

```bash
set CSC_LINK=<证书 p12 路径或 base64>
set CSC_KEY_PASSWORD=<证书密码>
npm run package
```

## 验证与验收

- **单测**：`npm test`（231 项，覆盖全部 service 纯逻辑 + 跨平台分支 + 主题系统 + 侧边栏组件）
- **类型**：`npm run typecheck`
- **核心命令直测**：服务层脚本可在本机直接验证（Win PowerShell / mac-linux bash）
- **主题持久化 E2E**（真实 GUI，Windows 实机）：
  ```bash
  node scripts/verify-theme-persistence.mjs
  ```
  通过 CDP 驱动真实应用：点击「深色 + 能量橙」→ 关闭 → 重启验证主题保持。
- **冒烟清单**：`docs/smoke-test-checklist.html`（交互式，231 项，含 44 项实机 GUI 冒烟）

## 已知限制

- 进程 CPU% 为双采样估算值，短生命周期进程可能显示偏低
- 挂起/结束系统关键进程被保护拒绝；调整高优先级可能因权限失败（需管理员）
- 修改防火墙配置 / 停止部分服务需要管理员权限（Win UAC / mac root / Linux root），普通权限下会返回明确错误信息
- 防火墙规则仅展示前 200 条（按显示名排序），海量规则场景建议使用筛选
- macOS 应用未配置 Apple Developer 证书时，Gatekeeper 会提示「未验证开发者」，需右键→打开；配置证书后 CI 自动签名+公证
- Linux 服务/计划任务/防火墙操作依赖 systemd / cron / ufw / iptables，init 系统与无 ufw 的发行版降级为只读
- 代码签名未配置（Win）/ 未公证（mac），首次安装会有系统安全提示，属预期
- 内存条 / 硬盘型号需管理员/root 权限，无权限时返回空（已在 UI 标注）

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。
