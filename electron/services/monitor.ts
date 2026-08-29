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

  const snapshot = async (): Promise<SystemSnapshot> => {
    const cpu = await f.cpu()
    const mem = await f.mem()
    const disks = await f.disks()
    // 在快照边界统一钳制百分比字段，保证 API 契约（0-100）不依赖数据源
    return {
      cpu: { load: pct(cpu.load), cores: cpu.cores.map(pct) },
      mem: { used: mem.used, total: mem.total, percent: pct(mem.percent) },
      disks: disks.map((d) => ({ ...d, percent: pct(d.percent) })),
      net: await f.net(),
      temp: await f.temp(),
      battery: await f.battery(),
      uptimeSec: await f.uptime(),
      at: Date.now()
    }
  }

  return { snapshot, fetcher: f }
}
