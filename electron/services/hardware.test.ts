import { describe, it, expect } from 'vitest'
import { createHardwareService } from './hardware'
import type { HardwareFetcher } from './hardware'
import type { HardwareInfo } from '../../shared/types'

function fakeFetcher(overrides: Partial<HardwareFetcher> = {}): HardwareFetcher {
  return {
    motherboard: async () => ({
      model: 'ROG STRIX Z690-A',
      vendor: 'ASUS',
      version: 'Rev 1.02',
      biosVendor: 'American Megatrends',
      biosVersion: '2401',
      biosDate: '2023-06-15'
    }),
    cpu: async () => ({
      vendor: 'Intel',
      brand: 'Core i7-12700K',
      arch: 'x64',
      physicalCores: 12,
      cores: 20,
      speedGHz: 3.6
    }),
    memory: async () => ({
      total: 34_359_738_368,
      sticks: [
        { model: 'CMK32GX4M2Z3200C16', vendor: 'Corsair', size: 17_179_869_184, speedMHz: 3200, type: 'DDR4' },
        { model: 'CMK32GX4M2Z3200C16', vendor: 'Corsair', size: 17_179_869_184, speedMHz: 3200, type: 'DDR4' }
      ]
    }),
    graphics: async () => [
      { model: 'NVIDIA GeForce RTX 4070', vendor: 'NVIDIA', vramMB: 12288, bus: 'PCIe' },
      { model: 'Intel UHD Graphics 770', vendor: 'Intel', vramMB: null, bus: 'Integrated' }
    ],
    displays: async () => [
      { model: 'LG UltraGear 27GP850', vendor: 'LG', resolutionX: 2560, resolutionY: 1440, sizeInch: 27 },
      { model: 'DELL U2723QE', vendor: 'Dell', resolutionX: 3840, resolutionY: 2160, sizeInch: 27 }
    ],
    disks: async () => [
      { model: 'Samsung SSD 980 PRO 2TB', vendor: 'Samsung', size: 2_000_398_934_016, type: 'NVMe', interfaceType: 'NVMe' },
      { model: 'ST4000DM004-2CV104', vendor: 'Seagate', size: 4_000_787_030_016, type: 'HDD', interfaceType: 'SATA' }
    ],
    power: async () => ({
      model: 'Prime PX-850',
      vendor: 'Seasonic',
      type: 'psu',
      powerW: 850
    }),
    ...overrides
  }
}

describe('createHardwareService', () => {
  it('聚合各数据源为 HardwareInfo', async () => {
    const svc = createHardwareService(fakeFetcher())
    const info = await svc.info()
    expect(info.motherboard.model).toBe('ROG STRIX Z690-A')
    expect(info.cpu.brand).toBe('Core i7-12700K')
    expect(info.cpu.arch).toBe('x64')
    expect(info.memory.sticks).toHaveLength(2)
    expect(info.graphics).toHaveLength(2)
    expect(info.displays).toHaveLength(2)
    expect(info.disks).toHaveLength(2)
    expect(info.power.type).toBe('psu')
    expect(typeof info.at).toBe('number')
  })

  it('注入的 fetcher 覆盖默认值（电池电源）', async () => {
    const svc = createHardwareService(
      fakeFetcher({
        power: async () => ({ model: 'BATTERY-123', vendor: 'LGC', type: 'battery', powerW: 60 })
      })
    )
    const info = await svc.info()
    expect(info.power.type).toBe('battery')
    expect(info.power.model).toBe('BATTERY-123')
  })

  it('台式机无电源信息时返回 unknown', async () => {
    const svc = createHardwareService(
      fakeFetcher({
        power: async () => ({ model: '', vendor: '', type: 'unknown', powerW: null })
      })
    )
    const info = await svc.info()
    expect(info.power.type).toBe('unknown')
    expect(info.power.powerW).toBeNull()
  })

  it('内存布局无权限时返回空数组', async () => {
    const svc = createHardwareService(
      fakeFetcher({ memory: async () => ({ total: 16_000_000_000, sticks: [] }) })
    )
    const info = await svc.info()
    expect(info.memory.sticks).toEqual([])
    expect(info.memory.total).toBe(16_000_000_000)
  })

  it('架构字段覆盖 x86/x64/arm64', async () => {
    for (const arch of ['x86', 'x64', 'arm64']) {
      const svc = createHardwareService(
        fakeFetcher({ cpu: async () => ({ vendor: 'V', brand: 'B', arch, physicalCores: 4, cores: 8, speedGHz: 2.0 }) })
      )
      const info = await svc.info()
      expect(info.cpu.arch).toBe(arch)
    }
  })

  it('类型契约完整性：HardwareInfo 所有字段存在', async () => {
    const svc = createHardwareService(fakeFetcher())
    const info: HardwareInfo = await svc.info()
    // 主板
    expect(info.motherboard).toHaveProperty('model')
    expect(info.motherboard).toHaveProperty('vendor')
    expect(info.motherboard).toHaveProperty('biosVendor')
    // CPU
    expect(info.cpu).toHaveProperty('vendor')
    expect(info.cpu).toHaveProperty('brand')
    expect(info.cpu).toHaveProperty('arch')
    expect(info.cpu).toHaveProperty('physicalCores')
    // 内存
    expect(info.memory).toHaveProperty('total')
    expect(info.memory).toHaveProperty('sticks')
    // 显卡
    expect(Array.isArray(info.graphics)).toBe(true)
    if (info.graphics.length) {
      expect(info.graphics[0]).toHaveProperty('model')
      expect(info.graphics[0]).toHaveProperty('vramMB')
    }
    // 显示器
    expect(Array.isArray(info.displays)).toBe(true)
    // 硬盘
    expect(Array.isArray(info.disks)).toBe(true)
    // 电源
    expect(info.power).toHaveProperty('type')
    expect(info.power).toHaveProperty('powerW')
  })
})
