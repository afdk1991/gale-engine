# M4 计划 — 系统深度管理（计划任务 / 服务管理 / 防火墙）

> 目标版本：v0.4.0。在 M3（进程管理 + 网络诊断）基础上，向系统层纵深扩展三个高价值模块。

## 范围

| 模块 | 服务文件 | IPC handlers | 核心能力 |
|---|---|---|---|
| 计划任务 Tasks | `electron/services/tasks.ts` | `tasks:list/setEnabled/run/stop` | 枚举计划任务 + 启停/立即运行/结束 |
| 服务管理 WinServices | `electron/services/winservices.ts` | `winServices:list/start/stop/setStartupType` | Win32_Service 查询 + 启停 + 启动类型切换 |
| 防火墙 Firewall | `electron/services/firewall.ts` | `firewall:profiles/listRules/setProfileEnabled/toggleRule` | 配置文件开关 + 规则启停 |

## 设计约束

1. **可注入范式**：三个模块均接收 `ExecRunner`，PowerShell 脚本生成与解析为纯函数，vitest 全覆盖。
2. **注入防护**：所有用户输入（任务路径/名称、服务名、规则名）过字符白名单（拒绝单引号、反引号、分号、管道、`$`、控制字符），非法输入直接拒绝且不调用执行器。
3. **系统保护**：
   - 服务停止：`PROTECTED_SERVICES` 名单（RpcSs/DcomLaunch/Winmgmt/Schedule/EventLog 等 10 项）+ `AcceptStop` 双保险。
   - 防火墙配置文件：仅允许 Domain/Private/Public 枚举值。
4. **错误回执**：PowerShell 端 try/catch → `ERR:<消息>` 前缀约定，前端逐项闪现反馈并写入优化记录。

## 前端

- 3 个新页面：`Services.vue`（表格 + 二次确认停止 + 启动类型下拉）、`Tasks.vue`（表格 + 筛选 + 运行/结束）、`Firewall.vue`（三卡片配置文件 + 规则表格）。
- 路由 12 条，侧边栏 12 项（新增 server/clock/shield 三个 SVG 图标）。
- 全部页面 640px 移动端断点（表格横向滚动）。

## 质量门禁

- [x] vitest ≥ 140 项全绿（实际 142：新增 42 项）
- [x] vue-tsc --noEmit 0 错误
- [x] electron-vite build 成功（3 个新页面 chunk 产出）
- [ ] Windows 实机 GUI 冒烟（需按 docs/smoke-test-checklist.md 人工核验）
