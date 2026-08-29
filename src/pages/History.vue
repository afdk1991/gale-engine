<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { HistoryEntry, HistoryType } from '../../shared/types'

const entries = ref<HistoryEntry[]>([])
const error = ref<string | null>(null)

const TYPE_LABEL: Record<HistoryType, string> = {
  cleanup: '清理',
  startup: '启动项',
  gameMode: '游戏模式',
  toolbox: '工具',
  optimize: '优化'
}

function fmtTime(at: number): string {
  if (!at) return '—'
  const diff = Date.now() - at
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

async function load(): Promise<void> {
  error.value = null
  try {
    entries.value = await window.gale.history.list()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function clearAll(): Promise<void> {
  await window.gale.history.clear()
  await load()
}

onMounted(load)
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>优化记录</h1>
      <p>所有清理、优化与模式切换操作都会在此留痕</p>
    </header>

    <p v-if="error" class="error">记录加载失败：{{ error }}</p>

    <div class="card">
      <div class="list-head">
        <span class="count">共 {{ entries.length }} 条</span>
        <button class="clear" :disabled="entries.length === 0" @click="clearAll">清空记录</button>
      </div>

      <ul v-if="entries.length" class="list">
        <li v-for="e in entries" :key="e.id" class="item">
          <span class="badge" :class="e.type">{{ TYPE_LABEL[e.type] }}</span>
          <div class="body">
            <div class="label">{{ e.label }}</div>
            <div v-if="e.detail" class="detail">{{ e.detail }}</div>
          </div>
          <span class="time">{{ fmtTime(e.at) }}</span>
        </li>
      </ul>

      <p v-else class="empty">暂无记录，去优化中心或工具箱试试吧。</p>
    </div>
  </section>
</template>

<style scoped>
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  max-width: 640px;
}
.list-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.count { font-size: 13px; color: var(--text-secondary); }
.clear {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
.clear:disabled { opacity: 0.5; cursor: not-allowed; }
.clear:not(:disabled):hover { color: var(--accent); border-color: var(--accent); }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.item:last-child { border-bottom: none; }
.badge {
  flex-shrink: 0;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.body { flex: 1; min-width: 0; }
.label { font-size: 13.5px; color: var(--text-primary); }
.detail { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; word-break: break-all; }
.time { font-size: 12px; color: var(--text-tertiary); flex-shrink: 0; }
.empty { font-size: 13px; color: var(--text-tertiary); padding: 12px 0; }
.error { color: #ef4444; font-size: 13px; }
</style>
