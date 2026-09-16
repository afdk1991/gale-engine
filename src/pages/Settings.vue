<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ACCENTS, ACCENT_ORDER } from '../theme/tokens'
import { themeController } from '../theme/themeController'
import UpdateCard from '../components/UpdateCard.vue'

const appearances = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
] as const

const autoLaunch = ref(false)
const autoLaunchMsg = ref('')
const elevated = ref(false)
const elevateMsg = ref('')

onMounted(async () => {
  try {
    autoLaunch.value = await window.gale.app.getAutoLaunch()
    elevated.value = await window.gale.app.isElevated()
  } catch {
    /* 初始化失败时静默降级，避免阻塞设置页 */
  }
})

/** 以提升权限重启本应用（Windows 弹 UAC；macOS 弹认证框；Linux 提示手动 sudo） */
async function restartElevated(): Promise<void> {
  elevateMsg.value = ''
  try {
    const r = await window.gale.app.restartElevated()
    elevateMsg.value = r.message
    if (r.ok) elevated.value = true
  } catch (e) {
    elevateMsg.value = e instanceof Error ? e.message : String(e)
  }
}

async function toggleAutoLaunch(): Promise<void> {
  autoLaunchMsg.value = ''
  const next = !autoLaunch.value
  try {
    const applied = await window.gale.app.setAutoLaunch(next)
    // 以主进程回传的实际状态为准，避免 IPC 失败或平台不支持时 UI 与真实状态不一致
    autoLaunch.value = applied
    if (applied !== next) autoLaunchMsg.value = '当前平台未能切换开机自启（可能缺少权限）'
  } catch (e) {
    autoLaunchMsg.value = e instanceof Error ? e.message : String(e)
  }
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

    <!-- 关于与更新：与首页/侧边栏共用同一份更新状态（composable 单例） -->
    <UpdateCard />

    <div class="card">
      <h2 class="card-title">管理员权限</h2>
      <p class="row-line">
        当前状态：
        <strong :class="elevated ? 'ok-text' : 'warn-text'">
          {{ elevated ? '已提升为管理员/root' : '普通权限' }}
        </strong>
      </p>
      <p class="hint">
        应用默认以普通权限启动（保证开机自启与自动更新可用）。遇到需要高权限的优化项时，
        可在此重启为管理员模式；日常使用无需常驻管理员。
      </p>
      <div class="row">
        <button class="btn btn-primary" :disabled="elevated" @click="restartElevated">
          {{ elevated ? '已具备管理员权限' : '以管理员身份重启' }}
        </button>
      </div>
      <p v-if="elevateMsg" class="hint" :class="{ bad: elevateMsg.includes('失败') }">{{ elevateMsg }}</p>
    </div>

    <div class="card">
      <h2 class="card-title">开机自启</h2>
      <label class="switch-line">
        <input type="checkbox" :checked="autoLaunch" @change="toggleAutoLaunch" />
        <span>登录系统时自动启动疾风引擎</span>
      </label>
      <p v-if="autoLaunchMsg" class="hint bad">{{ autoLaunchMsg }}</p>
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
.ok-text { color: #059669; }
.warn-text { color: #d97706; }
.switch-line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }

@media (max-width: 640px) {
  .card { padding: 14px; max-width: 100%; }
  .colors { gap: 10px; }
  .swatch { width: 30px; height: 30px; }
}
</style>
