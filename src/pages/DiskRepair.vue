<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { DiskVolume, DeepCleanupPlan, CleanupResult, DiskRepairResult, SystemRepairKind } from '../../shared/types'

// Electron 渲染层可通过 navigator.platform 判断宿主系统
const isWindows = /win/i.test(navigator.platform)

// ── 磁盘空间总览 ────────────────────────────────────────────
const volumes = ref<DiskVolume[]>([])
const volumesLoading = ref(false)
const lowVolumes = computed(() => volumes.value.filter((v) => v.lowSpace))

// ── 深度空间释放 ────────────────────────────────────────────
const deepPlans = ref<DeepCleanupPlan[]>([])
const selectedDeep = ref<Set<string>>(new Set())
const deepLoading = ref(false)
const deepRunning = ref(false)
const deepResult = ref<string | null>(null)
const selectedBytes = computed(() =>
  deepPlans.value
    .filter((p) => selectedDeep.value.has(p.id) && p.kind === 'path')
    .reduce((sum, p) => sum + p.sizeBytes, 0)
)

// ── 磁盘检查 / 修复 ─────────────────────────────────────────
const selectedMount = ref('')
const checkRunning = ref<boolean | 'check' | 'fix'>(false)
const checkResult = ref<DiskRepairResult | null>(null)

// ── 系统文件 / DLL 修复 ─────────────────────────────────────
const sysRunning = ref<SystemRepairKind | null>(null)
const sysResult = ref<DiskRepairResult | null>(null)

const error = ref<string | null>(null)

function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / 1024 ** 2
  return `${mb.toFixed(1)} MB`
}

function pctColor(percent: number, low: boolean): string {
  if (low) return '#ef4444'
  if (percent >= 75) return '#f59e0b'
  return 'var(--accent)'
}

async function loadVolumes(): Promise<void> {
  volumesLoading.value = true
  error.value = null
  try {
    volumes.value = await window.gale.disk.volumes()
    if (!selectedMount.value && volumes.value.length > 0) {
      selectedMount.value = volumes.value[0].mount
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    volumesLoading.value = false
  }
}

function toggleDeep(id: string): void {
  const next = new Set(selectedDeep.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedDeep.value = next
}

async function scanDeep(): Promise<void> {
  deepLoading.value = true
  error.value = null
  try {
    deepPlans.value = await window.gale.disk.scanDeepCleanup()
    selectedDeep.value = new Set(deepPlans.value.filter((p) => p.safe && p.defaultChecked).map((p) => p.id))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    deepLoading.value = false
  }
}

async function runDeep(): Promise<void> {
  if (selectedDeep.value.size === 0) return
  deepRunning.value = true
  deepResult.value = null
  try {
    // 只传 id：路径与类型由服务端权威清单解析（原先传的 p.detail 是展示文案，语义不符）
    const ids = [...selectedDeep.value]
    const results: CleanupResult[] = await window.gale.disk.runDeepCleanup(ids)
    const okCount = results.filter((r) => r.ok).length
    const fail = results.filter((r) => !r.ok)
    deepResult.value =
      `已完成 ${okCount}/${results.length} 项` +
      (fail.length ? `；失败 ${fail.length} 项（可能需要管理员权限）` : '')
    await window.gale.history.add({
      type: 'cleanup',
      label: `磁盘深度释放 ${okCount} 项`,
      detail: ids.join('、')
    })
    await Promise.all([loadVolumes(), scanDeep()])
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    deepRunning.value = false
  }
}

async function checkVolume(fix: boolean): Promise<void> {
  if (!selectedMount.value || checkRunning.value) return
  checkRunning.value = fix ? 'fix' : 'check'
  checkResult.value = null
  error.value = null
  try {
    const res = await window.gale.disk.checkVolume(selectedMount.value, fix)
    checkResult.value = res
    await window.gale.history.add({
      type: 'toolbox',
      label: `${fix ? '在线修复' : '检查'}卷 ${selectedMount.value}`,
      detail: res.summary
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    checkRunning.value = false
  }
}

async function repairSys(kind: SystemRepairKind): Promise<void> {
  if (sysRunning.value) return
  sysRunning.value = kind
  sysResult.value = null
  error.value = null
  try {
    sysResult.value = await window.gale.disk.repairSystemFiles(kind)
    await window.gale.history.add({
      type: 'toolbox',
      label: kind === 'sfc' ? 'SFC 系统文件修复' : 'DISM 组件存储修复',
      detail: sysResult.value.summary
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    sysRunning.value = null
  }
}

onMounted(() => {
  void loadVolumes()
  void scanDeep()
})
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>磁盘修复</h1>
      <p>查看磁盘空间、深度释放占用、检查并修复文件系统与系统文件（DLL）错误</p>
    </header>

    <p v-if="error" class="error">操作失败：{{ error }}</p>

    <!-- 空间不足告警 -->
    <div v-if="lowVolumes.length > 0" class="alert">
      <strong>空间不足：</strong>
      {{ lowVolumes.map((v) => `${v.mount} 仅剩 ${fmtSize(v.freeBytes)}`).join('，') }}，建议在下方深度释放空间。
    </div>

    <!-- ① 空间总览 -->
    <div class="card block">
      <div class="block-head">
        <h2 class="card-title">磁盘空间总览</h2>
        <button class="btn small" :disabled="volumesLoading" @click="loadVolumes">
          {{ volumesLoading ? '刷新中…' : '刷新' }}
        </button>
      </div>
      <p v-if="volumes.length === 0 && !volumesLoading" class="muted">未检测到磁盘卷。</p>
      <div class="vol-grid">
        <div v-for="v in volumes" :key="v.mount" class="vol" :class="{ low: v.lowSpace }">
          <div class="vol-top">
            <span class="vol-mount">{{ v.mount }} <small>{{ v.fsType }}</small></span>
            <span class="vol-free" :class="{ low: v.lowSpace }">剩余 {{ fmtSize(v.freeBytes) }}</span>
          </div>
          <div class="bar">
            <div
              class="bar-fill"
              :style="{ width: `${v.percent}%`, background: pctColor(v.percent, v.lowSpace) }"
            ></div>
          </div>
          <div class="vol-meta">
            已用 {{ fmtSize(v.usedBytes) }} / {{ fmtSize(v.sizeBytes) }}（{{ v.percent.toFixed(1) }}%）
          </div>
        </div>
      </div>
    </div>

    <!-- ② 深度空间释放 -->
    <div class="card block">
      <div class="block-head">
        <h2 class="card-title">硬盘空间深度释放</h2>
        <button class="btn small" :disabled="deepLoading" @click="scanDeep">
          {{ deepLoading ? '扫描中…' : '重新扫描' }}
        </button>
      </div>
      <p class="muted tip">
        下列项目均为系统可自动重建的缓存，安全可清理；标注「需管理员」的项目在普通权限下可能失败。
      </p>
      <p v-if="deepPlans.length === 0 && !deepLoading" class="muted">暂无可释放项，点击「重新扫描」。</p>
      <ul v-else class="plan-list">
        <li v-for="p in deepPlans" :key="p.id" class="plan">
          <label class="plan-row">
            <input type="checkbox" :checked="selectedDeep.has(p.id)" @change="toggleDeep(p.id)" />
            <span class="plan-main">
              <span class="plan-label">{{ p.label }}</span>
              <span class="plan-detail">{{ p.detail }}</span>
            </span>
            <span v-if="p.needsAdmin" class="badge-admin">需管理员</span>
            <span class="plan-size">{{ p.kind === 'action' ? '执行后释放' : fmtSize(p.sizeBytes) }}</span>
          </label>
        </li>
      </ul>
      <div class="actions">
        <button class="btn primary" :disabled="deepRunning || selectedDeep.size === 0" @click="runDeep">
          {{ deepRunning ? '清理中，请稍候…' : `立即释放（${selectedDeep.size} 项${selectedBytes ? '，约 ' + fmtSize(selectedBytes) : ''}）` }}
        </button>
        <span v-if="deepResult" class="result">{{ deepResult }}</span>
      </div>
    </div>

    <!-- ③ 硬盘错误检查与修复 -->
    <div class="card block">
      <div class="block-head">
        <h2 class="card-title">硬盘错误检查与修复</h2>
      </div>
      <p class="muted tip">
        Windows 使用 chkdsk：检查为只读；在线修复走 NTFS 在线扫描（/scan），无需重启、不锁定磁盘。
        物理坏道级深度修复（/r）需重启离线执行，本应用不自动安排重启。macOS 使用 diskutil。
      </p>
      <div class="actions">
        <select v-model="selectedMount" class="select">
          <option v-for="v in volumes" :key="v.mount" :value="v.mount">{{ v.mount }}（{{ v.fsType }}）</option>
        </select>
        <button class="btn" :disabled="checkRunning !== false" @click="checkVolume(false)">
          {{ checkRunning === 'check' ? '检查中…' : '检查错误（只读）' }}
        </button>
        <button class="btn primary" :disabled="checkRunning !== false" @click="checkVolume(true)">
          {{ checkRunning === 'fix' ? '在线修复中…' : '在线扫描修复' }}
        </button>
      </div>
      <div v-if="checkResult" class="result-box" :class="{ bad: !checkResult.ok && !checkResult.unsupported }">
        <div class="result-summary">
          <span class="dot" :class="checkResult.ok ? 'ok' : checkResult.unsupported ? 'warn' : 'no'"></span>
          {{ checkResult.summary }}
        </div>
        <pre v-if="checkResult.output" class="console">{{ checkResult.output }}</pre>
      </div>
    </div>

    <!-- ④ DLL / 系统文件修复（仅 Windows） -->
    <div class="card block">
      <div class="block-head">
        <h2 class="card-title">DLL / 系统文件修复</h2>
      </div>
      <template v-if="isWindows">
        <p class="muted tip">
          当出现「找不到 xxx.dll」「系统文件损坏」等问题时使用。SFC 会扫描并还原受保护的系统文件（含 DLL）；
          若 SFC 无法修复，先运行 DISM 修复组件存储，再重新运行 SFC。两者均需<strong>管理员权限</strong>，耗时数分钟。
        </p>
        <div class="actions">
          <button class="btn primary" :disabled="sysRunning !== null" @click="repairSys('sfc')">
            {{ sysRunning === 'sfc' ? 'SFC 扫描修复中…' : 'SFC 扫描并修复系统文件' }}
          </button>
          <button class="btn" :disabled="sysRunning !== null" @click="repairSys('dism-restore')">
            {{ sysRunning === 'dism-restore' ? 'DISM 修复中…' : 'DISM 修复组件存储（RestoreHealth）' }}
          </button>
        </div>
      </template>
      <p v-else class="muted tip">系统文件 / DLL 修复（SFC、DISM）为 Windows 专属能力，当前系统不适用。</p>
      <div v-if="sysResult" class="result-box" :class="{ bad: !sysResult.ok && !sysResult.unsupported }">
        <div class="result-summary">
          <span class="dot" :class="sysResult.ok ? 'ok' : sysResult.unsupported ? 'warn' : 'no'"></span>
          {{ sysResult.summary }}
        </div>
        <pre v-if="sysResult.output" class="console">{{ sysResult.output }}</pre>
      </div>
    </div>
  </section>
</template>

<style scoped>
.block { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 18px; margin-bottom: 16px; }
.block-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.card-title { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.muted { color: var(--text-tertiary); font-size: 12px; }
.tip { margin-bottom: 12px; line-height: 1.6; }
.error { color: #ef4444; font-size: 13px; margin-bottom: 10px; }

.alert { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; font-size: 13px;
  padding: 10px 14px; border-radius: 10px; margin-bottom: 16px; line-height: 1.5; }

/* 卷空间 */
.vol-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.vol { background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.vol.low { border-color: #fca5a5; }
.vol-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; gap: 8px; }
.vol-mount { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.vol-mount small { font-weight: 400; color: var(--text-tertiary); font-size: 11px; }
.vol-free { font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
.vol-free.low { color: #ef4444; font-weight: 600; }
.bar { height: 8px; border-radius: 999px; background: var(--bg-secondary); overflow: hidden; margin-bottom: 6px; }
.bar-fill { height: 100%; border-radius: 999px; transition: width 0.3s; }
.vol-meta { font-size: 11px; color: var(--text-tertiary); }

/* 清理清单 */
.plan-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.plan-row { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px; background: var(--bg-tertiary); cursor: pointer; }
.plan-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.plan-label { font-size: 13px; color: var(--text-primary); }
.plan-detail { font-size: 11px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge-admin { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #fef3c7; color: #b45309; flex-shrink: 0; }
.plan-size { font-size: 12px; color: var(--text-secondary); flex-shrink: 0; min-width: 64px; text-align: right; }

.actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.result { font-size: 12px; color: var(--text-secondary); }
.select { font-size: 13px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--bg-tertiary); color: var(--text-primary); font-family: inherit; }

.btn { font-size: 13px; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--bg-tertiary); color: var(--text-primary); cursor: pointer; transition: background 0.15s, opacity 0.15s; font-family: inherit; }
.btn:hover:not(:disabled) { background: var(--accent-soft); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.primary { background: var(--accent); color: #fff; border-color: transparent; }
.btn.small { padding: 5px 12px; font-size: 12px; }

/* 结果输出 */
.result-box { margin-top: 12px; border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: var(--bg-tertiary); }
.result-box.bad { border-color: #fca5a5; }
.result-summary { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-primary); margin-bottom: 6px; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.dot.ok { background: #22c55e; }
.dot.no { background: #ef4444; }
.dot.warn { background: #f59e0b; }
.console { margin: 0; max-height: 240px; overflow: auto; font-family: 'Cascadia Code', 'Consolas', monospace;
  font-size: 11.5px; line-height: 1.5; color: var(--text-secondary); white-space: pre-wrap; word-break: break-word; }

@media (max-width: 640px) {
  .block { padding: 14px; }
  .actions { flex-direction: column; align-items: stretch; }
  .btn, .select { width: 100%; }
  .plan-row { flex-wrap: wrap; }
}
</style>
