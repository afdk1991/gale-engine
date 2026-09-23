import type {
  SystemSnapshot,
  CpuSnapshot,
  MemSnapshot,
  DiskSnapshot,
  NetSnapshot
} from '../../shared/types'
import * as si from 'systeminformation'

/**
 * 监控数据获取器。默认实现走 systeminformation（跨平台，Windows 原生可用），
 * 测试时可注入 fake 实现，避免依赖真实硬件与系统调用。
 */
export interface MonitorFetcher {
  cpu(): Promise<CpuSnapshot>
  mem(): Promise<MemSnapshot>
  disks(): Promise<DiskSnapshot[]>
  net(): Promise<NetSnapshot>
  temp(): Promise<number | null>
  battery(): Promise<number | null>
  uptime(): Promise<number>
}

/** 将任意数值规整到 0-100 的一位小数，非法输入归零 */
function pct(n: number): number {
  const v = Number.isFinite(n) ? n : 0
  return Math.min(100, Math.max(0, Math.round(v * 10) / 10))
}

export function createSystemInformationFetcher(): MonitorFetcher {
  return {
    async cpu() {
      const load = await si.currentLoad()
      return {
        load: load.currentLoad,
        cores: (load.cpus ?? []).map((c) => c.load)
      }
    },
    async mem() {
      const m = await si.mem()
      const percent = m.total > 0 ? (m.used / m.total) * 100 : 0
      return { used: m.used, total: m.total, percent }
    },
    async disks() {
      const fs = await si.fsSize()
      return (fs ?? [])
        .filter((d) => d.size > 0)
        .map<DiskSnapshot>((d) => ({
          mount: d.mount,
          used: d.used,
          total: d.size,
          percent: d.use ?? 0
        }))
    },
    async net() {
      const stats = await si.networkStats()
      const agg = (stats ?? []).reduce(
        (acc, s) => ({ rx: acc.rx + (s.rx_sec ?? 0), tx: acc.tx + (s.tx_sec ?? 0) }),
        { rx: 0, tx: 0 }
      )
      return { rxSec: agg.rx, txSec: agg.tx }
    },
    async temp() {
      try {
        const t = await si.cpuTemperature()
        return typeof t.main === 'number' && t.main > 0 ? t.main : null
      } catch {
        return null
      }
    },
    async battery() {
      try {
        const b = await si.battery()
        return typeof b.percent === 'number' ? b.percent : null
      } catch {
        return null
      }
    },
    async uptime() {
      const t = await si.time()
      return typeof t.uptime === 'number' ? t.uptime : 0
    }
  }
}

export function createMonitorService(fetcher?: Partial<MonitorFetcher>) {
  const f: MonitorFetcher = { ...createSystemInformationFetcher(), ...(fetcher ?? {}) }

  /**
   * 单项采集失败时**按字段降级**，不让整张快照 reject。
   *
   * 背景：原先 cpu/mem/disks/net/uptime 直接 await systeminformation，任一项抛错
   * （虚拟机的温度接口、网络盘超时、容器里的 fsSize 等）都会让 snapshot() 整体失败，
   * 界面整块显示「监控数据获取失败」，连正常项也看不到。
   * 现在失败项记入 `degraded`，其余照常返回。
   */
  const attempt = async <T>(
    label: string,
    fn: () => Promise<T>,
    fallback: T,
    degraded: string[]
  ): Promise<T> => {
    try {
      const v = await fn()
      return v ?? fallback
    } catch {
      degraded.push(label)
      return fallback
    }
  }

  const snapshot = async (): Promise<SystemSnapshot> => {
    const degraded: string[] = []

    // 七项采集并发执行（Promise.all）：原先逐个 await 串行，总延迟是各项之和；
    // 并发后取 max(各项)。每项内部仍由 attempt 包裹独立 try/catch，单项失败只登记
    // degraded 并降级，不影响其余项，也不会让整张快照 reject。
    const [cpu, mem, disks, net, temp, battery, uptime] = await Promise.all([
      attempt<CpuSnapshot>('cpu', () => f.cpu(), { load: 0, cores: [] }, degraded),
      attempt<MemSnapshot>(
        'mem',
        () => f.mem(),
        { used: 0, total: 0, percent: 0 },
        degraded
      ),
      attempt<DiskSnapshot[]>('disks', () => f.disks(), [], degraded),
      attempt<NetSnapshot>('net', () => f.net(), { rxSec: 0, txSec: 0 }, degraded),
      attempt<number | null>('temp', () => f.temp(), null, degraded),
      attempt<number | null>('battery', () => f.battery(), null, degraded),
      attempt<number>('uptime', () => f.uptime(), 0, degraded)
    ])

    // 在快照边界统一钳制百分比字段，保证 API 契约（0-100）不依赖数据源
    return {
      cpu: { load: pct(cpu.load), cores: (cpu.cores ?? []).map(pct) },
      mem: { used: mem.used, total: mem.total, percent: pct(mem.percent) },
      disks: disks.map((d) => ({ ...d, percent: pct(d.percent) })),
      net,
      temp,
      battery,
      uptimeSec: uptime,
      at: Date.now(),
      degraded
    }
  }

  return { snapshot, fetcher: f }
}
