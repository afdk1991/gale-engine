# 疾风引擎 — 发布前冒烟与检查清单

> 适用范围：每次发版（含 `v0.x` 小版本）前的质量门禁。
> 说明：自动化门禁（typecheck / vitest / 构建 / 核心 PowerShell 命令直测）已在本机通过；GUI 交互项标注「⚙️ 需 Windows 实机」，由发布人在真实 Windows 上执行。

## 一、构建与门禁（本机可验 ✅）

- [ ] `npm run typecheck`（`vue-tsc --noEmit`）零错误
- [ ] `npm run test`（`vitest run`）全绿（当前 309 项）
- [ ] `npm run build`（`electron-vite build`）主进程/预加载/渲染产物均生成，无报错
- [ ] 版本号 `package.json#version` 与计划发版号一致（当前 `0.1.9`）

## 二、安装包产出（本机可验 ✅）

- [ ] 执行 `scripts/package-win.cmd` 产出 `release/gale-engine-${version}-${arch}-setup.exe`（ASCII 文件名，保证 `latest.yml` 正确；`${arch}` 为 `x64` / `arm64`）
- [ ] 安装包为合法 NSIS（PE 头 `MZ`、含 `NullsoftInst` 区段）
- [ ] 镜像源 `ELECTRON_BUILDER_BINARIES_MIRROR` 带结尾斜杠（国内 `npmmirror` 同构路径）

## 三、核心命令直测（本机可验 ✅，服务层真实执行路径）

- [ ] 进程采集：双采样 CPU% 输出合法 JSON，字段 pid/name/cpu/mem/status 完整
- [ ] 挂起/恢复：对无害进程（notepad）执行 `NtSuspendProcess` / `NtResumeProcess` 返回 0
- [ ] Ping：`Test-Connection` 返回 min/avg/max/loss 数值，不可达目标 loss=100
- [ ] 网卡查询：返回本机网卡名称 / IP / 状态
- [ ] 浏览器缓存扫描：Chrome / Edge 的 Cache 目录存在时列入清理计划
- [ ] 服务查询：`Get-CimInstance Win32_Service` 返回 name/displayName/status/startType/canStop 完整
- [ ] 计划任务枚举：`Get-ScheduledTask | Get-ScheduledTaskInfo` 返回 taskPath/taskName/state 完整
- [ ] 防火墙配置：`Get-NetFirewallProfile` 返回 Domain/Private/Public 三个配置文件的开关与默认动作

## 四、GUI 冒烟（⚙️ 需 Windows 实机）

### 启动与导航
- [ ] 双击 `gale-engine-${version}-${arch}-setup.exe` 完成安装（支持自定义目录；默认装到用户目录，不应弹 UAC）
- [ ] 桌面/开始菜单快捷方式可启动应用，主窗口正常显示（1080×720）
- [ ] 左侧 14 个导航项均可点击，路由切换无白屏：首页 / 硬件监控 / 硬件信息 / 进程管理 / 网络诊断 / 优化中心 / 磁盘修复 / 游戏模式 / 服务管理 / 计划任务 / 防火墙 / 工具箱 / 优化记录 / 设置
- [ ] 窗口关闭后重新打开，主题（外观/强调色）设置保持

### 首页一键优化（OneKey）
- [ ] 首页 Hero 区显示「⚡ 一键优化」入口，点击后开始按序执行各可优化项
- [ ] 执行过程中实时显示进度与当前执行项，不卡界面
- [ ] 每项结果明确标注成功 / 失败 / 跳过，结束时给出汇总报告
- [ ] 「停止」可中途取消：已完成项保留结果，未执行项标为跳过
- [ ] 存在失败项时可「重试」，重试只针对失败项（默认 1 次，不无限循环）
- [ ] 一键优化过程与结果在「优化记录」中留痕

### 硬件监控（Monitor）
- [ ] 进入后每秒刷新一次；CPU 负载、内存占用、网络速率、温度/电量/运行时长均有数值
- [ ] 磁盘列表显示各盘占用百分比；无任何字段为 `NaN` 或异常负值

### 硬件信息（Hardware）
- [ ] 主板 / CPU / 内存 / 显卡 / 显示器 / 硬盘 / 电源 七类信息均有展示，无 `undefined` 或空白项
- [ ] CPU 显示型号与核心数；内存显示容量与频率；硬盘列出各盘型号与容量
- [ ] 采集失败的字段显示明确占位（如「未知」），不导致整页崩溃或长时间白屏

### 进程管理（Process）
- [ ] 进程列表按 CPU / 内存 / 名称排序切换正常，数值非 NaN
- [ ] 系统关键进程（System / lsass / svchost 等）显示「系统」徽标，结束/挂起按钮禁用
- [ ] 结束普通进程：二次确认后成功结束，列表刷新；取消不执行
- [ ] 挂起 / 恢复普通进程：状态在「已挂起 / 运行中」间切换，进程可恢复
- [ ] 调整优先级：选择后回执成功；权限不足时显示错误原因不崩溃
- [ ] 进程操作在「优化记录」中留痕

### 网络诊断（Network）
- [ ] 延迟测试：输入 `baidu.com` 或点击快捷目标，显示最小/平均/最大延迟与丢包率
- [ ] 不可达目标（如 `10.255.255.1`）显示失败提示，不崩溃
- [ ] 网卡列表显示本机网卡名称、IP 与连接状态

### 优化中心（Optimizer）
- [ ] 「重新扫描」能列出 Temp / 回收站 / 浏览器缓存占用与大小
- [ ] 勾选安全项 → 「清理选中项」回执成功计数；非安全路径项被禁用不可勾选
- [ ] 「启动项管理」列出 HKCU/HKLM 启动项；禁用/启用切换后状态即时更新
- [ ] 上述操作均在「优化记录」中留痕

### 磁盘修复（Disk）
- [ ] 空间总览列出各卷容量 / 已用 / 剩余与占用条；已用 ≥90% 或可用 <10GiB 时顶部出现「空间不足」告警
- [ ] 深度释放：清单来自服务端白名单，客户端无法传路径；勾选后回执「实测释放字节数」
- [ ] 深度释放默认**不勾选**需管理员的两项（DISM 组件清理、关闭休眠释放 hiberfil.sys）
- [ ] 缩略图缓存清理执行后资源管理器外壳自动重启，桌面不消失
- [ ] 硬盘错误检查：Windows 提供只读检查与 NTFS 在线 `/scan` 修复；**不应**出现需离线的 `/f` `/r` 选项
- [ ] DLL / 系统文件修复（`sfc /scannow` + `DISM /RestoreHealth`）给出「完整 / 已修复 / 需管理员」结论与原始输出尾部
- [ ] 非 Windows 平台对上述仅 Windows 的能力**诚实降级**（明确提示不支持），不静默失败
- [ ] 盘符 / 挂载点经过白名单校验，注入型输入被拒绝且给出错误提示

### 游戏模式（GameMode）
- [ ] 「进入游戏模式」后状态切换为已开启，提示切换到高性能计划
- [ ] 「退出游戏模式」还原进入前的电源计划，状态回到普通模式
- [ ] （验证）`powercfg /getactivescheme` 在高性能与普通计划间切换正确

### 服务管理（WinServices）
- [ ] 服务列表显示名称 / 显示名 / 状态 / 启动类型，筛选框按名称或显示名过滤生效
- [ ] 系统关键服务（RpcSs / DcomLaunch / Winmgmt 等）显示「系统」徽标，启动类型下拉与启停按钮禁用
- [ ] 停止运行中的普通服务：二次确认后成功停止，状态刷新为 Stopped；取消不执行
- [ ] 启动已停止的普通服务：状态刷新为 Running；已在运行的服务「启动」按钮禁用
- [ ] 切换启动类型（自动 / 手动 / 已禁用）后回执成功；权限不足时显示错误原因不崩溃
- [ ] 尝试停止系统关键服务被拒绝，页面显示明确错误提示
- [ ] 服务操作在「优化记录」中留痕

### 计划任务（Tasks）
- [ ] 任务列表显示任务名 / 路径 / 状态 / 上次与下次运行时间，筛选框按名称或路径过滤生效
- [ ] 启用 / 禁用任务：状态在 Ready 与 Disabled 间切换，回执成功
- [ ] 「运行」触发任务立即执行；「结束」对 Running 状态任务生效（其他状态按钮禁用）
- [ ] 操作失败（如权限不足）显示错误原因，不崩溃
- [ ] 任务操作在「优化记录」中留痕

### 防火墙（Firewall）
- [ ] 三个配置文件卡片显示 Domain / Private / Public 的开关状态与出入站默认动作
- [ ] 切换配置文件开关：点击后状态更新，回执成功；非管理员运行时显示「拒绝访问」等明确错误
- [ ] 规则列表显示规则名 / 方向 / 动作 / 启用状态（前 200 条），筛选框按名称过滤生效
- [ ] 单条规则启用 / 禁用：状态切换成功，回执提示
- [ ] 防火墙操作在「优化记录」中留痕

### 工具箱（Toolbox）
- [ ] 刷新 DNS / 清空回收站 / 清空剪贴板 / 深色·浅色 四个工具均给出成功反馈
- [ ] 失败场景（如权限不足）显示红色错误原因，不崩溃
- [ ] 每个成功工具在「优化记录」中留痕

### 设置与记录
- [ ] 外观（系统/浅色/深色）、强调色切换即时生效并持久化
- [ ] 「优化记录」时间线按时间倒序；「清空记录」后列表为空

## 五、Release 发布（CI tag 触发 + 本地备用通道）

### CI 自动发布（⚙️ GitHub Actions）
- [ ] 推送 `v*` tag 触发 `.github/workflows/release.yml`，工作流 `completed / success`
- [ ] Release 产物齐全：`gale-engine-${version}-x64-setup.exe` / `-arm64-setup.exe` + 各自 `.blockmap` + `latest.yml`（macOS 为 `.dmg`，Linux 为 `.AppImage` / `.deb`）
- [ ] `latest.yml` 内文件名与实际产物名一致（ASCII，避免净化名导致自动更新 404）
- [ ] **Release 说明非空**：body 含本版本功能条目 + 下载表（由 `scripts/extract-changelog.py` 从 CHANGELOG 对应章节生成）
  - ⚠️ 历史坑：曾用 `generate_release_notes`，无 PR 时只产出一行 `Full Changelog` 链接 → body 近乎空，而 `electron-updater` 把 body 当更新弹窗内容，导致用户点「检查更新」看不到任何说明
  - 快速校验：`gh release view <tag> --json body --jq '.body' | wc -c` 应明显大于 200 字符
- [ ] **Latest 归属正确**：`gh release list` 中最新版本为 `Latest`（补发/重建旧版本后易被旧版本抢走，修正：`gh release edit <tag> --latest`）
- [ ] 应用内「设置 → 检查更新」能读到该 Release 版本
- [ ] 仓库 Actions 权限已启用（Settings → Actions → Allow all actions）

### 本地备用通道（CI 不可用时）
- [ ] `pwsh scripts/publish-release.ps1 -DryRun` 预演通过，且不产生任何远端写操作
- [ ] 预演输出的「待上传资产」中**必须包含 `latest.yml`**；缺失即自动更新链路失效
- [ ] 正式发布后，Release 中 exe + `.blockmap` + `latest.yml` **三件齐全**（只传 exe 会让自动更新静默失效）
- [ ] 历史版本补发走 `.github/workflows/release-backfill.yml`（基于 master 构建，说明中须含「代码来源声明」）

## 六、发布与托管（EdgeOne Makers）

- [ ] 落地页（静态站点）含：版本徽章、`下载安装包` CTA、功能亮点、更新日志
- [ ] 落地页 CTA 与获取方式指向真实 GitHub Releases 地址
- [ ] 落地页经 EdgeOne Makers 部署得到公开 URL
- [ ] 安装包制品随发版归档（Release / 对象存储），下载链接与落地页 CTA 对齐
- [ ] 更新日志（CHANGELOG）补充本次发版条目，包含已知限制

## 七、回滚与异常

- [ ] 安装包提供卸载入口，卸载后无残留服务/计划任务
- [ ] 若某模块在实机异常，优先回退该模块 IPC 注册，不阻断主窗口启动
- [ ] 发布后保留上一版本 tag，便于对照基线

---
> 已知限制：进程 CPU% 为双采样估算值；挂起/结束系统关键进程被保护拒绝；调整高优先级可能因权限失败（需管理员）。
> 防火墙配置修改与服务停止需管理员权限，普通权限下返回明确错误信息；防火墙规则仅展示前 200 条。
