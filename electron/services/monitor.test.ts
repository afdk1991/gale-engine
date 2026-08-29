import { describe, it, expect } from 'vitest'
import { createMonitorService } from './monitor'
import type { MonitorFetcher } from './monitor'

function fakeFetcher(overrides: Partial<MonitorFetcher> = {}): MonitorFetcher {
  return {
    cpu: async () => ({ load: 42.5, cores: [10, 20, 30] }),
    mem: async () => ({ used: 4_000_000_000, total: 16_000_000_000, percent: 25 }),
    disks: async () => [{ mount: 'C:', used: 100, total: 200, percent: 50 }],
    net: async () => ({ rxSec: 1024, txSec: 512 }),
    temp: async () => 55,
    battery: async () => 80,
    uptime: async () => 3600,
    ...overrides
  }
}

describe('createMonitorService', () => {
  it('聚合各数据源为 SystemSnapshot', async () => {
    const svc = createMonitorService(fakeFetcher())
    const snap = await svc.snapshot()
    expect(snap.cpu.load).toBe(42.5)
    expect(snap.cpu.cores).toEqual([10, 20, 30])
    expect(snap.mem.percent).toBe(25)
    expect(snap.disks).toHaveLength(1)
    expect(snap.net.rxSec).toBe(1024)
    expect(snap.temp).toBe(55)
    expect(snap.battery).toBe(80)
    expect(snap.uptimeSec).toBe(3600)
    expect(typeof snap.at).toBe('number')
  })

  it('注入的 fetcher 覆盖默认值（温度/电量可空）', async () => {
    const svc = createMonitorService(fakeFetcher({ temp: async () => null, battery: async () => null }))
    const snap = await svc.snapshot()
    expect(snap.temp).toBeNull()
    expect(snap.battery).toBeNull()
  })

  it('负载数值被钳制到 0-100，非法输入归零', async () => {
    const svc = createMonitorService(
      fakeFetcher({
        cpu: async () => ({ load: -50, cores: [999] }),
        mem: async () => ({ used: 0, total: 0, percent: NaN })
      })
    )
    const snap = await svc.snapshot()
    expect(snap.cpu.load).toBe(0)
    expect(snap.cpu.cores).toEqual([100])
    expect(snap.mem.percent).toBe(0)
  })
})
