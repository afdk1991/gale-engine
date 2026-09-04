# 疾风引擎 — HarmonyOS（鸿蒙）版技术可行性调研报告

> 调研时间：2026-09-05 ｜ 调研对象：华为鸿蒙操作系统（HarmonyOS）
> 结论先行：**Electron 技术栈无法运行于鸿蒙，鸿蒙版需用 ArkTS + ArkUI 从零重写，属独立项目**。

## 一、鸿蒙操作系统现状

| 形态 | 说明 | 与本软件相关性 |
|---|---|---|
| **HarmonyOS NEXT（纯血鸿蒙）** | 2024 年底起推向消费者的桌面/手机版本，彻底移除 AOSP 兼容层，仅支持鸿蒙原生应用 | **目标平台**（若做鸿蒙版） |
| **OpenHarmony** | 开源底座，面向 IoT/嵌入式/轻量设备 | 非桌面目标 |
| **早期 HarmonyOS（1-4）** | 基于 AOSP，兼容 Android 应用 | 非目标，属过渡形态 |

本软件是**桌面系统优化工具**，若做鸿蒙版，对标的是 **HarmonyOS NEXT 的 PC/桌面形态**（华为 2024-2025 推出的鸿蒙 PC）。

## 二、为什么 Electron 不可行

### 1. 运行时栈完全不兼容
Electron = Chromium（渲染）+ Node.js（主进程）+ V8（JS 引擎）。鸿蒙 NEXT 的应用运行时为 **ArkCompiler + ArkVM**，不提供 Chromium/Node.js/V8 二进制。

- 鸿蒙没有 Node.js 运行时，无法执行 `require('child_process')`、`execFile` 等本软件赖以调用系统命令的 API。
- 鸿蒙没有 Chromium 渲染层，BrowserWindow / electron-vite / Vue 渲染进程整套无法加载。
- 鸿蒙的安全模型是「应用沙箱 + Stage 模型」，系统命令调用受严格权限管控，无 bash/PowerShell 等通用 shell。

### 2. 系统能力访问方式不同
本软件的 12 个 service 通过 shell 调用系统命令（进程/服务/防火墙/计划任务等）。鸿蒙 NEXT：
- 进程管理：通过 `@ohos.app.ability.ApplicationManager` / `appManager` API，非 `kill`/`ps`。
- 网络诊断：通过 `@ohos.net.connection` / `@ohos.net.ping`（如有）模块，非 `Test-Connection`/`ping`。
- 防火墙/服务/计划任务：鸿蒙桌面版开放程度未知，多数系统级管控 API 不对第三方应用开放。
- 硬件监控：通过 `@ohos.batteryInfo` / `@ohos.thermal` 等模块，非 systeminformation。

→ 即使重写，**部分功能（防火墙、系统服务、计划任务）可能在鸿蒙上无对应开放 API 而无法实现**。

### 3. UI 框架不同
- 本软件 UI：Vue 3 + Vue Router + CSS（运行于 Chromium）。
- 鸿蒙原生 UI：**ArkUI**（声明式，ArkTS 语言，类 SWIFTUI 范式），与 Vue/CSS 模型差异大。
- 鸿蒙也支持跨平台框架（如 Flutter、React Native 鸿蒙适配），但均需重写 UI 层。

## 三、若要做鸿蒙版：技术路线

| 方案 | 工作量 | 优劣 |
|---|---|---|
| **A. ArkTS + ArkUI 原生重写**（推荐） | 极高（≈重写整个项目） | 性能/体验最佳，符合鸿蒙原生生态，但需 ArkTS 技能栈 |
| **B. Flutter 鸿蒙适配** | 高（UI 重写 + 系统层用鸿蒙 plugin） | 跨 Android/iOS/鸿蒙，但本软件无移动端需求，收益有限 |
| **C. 等待 Electron/Tauri 鸿蒙适配** | 未知（取决于社区/华为） | 当前无官方计划，时间不可控 |

### 推荐路线（方案 A）的工作量拆解
1. **环境**：DevEco Studio + HarmonyOS SDK，学习 ArkTS/ArkUI 范式。
2. **UI 层**：12 个页面用 ArkUI 重写（声明式组件、状态管理 @State/@Link）。
3. **系统层**：12 个 service 用鸿蒙系统能力 API 重写，逐个核实 API 开放性。
4. **受限功能**：防火墙/服务/计划任务若无开放 API，需降级为「只读展示」或砍除。
5. **打包**：用 DevEco Studio 产出 .hap，经华为应用市场分发。

预估：**2-3 人月**（含 ArkTS 学习曲线与 API 可用性调研），且功能可能缩减。

## 四、与主项目的关系定位

- 鸿蒙版与 Electron 版**共享的只有产品设计与功能定义**，代码零复用。
- 建议作为**独立仓库 / 独立项目**推进，命名如 `gale-engine-harmony`，避免与 Electron 主项目耦合。
- 主项目（Electron 版）继续聚焦 Windows/macOS/Linux 桌面生态；鸿蒙版单独跟进华为生态。

## 五、建议

1. **本期不做鸿蒙版代码**，仅保留本调研报告。
2. 待 HarmonyOS NEXT PC 生态成熟、系统 API 开放度明确后，再启动鸿蒙版立项。
3. 若确需推进，第一步是「API 可用性 PoC」：用 ArkTS 验证进程/网络/硬件监控 3 个核心能力在鸿蒙上的开放程度，确认可行后再全面投入。
4. 优先级：跨平台（Win/Mac/Linux + ARM64）> 鸿蒙版。鸿蒙桌面用户基数当前远小于三大桌面 OS。

---

> 附：本报告基于 2024-2025 年鸿蒙公开信息。HarmonyOS NEXT 仍快速演进，API 开放度可能变化，立项前需重新核实。
