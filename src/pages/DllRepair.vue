<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  DllCategory,
  DllRepairAdvice,
  DllRepairKind,
  DllRepairResult,
  DllScanItem,
  DllScanResult
} from '../../shared/types'

// ─────────────────────────────────────────────────────────────
// DLL（动态链接库）缺失检测与修复页
//
// DLL = Dynamic Link Library：Windows 的代码共享机制（.dll）。
// 多个程序共用同一份实现——省内存、可模块化升级；
// 代价是公共 DLL 一旦缺失会同时打挂一批程序。
// 本页：扫描 → 定位 → 给出可执行修复，并把「为什么缺」讲清楚。
// ─────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<DllCategory, string> = {
  system: '系统 API',
  runtime: 'VC++ 运行库',
  crt: '通用 C 运行时',
  graphics: '图形/输入',
  media: '媒体',
  legacy: '旧组件'
}

const scanResult = ref<DllScanResult | null>(null)
const scanning = ref(false)
const advice = ref<DllRepairAdvice[]>([])
const repairRunning = ref<DllRepairKind | null>(null)
const repairResult = ref<DllRepairResult | null>(null)
const error = ref<string | null>(null)
const showAll = ref(false)

const problems = computed<DllScanItem[]>(
  () => scanResult.value?.items.filter((i) => !i.present || i.partial) ?? []
)
const missingCount = computed(() => scanResult.value?.missing.length ?? 0)
const partialCount = computed(() => scanResult.value?.partial.length ?? 0)
const isWin = computed(() => scanResult.value?.platform === 'win32')
const vcText = computed(() => {
  const vc = scanResult.value?.vcRedist
  if (!vc || (!vc.x64 && !vc.x86)) return '未检出'
  return `x64 ${vc.x64 || '—'} / x86 ${vc.x86 || '—'}`
})

/** 无问题时展示的检查项数量（默认折叠，避免一眼看到 60+ 行） */
const healthyItems = computed(() => scanResult.value?.items.filter((i) => i.present && !i.partial) ?? [])

async function runScan(): Promise<void> {
  scanning.value = true
  error.value = null
  repairResult.value = null
  try {
    scanResult.value = await window.gale.dll.scan()
    advice.value = await window.gale.dll.advice()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    scanning.value = false
  }
}

async function runRepair(kind: DllRepairKind): Promise<void> {
  repairRunning.value = kind
  error.value = null
  try {
    repairResult.value = await window.gale.dll.repair(kind)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    repairRunning.value = null
  }
}

/** 修复结束后自动复扫，让用户直接看到结果变化 */
async function runRepairAndRescan(kind: DllRepairKind): Promise<void> {
  await runRepair(kind)
  if (repairResult.value?.ok) await runScan()
}

function openExternal(url: string): void {
  void window.gale.app.openExternal(url)
}
</script>

<template>
  <section class="page">
    <header class="page-header">
      <h1>DLL 修复</h1>
      <p>检测缺失的动态链接库（DLL / 运行库），给出可执行的修复方案</p>
    </header>

    <!-- ── 什么是 DLL（知识区：让用户理解报错从哪来）── -->
    <div class="card">
      <h2 class="card-title">什么是 DLL（动态链接库）</h2>
      <p class="prose">
        DLL（Dynamic Link Library，动态链接库）是 Windows 实现<strong>代码共享</strong>的机制，
        文件扩展名为 <code>.dll</code>。它带来的三个核心作用是：
      </p>
      <ul class="prose-list">
        <li><strong>代码复用</strong>：多个程序可同时调用同一个 DLL 中的函数，无需各自内置一份相同代码</li>
        <li><strong>模块化</strong>：功能拆成独立模块便于更新维护——替换某个 DLL 即可修复或升级该功能，无需重新编译整个程序</li>
        <li><strong>节省资源</strong>：DLL 在内存中只需加载一次，可被多个进程共享</li>
      </ul>
      <table class="grid">
        <thead>
          <tr><th>常见使用场景</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr><td>系统 API</td><td>kernel32.dll、user32.dll 等封装了 Windows 核心功能</td></tr>
          <tr><td>运行库</td><td>VC++ Redistributable（msvcp140.dll 等）</td></tr>
          <tr><td>硬件驱动</td><td>显卡、打印机等设备的驱动模块</td></tr>
          <tr><td>插件扩展</td><td>各类软件的插件以 DLL 形式加载</td></tr>
        </tbody>
      </table>
      <p class="hint">
        正因为 DLL 被大量程序共用，<strong>缺少一个公共 DLL 会同时影响一批程序</strong>，
        而报错信息往往只是「找不到 xxx.dll」或「0xc000007b」——本页负责把它翻译成可执行的修复动作。
      </p>
    </div>

    <!-- ── 扫描 ── -->
    <div class="card">
      <h2 class="card-title">检测</h2>
      <div class="row">
        <button class="btn primary" :disabled="scanning" @click="runScan">
          {{ scanning ? '扫描中…' : '开始扫描' }}
        </button>
        <span v-if="scanResult" class="meta">
          共检查 {{ scanResult.total }} 项 · 缺失 {{ missingCount }} · 位数不全 {{ partialCount }}
        </span>
      </div>

      <p v-if="scanResult" class="hint">{{ scanResult.note }}</p>

      <div v-if="scanResult" class="facts">
        <div class="fact">
          <span class="fact-label">扫描目录</span>
          <span class="fact-value">{{ scanResult.roots.join('  ·  ') || '—' }}</span>
        </div>
        <div class="fact" v-if="isWin">
          <span class="fact-label">VC++ 运行库</span>
          <span class="fact-value">{{ vcText }}</span>
        </div>
      </div>

      <p v-if="error" class="hint bad">{{ error }}</p>
    </div>

    <!-- ── 问题清单 ── -->
    <div v-if="scanResult" class="card">
      <h2 class="card-title">检测结果</h2>

      <p v-if="problems.length === 0" class="ok-line">
        ✓ 未发现关键 DLL 缺失或位数不全，运行时环境完整。
      </p>

      <table v-else class="grid">
        <thead>
          <tr>
            <th>DLL</th>
            <th>类别</th>
            <th>状态</th>
            <th>用途</th>
            <th>缺失影响</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in problems" :key="it.id">
            <td class="mono">{{ it.name }}</td>
            <td>{{ CATEGORY_LABEL[it.category] }}</td>
            <td>
              <span class="tag" :class="it.present ? 'warn' : 'bad'">
                {{ it.present ? '位数不全' : '缺失' }}
              </span>
            </td>
            <td class="dim">{{ it.purpose }}</td>
            <td class="dim">{{ it.impact }}</td>
          </tr>
        </tbody>
      </table>

      <button v-if="problems.length === 0 && healthyItems.length" class="btn small toggle" @click="showAll = !showAll">
        {{ showAll ? '收起全部检查项' : `查看全部 ${scanResult.total} 项检查结果` }}
      </button>
      <table v-if="showAll" class="grid dim-table">
        <thead><tr><th>DLL</th><th>类别</th><th>来源</th><th>命中路径</th></tr></thead>
        <tbody>
          <tr v-for="it in healthyItems" :key="it.id">
            <td class="mono">{{ it.name }}</td>
            <td>{{ CATEGORY_LABEL[it.category] }}</td>
            <td class="dim">{{ it.origin }}</td>
            <td class="mono tiny">{{ it.paths.map((p) => p.path).join(' , ') || '（已解析）' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── 修复建议 ── -->
    <div v-if="scanResult && advice.length > 0" class="card">
      <h2 class="card-title">修复建议</h2>
      <p class="hint">按推荐顺序排列：先补运行库（一步解决大多数「缺少 msvcp/vcruntime」），再跑系统级修复。</p>
      <div class="advice" v-for="a in advice" :key="a.kind">
        <div class="advice-main">
          <div class="advice-head">
            <strong>{{ a.label }}</strong>
            <span v-if="a.needsAdmin" class="tag warn">需要管理员</span>
          </div>
          <p class="dim">{{ a.description }}</p>
        </div>
        <button class="btn primary" :disabled="repairRunning !== null" @click="runRepairAndRescan(a.kind)">
          {{ repairRunning === a.kind ? '执行中…' : '执行修复' }}
        </button>
      </div>
      <p class="hint">
        修复走系统自带通道：VC++ 运行库经 winget 安装微软官方包；系统文件走 SFC / DISM。
        遇到 UAC 提示请选择「是」。
      </p>
    </div>

    <!-- ── 修复结果 ── -->
    <div v-if="repairResult" class="card">
      <h2 class="card-title">修复结果 · {{ repairResult.label }}</h2>
      <p class="result-line" :class="repairResult.repaired ? 'ok' : 'bad'">
        {{ repairResult.repaired ? '✓ ' : '✗ ' }}{{ repairResult.summary }}
      </p>
      <ul v-if="repairResult.nextSteps.length" class="next-steps">
        <li v-for="(s, i) in repairResult.nextSteps" :key="i">
          <template v-if="s.startsWith('http')">
            <a href="#" class="link" @click.prevent="openExternal(s)">{{ s }}</a>
          </template>
          <template v-else>{{ s }}</template>
        </li>
      </ul>
      <details v-if="repairResult.output" class="out">
        <summary>查看命令原始输出</summary>
        <pre>{{ repairResult.output }}</pre>
      </details>
    </div>
  </section>
</template>

<style scoped>
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  margin-bottom: 14px;
  max-width: 900px;
}
.card-title { font-size: 14px; font-weight: 600; margin-bottom: 12px; }

.prose { font-size: 13px; color: var(--text-secondary); line-height: 1.7; margin-bottom: 10px; }
.prose-list { font-size: 13px; color: var(--text-secondary); line-height: 1.8; padding-left: 20px; margin-bottom: 14px; }
.prose-list li { list-style: disc; }

.grid { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-bottom: 10px; }
.grid th {
  text-align: left;
  font-weight: 600;
  color: var(--text-tertiary);
  padding: 7px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.grid td { padding: 7px 8px; border-bottom: 1px solid var(--border); color: var(--text-secondary); vertical-align: top; }
.grid tr:last-child td { border-bottom: none; }
.mono { font-family: 'Cascadia Code', 'Consolas', monospace; color: var(--text-primary); word-break: break-all; }
.tiny { font-size: 11.5px; }
.dim { color: var(--text-tertiary); }
.dim-table { margin-top: 12px; }

.row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.meta { font-size: 12.5px; color: var(--text-tertiary); }
.facts { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.fact { display: flex; gap: 10px; font-size: 12.5px; }
.fact-label { color: var(--text-tertiary); flex-shrink: 0; }
.fact-value { color: var(--text-secondary); word-break: break-all; }

.tag { font-size: 11.5px; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
.tag.bad { color: #ef4444; background: rgba(239, 68, 68, 0.12); }
.tag.warn { color: #d97706; background: rgba(217, 119, 6, 0.12); }

.ok-line { font-size: 13px; color: #059669; }
.result-line { font-size: 13px; line-height: 1.7; }
.result-line.ok { color: #059669; }
.result-line.bad { color: #ef4444; }
.next-steps { font-size: 12.5px; color: var(--text-secondary); padding-left: 20px; margin: 8px 0; }
.next-steps li { list-style: disc; line-height: 1.8; }
.link { color: var(--accent); word-break: break-all; }

.advice {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.advice:last-of-type { border-bottom: none; }
.advice-main { flex: 1; min-width: 0; }
.advice-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font-size: 13px; color: var(--text-primary); }
.advice .dim { font-size: 12.5px; line-height: 1.6; margin: 0; }

.out { margin-top: 10px; font-size: 12.5px; color: var(--text-tertiary); }
.out summary { cursor: pointer; }
.out pre {
  margin-top: 8px;
  padding: 10px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  max-height: 240px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.toggle { margin-top: 4px; }
.hint { font-size: 12.5px; color: var(--text-tertiary); line-height: 1.7; }
.hint.bad { color: #ef4444; }

@media (max-width: 720px) {
  .card { padding: 14px; }
  .grid { font-size: 12px; }
  .advice { flex-direction: column; align-items: stretch; }
}
</style>
