<script setup lang="ts">
import { computed } from 'vue'
import { useAppUpdate } from '../composables/useAppUpdate'

const props = defineProps<{
  /** compact=true 用于首页内嵌（不展示偏好开关与包格式细节） */
  compact?: boolean
}>()

const {
  state,
  capability,
  prefs,
  prefError,
  busy,
  ready,
  supported,
  label,
  percent,
  canCheck,
  check,
  install,
  setPrefs
} = useAppUpdate()

const releasesUrl = 'https://github.com/afdk1991/gale-engine/releases/latest'

const showPrefs = computed(() => props.compact !== true && supported.value)

/** 平台/安装方式的可读文案（让用户明白为什么能不能自更新） */
const packageLabel = computed<string>(() => {
  const c = capability.value
  if (!c) return '检测中…'
  const names: Record<string, string> = {
    nsis: 'Windows 安装包（NSIS）',
    'mac-zip': 'macOS 压缩包（zip）',
    appimage: 'Linux AppImage',
    deb: 'Linux 系统包（deb/rpm）',
    unknown: '未知'
  }
  return `${c.platform} · ${names[c.packageKind] ?? c.packageKind}`
})

async function openReleases(): Promise<void> {
  try {
    await window.gale.app.openExternal(releasesUrl)
  } catch {
    // 外链打开失败不该影响卡片其余状态；主进程侧已有 host 白名单，这里只兜住 rejection
  }
}

async function toggle(key: 'autoCheck' | 'autoDownload' | 'autoInstallOnQuit', ev?: Event): Promise<void> {
  const el = ev?.target as HTMLInputElement | undefined
  const next = !(prefs.value?.[key] ?? true)
  await setPrefs({ [key]: next })
  // 写入失败时 prefs 未变，Vue 不一定会重渲——显式把勾选状态拨回真实值，
  // 避免出现「界面上是开的、实际没生效」的假成功
  if (el && prefs.value?.[key] !== next) el.checked = prefs.value?.[key] ?? false
}
</script>

<template>
  <div class="card update-card" :class="{ compact }">
    <h2 class="card-title">{{ compact ? '版本与更新' : '关于与更新' }}</h2>

    <p class="row-line">
      当前版本：<strong>v{{ state.currentVersion ?? '—' }}</strong>
      <span class="pkg" v-if="!compact">{{ packageLabel }}</span>
    </p>

    <p class="status" :class="state.status">
      <span class="dot" aria-hidden="true"></span>{{ label }}
    </p>

    <!-- 下载进度：把「自动下载」的进展如实展示出来，而不是只转圈 -->
    <div v-if="percent !== null" class="bar" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
      <span :style="{ width: percent + '%' }"></span>
    </div>

    <div class="row">
      <button class="btn primary" :disabled="!canCheck" @click="check">
        {{ busy ? '处理中…' : state.status === 'error' ? '重试' : '检查更新' }}
      </button>
      <button v-if="ready" class="btn primary" @click="install">立即安装并重启</button>
      <button class="btn" @click="openReleases">手动下载</button>
    </div>

    <!-- 平台不支持自更新时，明确告知原因与替代方式，不留「点了没反应」的坑 -->
    <p v-if="state.status === 'unsupported'" class="hint warn">{{ state.reason }}</p>
    <p v-else-if="state.status === 'error'" class="hint bad">{{ state.error }}</p>
    <p v-else-if="ready" class="hint ok">下载已完成，点「立即安装并重启」即可完成升级。</p>
    <p v-else class="hint">检测到新版本后会自动下载；也可随时到 Releases 页手动下载安装包。</p>

    <div v-if="showPrefs" class="prefs">
      <label class="switch-line">
        <input type="checkbox" :checked="prefs?.autoCheck" @change="toggle('autoCheck', $event)" />
        <span>启动后自动检查更新（后台静默，不打扰）</span>
      </label>
      <label class="switch-line">
        <input type="checkbox" :checked="prefs?.autoDownload" @change="toggle('autoDownload', $event)" />
        <span>发现新版本后自动下载</span>
      </label>
      <label class="switch-line">
        <input type="checkbox" :checked="prefs?.autoInstallOnQuit" @change="toggle('autoInstallOnQuit', $event)" />
        <span>下载完成后，退出应用时自动安装</span>
      </label>
      <p v-if="prefError" class="hint bad">偏好保存失败：{{ prefError }}</p>
    </div>
  </div>
</template>

<style scoped>
.update-card { max-width: 560px; margin-bottom: 14px; }
.update-card.compact { max-width: none; margin-bottom: 22px; }

.row-line { font-size: 13px; color: var(--text-secondary); margin: 0 0 10px; }
.pkg { margin-left: 10px; font-size: 12px; color: var(--text-tertiary); }

.status {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 10px;
}
.status .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
.status.available .dot,
.status.downloading .dot { background: var(--accent); }
.status.downloaded .dot { background: #059669; }
.status.error .dot { background: #ef4444; }
.status.unsupported .dot { background: #d97706; }
.status.checking .dot { background: var(--accent); animation: pulse 1.1s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }

.bar { height: 6px; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden; margin-bottom: 12px; }
.bar span { display: block; height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.3s ease; }

.row { display: flex; gap: 10px; flex-wrap: wrap; margin: 10px 0 8px; }
.hint { font-size: 12.5px; color: var(--text-tertiary); line-height: 1.6; }
.hint.bad { color: #ef4444; }
.hint.warn { color: #d97706; }
.hint.ok { color: #059669; }

.prefs { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
.switch-line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
</style>
