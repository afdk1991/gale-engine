import { getCurrentInstance, onUnmounted, ref, type Ref } from 'vue'

/**
 * 定时轮询，带**并发守卫**。
 *
 * 背景：监控页（1s）与首页（2s）原先直接 `setInterval(() => refresh(), n)`。
 * 采集本身是异步的，在机械盘 / 多卷 / 网络盘 / 低配机器上 `fsSize()`、`currentLoad()`
 * 经常耗时超过一个周期，于是每来一次定时器就再发一次请求 —— 请求持续叠加，
 * 造成数据乱序（旧结果覆盖新结果）、IPC 与采集子进程堆积、内存增长。
 *
 * 本 composable 的语义：**上一次未返回就跳过本次**（丢帧而非排队）。
 * 监控面板属于「只关心最新值」的场景，丢帧比排队更合适。
 *
 * @param task       每次 tick 要执行的任务；其内部自行处理错误展示（本处不吞异常也不上报）
 * @param intervalMs 轮询间隔
 */
export function usePolling(task: () => Promise<void> | void, intervalMs: number) {
  /** 当前是否有一次采集尚未返回 */
  const busy = ref(false)
  /** 因上一次未返回而跳过的次数（诊断「数据看起来卡住」时有用） */
  const skipped = ref(0)
  /** 是否已启动 */
  const active = ref(false)

  let timer: ReturnType<typeof setInterval> | null = null

  const tick = async (): Promise<void> => {
    if (busy.value) {
      skipped.value += 1
      return
    }
    busy.value = true
    try {
      await task()
    } catch {
      // 任务自身负责把失败反映到界面状态（如 error ref）；
      // 这里若向上抛，会变成 setInterval 回调里的未捕获 rejection。
    } finally {
      busy.value = false
    }
  }

  const start = (): void => {
    if (timer !== null) return
    active.value = true
    timer = setInterval(() => void tick(), intervalMs)
  }

  const stop = (): void => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    active.value = false
    skipped.value = 0
  }

  // 仅在组件 setup 内注册：组件外直接调用（如单测）时 Vue 会告警，故先探测
  if (getCurrentInstance()) onUnmounted(stop)

  return { tick, start, stop, busy, skipped, active }
}
