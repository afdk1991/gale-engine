<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { HardwareInfo } from '../../shared/types'

const info = ref<HardwareInfo | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)

function fmtBytes(bytes: number): string {
  if (!bytes) return '—'
  const gb = bytes / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1024 / 1024
  return `${mb.toFixed(0)} MB`
}
function orDash(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

async function refresh(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    info.value = await window.gale.hardware.info()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => void refresh())
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>硬件信息</h1>
      <p>主板 / CPU / 内存 / 显卡 / 显示器 / 硬盘 / 电源 型号规格（静态采集，支持 x86 / x64 / arm64）</p>
    </header>

    <p v-if="error" class="error">硬件信息获取失败：{{ error }}</p>

    <div v-if="info" class="grid">
      <!-- 主板 -->
      <div class="card">
        <h2 class="card-title">主板 / BIOS</h2>
        <dl class="spec">
          <dt>主板型号</dt><dd>{{ orDash(info.motherboard.model) }}</dd>
          <dt>主板厂商</dt><dd>{{ orDash(info.motherboard.vendor) }}</dd>
          <dt>主板版本</dt><dd>{{ orDash(info.motherboard.version) }}</dd>
          <dt>BIOS 厂商</dt><dd>{{ orDash(info.motherboard.biosVendor) }}</dd>
          <dt>BIOS 版本</dt><dd>{{ orDash(info.motherboard.biosVersion) }}</dd>
          <dt>BIOS 日期</dt><dd>{{ orDash(info.motherboard.biosDate) }}</dd>
        </dl>
      </div>

      <!-- CPU -->
      <div class="card">
        <h2 class="card-title">CPU</h2>
        <dl class="spec">
          <dt>型号</dt><dd>{{ orDash(info.cpu.brand) }}</dd>
          <dt>厂商</dt><dd>{{ orDash(info.cpu.vendor) }}</dd>
          <dt>架构</dt><dd>{{ orDash(info.cpu.arch) }}</dd>
          <dt>物理核心</dt><dd>{{ info.cpu.physicalCores }}</dd>
          <dt>逻辑核心</dt><dd>{{ info.cpu.cores }}</dd>
          <dt>基础频率</dt><dd>{{ info.cpu.speedGHz === null ? '—' : info.cpu.speedGHz + ' GHz' }}</dd>
        </dl>
      </div>

      <!-- 内存 -->
      <div class="card">
        <h2 class="card-title">内存</h2>
        <dl class="spec">
          <dt>总容量</dt><dd>{{ fmtBytes(info.memory.total) }}</dd>
        </dl>
        <div v-if="info.memory.sticks.length" class="sticks">
          <div v-for="(s, i) in info.memory.sticks" :key="i" class="stick">
            <span class="stick-tag">DIMM {{ i + 1 }}</span>
            <span class="stick-model">{{ orDash(s.model) }}</span>
            <span class="muted">{{ orDash(s.vendor) }} · {{ fmtBytes(s.size) }} · {{ s.speedMHz === null ? '—' : s.speedMHz + ' MHz' }} · {{ orDash(s.type) }}</span>
          </div>
        </div>
        <p v-else class="muted note">内存条型号需管理员/root 权限，当前未获取到详细信息</p>
      </div>

      <!-- 显卡 -->
      <div class="card">
        <h2 class="card-title">显卡</h2>
        <div v-if="info.graphics.length" class="list">
          <div v-for="(g, i) in info.graphics" :key="i" class="list-item">
            <span class="list-model">{{ orDash(g.model) }}</span>
            <span class="muted">{{ orDash(g.vendor) }} · {{ g.vramMB === null ? '显存未知' : g.vramMB + ' MB' }} · {{ orDash(g.bus) }}</span>
          </div>
        </div>
        <p v-else class="muted note">未检测到显卡</p>
      </div>

      <!-- 显示器 -->
      <div class="card">
        <h2 class="card-title">显示器</h2>
        <div v-if="info.displays.length" class="list">
          <div v-for="(d, i) in info.displays" :key="i" class="list-item">
            <span class="list-model">{{ orDash(d.model) }}</span>
            <span class="muted">{{ orDash(d.vendor) }} · {{ d.resolutionX }}×{{ d.resolutionY }} · {{ d.sizeInch === null ? '尺寸未知' : d.sizeInch + '"' }}</span>
          </div>
        </div>
        <p v-else class="muted note">未检测到显示器</p>
      </div>

      <!-- 硬盘 -->
      <div class="card">
        <h2 class="card-title">硬盘</h2>
        <div v-if="info.disks.length" class="list">
          <div v-for="(d, i) in info.disks" :key="i" class="list-item">
            <span class="list-model">{{ orDash(d.model) }}</span>
            <span class="muted">{{ orDash(d.vendor) }} · {{ fmtBytes(d.size) }} · {{ orDash(d.type) }} · {{ orDash(d.interfaceType) }}</span>
          </div>
        </div>
        <p v-else class="muted note">硬盘型号需管理员/root 权限，当前未获取到详细信息</p>
      </div>

      <!-- 电源 -->
      <div class="card">
        <h2 class="card-title">电源</h2>
        <dl class="spec">
          <dt>型号</dt><dd>{{ orDash(info.power.model) }}</dd>
          <dt>厂商</dt><dd>{{ orDash(info.power.vendor) }}</dd>
          <dt>类型</dt>
          <dd>{{ info.power.type === 'battery' ? '电池' : info.power.type === 'psu' ? '电源供应器' : '不可用' }}</dd>
          <dt>额定功率</dt><dd>{{ info.power.powerW === null ? '—' : info.power.powerW + ' W' }}</dd>
        </dl>
        <p v-if="info.power.type === 'unknown'" class="muted note">台式机 PSU 通常无标准软件接口（需 PMBus/SMBus），型号不可读取</p>
      </div>
    </div>

    <p v-else-if="!error" class="hint">{{ loading ? '采集硬件信息中…' : '' }}</p>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  max-width: 760px;
}
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
}
.card-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 12px; }
.spec { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 13px; }
.spec dt { color: var(--text-tertiary); }
.spec dd { margin: 0; color: var(--text-primary); word-break: break-word; }
.muted { color: var(--text-tertiary); font-size: 12px; }
.note { margin-top: 8px; font-size: 12px; }
.sticks { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.stick { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.stick-tag { background: var(--bg-tertiary); border-radius: 4px; padding: 1px 6px; color: var(--accent); font-size: 11px; }
.stick-model { color: var(--text-primary); font-weight: 600; }
.list { display: flex; flex-direction: column; gap: 10px; }
.list-item { display: flex; flex-direction: column; gap: 2px; }
.list-model { color: var(--text-primary); font-size: 13px; font-weight: 600; }
@media (max-width: 640px) {
  .grid { grid-template-columns: 1fr; }
}
.error { color: #ef4444; font-size: 13px; }
.hint { color: var(--text-tertiary); font-size: 13px; }
</style>
