import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createWebHashHistory, type Router } from 'vue-router'
import AppSidebar from './AppSidebar.vue'

function mountSidebar(): ReturnType<typeof mount> {
  const router: Router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', component: { render: () => null } },
      { path: '/monitor', component: { render: () => null } },
      { path: '/hardware', component: { render: () => null } },
      { path: '/process', component: { render: () => null } },
      { path: '/network', component: { render: () => null } },
      { path: '/optimizer', component: { render: () => null } },
      { path: '/game', component: { render: () => null } },
      { path: '/services', component: { render: () => null } },
      { path: '/tasks', component: { render: () => null } },
      { path: '/firewall', component: { render: () => null } },
      { path: '/toolbox', component: { render: () => null } },
      { path: '/history', component: { render: () => null } },
      { path: '/settings', component: { render: () => null } }
    ]
  })
  return mount(AppSidebar, { global: { plugins: [router] } })
}

describe('AppSidebar', () => {
  it('渲染品牌名与 13 个导航项', () => {
    const wrapper = mountSidebar()
    expect(wrapper.find('.brand-name').text()).toBe('疾风引擎')
    const items = wrapper.findAll('.nav-item')
    expect(items).toHaveLength(13)
    expect(items.map((item) => item.text())).toEqual([
      '首页', '硬件监控', '硬件信息', '进程管理', '网络诊断', '优化中心', '游戏模式', '服务管理', '计划任务', '防火墙', '工具箱', '优化记录', '设置'
    ])
  })

  it('导航项链接指向正确路由', () => {
    const wrapper = mountSidebar()
    const hrefs = wrapper.findAll('.nav-item').map((item) => item.attributes('href'))
    expect(hrefs).toEqual([
      '#/', '#/monitor', '#/hardware', '#/process', '#/network', '#/optimizer', '#/game', '#/services', '#/tasks', '#/firewall', '#/toolbox', '#/history', '#/settings'
    ])
  })

  it('exact-active-class 精确高亮当前路由', async () => {
    const wrapper = mountSidebar()
    await wrapper.vm.$router.push('/monitor')
    await wrapper.vm.$nextTick()
    const items = wrapper.findAll('.nav-item')
    expect(items[1].classes()).toContain('active')
    expect(items[0].classes()).not.toContain('active')
  })
})
