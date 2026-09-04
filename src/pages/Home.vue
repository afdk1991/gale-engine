<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { SystemSnapshot } from '../../shared/types'

const snap = ref<SystemSnapshot | null>(null)
const version = ref('')
const error = ref<string | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

function fmtSpeed(bytesPerSec: number): string {
  const kb = bytesPerSec / 1024
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB/s`
  return `${kb.toFixed(0)} KB/s`
}

/** 综合健康评分：CPU/内存/磁盘占用越低越好 */
const score = computed<number | null>(() => {
  if (!snap.value) return null
  const cpu = snap.value.cpu.load
  const mem = snap.value.mem.percent
  const disk = snap.value.disks.reduce((m, d) => Math.max(m, d.percent), 0)
  const penalty = cpu * 0.4 + mem * 0.4 + disk * 0.2
  return Math.max(0, Math.min(100, Math.round(100 - penalty)))
})

const scoreLabel = computed<string>(() => {
  const s = score.value
  if (s === null) return '—'
  if (s >= 80) return '流畅'
  if (s >= 60) return '良好'
  if (s >= 40) return '一般'
  return '偏重'
})

const scoreClass = computed<string>(() => {
  const s = score.value ?? 0
  if (s >= 80) return 'good'
  if (s >= 60) return 'ok'
  if (s >= 40) return 'warn'
  return 'bad'
})

async function refresh(): Promise<void> {
  try {
    snap.value = await window.gale.monitor.snapshot()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

onMounted(async () => {
  void refresh()
  timer = setInterval(() => void refresh(), 2000)
  try {
    version.value = await window.gale.app.getVersion()
  } catch {
    /* 版本获取失败时不影响主页展示 */
  }
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <section class="page">
    <div class="hero" :class="scoreClass">
      <div class="hero-main">
        <div class="hero-brand">
          <span class="hero-mark"></span>
          <span class="hero-name">疾风引擎</span>
          <span class="hero-ver">v{{ version || '—' }}</span>
        </div>
        <p class="hero-sub">一站式系统优化与硬件监控，让电脑持续保持最佳状态</p>
        <div class="hero-actions">
          <RouterLink class="hero-btn" to="/monitor">硬件监控</RouterLink>
          <RouterLink class="hero-btn ghost" to="/optimizer">优化中心</RouterLink>
        </div>
      </div>
      <div class="hero-score">
        <div class="score-ring">
          <span class="score-num">{{ score ?? '—' }}</span>
          <span class="score-unit">分</span>
        </div>
        <span class="score-label">{{ scoreLabel }}</span>
      </div>
    </div>

    <p v-if="error" class="error">监控数据获取失败：{{ error }}</p>

    <div v-if="snap" class="stats">
      <div class="stat">
        <span class="stat-label">CPU</span>
        <span class="stat-value">{{ snap.cpu.load }}<i>%</i></span>
        <div class="stat-bar"><span :style="{ width: snap.cpu.load + '%' }"></span></div>
      </div>
      <div class="stat">
        <span class="stat-label">内存</span>
        <span class="stat-value">{{ snap.mem.percent }}<i>%</i></span>
        <div class="stat-bar"><span :style="{ width: snap.mem.percent + '%' }"></span></div>
      </div>
      <div class="stat">
        <span class="stat-label">网络 ↓</span>
        <span class="stat-value sm">{{ fmtSpeed(snap.net.rxSec) }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">网络 ↑</span>
        <span class="stat-value sm">{{ fmtSpeed(snap.net.txSec) }}</span>
      </div>
    </div>

    <h2 class="section-title">功能模块</h2>
    <div class="modules">
      <RouterLink class="module" to="/monitor">
        <span class="module-icon">📊</span>
        <span class="module-name">硬件监控</span>
        <span class="module-desc">实时采集 CPU、内存、磁盘与网络负载</span>
      </RouterLink>
      <RouterLink class="module" to="/optimizer">
        <span class="module-icon">🧹</span>
        <span class="module-name">优化中心</span>
        <span class="module-desc">一键清理系统垃圾、管理开机启动项</span>
      </RouterLink>
      <RouterLink class="module" to="/game">
        <span class="module-icon">🎮</span>
        <span class="module-name">游戏模式</span>
        <span class="module-desc">切换高性能电源计划，释放系统性能</span>
      </RouterLink>
      <RouterLink class="module" to="/toolbox">
        <span class="module-icon">🧰</span>
        <span class="module-name">工具箱</span>
        <span class="module-desc">刷新 DNS、清空回收站等系统小工具</span>
      </RouterLink>
      <RouterLink class="module" to="/history">
        <span class="module-icon">🕘</span>
        <span class="module-name">优化记录</span>
        <span class="module-desc">查看全部清理与优化的历史留痕</span>
      </RouterLink>
      <RouterLink class="module" to="/settings">
        <span class="module-icon">⚙️</span>
        <span class="module-name">设置</span>
        <span class="module-desc">外观主题、自动更新与开机自启</span>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-radius: 16px;
  padding: 26px 28px;
  color: #fff;
  background: var(--accent-bg, #3b82f6);
  box-shadow: var(--shadow);
  margin-bottom: 18px;
}
.hero.good { background: linear-gradient(135deg, #059669, #047857); }
.hero.ok { background: linear-gradient(135deg, #2563eb, #1d4ed8); }
.hero.warn { background: linear-gradient(135deg, #d97706, #b45309); }
.hero.bad { background: linear-gradient(135deg, #dc2626, #b91c1c); }

/* 暗色模式下降低渐变亮度，避免刺眼 */
:root[data-theme='dark'] .hero.good { background: linear-gradient(135deg, #047857, #065f46); }
:root[data-theme='dark'] .hero.ok { background: linear-gradient(135deg, #1d4ed8, #1e40af); }
:root[data-theme='dark'] .hero.warn { background: linear-gradient(135deg, #b45309, #92400e); }
:root[data-theme='dark'] .hero.bad { background: linear-gradient(135deg, #b91c1c, #991b1b); }
.hero-brand { display: flex; align-items: center; gap: 10px; }
.hero-mark { width: 30px; height: 30px; border-radius: 9px; background: rgba(255, 255, 255, 0.25); }
.hero-name { font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
.hero-ver { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.2); }
.hero-sub { margin: 12px 0 16px; font-size: 13.5px; opacity: 0.92; max-width: 460px; line-height: 1.6; }
.hero-actions { display: flex; gap: 10px; }
.hero-btn {
  font-size: 13px;
  padding: 9px 18px;
  border-radius: 9px;
  background: #fff;
  color: #1f2329;
  text-decoration: none;
  font-weight: 600;
  transition: transform 0.12s, opacity 0.12s;
}
.hero-btn.ghost { background: rgba(255, 255, 255, 0.16); color: #fff; }
.hero-btn:hover { transform: translateY(-1px); opacity: 0.95; }
.hero-score { display: flex; flex-direction: column; align-items: center; gap: 6px; flex-shrink: 0; }
.score-ring {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  display: flex;
  align-items: baseline;
  justify-content: center;
  background: rgba(255, 255, 255, 0.18);
  border: 3px solid rgba(255, 255, 255, 0.55);
}
.score-num { font-size: 38px; font-weight: 800; line-height: 1; }
.score-unit { font-size: 13px; margin-left: 2px; opacity: 0.9; }
.score-label { font-size: 13px; font-weight: 600; }

.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 22px; }
.stat { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.stat-label { font-size: 12px; color: var(--text-secondary); }
.stat-value { display: block; font-size: 22px; font-weight: 700; color: var(--text-primary); margin-top: 4px; }
.stat-value i { font-size: 13px; font-style: normal; color: var(--text-tertiary); margin-left: 2px; }
.stat-value.sm { font-size: 16px; }
.stat-bar { height: 6px; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden; margin-top: 10px; }
.stat-bar span { display: block; height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.4s ease; }

.section-title { font-size: 15px; font-weight: 600; color: var(--text-primary); margin: 4px 0 12px; }
.modules { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.module {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  text-decoration: none;
  transition: border-color 0.15s, transform 0.12s, box-shadow 0.15s;
}
.module:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: var(--shadow); }
.module-icon { font-size: 22px; }
.module-name { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-top: 4px; }
.module-desc { font-size: 12px; color: var(--text-tertiary); line-height: 1.5; }

.error { color: #ef4444; font-size: 13px; margin-bottom: 12px; }

@media (max-width: 900px) {
  .modules { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .hero { flex-direction: column; align-items: flex-start; }
  .modules { grid-template-columns: 1fr; }
  .stats { grid-template-columns: 1fr 1fr; }
}
</style>
