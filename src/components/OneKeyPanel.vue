<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useOneKey } from '../composables/useOneKey'
import type { OptOutcome } from '../../shared/types'

const {
  progress,
  summary,
  capabilities,
  selected,
  elevated,
  error,
  busy,
  running,
  finished,
  outcomes,
  failedIds,
  percent,
  loadCapabilities,
  refreshElevated,
  restore,
  start,
  cancel,
  retryFailed,
  toggle,
  selectAll,
  clearAll,
  formatSize,
  formatDuration
} = useOneKey()

const restartMsg = ref('')

async function restartElevated(): Promise<void> {
  restartMsg.value = ''
  try {
    const r = await window.gale.app.restartElevated()
    restartMsg.value = r.message
    if (r.ok) await refreshElevated()
  } catch (e) {
    restartMsg.value = e instanceof Error ? e.message : String(e)
  }
}

function statusText(o: OptOutcome): string {
  if (o.status === 'success') return '成功'
  if (o.status === 'failed') return '失败'
  return '跳过'
}

function detailText(o: OptOutcome): string {
  const parts: string[] = []
  parts.push(formatDuration(o.durationMs))
  if (o.releasedBytes && o.releasedBytes > 0) parts.push(`释放 ${formatSize(o.releasedBytes)}`)
  if (o.attempts && o.attempts > 1) parts.push(`重试 ${o.attempts - 1} 次`)
  return parts.join(' · ')
}

onMounted(async () => {
  await loadCapabilities()
  await refreshElevated()
  await restore()
})
onUnmounted(() => {
  /* 订阅为模块级单例，组件卸载不退订：切页面时仍需接收推送 */
})
</script>

<template>
  <section class="card onekey">
    <header class="head">
      <div>
        <h2 class="title">一键优化</h2>
        <p class="desc">按序执行下方全部勾选项，实时展示每项结果与释放空间；可随时停止，失败项支持重试。</p>
      </div>
      <span class="badge" :class="elevated ? 'ok' : 'warn'">
        {{ elevated ? '已获取管理员权限' : '未提权（高权限项将跳过）' }}
      </span>
    </header>

    <p v-if="!elevated" class="admin-tip">
      更新缓存、组件存储清理、系统文件修复需要管理员权限。
      <button class="link" @click="restartElevated">以管理员身份重启</button>
      <span v-if="restartMsg" class="restart-msg">— {{ restartMsg }}</span>
    </p>

    <ul class="caps">
      <li
        v-for="c in capabilities"
        :key="c.id"
        class="cap"
        :class="{ off: !selected.has(c.id) }"
      >
        <label class="cap-label">
          <input
            type="checkbox"
            :checked="selected.has(c.id)"
            :disabled="running"
            :aria-label="c.label"
            @change="toggle(c.id)"
          />
          <span class="cap-text">
            <span class="cap-name">
              {{ c.label }}
              <em v-if="c.needsAdmin" class="tag">需管理员</em>
            </span>
            <span class="cap-desc">{{ c.description }}</span>
          </span>
        </label>
      </li>
    </ul>
    <p v-if="capabilities.length === 0" class="empty">正在读取可优化项…</p>

    <div class="actions">
      <button class="btn primary" :disabled="running || busy" @click="start">
        {{ running ? '优化中…' : finished ? '重新优化' : '开始一键优化' }}
      </button>
      <button v-if="running" class="btn" @click="cancel">停止</button>
      <button
        v-if="!running && failedIds.length > 0"
        class="btn"
        @click="retryFailed"
      >重试失败项（{{ failedIds.length }}）</button>
      <button class="btn ghost" :disabled="running" @click="selectAll">全选</button>
      <button class="btn ghost" :disabled="running" @click="clearAll">全不选</button>
    </div>

    <p v-if="error" class="err">{{ error }}</p>

    <div v-if="progress" class="progress">
      <div class="bar"><span :style="{ width: percent + '%' }"></span></div>
      <div class="bar-meta">
        <span v-if="running && progress.currentLabel" class="current">
          正在执行：{{ progress.currentLabel }}
        </span>
        <span v-else-if="progress.phase === 'cancelled'" class="current">已停止</span>
        <span v-else-if="progress.phase === 'done'" class="current">已完成</span>
        <span v-else class="current">就绪</span>
        <span class="count">{{ progress.completed }} / {{ progress.total }}</span>
      </div>
    </div>

    <ul v-if="outcomes.length > 0" class="results">
      <li v-for="o in outcomes" :key="o.id" class="result" :class="o.status">
        <span class="dot" aria-hidden="true"></span>
        <span class="r-name">{{ o.label }}</span>
        <span class="r-status">{{ statusText(o) }}</span>
        <span class="r-detail">{{ detailText(o) }}</span>
        <span v-if="o.error || o.reason" class="r-msg">{{ o.error || o.reason }}</span>
      </li>
    </ul>

    <div v-if="summary" class="summary">
      <span>成功 <b class="s-ok">{{ summary.success }}</b></span>
      <span>失败 <b class="s-bad">{{ summary.failed }}</b></span>
      <span>跳过 <b class="s-skip">{{ summary.skipped }}</b></span>
      <span>共释放 <b class="s-size">{{ formatSize(summary.releasedBytes) }}</b></span>
      <span>耗时 {{ formatDuration(summary.durationMs) }}</span>
    </div>
  </section>
</template>

<style scoped>
.onekey { margin-bottom: 18px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.title { font-size: 15px; font-weight: 700; color: var(--text-primary); }
.desc { font-size: 12.5px; color: var(--text-tertiary); line-height: 1.6; margin-top: 4px; }
.badge {
  flex-shrink: 0;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  background: var(--bg-tertiary);
}
.badge.ok { color: #059669; border-color: rgba(5, 150, 105, 0.35); background: rgba(5, 150, 105, 0.1); }
.badge.warn { color: #d97706; border-color: rgba(217, 119, 6, 0.35); background: rgba(217, 119, 6, 0.1); }

.admin-tip {
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 12px;
  line-height: 1.6;
}
.link {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12.5px;
  font-family: inherit;
  text-decoration: underline;
  padding: 0 2px;
}
.restart-msg { color: var(--text-tertiary); margin-left: 4px; }

.caps {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 14px 0 12px;
}
.cap { border: 1px solid var(--border); border-radius: 10px; padding: 9px 11px; background: var(--bg-secondary); }
.cap.off { opacity: 0.55; }
.cap-label { display: flex; gap: 9px; align-items: flex-start; cursor: pointer; }
.cap-label input { margin-top: 2px; accent-color: var(--accent); flex-shrink: 0; }
.cap-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.cap-name { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.tag {
  font-style: normal;
  font-size: 11px;
  font-weight: 500;
  color: #d97706;
  border: 1px solid rgba(217, 119, 6, 0.35);
  border-radius: 4px;
  padding: 0 5px;
  margin-left: 6px;
}
.cap-desc { font-size: 11.5px; color: var(--text-tertiary); line-height: 1.5; }
.empty { font-size: 12.5px; color: var(--text-tertiary); margin-bottom: 12px; }

.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.err { margin-top: 10px; font-size: 12.5px; color: #ef4444; }

.progress { margin-top: 14px; }
.bar { height: 7px; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.3s ease; }
.bar-meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 7px; font-size: 12.5px; }
.current { color: var(--text-secondary); }
.count { color: var(--text-tertiary); flex-shrink: 0; }

.results { list-style: none; margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.result {
  display: grid;
  grid-template-columns: 8px minmax(120px, 1.4fr) 52px auto;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-secondary);
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-tertiary); }
.result.success .dot { background: #059669; }
.result.failed .dot { background: #ef4444; }
.result.skipped .dot { background: #d97706; }
.r-name { color: var(--text-primary); font-weight: 500; }
.r-status { font-size: 12px; color: var(--text-secondary); }
.result.success .r-status { color: #059669; }
.result.failed .r-status { color: #ef4444; }
.result.skipped .r-status { color: #d97706; }
.r-detail { font-size: 11.5px; color: var(--text-tertiary); text-align: right; }
.r-msg {
  grid-column: 2 / -1;
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.5;
  word-break: break-word;
}

.summary {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 12.5px;
  color: var(--text-secondary);
}
.summary b { font-weight: 700; }
.s-ok { color: #059669; }
.s-bad { color: #ef4444; }
.s-skip { color: #d97706; }
.s-size { color: var(--accent); }

@media (max-width: 720px) {
  .head { flex-direction: column; }
  .caps { grid-template-columns: 1fr; }
  .result { grid-template-columns: 8px 1fr 52px; }
  .r-detail { grid-column: 2 / -1; text-align: left; }
}
</style>
