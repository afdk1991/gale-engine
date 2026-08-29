<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { SystemSnapshot } from '../../shared/types'

const snap = ref<SystemSnapshot | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

function fmtGB(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1)
}
function fmtSpeed(bytesPerSec: number): string {
  const kb = bytesPerSec / 1024
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB/s`
  return `${kb.toFixed(0)} KB/s`
}
function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h ${m}m`
}

async function refresh(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    snap.value = await window.gale.monitor.snapshot()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 1000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>硬件监控</h1>
      <p>实时采集 CPU / 内存 / 磁盘 / 网络负载（每秒刷新）</p>
    </header>

    <p v-if="error" class="error">监控数据获取失败：{{ error }}</p>

    <div v-if="snap" class="grid">
      <div class="card metric">
        <h2 class="card-title">CPU 负载</h2>
        <div class="big">{{ snap.cpu.load }}<span class="unit">%</span></div>
        <div class="cores">
          <div v-for="(c, i) in snap.cpu.cores" :key="i" class="core">
            <div class="core-bar"><span :style="{ width: c + '%' }"></span></div>
            <span class="core-label">#{{ i }} {{ c }}%</span>
          </div>
        </div>
      </div>

      <div class="card metric">
        <h2 class="card-title">内存</h2>
        <div class="big">{{ snap.mem.percent }}<span class="unit">%</span></div>
        <p class="sub">{{ fmtGB(snap.mem.used) }} / {{ fmtGB(snap.mem.total) }} GB</p>
        <div class="bar"><span :style="{ width: snap.mem.percent + '%' }"></span></div>
      </div>

      <div class="card metric">
        <h2 class="card-title">网络</h2>
        <p class="net-line">↓ {{ fmtSpeed(snap.net.rxSec) }}</p>
        <p class="net-line">↑ {{ fmtSpeed(snap.net.txSec) }}</p>
      </div>

      <div class="card metric">
        <h2 class="card-title">温度 / 电量</h2>
        <p class="sub">{{ snap.temp === null ? '温度不可用' : snap.temp + ' °C' }}</p>
        <p class="sub">{{ snap.battery === null ? '无电池' : '电量 ' + snap.battery + '%' }}</p>
        <p class="sub">运行时长 {{ fmtUptime(snap.uptimeSec) }}</p>
      </div>

      <div class="card disks">
        <h2 class="card-title">磁盘</h2>
        <div v-for="d in snap.disks" :key="d.mount" class="disk">
          <div class="disk-head">
            <span>{{ d.mount }}</span>
            <span class="muted">{{ fmtGB(d.used) }} / {{ fmtGB(d.total) }} GB</span>
          </div>
          <div class="bar"><span :style="{ width: d.percent + '%' }"></span></div>
        </div>
        <p v-if="snap.disks.length === 0" class="muted">未检测到磁盘</p>
      </div>
    </div>

    <p v-else-if="!error" class="hint">{{ loading ? '加载中…' : '' }}</p>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  max-width: 720px;
}
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
}
.card-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 10px; }
.big { font-size: 40px; font-weight: 700; color: var(--accent); line-height: 1; }
.unit { font-size: 18px; margin-left: 4px; color: var(--text-secondary); }
.sub { font-size: 13px; color: var(--text-secondary); margin-top: 6px; }
.muted { color: var(--text-tertiary); font-size: 12px; }
.cores { margin-top: 12px; display: flex; flex-direction: column; gap: 5px; }
.core { display: flex; align-items: center; gap: 8px; }
.core-bar { flex: 1; height: 6px; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden; }
.core-bar span { display: block; height: 100%; background: var(--accent); border-radius: 4px; }
.core-label { font-size: 11px; color: var(--text-tertiary); width: 64px; text-align: right; }
.bar { height: 8px; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden; margin-top: 10px; }
.bar span { display: block; height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.4s ease; }
.net-line { font-size: 14px; color: var(--text-primary); margin: 4px 0; }
.disks { grid-column: 1 / -1; }
.disk { margin-bottom: 12px; }
.disk-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
.error { color: #ef4444; font-size: 13px; }
.hint { color: var(--text-tertiary); font-size: 13px; }
</style>
