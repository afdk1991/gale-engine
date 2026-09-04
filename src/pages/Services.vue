<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ServiceStartupType, WinService } from '../../shared/types'

const list = ref<WinService[]>([])
const filter = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)
const feedback = ref<Record<string, string>>({})
const confirmStop = ref<string | null>(null)

const statusClass: Record<string, string> = {
  Running: 'st-ok',
  Stopped: 'st-off',
  Paused: 'st-warn'
}

const startupLabels: Record<string, string> = {
  Automatic: '自动',
  Manual: '手动',
  Disabled: '已禁用'
}

const filtered = () => {
  const kw = filter.value.trim().toLowerCase()
  if (!kw) return list.value
  return list.value.filter(
    (s) => s.name.toLowerCase().includes(kw) || s.displayName.toLowerCase().includes(kw)
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
    list.value = await window.gale.winServices.list()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function act(s: WinService, label: string, fn: () => Promise<{ ok: boolean; message: string }>): Promise<void> {
  busy.value = s.name
  try {
    const r = await fn()
    flash(s.name, r.message)
    if (r.ok) {
      await window.gale.history.add({ type: 'optimize', label: `${label}服务`, detail: s.name })
    }
    await refresh()
  } catch (e) {
    flash(s.name, e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = null
    confirmStop.value = null
  }
}

const startService = (s: WinService) => act(s, '启动', () => window.gale.winServices.start(s.name))
const stopService = (s: WinService) => act(s, '停止', () => window.gale.winServices.stop(s.name))
const setStartup = (s: WinService, ev: Event) => {
  const t = (ev.target as HTMLSelectElement).value as ServiceStartupType | ''
  if (!t) return
  void act(s, '设置启动类型', () => window.gale.winServices.setStartupType(s.name, t))
}

onMounted(() => void refresh())
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>服务管理</h1>
      <p>查看与管理 Windows 服务：启动 / 停止、设置启动类型（系统关键服务已保护）</p>
    </header>

    <div class="toolbar">
      <input v-model="filter" class="input" placeholder="按服务名或显示名筛选…" />
      <button class="btn" :disabled="loading" @click="void refresh()">{{ loading ? '加载中…' : '刷新' }}</button>
    </div>

    <p v-if="error" class="error">服务列表获取失败：{{ error }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>服务</th>
            <th>状态</th>
            <th>启动类型</th>
            <th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filtered()" :key="s.name">
            <td>
              <span class="sname" :class="{ prot: s.protected }">{{ s.displayName || s.name }}</span>
              <span class="sraw">{{ s.name }}</span>
              <span v-if="s.protected" class="badge">系统</span>
            </td>
            <td>
              <span class="st" :class="statusClass[s.status] ?? 'st-off'">{{ s.status }}</span>
            </td>
            <td>
              <select class="prio" value="" :disabled="s.protected || busy === s.name" @change="setStartup(s, $event)">
                <option value="">{{ startupLabels[s.startType] ?? s.startType }}</option>
                <option value="auto">自动</option>
                <option value="manual">手动</option>
                <option value="disabled">已禁用</option>
              </select>
            </td>
            <td class="ops">
              <div class="row-ops" :class="{ disabled: s.protected && s.status !== 'Running' }">
                <template v-if="s.name === confirmStop">
                  <button class="btn danger mini" :disabled="busy === s.name" @click="void stopService(s)">确认停止</button>
                  <button class="btn mini" :disabled="busy === s.name" @click="confirmStop = null">取消</button>
                </template>
                <template v-else>
                  <button class="btn mini" :disabled="s.status === 'Running' || s.protected || busy === s.name" @click="void startService(s)">启动</button>
                  <button class="btn danger mini" :disabled="s.status !== 'Running' || !s.canStop || s.protected || busy === s.name" @click="confirmStop = s.name">停止</button>
                </template>
              </div>
              <p v-if="feedback[s.name]" class="fb">{{ feedback[s.name] }}</p>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!loading && filtered().length === 0 && !error" class="hint">没有匹配的服务</p>
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
.btn.danger { border-color: #fecaca; color: #dc2626; }
.btn.danger:hover:not(:disabled) { background: #fef2f2; }
.table-wrap { max-width: 960px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-size: 12px; color: var(--text-tertiary); font-weight: 500; padding: 10px 14px; border-bottom: 1px solid var(--border); }
td { padding: 9px 14px; border-bottom: 1px solid var(--border); color: var(--text-primary); vertical-align: top; }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--bg-tertiary); }
.sname { font-weight: 600; display: inline-block; margin-right: 6px; }
.sname.prot { color: var(--text-tertiary); }
.sraw { font-size: 11px; color: var(--text-tertiary); font-family: var(--font-mono, monospace); }
.badge { display: inline-block; margin-left: 6px; font-size: 10px; padding: 1px 6px; border-radius: 999px; background: var(--bg-tertiary); color: var(--text-tertiary); }
.st { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
.st-ok { color: #16a34a; background: #f0fdf4; }
.st-off { color: #6b7280; background: #f3f4f6; }
.st-warn { color: #d97706; background: #fffbeb; }
.prio { font-size: 12px; padding: 4px 6px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); }
.ops { min-width: 190px; }
.row-ops { display: flex; align-items: center; gap: 6px; }
.row-ops.disabled { opacity: 0.55; }
.fb { font-size: 11px; color: #16a34a; margin-top: 4px; }
.error { color: #ef4444; font-size: 13px; margin-bottom: 10px; }
.hint { color: var(--text-tertiary); font-size: 13px; padding: 14px; }
@media (max-width: 640px) {
  .table-wrap { overflow-x: auto; }
  table { min-width: 620px; }
}
</style>
