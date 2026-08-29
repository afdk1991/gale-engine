<script setup lang="ts">
import { ref } from 'vue'
import type { ToolResult } from '../../shared/types'

const busy = ref<string | null>(null)
const error = ref<string | null>(null)
const results = ref<Record<string, ToolResult>>({})

const flushDns = () => window.gale.toolbox.flushDns()
const emptyRecycleBin = () => window.gale.toolbox.emptyRecycleBin()
const clearClipboard = () => window.gale.toolbox.clearClipboard()
const setDark = () => window.gale.toolbox.toggleDarkMode(true)
const setLight = () => window.gale.toolbox.toggleDarkMode(false)

async function run(key: string, fn: () => Promise<ToolResult>, label: string): Promise<void> {
  busy.value = key
  error.value = null
  try {
    const r = await fn()
    results.value = { ...results.value, [key]: r }
    if (r.ok) {
      await window.gale.history.add({ type: 'toolbox', label, detail: r.message })
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = null
  }
}

function feedback(key: string): string {
  const r = results.value[key]
  if (!r) return ''
  return r.ok ? `✓ ${r.message}` : `✗ ${r.message}`
}
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>工具箱</h1>
      <p>一组安全、幂等的系统小工具</p>
    </header>

    <p v-if="error" class="error">操作失败：{{ error }}</p>

    <div class="grid">
      <div class="card tool">
        <h2 class="card-title">刷新 DNS</h2>
        <p class="desc">清除本地 DNS 解析缓存（ipconfig /flushdns）</p>
        <button class="btn" :disabled="busy === 'dns'" @click="run('dns', flushDns, '刷新 DNS')">
          {{ busy === 'dns' ? '执行中…' : '刷新 DNS' }}
        </button>
        <p class="result" :class="{ bad: results.dns && !results.dns.ok }">{{ feedback('dns') }}</p>
      </div>

      <div class="card tool">
        <h2 class="card-title">清空回收站</h2>
        <p class="desc">永久删除回收站中的文件</p>
        <button class="btn" :disabled="busy === 'bin'" @click="run('bin', emptyRecycleBin, '清空回收站')">
          {{ busy === 'bin' ? '执行中…' : '清空回收站' }}
        </button>
        <p class="result" :class="{ bad: results.bin && !results.bin.ok }">{{ feedback('bin') }}</p>
      </div>

      <div class="card tool">
        <h2 class="card-title">清空剪贴板</h2>
        <p class="desc">清除当前剪贴板内容</p>
        <button class="btn" :disabled="busy === 'clip'" @click="run('clip', clearClipboard, '清空剪贴板')">
          {{ busy === 'clip' ? '执行中…' : '清空剪贴板' }}
        </button>
        <p class="result" :class="{ bad: results.clip && !results.clip.ok }">{{ feedback('clip') }}</p>
      </div>

      <div class="card tool">
        <h2 class="card-title">深色模式</h2>
        <p class="desc">切换 Windows 应用深色/浅色主题（注册表）</p>
        <div class="row">
          <button class="btn" :disabled="busy === 'dark'" @click="run('dark', setDark, '切换深色模式')">深色</button>
          <button class="btn" :disabled="busy === 'dark'" @click="run('light', setLight, '切换浅色模式')">浅色</button>
        </div>
        <p class="result" :class="{ bad: (results.dark && !results.dark.ok) || (results.light && !results.light.ok) }">
          {{ feedback('dark') || feedback('light') }}
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; max-width: 720px; }
.card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 18px; }
.card-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.desc { font-size: 12px; color: var(--text-tertiary); margin-bottom: 12px; min-height: 32px; }
.btn { font-size: 13px; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; transition: background 0.15s, opacity 0.15s; }
.btn:hover:not(:disabled) { background: var(--accent-soft); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.row { display: flex; gap: 8px; }
.result { font-size: 12px; color: var(--accent); margin-top: 10px; }
.result.bad { color: #ef4444; }
.error { color: #ef4444; font-size: 13px; }
</style>
