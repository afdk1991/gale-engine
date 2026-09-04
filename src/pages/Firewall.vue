<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { FirewallProfile, FirewallRule } from '../../shared/types'

const profiles = ref<FirewallProfile[]>([])
const rules = ref<FirewallRule[]>([])
const ruleFilter = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)
const feedback = ref<Record<string, string>>({})

const filteredRules = () => {
  const kw = ruleFilter.value.trim().toLowerCase()
  if (!kw) return rules.value
  return rules.value.filter(
    (r) => r.displayName.toLowerCase().includes(kw) || r.name.toLowerCase().includes(kw)
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
    const [p, r] = await Promise.all([window.gale.firewall.profiles(), window.gale.firewall.listRules()])
    profiles.value = p
    rules.value = r
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function toggleProfile(p: FirewallProfile): Promise<void> {
  busy.value = `profile:${p.name}`
  try {
    const r = await window.gale.firewall.setProfileEnabled(p.name, !p.enabled)
    flash(`profile:${p.name}`, r.message)
    if (r.ok) {
      await window.gale.history.add({
        type: 'toolbox',
        label: `${p.enabled ? '关闭' : '开启'}防火墙`,
        detail: p.name
      })
    }
    await refresh()
  } catch (e) {
    flash(`profile:${p.name}`, e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = null
  }
}

async function toggleRule(r: FirewallRule): Promise<void> {
  busy.value = r.name
  try {
    const res = await window.gale.firewall.toggleRule(r.name, !r.enabled)
    flash(r.name, res.message)
    if (res.ok) {
      await window.gale.history.add({
        type: 'toolbox',
        label: `${r.enabled ? '禁用' : '启用'}防火墙规则`,
        detail: r.displayName || r.name
      })
    }
    await refresh()
  } catch (e) {
    flash(r.name, e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = null
  }
}

onMounted(() => void refresh())
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>防火墙</h1>
      <p>Windows 防火墙配置文件开关与规则管理（修改需要管理员权限）</p>
    </header>

    <p v-if="error" class="error">防火墙信息获取失败：{{ error }}</p>

    <div class="profile-grid">
      <div v-for="p in profiles" :key="p.name" class="card">
        <div class="card-head">
          <h2 class="card-title">{{ p.name }}</h2>
          <button
            class="btn mini"
            :class="{ 'btn-off': p.enabled }"
            :disabled="busy === `profile:${p.name}`"
            @click="void toggleProfile(p)"
          >{{ p.enabled ? '开启中' : '已关闭' }}</button>
        </div>
        <p class="card-desc">
          入站默认 {{ p.inbound }} · 出站默认 {{ p.outbound }}
        </p>
        <p v-if="feedback[`profile:${p.name}`]" class="fb" :class="{ bad: !p.enabled === feedback[`profile:${p.name}`].includes('拒绝') }">
          {{ feedback[`profile:${p.name}`] }}
        </p>
      </div>
    </div>

    <div class="rules-head">
      <h2 class="rules-title">规则（前 200 条）</h2>
      <input v-model="ruleFilter" class="input" placeholder="按规则名筛选…" />
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>规则</th>
            <th>方向</th>
            <th>动作</th>
            <th>状态</th>
            <th class="ops">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filteredRules()" :key="r.name">
            <td><span class="rname">{{ r.displayName || r.name }}</span></td>
            <td class="num">{{ r.direction === 'Inbound' ? '入站' : '出站' }}</td>
            <td class="num">
              <span :class="r.action === 'Allow' ? 'act-allow' : 'act-block'">{{ r.action === 'Allow' ? '允许' : '阻止' }}</span>
            </td>
            <td>
              <span class="st" :class="r.enabled ? 'st-ok' : 'st-off'">{{ r.enabled ? '启用' : '禁用' }}</span>
            </td>
            <td class="ops">
              <button class="btn mini" :disabled="busy === r.name" @click="void toggleRule(r)">
                {{ r.enabled ? '禁用' : '启用' }}
              </button>
              <p v-if="feedback[r.name]" class="fb">{{ feedback[r.name] }}</p>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!loading && filteredRules().length === 0 && !error" class="hint">没有匹配的规则</p>
    </div>
  </section>
</template>

<style scoped>
.profile-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; max-width: 960px; margin-bottom: 18px; }
.card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.card-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0; }
.card-desc { font-size: 12px; color: var(--text-tertiary); margin: 8px 0 0; }
.btn { font-size: 13px; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; transition: background 0.15s, opacity 0.15s; }
.btn:hover:not(:disabled) { background: var(--accent-soft); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.mini { padding: 4px 10px; font-size: 12px; }
.btn-off { color: #dc2626; border-color: #fecaca; }
.rules-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 960px; margin-bottom: 10px; }
.rules-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); margin: 0; }
.input { font-size: 13px; padding: 7px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-tertiary); color: var(--text-primary); width: 240px; }
.table-wrap { max-width: 960px; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; font-size: 12px; color: var(--text-tertiary); font-weight: 500; padding: 10px 14px; border-bottom: 1px solid var(--border); }
td { padding: 8px 14px; border-bottom: 1px solid var(--border); color: var(--text-primary); }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--bg-tertiary); }
.rname { font-weight: 500; }
.num { color: var(--text-secondary); white-space: nowrap; }
.act-allow { color: #16a34a; }
.act-block { color: #dc2626; }
.st { font-size: 12px; padding: 2px 8px; border-radius: 999px; }
.st-ok { color: #16a34a; background: #f0fdf4; }
.st-off { color: #6b7280; background: #f3f4f6; }
.ops { min-width: 90px; }
.fb { font-size: 11px; color: #16a34a; margin-top: 4px; }
.fb.bad { color: #dc2626; }
.error { color: #ef4444; font-size: 13px; margin-bottom: 10px; }
.hint { color: var(--text-tertiary); font-size: 13px; padding: 14px; }
@media (max-width: 640px) {
  .profile-grid { grid-template-columns: 1fr; }
  .rules-head { flex-direction: column; align-items: stretch; }
  .input { width: 100%; }
  .table-wrap { overflow-x: auto; }
  table { min-width: 560px; }
}
</style>
