<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ProcessActionResult, ProcessInfo, ProcessPriorityLevel, ProcessSortKey } from '../../shared/types'

const list = ref<ProcessInfo[]>([])
const sort = ref<ProcessSortKey>('cpu')
const loading = ref(false)
const error = ref<string | null>(null)
const busy = ref<number | null>(null)
const feedback = ref<Record<number, string>>({})
const confirmKill = ref<number | null>(null)

const priorityLevels: { value: ProcessPriorityLevel; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'belowNormal', label: '低于正常' },
  { value: 'normal', label: '正常' },
  { value: 'aboveNormal', label: '高于正常' },
  { value: 'high', label: '高' }
]

async function refresh(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    list.value = await window.gale.process.list(sort.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function flash(pid: number, message: string): void {
  feedback.value = { ...feedback.value, [pid]: message }
  setTimeout(() => {
    const next = { ...feedback.value }
    delete next[pid]
    feedback.value = next
  }, 3000)
}

async function act(
  pid: number,
  label: string,
  fn: () => Promise<ProcessActionResult>,
  historyLabel: string
): Promise<void> {
  busy.value = pid
  try {
    const r = await fn()
    flash(pid, r.message)
    if (r.ok) {
      await window.gale.history.add({ type: 'optimize', label: historyLabel, detail: `PID ${pid} ${label}` })
    }
    await refresh()
  } catch (e) {
    flash(pid, e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = null
    confirmKill.value = null
  }
}

const killProcess = (p: ProcessInfo) =>
  act(p.pid, '结束', () => window.gale.process.kill(p.pid), '结束进程')
const suspendProcess = (p: ProcessInfo) =>
  act(p.pid, '挂起', () => window.gale.process.suspend(p.pid), '挂起进程')
const resumeProcess = (p: ProcessInfo) =>
  act(p.pid, '恢复', () => window.gale.process.resume(p.pid), '恢复进程')
const setPriority = (p: ProcessInfo, ev: Event) => {
  const level = (ev.target as HTMLSelectElement).value as ProcessPriorityLevel
  void act(p.pid, '优先级', () => window.gale.process.priority(p.pid, level), '调整进程优先级')
}

onMounted(() => void refresh())
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>进程管理</h1>
      <p>查看与管理系统进程：结束、挂起 / 恢复、调整优先级（系统关键进程已保护）</p>
    </header>

    <div class="toolbar">
      <div class="seg" role="group" aria-label="排序方式">
        <button
          v-for="opt in ([{ v: 'cpu', t: '按 CPU' }, { v: 'mem', t: '按内存' }, { v: 'name', t: '按名称' }] as const)"
          :key="opt.v"
          class="seg-btn"
          :class="{ on: sort === opt.v }"
          @click="sort = opt.v; void refresh()"
        >{{ opt.t }}</button>
      </div>
      <button class="btn" :disabled="loading" @click="void refresh()">{{ loading ? '加载中…' : '刷新' }}</button>
    </div>

    <p v-if="error" class="error">进程列表获取失败：{{ error }}</p>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>进程</th>
            <th>PID</th>
            <th>CPU</th>
            <th>内存</th>
            <th>状态</th>
            <th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in list" :key="p.pid">
            <td>
              <span class="pname" :class="{ prot: p.protected }">{{ p.name }}</span>
              <span v-if="p.protected" class="badge">系统</span>
            </td>
            <td class="num">{{ p.pid }}</td>
            <td class="num">{{ p.cpuPercent.toFixed(1) }}%</td>
            <td class="num">{{ p.memMB.toFixed(0) }} MB</td>
            <td>
              <span class="st" :class="p.status === 'suspended' ? 'st-sus' : 'st-run'">
                {{ p.status === 'suspended' ? '已挂起' : '运行中' }}
              </span>
            </td>
            <td class="ops">
              <div class="row-ops" :class="{ disabled: p.protected }">
                <template v-if="p.pid === confirmKill">
                  <button class="btn danger mini" :disabled="busy === p.pid" @click="void killProcess(p)">确认</button>
                  <button class="btn mini" :disabled="busy === p.pid" @click="confirmKill = null">取消</button>
                </template>
                <template v-else>
                  <button class="btn danger mini" :disabled="p.protected || busy === p.pid" @click="confirmKill = p.pid">结束</button>
                  <button
                    class="btn mini"
                    :disabled="p.protected || busy === p.pid"
                    @click="p.status === 'suspended' ? void resumeProcess(p) : void suspendProcess(p)"
                  >{{ p.status === 'suspended' ? '恢复' : '挂起' }}</button>
                  <select
                    class="prio"
                    :value="'normal'"
                    :disabled="p.protected || busy === p.pid"
                    @change="setPriority(p, $event)"
                  >
                    <option value="">优先级</option>
                    <option v-for="l in priorityLevels" :key="l.value" :value="l.value">{{ l.label }}</option>
                  </select>
                </template>
              </div>
              <p v-if="feedback[p.pid]" class="fb" :class="{ bad: feedback[p.pid].startsWith('✗') || feedback[p.pid].includes('失败') || feedback[p.pid].includes('拒绝') }">
                {{ feedback[p.pid] }}
              </p>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!loading && list.length === 0 && !error" class="hint">暂无进程数据</p>
    </div>
  </section>
</template>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; max-width: 960px; }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.seg-btn { font-size: 13px; padding: 7px 14px; background: var(--bg-secondary); color: var(--text-secondary); border: none; cursor: pointer; transition: background 0.15s, color 0.15s; }
.seg-btn.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.btn { font-size: 13px; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; transition: background 0.15s, opacity 0.15s; }
.btn:hover:not(:disabled) { background: var(--accent-soft); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.mini { padding: 4px 10px; font-size: 12px; }
.btn.danger { border-color: #fecaca; color: #dc2626; }
.btn.danger:hover:not(:disabled) { background: #fef2f2; }
.table-wrap { max-width: 960px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-size: 12px; color: var(--text-tertiary); font-weight: 500; padding: 10px 14px; border-bottom: 1px solid var(--border); }
td { padding: 9px 14px; border-bottom: 1px solid var(--border); color: var(--text-primary); }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--bg-tertiary); }
.pname { font-weight: 600; }
.pname.prot { color: var(--text-tertiary); }
.badge { display: inline-block; margin-left: 6px; font-size: 10px; padding: 1px 6px; border-radius: 999px; background: var(--bg-tertiary); color: var(--text-tertiary); }
.num { font-variant-numeric: tabular-nums; color: var(--text-secondary); }
.st { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
.st-run { color: #16a34a; background: #f0fdf4; }
.st-sus { color: #d97706; background: #fffbeb; }
.ops { min-width: 230px; }
.row-ops { display: flex; align-items: center; gap: 6px; }
.row-ops.disabled { opacity: 0.55; }
.prio { font-size: 12px; padding: 4px 6px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); }
.fb { font-size: 11px; color: #16a34a; margin-top: 4px; }
.fb.bad { color: #dc2626; }
.error { color: #ef4444; font-size: 13px; margin-bottom: 10px; }
.hint { color: var(--text-tertiary); font-size: 13px; padding: 14px; }
</style>
