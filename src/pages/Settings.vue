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
