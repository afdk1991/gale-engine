# 疾风引擎 M1（应用骨架）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建疾风引擎（Windows 桌面优化加速软件）的 Electron + Vue 3 工程骨架：侧边栏导航、7 个页面路由、完整主题系统（3 外观模式 × 6 主题色，持久化），并产出第一个可安装的 NSIS 安装包 v0.1。

**Architecture:** 主进程（`electron/`）负责窗口、IPC 与设置持久化（electron-store 打包进主进程 bundle）；渲染进程（`src/`）为 Vue 3 SPA（hash 路由），通过 contextBridge 暴露的类型化 `window.gale` API 通信；共享契约类型放 `shared/`。主题由 CSS 变量驱动：外观模式写 `data-theme`，主题色由 JS 注入 `--accent*` 内联变量。

**Tech Stack:** Electron 33 · electron-vite 3 · Vue 3.5 · vue-router 4 · electron-store 8 · vitest 3 + @vue/test-utils · electron-builder 25（NSIS）

**执行环境：** Windows / PowerShell，仓库根目录 `d:\网站全栈项目\项目002`（即工程根，不建子目录）。要求 Node ≥ 20（`node -v` 验证）。

**范围说明：** 本计划只覆盖设计文档（`docs/superpowers/specs/2026-08-29-gale-engine-design.md`）的里程碑 M1。M2–M6 各自在启动时编写独立计划。页面在 M1 均为带标题的占位页（设置页的主题定制区块完整实现）。

---

## 文件结构总览

```
项目002/
├─ package.json                  # 任务1
├─ electron.vite.config.ts       # 任务2
├─ tsconfig.json                 # 任务2
├─ vitest.config.ts              # 任务2
├─ shared/
│  └─ types.ts                   # 任务3（IPC 契约类型）
├─ electron/
│  ├─ main.ts                    # 任务4（窗口 + IPC 注册）
│  ├─ preload.ts                 # 任务4（contextBridge 桥）
│  └─ services/
│     ├─ settings.ts             # 任务3（设置服务，存储适配器注入）
│     └─ settings.test.ts        # 任务3
├─ src/                          # 渲染进程根（electron-vite renderer root）
│  ├─ index.html                 # 任务5
│  ├─ main.ts                    # 任务5（入口，先 init 主题再挂载）
│  ├─ env.d.ts                   # 任务2（window.gale 声明）
│  ├─ shims-vue.d.ts             # 任务2（.vue 模块声明，须为无顶层 import/export 的全局脚本文件）
│  ├─ App.vue                    # 任务5 临时版 → 任务8 正式版（含侧边栏）
│  ├─ router/index.ts            # 任务5
│  ├─ assets/base.css            # 任务5（reset + 页面通用样式）
│  ├─ pages/                     # 任务5（7 个占位页）
│  │  ├─ Home.vue  Monitor.vue  Optimizer.vue  GameMode.vue
│  │  └─ Toolbox.vue  History.vue  Settings.vue
│  ├─ components/
│  │  └─ AppSidebar.vue          # 任务8（+ 测试）
│  ├─ theme/
│  │  ├─ tokens.ts               # 任务6（6 主题色令牌 + 纯函数）
│  │  ├─ tokens.test.ts          # 任务6
│  │  ├─ theme.css               # 任务6（浅/深色表面变量）
│  │  ├─ useTheme.ts             # 任务7（可注入的主题控制器工厂）
│  │  ├─ useTheme.test.ts        # 任务7
│  │  └─ themeController.ts      # 任务7（绑定 window.gale 的单例）
├─ electron-builder.yml          # 任务10
└─ release/                      # 任务10 产物（gitignore）
```

---

### Task 1: 工程初始化与依赖安装

**Files:**
- Create: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: 确认 Node 版本**

Run: `node -v`
Expected: `v20.x.x` 或更高。若低于 v20，先升级 Node 再继续。

- [ ] **Step 2: 写入 package.json**

```json
{
  "name": "gale-engine",
  "version": "0.1.0",
  "description": "疾风引擎 - Windows 桌面优化加速软件",
  "main": "out/main/index.js",
  "author": "GaleEngine",
  "private": true,
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "package": "electron-vite build && electron-builder --win",
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "electron-store": "^8.2.0",
    "vue": "^3.5.13",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@vitejs/plugin-vue": "^5.2.1",
    "@vue/test-utils": "^2.4.6",
    "electron": "^33.2.1",
    "electron-builder": "^25.1.8",
    "electron-vite": "^3.1.0",
    "jsdom": "^26.0.0",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0",
    "vue-tsc": "^2.1.10"
  }
}
```

注意：`electron-store` 锁定 v8（CJS，可被 rollup 打进主进程 bundle；v10 是 ESM-only，会破坏打包）。

- [ ] **Step 3: 更新 .gitignore（追加 out/）**

`.gitignore` 完整内容：

```
node_modules/
dist/
out/
release/
.superpowers/
*.log
```

- [ ] **Step 4: 安装依赖**

Run: `npm install`
Expected: 退出码 0。Electron 二进制下载可能耗时数分钟，出现 `npm warn deprecated` 类警告属正常。若网络失败，重试或设置镜像 `npm config set ELECTRON_MIRROR https://npmmirror.com/mirrors/electron/` 后重装。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: 初始化疾风引擎工程与依赖"
```

---

### Task 2: 构建 / 类型 / 测试配置

**Files:**
- Create: `electron.vite.config.ts`、`tsconfig.json`、`vitest.config.ts`、`src/env.d.ts`、`src/shims-vue.d.ts`

- [ ] **Step 1: 写入 electron.vite.config.ts**

```ts
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main.ts') }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') }
      }
    }
  },
  renderer: {
    root: 'src',
    plugins: [vue()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') }
      }
    }
  }
})
```

说明：不使用 `externalizeDepsPlugin`，让 electron-store 等依赖全部打进 `out/main/index.js`，打包时无需携带 node_modules（体积优化第一步）。

- [ ] **Step 2: 写入 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"],
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": [
    "electron/**/*.ts",
    "src/**/*.ts",
    "src/**/*.vue",
    "shared/**/*.ts",
    "electron.vite.config.ts",
    "vitest.config.ts"
  ]
}
```

- [ ] **Step 3: 写入 vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    environment: 'jsdom',
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts']
  }
})
```

统一用 jsdom 环境：主进程服务测试全部走纯函数 + 依赖注入，不触碰 Electron API，jsdom 下可跑。

- [ ] **Step 4: 写入 src/env.d.ts 与 src/shims-vue.d.ts**

`src/env.d.ts`（含顶层 `import type`，属模块文件——模块文件内的 `declare module` 会被按模块增强处理，通配符声明不生效，故 `*.vue` 声明必须拆到独立的全局脚本文件）：

```ts
/// <reference types="vite/client" />
import type { GaleApi } from '../shared/types'

declare global {
  interface Window {
    gale: GaleApi
  }
}

export {}
```

`src/shims-vue.d.ts`（**不得有任何顶层 import/export**，必须是全局脚本文件才能让 `*.vue` 通配符声明生效；`declare module` 块内部的 import/export 不影响全局脚本属性）：

```ts
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
```

- [ ] **Step 5: 验证配置可加载**

Run: `npx electron-vite build 2>&1 | Select-Object -First 5`
Expected: 报找不到入口 `electron/main.ts`（Task 4 才创建）——只要不是配置语法错误即可。若报配置文件解析错误，检查本任务文件内容。

- [ ] **Step 6: Commit**

```bash
git add electron.vite.config.ts tsconfig.json vitest.config.ts src/env.d.ts src/shims-vue.d.ts
git commit -m "chore: electron-vite / tsconfig / vitest 配置"
```

---

### Task 3: 共享契约类型 + 设置服务（TDD）

**Files:**
- Create: `shared/types.ts`、`electron/services/settings.ts`、`electron/services/settings.test.ts`

- [ ] **Step 1: 写入共享类型 shared/types.ts**

```ts
export type AppearanceMode = 'system' | 'light' | 'dark'

export type AccentKey = 'blue' | 'cyan' | 'violet' | 'green' | 'orange' | 'gradient'

export interface ThemeSettings {
  appearance: AppearanceMode
  accent: AccentKey
}

export interface GaleApi {
  settings: {
    get(): Promise<ThemeSettings>
    set(patch: Partial<ThemeSettings>): Promise<ThemeSettings>
  }
}
```

- [ ] **Step 2: 写失败测试 electron/services/settings.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { createSettingsService, normalizeSettings, DEFAULT_SETTINGS } from './settings'
import type { StorageAdapter } from './settings'

function memoryStorage(initial: Record<string, unknown> = {}): StorageAdapter & { data: Record<string, unknown> } {
  const data = { ...initial }
  return {
    data,
    get<T>(key: string, fallback: T): T {
      return (key in data ? data[key] : fallback) as T
    },
    set(key: string, value: unknown): void {
      data[key] = value
    }
  }
}

describe('normalizeSettings', () => {
  it('非法字段回退默认值，合法字段保留', () => {
    expect(normalizeSettings({ appearance: 'dark', accent: 'nope' })).toEqual({
      appearance: 'dark',
      accent: 'blue'
    })
  })

  it('非对象输入整体回退默认值', () => {
    expect(normalizeSettings('junk')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('createSettingsService', () => {
  it('读取已持久化的设置', () => {
    const storage = memoryStorage({ theme: { appearance: 'dark', accent: 'green' } })
    const service = createSettingsService(storage)
    expect(service.get()).toEqual({ appearance: 'dark', accent: 'green' })
  })

  it('空存储返回默认设置', () => {
    expect(createSettingsService(memoryStorage()).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('set 合并补丁、归一化并写回存储', () => {
    const storage = memoryStorage()
    const service = createSettingsService(storage)
    const result = service.set({ accent: 'orange' })
    expect(result).toEqual({ appearance: 'system', accent: 'orange' })
    expect(storage.data.theme).toEqual({ appearance: 'system', accent: 'orange' })
    expect(service.get().accent).toBe('orange')
  })

  it('set 中的非法值被归一化丢弃', () => {
    const storage = memoryStorage()
    const service = createSettingsService(storage)
    const result = service.set({ appearance: 'neon' } as never)
    expect(result.appearance).toBe('system')
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run electron/services/settings.test.ts`
Expected: FAIL，报无法解析 `./settings`（模块不存在）。

- [ ] **Step 4: 实现 electron/services/settings.ts**

```ts
import type { AccentKey, AppearanceMode, ThemeSettings } from '../../shared/types'

export const DEFAULT_SETTINGS: ThemeSettings = { appearance: 'system', accent: 'blue' }

const APPEARANCES: AppearanceMode[] = ['system', 'light', 'dark']
const ACCENTS: AccentKey[] = ['blue', 'cyan', 'violet', 'green', 'orange', 'gradient']

/** 存储适配器：生产环境用 electron-store，测试注入内存实现 */
export interface StorageAdapter {
  get<T>(key: string, fallback: T): T
  set(key: string, value: unknown): void
}

/** 任意输入（含损坏数据）归一化为合法 ThemeSettings */
export function normalizeSettings(raw: unknown): ThemeSettings {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const appearance = APPEARANCES.includes(obj.appearance as AppearanceMode)
    ? (obj.appearance as AppearanceMode)
    : DEFAULT_SETTINGS.appearance
  const accent = ACCENTS.includes(obj.accent as AccentKey)
    ? (obj.accent as AccentKey)
    : DEFAULT_SETTINGS.accent
  return { appearance, accent }
}

export function createSettingsService(storage: StorageAdapter) {
  return {
    get(): ThemeSettings {
      return normalizeSettings(storage.get('theme', DEFAULT_SETTINGS))
    },
    set(patch: Partial<ThemeSettings>): ThemeSettings {
      const next = normalizeSettings({ ...this.get(), ...patch })
      storage.set('theme', next)
      return next
    }
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run electron/services/settings.test.ts`
Expected: PASS，6 个测试全部通过。

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts electron/services/settings.ts electron/services/settings.test.ts
git commit -m "feat: 主题设置服务与共享 IPC 契约类型"
```

---

### Task 4: 主进程窗口 + preload 桥

**Files:**
- Create: `electron/main.ts`、`electron/preload.ts`

- [ ] **Step 1: 写入 electron/main.ts**

```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import Store from 'electron-store'
import { createSettingsService, type StorageAdapter } from './services/settings'

const store = new Store()
const settingsService = createSettingsService(store as unknown as StorageAdapter)

function registerIpc(): void {
  ipcMain.handle('settings:get', () => settingsService.get())
  ipcMain.handle('settings:set', (_event, patch) => settingsService.set(patch ?? {}))
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    title: '疾风引擎',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 2: 写入 electron/preload.ts**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { GaleApi } from '../shared/types'

const api: GaleApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  }
}

contextBridge.exposeInMainWorld('gale', api)
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 退出码 0，无类型错误。

- [ ] **Step 4: dev 冒烟（渲染进程尚未创建）**

Run: `npm run dev`
Expected: Electron 窗口打开并显示**空白页**（渲染入口 `src/index.html` 下一任务才创建），控制台无崩溃栈。确认后 Ctrl+C 退出。

- [ ] **Step 5: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat: 主进程窗口与 settings IPC、preload 桥"
```

---

### Task 5: 渲染进程骨架、路由与 7 个占位页

**Files:**
- Create: `src/index.html`、`src/main.ts`、`src/App.vue`、`src/router/index.ts`、`src/assets/base.css`、`src/pages/Home.vue`、`src/pages/Monitor.vue`、`src/pages/Optimizer.vue`、`src/pages/GameMode.vue`、`src/pages/Toolbox.vue`、`src/pages/History.vue`、`src/pages/Settings.vue`

- [ ] **Step 1: 写入 src/index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>疾风引擎</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

（M1 不加 CSP meta，避免阻断 dev HMR；列入 M6 加固项。）

- [ ] **Step 2: 写入 src/assets/base.css**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

html, body, #app { height: 100%; }

body {
  font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
  font-size: 14px;
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
}

#app { display: flex; }

.page { flex: 1; padding: 24px 28px; overflow-y: auto; }
.page-header { margin-bottom: 20px; }
.page-header h1 { font-size: 20px; font-weight: 600; margin-bottom: 6px; }
.page-header p { font-size: 13px; color: var(--text-secondary); }
```

- [ ] **Step 3: 写入 src/router/index.ts（hash 路由，file:// 加载必需）**

```ts
import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../pages/Home.vue'), meta: { title: '首页' } },
    { path: '/monitor', name: 'monitor', component: () => import('../pages/Monitor.vue'), meta: { title: '硬件监控' } },
    { path: '/optimizer', name: 'optimizer', component: () => import('../pages/Optimizer.vue'), meta: { title: '优化中心' } },
    { path: '/game', name: 'game', component: () => import('../pages/GameMode.vue'), meta: { title: '游戏模式' } },
    { path: '/toolbox', name: 'toolbox', component: () => import('../pages/Toolbox.vue'), meta: { title: '工具箱' } },
    { path: '/history', name: 'history', component: () => import('../pages/History.vue'), meta: { title: '优化记录' } },
    { path: '/settings', name: 'settings', component: () => import('../pages/Settings.vue'), meta: { title: '设置' } }
  ]
})
```

- [ ] **Step 4: 写入 7 个占位页**

`src/pages/Home.vue`：

```vue
<template>
  <section class="page">
    <header class="page-header">
      <h1>首页</h1>
      <p>健康评分与一键加速将在 M2 里程碑实现。</p>
    </header>
  </section>
</template>
```

`src/pages/Monitor.vue`：

```vue
<template>
  <section class="page">
    <header class="page-header">
      <h1>硬件监控</h1>
      <p>CPU / 内存 / 磁盘 / 温度实时仪表盘将在 M2 里程碑实现。</p>
    </header>
  </section>
</template>
```

`src/pages/Optimizer.vue`：

```vue
<template>
  <section class="page">
    <header class="page-header">
      <h1>优化中心</h1>
      <p>垃圾清理、内存加速、启动项管理将在 M3 里程碑实现。</p>
    </header>
  </section>
</template>
```

`src/pages/GameMode.vue`：

```vue
<template>
  <section class="page">
    <header class="page-header">
      <h1>游戏模式</h1>
      <p>游戏模式组合优化将在 M4 里程碑实现。</p>
    </header>
  </section>
</template>
```

`src/pages/Toolbox.vue`：

```vue
<template>
  <section class="page">
    <header class="page-header">
      <h1>工具箱</h1>
      <p>8 个实用工具将在 M5 里程碑实现。</p>
    </header>
  </section>
</template>
```

`src/pages/History.vue`：

```vue
<template>
  <section class="page">
    <header class="page-header">
      <h1>优化记录</h1>
      <p>历史清理量与评分变化曲线将在 M4 里程碑实现。</p>
    </header>
  </section>
</template>
```

`src/pages/Settings.vue`（M1 先渲染标题，主题 UI 在 Task 9 完成）：

```vue
<template>
  <section class="page">
    <header class="page-header">
      <h1>设置</h1>
      <p>主题定制与偏好配置。</p>
    </header>
  </section>
</template>
```

- [ ] **Step 5: 写入临时版 src/App.vue（正式侧边栏布局在 Task 8）**

```vue
<template>
  <main class="content">
    <RouterView />
  </main>
</template>

<style scoped>
.content { flex: 1; min-width: 0; display: flex; flex-direction: column; }
</style>
```

- [ ] **Step 6: 写入 src/main.ts（入口；theme.css 与主题 init 分别在 Task 6/7 接入）**

```ts
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './assets/base.css'

void createApp(App).use(router).mount('#app')
```

（本任务不导入 `./theme/theme.css`——该文件 Task 6 才创建，保持每个任务独立可运行。）

- [ ] **Step 7: dev 验证路由**

Run: `npm run dev`
Expected: 窗口显示"首页"占位页。在应用窗口按 Ctrl+Shift+I 打开 DevTools，在控制台执行 `location.hash = '#/monitor'`，再依次切到 `#/optimizer`、`#/game`、`#/toolbox`、`#/history`、`#/settings`，每个 hash 页面标题正确切换。Ctrl+C 退出。

- [ ] **Step 8: 类型检查 + Commit**

Run: `npm run typecheck`
Expected: 退出码 0。

```bash
git add src/
git commit -m "feat: 渲染进程骨架、hash 路由与 7 个占位页"
```

---

### Task 6: 主题令牌与浅/深色表面变量（TDD）

**Files:**
- Create: `src/theme/tokens.ts`、`src/theme/tokens.test.ts`、`src/theme/theme.css`
- Modify: `src/main.ts`（导入 theme.css）

- [ ] **Step 1: 写失败测试 src/theme/tokens.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { ACCENTS, ACCENT_ORDER, resolveTheme, isAccentKey, applyAccentToDocument } from './tokens'

describe('resolveTheme', () => {
  it('system 模式跟随系统偏好', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('显式模式直接返回', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
})

describe('ACCENTS', () => {
  it('包含 6 个完整主题色', () => {
    expect(ACCENT_ORDER).toHaveLength(6)
    for (const key of ACCENT_ORDER) {
      expect(ACCENTS[key].label).toBeTruthy()
      expect(ACCENTS[key].color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(ACCENTS[key].bg).toBeTruthy()
    }
  })
})

describe('isAccentKey', () => {
  it('识别合法与非法主题色键', () => {
    expect(isAccentKey('blue')).toBe(true)
    expect(isAccentKey('gradient')).toBe(true)
    expect(isAccentKey('neon')).toBe(false)
    expect(isAccentKey(42)).toBe(false)
  })
})

describe('applyAccentToDocument', () => {
  it('将主题色写入文档根 CSS 变量', () => {
    applyAccentToDocument('green')
    const root = document.documentElement
    expect(root.style.getPropertyValue('--accent')).toBe('#10b981')
    expect(root.style.getPropertyValue('--accent-soft')).toBe('rgba(16,185,129,0.12)')
  })

  it('渐变主题同时写入渐变背景变量', () => {
    applyAccentToDocument('gradient')
    expect(document.documentElement.style.getPropertyValue('--accent-bg')).toBe(
      'linear-gradient(135deg, #2563eb, #7c3aed)'
    )
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/theme/tokens.test.ts`
Expected: FAIL，无法解析 `./tokens`。

- [ ] **Step 3: 实现 src/theme/tokens.ts**

```ts
import type { AccentKey, AppearanceMode } from '../../shared/types'

export interface AccentToken {
  key: AccentKey
  label: string
  /** 主色（渐变主题取起点色，用于文字、描边等纯色场景） */
  color: string
  /** 强调元素背景（纯色或渐变，用于按钮、品牌标等） */
  bg: string
  hover: string
  /** 柔和底色（选中态、悬浮态背景） */
  soft: string
}

export const ACCENTS: Record<AccentKey, AccentToken> = {
  blue: { key: 'blue', label: '科技蓝', color: '#3b82f6', bg: '#3b82f6', hover: '#2563eb', soft: 'rgba(59,130,246,0.12)' },
  cyan: { key: 'cyan', label: '极客青', color: '#06b6d4', bg: '#06b6d4', hover: '#0891b2', soft: 'rgba(6,182,212,0.12)' },
  violet: { key: 'violet', label: '活力紫', color: '#8b5cf6', bg: '#8b5cf6', hover: '#7c3aed', soft: 'rgba(139,92,246,0.12)' },
  green: { key: 'green', label: '健康绿', color: '#10b981', bg: '#10b981', hover: '#059669', soft: 'rgba(16,185,129,0.12)' },
  orange: { key: 'orange', label: '能量橙', color: '#f97316', bg: '#f97316', hover: '#ea580c', soft: 'rgba(249,115,22,0.12)' },
  gradient: { key: 'gradient', label: '渐变蓝紫', color: '#2563eb', bg: 'linear-gradient(135deg, #2563eb, #7c3aed)', hover: '#4f46e5', soft: 'rgba(99,102,241,0.12)' }
}

export const ACCENT_ORDER: AccentKey[] = ['blue', 'cyan', 'violet', 'green', 'orange', 'gradient']

export function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === 'string' && value in ACCENTS
}

/** system 模式依据系统偏好解析为 light / dark */
export function resolveTheme(mode: AppearanceMode, prefersDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode
}

/** 将主题色 CSS 变量注入文档根（内联样式优先级高于 theme.css 的默认值） */
export function applyAccentToDocument(accent: AccentKey, doc: Document = document): void {
  const token = ACCENTS[accent]
  const root = doc.documentElement
  root.style.setProperty('--accent', token.color)
  root.style.setProperty('--accent-bg', token.bg)
  root.style.setProperty('--accent-hover', token.hover)
  root.style.setProperty('--accent-soft', token.soft)
}
```

- [ ] **Step 4: 写入 src/theme/theme.css（表面变量；默认值即科技蓝，JS 注入可覆盖）**

```css
:root,
:root[data-theme='light'] {
  --bg-primary: #f7f8fa;
  --bg-secondary: #ffffff;
  --bg-tertiary: #f0f2f6;
  --border: #e2e5ea;
  --text-primary: #1f2329;
  --text-secondary: #6b7280;
  --text-tertiary: #9ca3af;
  --accent: #3b82f6;
  --accent-bg: #3b82f6;
  --accent-hover: #2563eb;
  --accent-soft: rgba(59, 130, 246, 0.12);
  --shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

:root[data-theme='dark'] {
  --bg-primary: #16181f;
  --bg-secondary: #1d2029;
  --bg-tertiary: #12141a;
  --border: #2a2e3a;
  --text-primary: #e5e7eb;
  --text-secondary: #8b90a0;
  --text-tertiary: #6b7280;
  --shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}
```

- [ ] **Step 5: src/main.ts 加回 theme.css 导入**

`src/main.ts` 完整内容：

```ts
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './assets/base.css'
import './theme/theme.css'

void createApp(App).use(router).mount('#app')
```

- [ ] **Step 6: 运行测试确认通过 + Commit**

Run: `npx vitest run src/theme/tokens.test.ts`
Expected: PASS，6 个测试全部通过。

```bash
git add src/theme/ src/main.ts
git commit -m "feat: 主题令牌（6 色）与浅/深色表面变量"
```

---

### Task 7: 主题控制器（TDD，可注入依赖）

**Files:**
- Create: `src/theme/useTheme.ts`、`src/theme/useTheme.test.ts`、`src/theme/themeController.ts`
- Modify: `src/main.ts`（挂载前 init 主题）

- [ ] **Step 1: 写失败测试 src/theme/useTheme.test.ts**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createThemeController } from './useTheme'
import type { ThemeSettings } from '../../../shared/types'

const defaults: ThemeSettings = { appearance: 'system', accent: 'blue' }

function fakeMedia(matches: boolean) {
  const listeners: Array<() => void> = []
  return {
    matches,
    addEventListener(_type: string, cb: () => void) { listeners.push(cb) },
    removeEventListener(_type: string, cb: () => void) {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    },
    trigger() { listeners.forEach((cb) => cb()) }
  }
}

function fakeDoc() {
  const style = new Map<string, string>()
  const dataset: Record<string, string> = {}
  return {
    documentElement: {
      dataset,
      style: {
        setProperty: (k: string, v: string) => void style.set(k, v),
        getPropertyValue: (k: string) => style.get(k) ?? ''
      }
    }
  }
}

describe('createThemeController', () => {
  it('init 应用持久化的外观与主题色', async () => {
    const media = fakeMedia(true)
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => ({ appearance: 'dark', accent: 'green' }),
      saveSettings: async (p) => ({ ...defaults, ...p }),
      media,
      doc
    })
    await controller.init()
    expect(doc.documentElement.dataset.theme).toBe('dark')
    expect(doc.documentElement.style.getPropertyValue('--accent')).toBe('#10b981')
  })

  it('loadSettings 失败时回退默认主题', async () => {
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => { throw new Error('ipc down') },
      saveSettings: async (p) => ({ ...defaults, ...p }),
      media: fakeMedia(false),
      doc
    })
    await controller.init()
    expect(doc.documentElement.dataset.theme).toBe('light')
    expect(controller.accent.value).toBe('blue')
  })

  it('setAccent 更新 DOM 并持久化补丁', async () => {
    const save = vi.fn(async (p: Partial<ThemeSettings>) => ({ ...defaults, ...p }))
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => defaults,
      saveSettings: save,
      media: fakeMedia(false),
      doc
    })
    await controller.init()
    await controller.setAccent('orange')
    expect(save).toHaveBeenCalledWith({ accent: 'orange' })
    expect(doc.documentElement.style.getPropertyValue('--accent')).toBe('#f97316')
  })

  it('setAppearance 持久化且立即生效', async () => {
    const save = vi.fn(async (p: Partial<ThemeSettings>) => ({ ...defaults, ...p }))
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => defaults,
      saveSettings: save,
      media: fakeMedia(true),
      doc
    })
    await controller.init()
    await controller.setAppearance('light')
    expect(doc.documentElement.dataset.theme).toBe('light')
    expect(save).toHaveBeenCalledWith({ appearance: 'light' })
  })

  it('system 模式响应系统主题变化', async () => {
    const media = fakeMedia(false)
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => defaults,
      saveSettings: async (p) => ({ ...defaults, ...p }),
      media,
      doc
    })
    await controller.init()
    expect(doc.documentElement.dataset.theme).toBe('light')
    media.matches = true
    media.trigger()
    expect(doc.documentElement.dataset.theme).toBe('dark')
  })

  it('dispose 移除系统主题监听', async () => {
    const media = fakeMedia(false)
    const doc = fakeDoc()
    const controller = createThemeController({
      loadSettings: async () => defaults,
      saveSettings: async (p) => ({ ...defaults, ...p }),
      media,
      doc
    })
    await controller.init()
    controller.dispose()
    media.matches = true
    media.trigger()
    expect(doc.documentElement.dataset.theme).toBe('light')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/theme/useTheme.test.ts`
Expected: FAIL，无法解析 `./useTheme`。

- [ ] **Step 3: 实现 src/theme/useTheme.ts**

```ts
import { ref } from 'vue'
import type { AccentKey, AppearanceMode, ThemeSettings } from '../../shared/types'
import { applyAccentToDocument, resolveTheme } from './tokens'

/** 可注入的 matchMedia 形状（便于测试） */
interface SystemMediaLike {
  matches: boolean
  addEventListener(type: string, cb: () => void): void
  removeEventListener(type: string, cb: () => void): void
}

export interface ThemeController {
  appearance: { value: AppearanceMode }
  accent: { value: AccentKey }
  resolved: { value: 'light' | 'dark' }
  init(): Promise<void>
  setAppearance(mode: AppearanceMode): Promise<void>
  setAccent(key: AccentKey): Promise<void>
  dispose(): void
}

export function createThemeController(opts: {
  loadSettings: () => Promise<ThemeSettings>
  saveSettings: (patch: Partial<ThemeSettings>) => Promise<ThemeSettings>
  media?: SystemMediaLike
  doc?: Document
}): ThemeController {
  const doc = opts.doc ?? document
  const media: SystemMediaLike =
    opts.media ?? window.matchMedia('(prefers-color-scheme: dark)')

  const appearance = ref<AppearanceMode>('system')
  const accent = ref<AccentKey>('blue')
  const resolved = ref<'light' | 'dark'>('light')
  let onMediaChange = (): void => {}

  function applyResolved(): void {
    resolved.value = resolveTheme(appearance.value, media.matches)
    doc.documentElement.dataset.theme = resolved.value
    applyAccentToDocument(accent.value, doc)
  }

  async function init(): Promise<void> {
    const settings = await opts.loadSettings().catch(() => ({
      appearance: 'system' as AppearanceMode,
      accent: 'blue' as AccentKey
    }))
    appearance.value = settings.appearance
    accent.value = settings.accent
    applyResolved()
    onMediaChange = () => {
      if (appearance.value === 'system') applyResolved()
    }
    media.addEventListener('change', onMediaChange)
  }

  async function setAppearance(mode: AppearanceMode): Promise<void> {
    appearance.value = mode
    applyResolved()
    await opts.saveSettings({ appearance: mode })
  }

  async function setAccent(key: AccentKey): Promise<void> {
    accent.value = key
    applyResolved()
    await opts.saveSettings({ accent: key })
  }

  function dispose(): void {
    media.removeEventListener('change', onMediaChange)
  }

  return { appearance, accent, resolved, init, setAppearance, setAccent, dispose }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/theme/useTheme.test.ts`
Expected: PASS，6 个测试全部通过。

- [ ] **Step 5: 写入 src/theme/themeController.ts（绑定 window.gale 的应用级单例）**

```ts
import { createThemeController } from './useTheme'

export const themeController = createThemeController({
  loadSettings: () => window.gale.settings.get(),
  saveSettings: (patch) => window.gale.settings.set(patch)
})
```

- [ ] **Step 6: src/main.ts 挂载前初始化主题（避免首帧闪烁）**

`src/main.ts` 完整内容：

```ts
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { themeController } from './theme/themeController'
import './assets/base.css'
import './theme/theme.css'

await themeController.init()

void createApp(App).use(router).mount('#app')
```

（入口使用顶层 await：electron-vite 渲染目标为现代 Chrome，原生支持。）

- [ ] **Step 7: dev 验证 + Commit**

Run: `npm run dev`
Expected: 窗口正常打开（主题默认浅色/科技蓝），无白屏。Ctrl+C 退出。

Run: `npx vitest run`
Expected: 全部测试 PASS（settings + tokens + useTheme）。

```bash
git add src/theme/ src/main.ts
git commit -m "feat: 主题控制器（跟随系统/浅/深 × 6 色，持久化）"
```

---

### Task 8: 侧边栏导航与整体布局（含组件测试）

**Files:**
- Create: `src/components/AppSidebar.vue`、`src/components/AppSidebar.test.ts`
- Modify: `src/App.vue`（接入侧边栏正式布局）

- [ ] **Step 1: 写失败测试 src/components/AppSidebar.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createWebHashHistory, type Router } from 'vue-router'
import AppSidebar from './AppSidebar.vue'

function mountSidebar(): ReturnType<typeof mount> {
  const router: Router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/monitor', component: { render: () => null } },
      { path: '/optimizer', component: { render: () => null } },
      { path: '/game', component: { render: () => null } },
      { path: '/toolbox', component: { render: () => null } },
      { path: '/history', component: { render: () => null } },
      { path: '/settings', component: { render: () => null } }
    ]
  })
  return mount(AppSidebar, { global: { plugins: [router] } })
}

describe('AppSidebar', () => {
  it('渲染品牌名与 7 个导航项', () => {
    const wrapper = mountSidebar()
    expect(wrapper.find('.brand-name').text()).toBe('疾风引擎')
    const items = wrapper.findAll('.nav-item')
    expect(items).toHaveLength(7)
    expect(items.map((item) => item.text())).toEqual([
      '首页', '硬件监控', '优化中心', '游戏模式', '工具箱', '优化记录', '设置'
    ])
  })

  it('导航项链接指向正确路由', () => {
    const wrapper = mountSidebar()
    const hrefs = wrapper.findAll('.nav-item').map((item) => item.attributes('href'))
    expect(hrefs).toEqual(['#/', '#/monitor', '#/optimizer', '#/game', '#/toolbox', '#/history', '#/settings'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/AppSidebar.test.ts`
Expected: FAIL，无法解析 `./AppSidebar`。

- [ ] **Step 3: 实现 src/components/AppSidebar.vue**

```vue
<script setup lang="ts">
const navItems = [
  { path: '/', label: '首页', icon: 'home' },
  { path: '/monitor', label: '硬件监控', icon: 'activity' },
  { path: '/optimizer', label: '优化中心', icon: 'sliders' },
  { path: '/game', label: '游戏模式', icon: 'gamepad' },
  { path: '/toolbox', label: '工具箱', icon: 'toolbox' },
  { path: '/history', label: '优化记录', icon: 'history' },
  { path: '/settings', label: '设置', icon: 'settings' }
] as const
</script>

<template>
  <nav class="sidebar">
    <div class="brand">
      <span class="brand-mark"></span>
      <span class="brand-name">疾风引擎</span>
    </div>
    <RouterLink
      v-for="item in navItems"
      :key="item.path"
      :to="item.path"
      class="nav-item"
      exact-active-class="active"
    >
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path v-if="item.icon === 'home'" d="M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3z" />
        <path v-else-if="item.icon === 'activity'" d="M3 12h4l3-7 4 14 3-7h4" />
        <g v-else-if="item.icon === 'sliders'">
          <path d="M4 7h16M4 12h16M4 17h16" />
          <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
          <circle cx="7" cy="17" r="2" fill="currentColor" stroke="none" />
        </g>
        <g v-else-if="item.icon === 'gamepad'">
          <rect x="2.5" y="7" width="19" height="10" rx="5" />
          <path d="M7 10v4M5 12h4" />
          <circle cx="16" cy="13" r="1" fill="currentColor" stroke="none" />
        </g>
        <g v-else-if="item.icon === 'toolbox'">
          <rect x="3" y="8" width="18" height="11" rx="2" />
          <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
        </g>
        <g v-else-if="item.icon === 'history'">
          <path d="M4 5v5h5" />
          <path d="M4.3 10A8 8 0 1 1 6 16.9" />
          <path d="M12 8v4l3 2" />
        </g>
        <g v-else-if="item.icon === 'settings'">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
        </g>
      </svg>
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--bg-tertiary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 16px 10px;
  gap: 2px;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 4px 10px 18px; }
.brand-mark { width: 26px; height: 26px; border-radius: 8px; background: var(--accent-bg); }
.brand-name { font-size: 15px; font-weight: 700; color: var(--text-primary); }
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 13.5px;
  transition: background 0.15s, color 0.15s;
}
.nav-item:hover { background: var(--accent-soft); color: var(--text-primary); }
.nav-item.active {
  background: var(--bg-secondary);
  color: var(--accent);
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--accent);
}
.icon { width: 17px; height: 17px; flex-shrink: 0; }
</style>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/components/AppSidebar.test.ts`
Expected: PASS，2 个测试通过。

- [ ] **Step 5: 更新 src/App.vue 为正式布局**

`src/App.vue` 完整内容：

```vue
<script setup lang="ts">
import AppSidebar from './components/AppSidebar.vue'
</script>

<template>
  <AppSidebar />
  <main class="content">
    <RouterView />
  </main>
</template>

<style scoped>
.content { flex: 1; min-width: 0; display: flex; flex-direction: column; }
</style>
```

- [ ] **Step 6: dev 验证**

Run: `npm run dev`
Expected: 左侧出现"疾风引擎"品牌区与 7 个导航项，点击任一项右侧内容区切换到对应占位页，当前项高亮为主色。Ctrl+C 退出。

- [ ] **Step 7: Commit**

```bash
git add src/components/ src/App.vue
git commit -m "feat: 侧边栏导航与应用布局"
```

---

### Task 9: 设置页主题定制 UI

**Files:**
- Modify: `src/pages/Settings.vue`（替换占位内容为完整实现）

- [ ] **Step 1: 重写 src/pages/Settings.vue**

```vue
<script setup lang="ts">
import { ACCENTS, ACCENT_ORDER } from '../theme/tokens'
import { themeController } from '../theme/themeController'

const appearances = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
] as const
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>设置</h1>
      <p>主题定制与偏好配置</p>
    </header>

    <div class="card">
      <h2 class="card-title">外观模式</h2>
      <div class="seg">
        <button
          v-for="a in appearances"
          :key="a.value"
          class="seg-btn"
          :class="{ on: themeController.appearance.value === a.value }"
          @click="themeController.setAppearance(a.value)"
        >
          {{ a.label }}
        </button>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">主题色</h2>
      <div class="colors">
        <button
          v-for="key in ACCENT_ORDER"
          :key="key"
          class="color"
          :class="{ on: themeController.accent.value === key }"
          @click="themeController.setAccent(key)"
        >
          <span class="swatch" :style="{ background: ACCENTS[key].bg }">
            {{ themeController.accent.value === key ? '✓' : '' }}
          </span>
          <span class="name">{{ ACCENTS[key].label }}</span>
        </button>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">更多设置</h2>
      <p class="hint">清理规则、开机自启与托盘将在后续里程碑开放。</p>
    </div>
  </section>
</template>

<style scoped>
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  margin-bottom: 14px;
  max-width: 560px;
}
.card-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; }
.seg { display: flex; gap: 8px; }
.seg-btn {
  flex: 1;
  padding: 8px 0;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.seg-btn.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); font-weight: 600; }
.colors { display: flex; gap: 14px; flex-wrap: wrap; }
.color { display: flex; flex-direction: column; align-items: center; gap: 6px; background: none; border: none; cursor: pointer; }
.swatch {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 14px;
}
.color.on .swatch { outline: 2px solid var(--text-primary); outline-offset: 2px; }
.name { font-size: 12px; color: var(--text-secondary); }
.color.on .name { color: var(--accent); font-weight: 600; }
.hint { font-size: 13px; color: var(--text-tertiary); }
</style>
```

- [ ] **Step 2: dev 手动验证（M1 主题验收核心）**

Run: `npm run dev`

逐项验证并记录结果：

1. 打开"设置"页，默认选中"跟随系统"+ 科技蓝。
2. 切换"深色"→ 整个应用（侧边栏、卡片、文字）立即变深色；切"浅色"恢复；切"跟随系统"与 Windows 系统主题一致。
3. 依次点击 6 个主题色 → 品牌方块、导航高亮、选中描边、按钮配色即时变化；"渐变蓝紫"下品牌方块呈渐变。
4. 选"深色 + 能量橙"，完全关闭应用后重新 `npm run dev` → 设置保持（electron-store 持久化生效）。
5. 其他页面（首页等）在深色模式下配色正常，无白底残留。

Expected: 以上 5 项全部通过。Ctrl+C 退出。

- [ ] **Step 3: 全量测试 + 类型检查 + Commit**

Run: `npx vitest run`
Expected: 全部 PASS（4 个测试文件、21 个测试：settings 6 + tokens 6 + useTheme 7 + AppSidebar 2）。

Run: `npm run typecheck`
Expected: 退出码 0。

```bash
git add src/pages/Settings.vue
git commit -m "feat: 设置页主题定制（3 外观模式 × 6 主题色）"
```

---

### Task 10: 打包 NSIS 安装程序（v0.1.0）

**Files:**
- Create: `electron-builder.yml`

- [ ] **Step 1: 写入 electron-builder.yml**

```yaml
appId: com.galeengine.app
productName: 疾风引擎
directories:
  output: release
files:
  - out/**
  - package.json
electronLanguages:
  - zh-CN
compression: maximum
win:
  target:
    - target: nsis
      arch:
        - x64
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  artifactName: 疾风引擎-${version}-setup.exe
```

要点：`files` 只带 `out/**`（依赖已全部打进 bundle，无需 node_modules）；`electronLanguages` 只保留 zh-CN 削减体积；`compression: maximum` 进一步压缩。

- [ ] **Step 2: 构建并打包**

Run: `npm run package`
Expected: 退出码 0。首次运行 electron-builder 会下载 NSIS/winCodeSign 工具链（需联网，耗时数分钟）。产物：`release/疾风引擎-0.1.0-setup.exe`。记录 setup.exe 体积（预期 55–65MB）。

- [ ] **Step 3: 安装冒烟测试**

手动执行：

1. 双击 `release/疾风引擎-0.1.0-setup.exe`，可选择安装目录，安装完成。
2. 启动"疾风引擎"：窗口标题正确、侧边栏 7 项齐全、页面切换正常。
3. 设置页切换"深色 + 活力紫"，完全退出后从开始菜单重新启动 → 主题保持。
4. 卸载测试（可选）：控制面板卸载干净。

Expected: 全部通过。

- [ ] **Step 4: 打 tag 并提交**

```bash
git add electron-builder.yml
git commit -m "build: electron-builder NSIS 打包配置，产出 v0.1.0 安装包"
git tag v0.1.0
```

---

## M1 完成定义（DoD）

- [ ] `npx vitest run` 全部通过（4 个测试文件、21 个测试）
- [ ] `npm run typecheck` 退出码 0
- [ ] `npm run dev` 下：7 页路由正常、主题 3 模式 × 6 色即时切换且重启保持
- [ ] `release/疾风引擎-0.1.0-setup.exe` 安装后冒烟通过
- [ ] `git tag v0.1.0` 已打

## 后续里程碑（各自启动时另写计划）

- M2 监控：systeminformation 1s 轮询 + IPC 事件流、硬件监控仪表盘（ECharts 按需引入）、首页评分环与三项指标
- M3 优化中心：垃圾扫描/清理、内存加速、启动项、一键加速链路
- M4 游戏模式 + 优化记录
- M5 工具箱 8 工具
- M6 收尾：托盘、开机自启、CSP 加固、图标、体积与签名
