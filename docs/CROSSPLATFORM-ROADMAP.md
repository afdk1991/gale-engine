# 疾风引擎 — 跨平台迁移路线图（Windows / macOS / Linux / ARM64）

> 制定时间：2026-09-05 ｜ 当前进度：架构层 + 1 个代表性 service（network）已转换，149 测试全绿
> 目标：12 个 service 全部支持 Win/macOS/Linux，6 套构建产物（3 OS × 2 架构）

## 一、架构总览

已建立的跨平台基础设施：

```
electron/services/
  shell.ts            # ExecRunner 接口 + createPowershellRunner / createBashRunner / createPlatformRunner 工厂
  network.ts          # ✅ 已转换：buildPingScript/buildInterfacesScript 按 platform 分发 win/unix 脚本
  monitor.ts          # ✅ 天然跨平台：systeminformation 库支持 Win/mac/Linux，零改造
  其余 9 个 service   # ⏳ 待迁移（见下表）
```

**转换范式**（以 network 为模板）：
1. service 接口与工厂签名**保持不变**（`createXxxService(runner)`）。
2. 内部脚本生成器拆为 `buildScriptWin()` / `buildScriptUnix()`，新增 `platform` 参数默认 `detectPlatform()`。
3. 解析器（`parseXxx`）平台无关，统一解析 JSON 输出。
4. 工厂按 `platform` 分发脚本：`runner.run(buildScript(host, platform))`。
5. 测试增补 unix 分支断言。

## 二、12 个 service 迁移状态与平台命令映射

| # | service | 状态 | Windows 命令 | macOS 等价 | Linux 等价 | 难度 |
|---|---|---|---|---|---|---|
| 1 | monitor | ✅ 完成 | systeminformation（跨平台库，零改造） | 同 | 同 | — |
| 2 | network | ✅ 完成 | Test-Connection / Win32_NetworkAdapter | ping / ifconfig | ping / ip addr | 已完成 |
| 3 | process | ⏳ 待迁 | Get-Process / NtSuspendProcess | ps / kill -STOP / kill -CONT | ps / kill -STOP/-CONT | 中 |
| 4 | optimizer | ⏳ 待迁 | 注册表 Run 键 / 回收站 / 浏览器缓存 | launchctl plist / ~/.Trash | systemd / ~/.local/share/Trash | 中 |
| 5 | gamemode | ⏳ 待迁 | powercfg 电源计划 | pmset / caffeinate | 无原生电源计划（用 cpufreq/gov） | 中高 |
| 6 | toolbox | ⏳ 待迁 | ipconfig /flushdns / 回收站 / 剪贴板 | dscacheutil -flushcache / pbcopy | systemd-resolve --flush-caches / xclip | 低 |
| 7 | autolaunch | ⏳ 待迁 | 注册表 Run / 启动文件夹 | launchd plist (~/Library/LaunchAgents) | systemd user unit / XDG autostart | 中 |
| 8 | firewall | ⏳ 待迁 | Get-NetFirewallProfile/Rule | pfctl / pf.conf（需 root） | ufw / iptables（需 root） | 高 |
| 9 | tasks | ⏳ 待迁 | Get-ScheduledTask | launchctl print/load/unload | systemctl list-units / crontab | 高 |
| 10 | winservices | ⏳ 待迁 | Win32_Service / Set-Service | launchctl / launchd plists | systemctl start/stop/enable | 高 |
| 11 | settings | ✅ 跨平台 | electron-store（跨平台，零改造） | 同 | 同 | — |
| 12 | history | ✅ 跨平台 | electron-store（跨平台，零改造） | 同 | 同 | — |
| 13 | update | ✅ 跨平台 | electron-updater（跨平台，需各平台 latest.yml） | 同 | 同 | — |

**已完成跨平台：4 个**（monitor / settings / history / update —— 用了跨平台库）
**已手动转换：1 个**（network —— 模板）
**待迁移：8 个**（process / optimizer / gamemode / toolbox / autolaunch / firewall / tasks / winservices）

## 三、迁移优先级（建议批次）

### 批次 1：低风险只读/工具类（先打通 mac/linux 启动体验）
- **toolbox**（难度低，mac/linux 命令清晰）
- **process**（只读 list 已可用 systeminformation 进阶；写操作 kill/signal 跨平台）

### 批次 2：优化与自启
- **optimizer**（缓存路径按平台映射，启动项用各平台机制）
- **autolaunch**（launchd / systemd / XDG autostart）

### 批次 3：特权系统管理（难度最高，需逐个验证权限模型）
- **gamemode**（mac 用 pmset/caffeinate，Linux 无标准电源计划，可能降级为 CPU 调速器切换）
- **winservices** → 重命名概念为「服务管理」，mac/linux 用 launchctl/systemctl
- **tasks** → 「计划任务」，mac/linux 用 launchd/crontab/systemd timer
- **firewall** → mac/linux 需 root，UI 需提示提权

## 四、ARM64 验证清单

构建配置已就绪（electron-builder.yml + release.yml 矩阵）。验证项：

- [ ] **Windows ARM64**：在 Win11 ARM 设备（如 Surface Pro X / Snapdragon 本）安装 `*-arm64-setup.exe`，确认启动 + 监控 + 网络诊断正常
- [ ] **macOS ARM64**：Apple Silicon（M1/M2/M3/M4）安装 `*-arm64.dmg`，确认签名/公证后可运行（无 Apple 证书则 Gatekeeper 提示，右键打开可用）
- [ ] **Linux ARM64**：树莓派 4/5 或 ARM 服务器运行 `*-arm64.AppImage`，确认 bash 脚本执行正常
- [ ] 自动更新：各平台独立 `latest-*.yml`，electron-updater 按当前 OS+架构拉取对应增量包
- [ ] 产物名：确认 `artifactName` 含 `${arch}`，避免不同架构产物同名覆盖

## 五、发布策略

### Release 资产结构（单次发版，6 个矩阵产物汇聚到一个 Release）
```
Release v0.5.0
├── gale-engine-0.5.0-x64-setup.exe          # Win x64
├── gale-engine-0.5.0-arm64-setup.exe        # Win ARM64
├── gale-engine-0.5.0-x64.dmg                # macOS Intel
├── gale-engine-0.5.0-arm64.dmg              # macOS Apple Silicon
├── gale-engine-0.5.0-x64.AppImage           # Linux x64
├── gale-engine-0.5.0-arm64.AppImage         # Linux ARM64
├── gale-engine-0.5.0-x64.deb                # Linux x64 (deb)
├── *.blockmap                                # 各产物增量更新映射
├── latest.yml                                # Win 自动更新元数据
├── latest-mac.yml                            # Mac 自动更新元数据
└── latest-linux.yml                          # Linux 自动更新元数据
```

### 落地页调整
- 下载按钮按访问者 OS 自动推荐对应包（UA 检测或显式三个 Tab：Windows/macOS/Linux）。
- 各平台显示架构选择（x64 / ARM64）。

## 六、风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| mac/linux 脚本在特定发行版异常（如 Alpine 无 bash） | 该平台功能失败 | createBashRunner 检测 /bin/sh 兜底；脚本用 POSIX 子集 |
| ARM64 交叉编译产物在真机表现未验 | 部分功能异常 | 上线前按 ARM64 验证清单实机点检 |
| mac 公证缺失致 Gatekeeper 拦截 | 用户无法双击打开 | 文档说明「右键→打开」；配 Apple 证书后自动公证 |
| Linux 发行版差异（systemd vs init） | 老系统服务管理失败 | 优先支持 systemd（主流），init 系统降级只读 |
| 单平台 CI 失败拖慢发版 | 发版延迟 | release.yml `fail-fast: false`，单平台失败不阻断其他 |

### 回滚策略
- 任一平台严重问题不阻断发版：CI 矩阵已设 `fail-fast: false`，可手动从 Release 删除问题平台产物，保留可用平台。
- 架构层改动（shell.ts / main.ts）已通过 149 全绿测试，回滚只需还原这两个文件即可恢复纯 Windows 行为。

## 七、当前完成度

- [x] 平台抽象层（PAL）：shell.ts 三 runner + 平台检测 + 工厂
- [x] network 多平台转换（win/unix 脚本 + 22 测试全绿）
- [x] monitor/settings/history/update 天然跨平台（无需改动）
- [x] main.ts 接入平台工厂
- [x] electron-builder.yml：Win/Mac/Linux + x64/arm64 配置
- [x] release.yml：6 矩阵 CI 构建
- [x] macOS entitlements 文件
- [x] 鸿蒙调研报告
- [ ] 8 个待迁 service（按批次推进）
- [ ] ARM64 三平台实机验证
- [ ] 落地页多平台下载适配

> 下一步建议：按批次 1（toolbox + process）推进，每批完成后跑全量测试 + 对应平台实机冒烟。
