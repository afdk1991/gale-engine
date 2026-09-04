<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ScheduledTask } from '../../shared/types'

const list = ref<ScheduledTask[]>([])
const filter = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)
const feedback = ref<Record<string, string>>({})

const stateClass: Record<string, string> = {
  Ready: 'st-ok',
  Running: 'st-run',
  Disabled: 'st-off'
}

const filtered = () => {
  const kw = filter.value.trim().toLowerCase()
  if (!kw) return list.value
  return list.value.filter(
    (t) => t.name.toLowerCase().includes(kw) || t.path.toLowerCase().includes(kw)
  )
}

function flash(key: string, message: string): void {
  feedback.value = { ...feedback.value, [key]: message }
  setTimeout(() => {
    const next = { ...feedback.value }
    delete next[key]
    feedback.value = next
  }, 3000)
}

async function refresh(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    list.value = await window.gale.tasks.list()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function act(t: ScheduledTask, label: string, fn: () => Promise<{ ok: boolean; message: string }>): Promise<void> {
  const key = `${t.path}|${t.name}`
  busy.value = key
  try {
    const r = await fn()
    flash(key, r.message)
    if (r.ok) {
      await window.gale.history.add({ type: 'optimize', label: `${label}计划任务`, detail: `${t.path}${t.name}` })
    }
    await refresh()
  } catch (e) {
    flash(key, e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = null
  }
}

const toggleTask = (t: ScheduledTask) =>
  act(t, t.state === 'Disabled' ? '启用' : '禁用', () =>
    window.gale.tasks.setEnabled(t.path, t.name, t.state === 'Disabled')
  )
const runTask = (t: ScheduledTask) => act(t, '运行', () => window.gale.tasks.run(t.path, t.name))
const stopTask = (t: ScheduledTask) => act(t, '结束', () => window.gale.tasks.stop(t.path, t.name))

onMounted(() => void refresh())
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>计划任务</h1>
      <p>查看与管理系统计划任务：启用 / 禁用、立即运行、结束运行中任务</p>
    </header>

    <div class="toolbar">
      <input v-model="filter" class="input" placeholder="按任务名或路径筛选…" />
      <button class="btn" :disabled="loading" @click="void refresh()">{{ loading ? '加载中…' : '刷新' }}</button>
    </div>

    <p v-if="error" class="error">计划任务获取失败：{{ error }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>任务</th>
            <th>状态</th>
            <th>上次运行</th>
            <th>下次运行</th>
            <th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in filtered()" :key="t.path + t.name">
            <td>
              <span class="tname">{{ t.name }}</span>
              <span class="tpath">{{ t.path }}</span>
            </td>
            <td>
              <span class="st" :class="stateClass[t.state] ?? 'st-off'">{{ t.state }}</span>
            </td>
            <td class="time">{{ t.lastRunTime || '—' }}</td>
            <td class="time">{{ t.nextRunTime || '—' }}</td>
            <td class="ops">
              <div class="row-ops">
                <button class="btn mini" :disabled="busy === t.path + t.name" @click="void toggleTask(t)">
                  {{ t.state === 'Disabled' ? '启用' : '禁用' }}
                </button>
                <button class="btn mini" :disabled="busy === t.path + t.name" @click="void runTask(t)">运行</button>
                <button class="btn mini" :disabled="busy === t.path + t.name || t.state !== 'Running'" @click="void stopTask(t)">结束</button>
              </div>
              <p v-if="feedback[t.path + t.name]" class="fb">{{ feedback[t.path + t.name] }}</p>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!loading && filtered().length === 0 && !error" class="hint">没有匹配的任务</p>
    </div>
  </section>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; max-width: 960px; }
.input { flex: 1; font-size: 13px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); }
.btn { font-size: 13px; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; transition: background 0.15s, opacity 0.15s; }
.btn:hover:not(:disabled) { background: var(--accent-soft); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.mini { padding: 4px 10px; font-size: 12px; }
.table-wrap { max-width: 960px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-size: 12px; color: var(--text-tertiary); font-weight: 500; padding: 10px 14px; border-bottom: 1px solid var(--border); }
td { padding: 9px 14px; border-bottom: 1px solid var(--border); color: var(--text-primary); vertical-align: top; }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--bg-tertiary); }
.tname { font-weight: 600; display: block; }
.tpath { font-size: 11px; color: var(--text-tertiary); font-family: var(--font-mono, monospace); }
.time { font-variant-numeric: tabular-nums; color: var(--text-secondary); white-space: nowrap; }
.st { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
.st-ok { color: #16a34a; background: #f0fdf4; }
.st-run { color: #2563eb; background: #eff6ff; }
.st-off { color: #6b7280; background: #f3f4f6; }
.ops { min-width: 190px; }
.row-ops { display: flex; align-items: center; gap: 6px; }
.fb { font-size: 11px; color: #16a34a; margin-top: 4px; }
.error { color: #ef4444; font-size: 13px; margin-bottom: 10px; }
.hint { color: var(--text-tertiary); font-size: 13px; padding: 14px; }
@media (max-width: 640px) {
  .table-wrap { overflow-x: auto; }
  table { min-width: 640px; }
}
</style>
