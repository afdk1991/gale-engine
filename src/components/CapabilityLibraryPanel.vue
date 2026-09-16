<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { CapabilityLibraryState } from '../../shared/types'

// 能力库 = 本项目的「DLL」热更新通道。
// 界面必须如实展示三件事：当前生效来源与版本、可更新版本、被拒条目及原因。
const state = ref<CapabilityLibraryState | null>(null)
const busy = ref(false)
const message = ref<string | null>(null)

const sourceLabel = computed(() =>
  state.value?.source === 'remote' ? '远端清单' : '内置（随主程序）'
)

const remoteCaps = computed(
  () => state.value?.capabilities.filter((c) => c.source === 'remote') ?? []
)

const overriddenIds = computed(() => {
  const s = state.value
  if (!s || s.source !== 'remote') return []
  // remoteIds 里出现的内置 id = 被远端覆盖了元信息（实现仍是内置的）
  const remoteOnly = new Set(remoteCaps.value.map((c) => c.id))
  return s.remoteIds.filter((id) => !remoteOnly.has(id))
})

async function refresh(): Promise<void> {
  try {
    state.value = await window.gale.optlib.libraryState()
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

async function check(): Promise<void> {
  busy.value = true
  message.value = null
  try {
    const next = await window.gale.optlib.checkLibrary()
    state.value = next
    if (next.lastError) message.value = `检查失败：${next.lastError}`
    else if (next.updateAvailable) message.value = `发现能力库新版本 v${next.availableVersion}`
    else message.value = '能力库已是最新'
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function apply(): Promise<void> {
  busy.value = true
  message.value = null
  try {
    state.value = await window.gale.optlib.applyLibrary()
    message.value = '能力库已生效（无需重启应用，一键优化中即可选用新能力）'
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function reset(): Promise<void> {
  busy.value = true
  message.value = null
  try {
    state.value = await window.gale.optlib.resetLibrary()
    message.value = '已回退到内置能力库'
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <div class="card block">
    <div class="block-head">
      <h2 class="card-title">能力库（可独立更新）</h2>
      <span class="tag" :data-source="state?.source ?? 'builtin'">{{ sourceLabel }}</span>
    </div>

    <p class="muted">
      能力库把每项优化能力封装为独立单元，可从远端清单更新——
      <strong>新增或调整一项能力无需重新发版应用</strong>。远端只能编排既有能力，无法下发可执行代码。
    </p>

    <dl class="meta">
      <div><dt>当前版本</dt><dd>v{{ state?.libraryVersion ?? '—' }}</dd></div>
      <div><dt>可用能力</dt><dd>{{ state?.capabilities.length ?? 0 }} 项（远端 {{ remoteCaps.length }} 项）</dd></div>
      <div v-if="state?.checkedAt"><dt>上次检查</dt><dd>{{ new Date(state.checkedAt).toLocaleString() }}</dd></div>
    </dl>

    <div class="row">
      <button class="btn" :disabled="busy" @click="check">{{ busy ? '处理中…' : '检查能力库更新' }}</button>
      <button v-if="state?.updateAvailable" class="btn primary" :disabled="busy" @click="apply">
        应用到 v{{ state.availableVersion }}
      </button>
      <button v-if="state?.source === 'remote'" class="btn" :disabled="busy" @click="reset">
        回退到内置
      </button>
    </div>

    <p v-if="message" class="msg">{{ message }}</p>
    <p v-if="state?.lastError" class="msg bad">清单错误：{{ state.lastError }}</p>

    <!-- 被拒条目必须显式列出：清单作者需要知道哪一条没生效、为什么 -->
    <div v-if="state?.rejected.length" class="rejected">
      <h3>被拒条目（{{ state.rejected.length }}）</h3>
      <ul>
        <li v-for="r in state.rejected" :key="r.id"><code>{{ r.id }}</code>{{ r.reason }}</li>
      </ul>
    </div>

    <div v-if="remoteCaps.length" class="remote">
      <h3>远端下发的能力</h3>
      <ul>
        <li v-for="c in remoteCaps" :key="c.id">
          <span class="cap-label">{{ c.label }}</span>
          <span v-if="c.needsAdmin" class="cap-admin">需管理员</span>
          <span class="cap-desc">{{ c.description }}</span>
        </li>
      </ul>
    </div>

    <div v-if="overriddenIds.length" class="overridden">
      <h3>元信息被远端覆盖的内置能力</h3>
      <p class="muted">{{ overriddenIds.join('、') }}（仅文案与默认勾选被覆盖，实现仍为内置）</p>
    </div>
  </div>
</template>

<style scoped>
.block { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 18px; margin-bottom: 16px; }
.block-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; }
.card-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--bg-tertiary); color: var(--text-secondary); }
.tag[data-source='remote'] { background: var(--accent-soft); color: var(--accent); }
.muted { color: var(--text-tertiary); font-size: 12px; line-height: 1.65; margin: 0 0 10px; }

.meta { display: flex; flex-wrap: wrap; gap: 18px; margin: 0 0 12px; }
.meta div { display: flex; flex-direction: column; gap: 2px; }
.meta dt { font-size: 11px; color: var(--text-tertiary); }
.meta dd { margin: 0; font-size: 13px; color: var(--text-primary); font-weight: 600; }

.row { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0 8px; }
.msg { font-size: 12.5px; color: var(--text-secondary); }
.msg.bad { color: #ef4444; }

.rejected, .remote, .overridden { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
.rejected h3, .remote h3, .overridden h3 { font-size: 12px; color: var(--text-secondary); margin: 0 0 8px; font-weight: 600; }
.rejected ul, .remote ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.rejected li { font-size: 12px; color: var(--text-tertiary); }
.rejected code { margin-right: 8px; padding: 1px 6px; border-radius: 4px; background: var(--bg-tertiary); color: var(--text-primary); font-size: 11.5px; }
.remote li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; padding: 7px 10px; border-radius: 8px; background: var(--bg-tertiary); }
.cap-label { color: var(--text-primary); font-weight: 600; }
.cap-admin { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: #fef3c7; color: #b45309; }
.cap-desc { color: var(--text-tertiary); }

.btn { font-size: 13px; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; transition: background 0.15s, opacity 0.15s; }
.btn:hover:not(:disabled) { background: var(--accent-soft); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.primary { background: var(--accent); color: #fff; border-color: transparent; }
.btn.primary:hover:not(:disabled) { opacity: 0.9; }

@media (max-width: 640px) {
  .block { padding: 14px; }
}
</style>
