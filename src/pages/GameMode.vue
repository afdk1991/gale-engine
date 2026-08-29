<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { GameModeStatus } from '../../shared/types'

const status = ref<GameModeStatus | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const hint = ref<string | null>(null)

async function refresh(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    status.value = await window.gale.gameMode.status()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function boost(): Promise<void> {
  loading.value = true
  hint.value = null
  try {
    const next = await window.gale.gameMode.boost()
    status.value = next
    hint.value = '已切换到高性能电源计划，进入游戏模式'
    await window.gale.history.add({ type: 'gameMode', label: '进入游戏模式', detail: next.activeName || next.active })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function restore(): Promise<void> {
  loading.value = true
  hint.value = null
  try {
    const next = await window.gale.gameMode.restore()
    status.value = next
    hint.value = '已退出游戏模式，还原上一电源计划'
    await window.gale.history.add({ type: 'gameMode', label: '退出游戏模式', detail: next.activeName || next.active })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refresh()
})
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>游戏模式</h1>
      <p>一键切换高性能电源计划，释放系统性能</p>
    </header>

    <p v-if="error" class="error">操作失败：{{ error }}</p>
    <p v-if="hint" class="hint">{{ hint }}</p>

    <div class="card">
      <div class="state">
        <span class="dot" :class="{ on: status?.boosted }"></span>
        <div>
          <div class="state-title">{{ status?.boosted ? '游戏模式已开启' : '当前为普通模式' }}</div>
          <div class="state-sub">
            <template v-if="status">
              当前计划：{{ status.activeName || status.active || '未知' }}
            </template>
            <template v-else>加载中…</template>
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="btn primary" :disabled="loading || status?.boosted" @click="boost">
          {{ status?.boosted ? '已处于游戏模式' : '进入游戏模式' }}
        </button>
        <button class="btn" :disabled="loading || !status?.boosted" @click="restore">退出游戏模式</button>
        <button class="btn ghost" :disabled="loading" @click="refresh">刷新状态</button>
      </div>
    </div>

    <p class="note">
      游戏模式通过 <code>powercfg /setactive</code> 切换到系统「高性能」电源计划，
      退出时自动还原进入前的计划；切换仅影响电源策略，不涉及进程终止，安全可逆。
    </p>
  </section>
</template>

<style scoped>
.card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 20px; max-width: 720px; }
.state { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
.dot { width: 12px; height: 12px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
.dot.on { background: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
.state-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.state-sub { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.btn { font-size: 13px; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; transition: background 0.15s, opacity 0.15s; }
.btn:hover:not(:disabled) { background: var(--accent-soft); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.primary { background: var(--accent); color: #fff; border-color: transparent; }
.btn.ghost { background: transparent; }
.error { color: #ef4444; font-size: 13px; }
.hint { color: var(--accent); font-size: 13px; }
.note { font-size: 12px; color: var(--text-tertiary); margin-top: 14px; max-width: 720px; line-height: 1.6; }
code { background: var(--bg-tertiary); padding: 1px 5px; border-radius: 4px; }
</style>
