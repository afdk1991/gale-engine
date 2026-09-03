# 疾风引擎 M3 计划

> 目标：在 M2 五大模块基础上，新增**进程管理**与**网络诊断**两大模块，并补齐浏览器缓存清理，形成更完整的深度优化工具链。
> 约束：延续 M2 架构范式（可注入 ExecRunner / 纯逻辑可单测），真实 Windows 命令用 PowerShell 直测验证。

## 架构约定（沿用 M2）
- 类型契约：`shared/types.ts` 的 `GaleApi`（前端 `window.gale`）
- 服务层：`electron/services/<module>.ts`，导出 `create<Module>Service(...)`；纯逻辑 + 可注入依赖
- IPC：`electron/main.ts` 用 `ipcMain.handle('<module>:<action>', ...)` 注册
- 桥接：`electron/preload.ts` 把方法挂到 `window.gale.<module>`
- 页面：`src/pages/<Module>.vue` 通过 `window.gale` 取数，渲染并接入主题 token

## M3a：进程管理（Process）

> M2 风险中明确"进程挂起类激进优化暂未纳入"，M3 补齐，但保证**安全可逆**：结束进程前校验非系统关键进程，挂起/恢复提供幂等操作。

- `process.list(sort?: 'cpu' | 'mem' | 'name'): Promise<ProcessInfo[]>`
  - 字段：pid、name、cpuPercent、memMB、status（running/suspended）、userName（可选）
  - PowerShell 用 `Get-Process` + `Get-Counter` 或 `Win32_Process` 采集；CPU% 用两次采样差值（或简化单次采样标注估算）
- `process.kill(pid): Promise<ProcessActionResult>`
  - 校验：拒绝 `system` / `idle` / `svchost`（父进程为 services）等系统关键进程，仅允许结束当前用户进程
  - 命令：`Stop-Process -Id <pid> -Force -ErrorAction Stop`
- `process.suspend(pid): Promise<ProcessActionResult>` / `process.resume(pid)`
  - 用 `NtSuspendProcess`（PowerShell Add-Type 内联 C# P/Invoke）实现挂起/恢复
  - 幂等：已挂起进程再次 suspend 返回 ok 提示；恢复同理
- `process.priority(pid, level: 'low'|'belowNormal'|'normal'|'aboveNormal'|'high'): Promise<ProcessActionResult>`（可选，若实现成本低则纳入）

### 单测覆盖
- fake runner 注入：list 解析（含 CPU% 浮点/缺失字段容错）、kill 对系统进程白名单拒绝、suspend/resume 幂等与错误回执、priority 合法值校验

## M3b：网络诊断（Network）

- `network.ping(host, count?=4): Promise<PingResult>`
  - 字段：host、min/avg/max ms、loss（丢包率 0-100）、ok
  - PowerShell：`Test-Connection -ComputerName <host> -Count <n>` 或 `ping -n`
  - 默认 host 可传空 → 使用 `127.0.0.1` / `baidu.com`（由调用方决定）
- `network.trace(host, hops?=15): Promise<TraceHop[]>`（可选，若 `tracert` 解析成本可控则纳入）
  - 字段：hop、host、ip、avgMs
- `network.interfaces(): Promise<NetInterface[]>`（可选）：网卡列表（名称/IP/速率）

### 单测覆盖
- ping 输出解析（不同 PS 版本输出差异容错）、loss 计算、trace 行解析、异常 host 回执 error

## M3c：浏览器缓存清理（Optimizer 扩展）

- 现有 `OptimizerTargetKind` 已有 `'browser'`，但 M2 只实现 temp/recycle。补齐：
  - 扫描 Chrome / Edge 的 `%LOCALAPPDATA%\<Browser>\User Data\Default\Cache` 及 Code Cache
  - 同样走白名单安全路径校验（仅 `%LOCALAPPDATA%` 下的浏览器缓存目录）
- 单测：白名单校验对浏览器缓存路径放行、对非白名单路径拒绝

## 测试与验证
- service 纯逻辑全部 vitest 覆盖（注入 fake runner）
- `npm run typecheck` + `npm run test` 全绿
- 真实 PowerShell 命令在本机 PowerShell 直测验证（非 GUI）
- 新增/更新的进程操作、网络诊断在 Windows 实机按冒烟清单核验

## 里程碑切分
- M3a：Process 模块（list/kill/suspend/resume/priority）
- M3b：Network 模块（ping/trace/interfaces）
- M3c：浏览器缓存清理补齐
- M3d：页面 + 冒烟清单更新 + 发版 v0.3.0

## 风险
- 挂起系统关键进程可能影响稳定性：白名单 + 拒绝列表双保险，默认不展示系统进程的激进操作
- 不同 PowerShell 版本输出差异：解析层做容错，测试覆盖宽松与严格两种输出
- 进程 CPU% 需两次采样才有意义：首次返回标注估算值，页面提示
