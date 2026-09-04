import * as os from 'os'
import * as si from 'systeminformation'
import type {
  HardwareInfo,
  HardwareMotherboard,
  HardwareCpu,
  HardwareMemory,
  HardwareMemoryStick,
  HardwareGraphicsController,
  HardwareDisplay,
  HardwareDisk,
  HardwarePower
} from '../../shared/types'

/**
 * 硬件型号信息采集器。默认实现走 systeminformation（跨平台：Windows / macOS / Linux），
 * 测试时可注入 fake 实现，避免依赖真实硬件与系统调用。
 *
 * 适用架构：x86 / x64 / arm64。部分字段（内存条布局 memLayout、磁盘布局 diskLayout）
 * 需管理员/root 权限，无权限时返回空数组或空字符串，不抛错。
 */
export interface HardwareFetcher {
  motherboard(): Promise<HardwareMotherboard>
  cpu(): Promise<HardwareCpu>
  memory(): Promise<HardwareMemory>
  graphics(): Promise<HardwareGraphicsController[]>
  displays(): Promise<HardwareDisplay[]>
  disks(): Promise<HardwareDisk[]>
  power(): Promise<HardwarePower>
}

/** 将 os.arch() 映射为可读架构标识 */
function archLabel(): string {
  const a = os.arch()
  if (a === 'x64') return 'x64'
  if (a === 'ia32') return 'x86'
  if (a === 'arm64') return 'arm64'
  if (a === 'arm') return 'arm'
  return a || 'unknown'
}

/** 安全取字符串，null/undefined → '' */
function s(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/** 安全取数字，null/undefined/NaN → null */
function n(v: unknown): number | null {
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

export function createSystemInformationHardwareFetcher(): HardwareFetcher {
  return {
    async motherboard(): Promise<HardwareMotherboard> {
      try {
        const board = await si.baseboard()
        let biosVendor = ''
        let biosVersion = ''
        let biosDate = ''
        try {
          const bios = await si.bios()
          biosVendor = s(bios.vendor)
          biosVersion = s(bios.version)
          biosDate = s(bios.releaseDate)
        } catch {
          // 部分 VM/精简系统无 BIOS 信息
        }
        return {
          model: s(board.model),
          vendor: s(board.manufacturer),
          version: s(board.version),
          biosVendor,
          biosVersion,
          biosDate
        }
      } catch {
        return { model: '', vendor: '', version: '', biosVendor: '', biosVersion: '', biosDate: '' }
      }
    },

    async cpu(): Promise<HardwareCpu> {
      try {
        const c = await si.cpu()
        const speed = n(c.speed)
        return {
          vendor: s(c.manufacturer || c.vendor),
          brand: s(c.brand),
          arch: archLabel(),
          physicalCores: n(c.physicalCores) ?? 0,
          cores: n(c.cores) ?? 0,
          speedGHz: speed !== null ? Math.round(speed * 10) / 10 : null
        }
      } catch {
        return { vendor: '', brand: '', arch: archLabel(), physicalCores: 0, cores: 0, speedGHz: null }
      }
    },

    async memory(): Promise<HardwareMemory> {
      let total = 0
      try {
        const m = await si.mem()
        total = n(m.total) ?? 0
      } catch {
        // mem 失败极罕见，兜底用 os.totalmem
        total = os.totalmem()
      }
      let sticks: HardwareMemoryStick[] = []
      try {
        const layout = await si.memLayout()
        sticks = (layout ?? []).map((d) => ({
          model: s(d.partNum),
          vendor: s(d.manufacturer),
          size: n(d.size) ?? 0,
          speedMHz: n(d.clockSpeed),
          type: s(d.type)
        }))
      } catch {
        // memLayout 需权限，无权限为空
      }
      return { total, sticks }
    },

    async graphics(): Promise<HardwareGraphicsController[]> {
      try {
        const g = await si.graphics()
        return (g.controllers ?? []).map((c) => ({
          model: s(c.model),
          vendor: s(c.vendor),
          vramMB: n(c.vram),
          bus: s(c.bus)
        }))
      } catch {
        return []
      }
    },

    async displays(): Promise<HardwareDisplay[]> {
      try {
        const g = await si.graphics()
        return (g.displays ?? []).map((d) => {
          // sizeInch 由物理尺寸 sizeX/sizeY（毫米）对角线换算，无物理尺寸为 null
          let sizeInch: number | null = null
          const sx = n(d.sizeX)
          const sy = n(d.sizeY)
          if (sx !== null && sy !== null && sx > 0 && sy > 0) {
            sizeInch = Math.round((Math.sqrt(sx * sx + sy * sy) / 25.4) * 10) / 10
          }
          return {
            model: s(d.model),
            vendor: s(d.vendor),
            resolutionX: n(d.resolutionX) ?? 0,
            resolutionY: n(d.resolutionY) ?? 0,
            sizeInch
          }
        })
      } catch {
        return []
      }
    },

    async disks(): Promise<HardwareDisk[]> {
      try {
        const layout = await si.diskLayout()
        return (layout ?? []).map((d) => ({
          model: s(d.name),
          vendor: s(d.vendor),
          size: n(d.size) ?? 0,
          type: s(d.type),
          interfaceType: s(d.interfaceType)
        }))
      } catch {
        // diskLayout 需权限
        return []
      }
    },

    async power(): Promise<HardwarePower> {
      // 优先尝试电池（笔记本）
      try {
        const b = await si.battery()
        if (b.hasBattery) {
          return {
            model: s(b.model),
            vendor: s(b.manufacturer),
            type: 'battery',
            powerW: n(b.designedCapacity)
          }
        }
      } catch {
        // 无电池信息
      }
      // 台式机 PSU 通常无标准软件接口（需 PMBus/SMBus），返回 unknown
      return { model: '', vendor: '', type: 'unknown', powerW: null }
    }
  }
}

export function createHardwareService(fetcher?: Partial<HardwareFetcher>) {
  const f: HardwareFetcher = { ...createSystemInformationHardwareFetcher(), ...(fetcher ?? {}) }

  const info = async (): Promise<HardwareInfo> => {
    const [motherboard, cpu, memory, graphics, displays, disks, power] = await Promise.all([
      f.motherboard(),
      f.cpu(),
      f.memory(),
      f.graphics(),
      f.displays(),
      f.disks(),
      f.power()
    ])
    return {
      motherboard,
      cpu,
      memory,
      graphics,
      displays,
      disks,
      power,
      at: Date.now()
    }
  }

  return { info, fetcher: f }
}
