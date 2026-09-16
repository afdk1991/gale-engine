import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import GameMode from './GameMode.vue'
import type { GameModeActionResult, GameModeStatus } from '../../shared/types'

const WIN_STATUS: GameModeStatus = {
  active: '381b4222-f694-41f0-9685-ff5bb260df2e',
  activeName: 'Balanced',
  boosted: false,
  previous: null
}

const BOOSTED_STATUS: GameModeStatus = {
  active: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  activeName: 'High performance',
  boosted: true,
  previous: '381b4222-f694-41f0-9685-ff5bb260df2e'
}

function result(ok: boolean, message: string, status: GameModeStatus): GameModeActionResult {
  return { ok, message, status }
}

interface Harness {
  historyAdd: ReturnType<typeof vi.fn>
  boostMock: ReturnType<typeof vi.fn>
  restoreMock: ReturnType<typeof vi.fn>
}

function installGale(opts: {
  status?: GameModeStatus
  boost?: GameModeActionResult
  restore?: GameModeActionResult
}): Harness {
  const historyAdd = vi.fn().mockResolvedValue(undefined)
  const boostMock = vi.fn().mockResolvedValue(opts.boost)
  const restoreMock = vi.fn().mockResolvedValue(opts.restore)
  const gale = {
    gameMode: {
      status: vi.fn().mockResolvedValue(opts.status ?? WIN_STATUS),
      boost: boostMock,
      restore: restoreMock
    },
    history: { add: historyAdd }
  }
  ;(window as unknown as { gale: unknown }).gale = gale
  return { historyAdd, boostMock, restoreMock }
}

/** 等所有微任务 + 一个宏任务，覆盖组件里 await IPC 的链路 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function mountPage(): Promise<VueWrapper> {
  const wrapper = mount(GameMode)
  await flush()
  return wrapper
}

describe('GameMode.vue 回执诚实性', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    delete (window as unknown as { gale?: unknown }).gale
  })

  it('boost 成功：提示服务端原文并写入优化记录', async () => {
    const h = installGale({
      status: WIN_STATUS,
      boost: result(true, '已切换到高性能模式', BOOSTED_STATUS)
    })
    const wrapper = await mountPage()

    await wrapper.find('.btn.primary').trigger('click')
    await flush()

    expect(wrapper.find('.hint').text()).toBe('已切换到高性能模式')
    expect(wrapper.find('.error').exists()).toBe(false)
    expect(h.historyAdd).toHaveBeenCalledTimes(1)
    expect(h.historyAdd.mock.calls[0][0]).toMatchObject({
      type: 'gameMode',
      label: '进入游戏模式',
      detail: 'High performance'
    })
  })

  // 回归：旧实现无论 boost 成败都提示「已切换到高性能电源计划」并记入历史。
  // Linux 无 root / Windows 无管理员权限时切换会真的失败，属谎报。
  it('boost 失败：展示失败原因、不提示成功、不写入优化记录', async () => {
    const h = installGale({
      status: WIN_STATUS,
      boost: result(false, '需 root 权限切换 CPU 调速器', WIN_STATUS)
    })
    const wrapper = await mountPage()

    await wrapper.find('.btn.primary').trigger('click')
    await flush()

    expect(wrapper.find('.error').text()).toContain('需 root 权限切换 CPU 调速器')
    expect(wrapper.find('.hint').exists()).toBe(false)
    expect(h.historyAdd).not.toHaveBeenCalled()
    // 状态未被乐观改写
    expect(wrapper.text()).toContain('当前为普通模式')
  })

  it('restore 失败：提示原因、不写入记录，且仍显示为已开启', async () => {
    const h = installGale({
      status: BOOSTED_STATUS,
      restore: result(false, '还原调速器失败（需 root 权限）', BOOSTED_STATUS)
    })
    const wrapper = await mountPage()

    const restoreBtn = wrapper.findAll('.actions button')[1]
    await restoreBtn.trigger('click')
    await flush()

    expect(wrapper.find('.error').text()).toContain('还原调速器失败')
    expect(wrapper.find('.hint').exists()).toBe(false)
    expect(h.historyAdd).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('游戏模式已开启')
  })

  it('restore 成功：提示并写入记录', async () => {
    const h = installGale({
      status: BOOSTED_STATUS,
      restore: result(true, '已退出游戏模式，还原上一模式', WIN_STATUS)
    })
    const wrapper = await mountPage()

    await wrapper.findAll('.actions button')[1].trigger('click')
    await flush()

    expect(wrapper.find('.hint').text()).toBe('已退出游戏模式，还原上一模式')
    expect(h.historyAdd).toHaveBeenCalledTimes(1)
    expect(h.historyAdd.mock.calls[0][0]).toMatchObject({ label: '退出游戏模式' })
  })

  it('前一次失败后再成功：旧的错误提示被清除', async () => {
    const h = installGale({
      status: WIN_STATUS,
      boost: result(false, '切换失败', WIN_STATUS)
    })
    const wrapper = await mountPage()
    await wrapper.find('.btn.primary').trigger('click')
    await flush()
    expect(wrapper.find('.error').exists()).toBe(true)

    // 第二次成功：错误必须被清掉，否则界面会同时显示「失败」与「成功」
    h.boostMock.mockResolvedValue(result(true, '已切换到高性能模式', BOOSTED_STATUS))
    await wrapper.find('.btn.primary').trigger('click')
    await flush()

    expect(wrapper.find('.error').exists()).toBe(false)
    expect(wrapper.find('.hint').text()).toBe('已切换到高性能模式')
  })

  it('写优化记录失败不影响已成功的切换结果', async () => {
    const h = installGale({
      status: WIN_STATUS,
      boost: result(true, '已切换到高性能模式', BOOSTED_STATUS)
    })
    h.historyAdd.mockRejectedValue(new Error('history disk full'))
    const wrapper = await mountPage()

    await wrapper.find('.btn.primary').trigger('click')
    await flush()

    expect(wrapper.find('.hint').text()).toBe('已切换到高性能模式')
    expect(wrapper.find('.error').exists()).toBe(false)
  })
})
