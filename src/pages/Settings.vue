<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ACCENTS, ACCENT_ORDER } from '../theme/tokens'
import { themeController } from '../theme/themeController'
import type { AppUpdateResult } from '../../shared/types'

const appearances = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
] as const

const version = ref('')
const checking = ref(false)
const updateState = ref<AppUpdateResult>({ status: 'up-to-date' })
const autoLaunch = ref(false)

onMounted(async () => {
  try {
    version.value = await window.gale.app.getVersion()
    autoLaunch.value = await window.gale.app.getAutoLaunch()
  } catch {
    /* 初始化失败时静默降级，避免阻塞设置页 */
  }
})

async function checkUpdate(): Promise<void> {
  checking.value = true
  try {
    updateState.value = await window.gale.app.checkUpdate()
  } catch (e) {
    updateState.value = { status: 'error', error: e instanceof Error ? e.message : String(e) }
  } finally {
    checking.value = false
  }
}

async function installUpdate(): Promise<void> {
  await window.gale.app.installUpdate()
}

async function toggleAutoLaunch(): Promise<void> {
  autoLaunch.value = await window.gale.app.setAutoLaunch(!autoLaunch.value)
}

function updateText(s: AppUpdateResult): string {
  if (s.status === 'available') return `发现新版本 v${s.version}，下载完成后点击「立即安装」`
  if (s.status === 'error') return `检查失败：${s.error ?? '未知错误'}`
  return '当前已是最新版本'
}
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
          :aria-pressed="themeController.appearance.value === a.value"
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
          :aria-pressed="themeController.accent.value === key"
          @click="themeController.setAccent(key)"
        >
          <span class="swatch" aria-hidden="true" :style="{ background: ACCENTS[key].bg }">
            {{ themeController.accent.value === key ? '✓' : '' }}
          </span>
          <span class="name">{{ ACCENTS[key].label }}</span>
        </button>
      </div>
    </div>

    <div class="card">
      <h2 class="card-title">关于与更新</h2>
      <p class="row-line">当前版本：<strong>{{ version || '—' }}</strong></p>
      <div class="row">
        <button class="btn" :disabled="checking" @click="checkUpdate">
          {{ checking ? '检查中…' : '检查更新' }}
        </button>
        <button
          v-if="updateState.status === 'available'"
          class="btn btn-primary"
          @click="installUpdate"
        >立即安装</button>
      </div>
      <p class="hint" :class="{ bad: updateState.status === 'error' }">{{ updateText(updateState) }}</p>
    </div>

    <div class="card">
      <h2 class="card-title">开机自启</h2>
      <label class="switch-line">
        <input type="checkbox" :checked="autoLaunch" @change="toggleAutoLaunch" />
        <span>登录 Windows 时自动启动疾风引擎</span>
      </label>
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
.hint.bad { color: #d33; }
.row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
.btn {
  padding: 8px 16px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.btn:disabled { opacity: .6; cursor: default; }
.btn-primary { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); font-weight: 600; }
.row-line { font-size: 13px; color: var(--text-secondary); margin: 0 0 12px; }
.switch-line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }

@media (max-width: 640px) {
  .card { padding: 14px; max-width: 100%; }
  .colors { gap: 10px; }
  .swatch { width: 30px; height: 30px; }
}
</style>
