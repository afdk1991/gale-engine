<script setup lang="ts">
import { useAppUpdate } from '../composables/useAppUpdate'

const navItems = [
  { path: '/', label: '首页', icon: 'home' },
  { path: '/monitor', label: '硬件监控', icon: 'activity' },
  { path: '/hardware', label: '硬件信息', icon: 'chip' },
  { path: '/process', label: '进程管理', icon: 'cpu' },
  { path: '/network', label: '网络诊断', icon: 'network' },
  { path: '/optimizer', label: '优化中心', icon: 'sliders' },
  { path: '/disk', label: '磁盘修复', icon: 'disk' },
  { path: '/dll', label: 'DLL 修复', icon: 'puzzle' },
  { path: '/game', label: '游戏模式', icon: 'gamepad' },
  { path: '/services', label: '服务管理', icon: 'server' },
  { path: '/tasks', label: '计划任务', icon: 'clock' },
  { path: '/firewall', label: '防火墙', icon: 'shield' },
  { path: '/toolbox', label: '工具箱', icon: 'toolbox' },
  { path: '/history', label: '优化记录', icon: 'history' },
  { path: '/settings', label: '设置', icon: 'settings' }
] as const

// 侧边栏底部的更新入口：任何页面都能看到「是否有新版本」并一键检查/安装
const { state, busy, ready, hasUpdate, canCheck, check, install } = useAppUpdate()
</script>

<template>
  <nav class="sidebar" aria-label="主导航">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-name">疾风引擎</span>
    </div>
    <div class="nav-scroll">
      <RouterLink
        v-for="item in navItems"
        :key="item.path"
        :to="item.path"
        class="nav-item"
        exact-active-class="active"
        :aria-label="item.label"
        :title="item.label"
      >
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path v-if="item.icon === 'home'" d="M3 10.5 12 3l9 7.5V21h-6v-6h-6v6H3z" />
          <path v-else-if="item.icon === 'activity'" d="M3 12h4l3-7 4 14 3-7h4" />
          <g v-else-if="item.icon === 'chip'">
            <rect x="5" y="5" width="14" height="14" rx="2" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
            <path d="M9 2v2M12 2v2M15 2v2M9 20v2M12 20v2M15 20v2M2 9h2M2 12h2M2 15h2M20 9h2M20 12h2M20 15h2" />
          </g>
          <g v-else-if="item.icon === 'cpu'">
            <rect x="7" y="7" width="10" height="10" rx="1.5" />
            <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
          </g>
          <g v-else-if="item.icon === 'network'">
            <circle cx="12" cy="12" r="3" />
            <path d="M5 12a7 7 0 0 1 14 0" />
            <path d="M2.5 12a9.5 9.5 0 0 1 19 0" />
            <path d="M12 21l2-3h-4z" fill="currentColor" stroke="none" />
          </g>
          <g v-else-if="item.icon === 'sliders'">
            <path d="M4 7h16M4 12h16M4 17h16" />
            <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
            <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
            <circle cx="7" cy="17" r="2" fill="currentColor" stroke="none" />
          </g>
          <g v-else-if="item.icon === 'disk'">
            <line x1="22" y1="12" x2="2" y2="12" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            <line x1="6" y1="16" x2="6.01" y2="16" />
            <line x1="10" y1="16" x2="10.01" y2="16" />
          </g>
          <!-- DLL 修复：拼图块（模块化拼装 = 动态链接库的复用语义） -->
          <g v-else-if="item.icon === 'puzzle'">
            <path d="M10 3h4v2.2a1.8 1.8 0 1 0 3.6 0V3H21v4h-2.2a1.8 1.8 0 1 0 0 3.6H21V21h-4.4v-2.2a1.8 1.8 0 1 0-3.6 0V21H3v-4.4h2.2a1.8 1.8 0 1 0 0-3.6H3V3h7z" />
          </g>
          <g v-else-if="item.icon === 'gamepad'">
            <rect x="2.5" y="7" width="19" height="10" rx="5" />
            <path d="M7 10v4M5 12h4" />
            <circle cx="16" cy="13" r="1" fill="currentColor" stroke="none" />
          </g>
          <g v-else-if="item.icon === 'toolbox'">
            <rect x="3" y="8" width="18" height="11" rx="2" />
            <path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
          </g>
          <g v-else-if="item.icon === 'server'">
            <rect x="3" y="4" width="18" height="7" rx="1.5" />
            <rect x="3" y="13" width="18" height="7" rx="1.5" />
            <path d="M7 7.5h.01M7 16.5h.01" />
          </g>
          <g v-else-if="item.icon === 'clock'">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3.5 2" />
          </g>
          <g v-else-if="item.icon === 'shield'">
            <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6z" />
            <path d="m9 12 2 2 4-4" />
          </g>
          <g v-else-if="item.icon === 'history'">
            <path d="M4 5v5h5" />
            <path d="M4.3 10A8 8 0 1 1 6 16.9" />
            <path d="M12 8v4l3 2" />
          </g>
          <g v-else-if="item.icon === 'settings'">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
          </g>
        </svg>
        <span>{{ item.label }}</span>
      </RouterLink>
    </div>

    <!-- 全局更新入口：所有页面都能看到并一键检查/安装 -->
    <div class="updater">
      <button
        v-if="ready"
        class="up-btn ready"
        :title="'v' + (state.version ?? '') + ' 已下载，点击立即安装'"
        :aria-label="'v' + (state.version ?? '') + ' 已下载，点击立即安装'"
        @click="install"
      >
        <span class="up-dot" aria-hidden="true"></span>
        <span class="up-text">立即安装 v{{ state.version }}</span>
      </button>
      <button
        v-else
        class="up-btn"
        :class="{ hot: hasUpdate, busy }"
        :disabled="busy || !canCheck"
        :title="'当前 v' + (state.currentVersion ?? '—') + ' · 点击检查更新'"
        :aria-label="'当前 v' + (state.currentVersion ?? '—') + ' · 点击检查更新'"
        @click="check"
      >
        <span class="up-dot" aria-hidden="true"></span>
        <span class="up-text">v{{ state.currentVersion ?? '—' }}{{ hasUpdate ? ' · 有新版本' : '' }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--bg-tertiary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 16px 10px;
  gap: 2px;
  transition: width 0.2s ease, padding 0.2s ease;
}
.brand { display: flex; align-items: center; gap: 10px; padding: 4px 10px 14px; }
.brand-mark { width: 26px; height: 26px; border-radius: 8px; background: var(--accent-bg); }
.brand-name { font-size: 15px; font-weight: 700; color: var(--text-primary); }
/* 导航项较多（15 项）时允许纵向滚动，避免底部更新入口被挤出可视区 */
.nav-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 13.5px;
  transition: background 0.15s, color 0.15s;
}
.nav-item:hover { background: var(--accent-soft); color: var(--text-primary); }
.nav-item.active {
  background: var(--bg-secondary);
  color: var(--accent);
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--accent);
}
.icon { width: 17px; height: 17px; flex-shrink: 0; }

.updater { padding: 10px 2px 0; border-top: 1px solid var(--border); margin-top: 8px; }
.up-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.up-btn:hover:not(:disabled) { background: var(--accent-soft); color: var(--text-primary); }
.up-btn:disabled { cursor: default; opacity: 0.75; }
.up-btn.hot { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); font-weight: 600; }
.up-btn.ready { color: #059669; border-color: #059669; background: rgba(5, 150, 105, 0.1); font-weight: 600; }
.up-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.up-btn.hot .up-dot { box-shadow: 0 0 0 3px var(--accent-soft); }
.up-btn.busy .up-dot { animation: blink 1.1s ease-in-out infinite; }
.up-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }

@media (max-width: 720px) {
  .sidebar { width: 60px; padding: 16px 6px; align-items: center; }
  .brand { padding: 4px 0 14px; justify-content: center; }
  .brand-name { display: none; }
  .nav-scroll { width: 100%; }
  .nav-item { justify-content: center; padding: 11px 0; gap: 0; }
  .nav-item span { display: none; }
  .updater { width: 100%; }
  .up-btn { justify-content: center; padding: 8px 0; }
  .up-text { display: none; }
}
</style>
