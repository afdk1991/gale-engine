<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CleanupPlan, CleanupResult, StartupItem } from '../../shared/types'

const plans = ref<CleanupPlan[]>([])
const selected = ref<Set<string>>(new Set())
const startupItems = ref<StartupItem[]>([])

const scanLoading = ref(false)
const runLoading = ref(false)
const startupLoading = ref(false)
const error = ref<string | null>(null)
const lastResult = ref<string | null>(null)

function fmtSize(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function kindLabel(kind: CleanupPlan['kind']): string {
  return kind === 'recycle' ? '回收站' : kind === 'browser' ? '浏览器' : '临时文件'
}

function toggleSelect(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

async function scan(): Promise<void> {
  scanLoading.value = true
  error.value = null
  try {
    const list = await window.gale.optimizer.scanCleanup()
    plans.value = list
    selected.value = new Set(list.filter((p) => p.safe).map((p) => p.id))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    scanLoading.value = false
  }
}

async function runCleanup(): Promise<void> {
  if (selected.value.size === 0) return
  runLoading.value = true
  lastResult.value = null
  try {
    const items = plans.value
      .filter((p) => selected.value.has(p.id))
      .map((p) => ({ id: p.id, path: p.path, kind: p.kind }))
    const results: CleanupResult[] = await window.gale.optimizer.runCleanup(items)
    const okCount = results.filter((r) => r.ok).length
    const failNames = results
      .filter((r) => !r.ok)
      .map((r) => plans.value.find((p) => p.id === r.id)?.label ?? r.id)
    lastResult.value =
      `已清理 ${okCount}/${results.length} 项` +
      (failNames.length ? `；跳过：${failNames.join('、')}` : '')
    await window.gale.history.add({
      type: 'cleanup',
      label: `清理 ${okCount} 项垃圾`,
      detail: items.map((i) => i.kind).join('、')
    })
    await scan()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    runLoading.value = false
  }
}

async function refreshStartup(): Promise<void> {
  startupLoading.value = true
  error.value = null
  try {
    startupItems.value = await window.gale.optimizer.listStartup()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    startupLoading.value = false
  }
}

async function toggleStartup(item: StartupItem): Promise<void> {
  try {
    const next = await window.gale.optimizer.toggleStartup(
      item.id,
      !item.enabled,
      item.enabled ? undefined : item.command
    )
    startupItems.value = next
    await window.gale.history.add({
      type: 'startup',
      label: `${!item.enabled ? '启用' : '禁用'}启动项：${item.name}`,
      detail: item.command
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

onMounted(() => {
  void scan()
  void refreshStartup()
})
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>优化中心</h1>
      <p>扫描并清理系统垃圾，管理开机启动项</p>
    </header>

    <p v-if="error" class="error">操作失败：{{ error }}</p>

    <div class="card block">
      <div class="block-head">
        <h2 class="card-title">垃圾清理</h2>
        <button class="btn" :disabled="scanLoading" @click="scan">
          {{ scanLoading ? '扫描中…' : '重新扫描' }}
        </button>
      </div>

      <p v-if="plans.length === 0 && !scanLoading" class="muted">暂无垃圾项，点击「重新扫描」。</p>

      <ul v-else class="plan-list">
        <li v-for="p in plans" :key="p.id" class="plan" :class="{ disabled: !p.safe }">
          <label class="plan-row">
            <input
              type="checkbox"
              :checked="selected.has(p.id)"
              :disabled="!p.safe"
              @change="toggleSelect(p.id)"
            />
            <span class="plan-kind" :data-kind="p.kind">{{ kindLabel(p.kind) }}</span>
            <span class="plan-label">{{ p.label }}</span>
            <span class="plan-size">{{ fmtSize(p.sizeBytes) }}</span>
            <span v-if="!p.safe" class="badge-unsafe">非安全</span>
          </label>
        </li>
      </ul>

      <div class="actions">
        <button class="btn primary" :disabled="runLoading || selected.size === 0" @click="runCleanup">
          {{ runLoading ? '清理中…' : `清理选中项（${selected.size}）` }}
        </button>
        <span v-if="lastResult" class="result">{{ lastResult }}</span>
      </div>
    </div>

    <div class="card block">
      <div class="block-head">
        <h2 class="card-title">启动项管理</h2>
        <button class="btn" :disabled="startupLoading" @click="refreshStartup">
          {{ startupLoading ? '刷新中…' : '刷新' }}
        </button>
      </div>

      <p v-if="startupItems.length === 0 && !startupLoading" class="muted">无开机启动项。</p>

      <ul v-else class="startup-list">
        <li v-for="item in startupItems" :key="item.id" class="startup">
          <div class="startup-info">
            <span class="startup-name">{{ item.name }}</span>
            <span class="startup-loc" :data-loc="item.location">{{ item.location }}</span>
            <span class="startup-cmd">{{ item.command }}</span>
          </div>
          <button
            class="btn small"
            :class="item.enabled ? 'danger' : 'primary'"
            @click="toggleStartup(item)"
          >
            {{ item.enabled ? '禁用' : '启用' }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.block { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 18px; margin-bottom: 16px; }
.block-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.card-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.muted { color: var(--text-tertiary); font-size: 12px; }
.error { color: #ef4444; font-size: 13px; margin-bottom: 10px; }

.plan-list, .startup-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.plan-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; background: var(--bg-tertiary); cursor: pointer; }
.plan.disabled .plan-row { opacity: 0.6; cursor: not-allowed; }
.plan-kind { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); flex-shrink: 0; }
.plan-kind[data-kind='recycle'] { background: #fef3c7; color: #b45309; }
.plan-kind[data-kind='browser'] { background: #e0e7ff; color: #4338ca; }
.plan-label { flex: 1; font-size: 13px; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-size { font-size: 12px; color: var(--text-secondary); flex-shrink: 0; }
.badge-unsafe { font-size: 11px; color: #b91c1c; background: #fee2e2; padding: 2px 8px; border-radius: 999px; flex-shrink: 0; }

.startup { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 8px; background: var(--bg-tertiary); }
.startup-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.startup-name { font-size: 13px; color: var(--text-primary); font-weight: 600; }
.startup-loc { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--bg-secondary); color: var(--text-secondary); align-self: flex-start; }
.startup-cmd { font-size: 11px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.result { font-size: 12px; color: var(--text-secondary); }

.btn { font-size: 13px; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; transition: background 0.15s, opacity 0.15s; }
.btn:hover:not(:disabled) { background: var(--accent-soft); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.primary { background: var(--accent); color: #fff; border-color: transparent; }
.btn.primary:hover:not(:disabled) { opacity: 0.9; }
.btn.danger { background: #ef4444; color: #fff; border-color: transparent; }
.btn.small { padding: 5px 12px; font-size: 12px; flex-shrink: 0; }

@media (max-width: 640px) {
  .block { padding: 14px; }
  .plan-row { flex-wrap: wrap; gap: 6px; }
  .plan-size { order: 3; width: 100%; }
  .startup { flex-wrap: wrap; gap: 8px; }
  .actions { flex-direction: column; }
}
</style>
