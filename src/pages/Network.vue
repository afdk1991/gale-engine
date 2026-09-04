<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { NetInterface, PingResult } from '../../shared/types'

const host = ref('baidu.com')
const busy = ref(false)
const error = ref<string | null>(null)
const ping = ref<PingResult | null>(null)
const ifaces = ref<NetInterface[]>([])

const quickHosts = ['baidu.com', '223.5.5.5', '127.0.0.1']

async function runPing(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    ping.value = await window.gale.network.ping(host.value, 4)
    if (!ping.value.ok) error.value = `无法连通 ${host.value}，请检查网络`
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function loadIfaces(): Promise<void> {
  try {
    ifaces.value = await window.gale.network.interfaces()
  } catch {
    ifaces.value = []
  }
}

onMounted(() => {
  void loadIfaces()
})
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>网络诊断</h1>
      <p>延迟测试与网络接口信息（基于 Windows 系统网络命令）</p>
    </header>

    <div class="grid">
      <div class="card">
        <h2 class="card-title">延迟测试</h2>
        <p class="desc">Ping 目标主机 4 次，查看往返延迟与丢包率</p>
        <div class="host-row">
          <input v-model="host" class="input" placeholder="输入主机名或 IP" @keyup.enter="void runPing()" />
          <button class="btn" :disabled="busy" @click="void runPing()">{{ busy ? '测试中…' : '开始测试' }}</button>
        </div>
        <div class="quick">
          <button
            v-for="h in quickHosts"
            :key="h"
            class="chip"
            :class="{ on: host === h }"
            @click="host = h; void runPing()"
          >{{ h }}</button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>
        <div v-if="ping" class="result-grid">
          <div class="metric">
            <span class="m-label">最小</span>
            <span class="m-val">{{ ping.min }}<span class="m-unit">ms</span></span>
          </div>
          <div class="metric">
            <span class="m-label">平均</span>
            <span class="m-val">{{ ping.avg }}<span class="m-unit">ms</span></span>
          </div>
          <div class="metric">
            <span class="m-label">最大</span>
            <span class="m-val">{{ ping.max }}<span class="m-unit">ms</span></span>
          </div>
          <div class="metric">
            <span class="m-label">丢包率</span>
            <span class="m-val" :class="{ bad: ping.loss > 0 }">{{ ping.loss }}<span class="m-unit">%</span></span>
          </div>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">网络接口</h2>
        <p class="desc">本机网卡与连接状态</p>
        <div v-if="ifaces.length" class="ifaces">
          <div v-for="(n, i) in ifaces" :key="i" class="iface">
            <div class="iface-head">
              <span class="iface-name">{{ n.name }}</span>
              <span class="iface-st" :class="n.status === '已连接' ? 'st-ok' : 'st-off'">{{ n.status }}</span>
            </div>
            <span class="iface-ip">{{ n.ip || '—' }}</span>
          </div>
        </div>
        <p v-else class="hint">暂无网卡数据</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; max-width: 960px; }
.card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
.card-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.desc { font-size: 12px; color: var(--text-tertiary); margin-bottom: 12px; }
.host-row { display: flex; gap: 8px; }
.input { flex: 1; font-size: 13px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); }
.btn { font-size: 13px; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; transition: background 0.15s, opacity 0.15s; }
.btn:hover:not(:disabled) { background: var(--accent-soft); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.quick { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.chip { font-size: 12px; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-secondary); cursor: pointer; }
.chip.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.error { color: #ef4444; font-size: 12px; margin-top: 10px; }
.result-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 14px; }
.metric { background: var(--bg-tertiary); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; }
.m-label { font-size: 11px; color: var(--text-tertiary); }
.m-val { font-size: 20px; font-weight: 700; color: var(--accent); }
.m-val.bad { color: #dc2626; }
.m-unit { font-size: 12px; font-weight: 400; color: var(--text-secondary); margin-left: 3px; }
.ifaces { display: flex; flex-direction: column; gap: 8px; }
.iface { background: var(--bg-tertiary); border-radius: 8px; padding: 10px 12px; }
.iface-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.iface-name { font-size: 13px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iface-st { font-size: 11px; padding: 2px 8px; border-radius: 999px; flex-shrink: 0; }
.st-ok { color: #16a34a; background: #f0fdf4; }
.st-off { color: #6b7280; background: #f3f4f6; }
.iface-ip { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.hint { color: var(--text-tertiary); font-size: 13px; }
@media (max-width: 700px) {
  .grid { grid-template-columns: 1fr; }
}
</style>
