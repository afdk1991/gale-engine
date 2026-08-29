import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('../pages/Home.vue'), meta: { title: '首页' } },
    { path: '/monitor', name: 'monitor', component: () => import('../pages/Monitor.vue'), meta: { title: '硬件监控' } },
    { path: '/optimizer', name: 'optimizer', component: () => import('../pages/Optimizer.vue'), meta: { title: '优化中心' } },
    { path: '/game', name: 'game', component: () => import('../pages/GameMode.vue'), meta: { title: '游戏模式' } },
    { path: '/toolbox', name: 'toolbox', component: () => import('../pages/Toolbox.vue'), meta: { title: '工具箱' } },
    { path: '/history', name: 'history', component: () => import('../pages/History.vue'), meta: { title: '优化记录' } },
    { path: '/settings', name: 'settings', component: () => import('../pages/Settings.vue'), meta: { title: '设置' } },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? '')} - 疾风引擎`
})
