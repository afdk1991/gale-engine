import * as si from 'systeminformation'
import type { Platform } from './shell'

// ─────────────────────────────────────────────────────────────
// 磁盘空间实测
//
// 「清理完成但空间没变」的根因之一，是代码只相信命令的退出码/OK 字样，
// 从未真正测量过卷的可用空间变化。这里提供 before/after 实测能力：
// 清理前记一次 freeBytes，清理后再记一次，差值才是真实释放量。
// ─────────────────────────────────────────────────────────────

export interface FsSizeLike {
  mount: string
  size: number
  used: number
  available?: number
}

export interface SpaceFetcher {
  fsSize(): Promise<FsSizeLike[]>
}

export function createSystemInformationSpaceFetcher(): SpaceFetcher {
  return {
    async fsSize() {
      return (await si.fsSize()) as unknown as FsSizeLike[]
    }
  }
}

const WIN_MOUNT_RE = /^([A-Za-z]):/

/**
 * 由路径推断其所在卷的挂载点。
 * - win32：`C:\Windows\Temp` → `C:`
 * - unix：统一取 `/`（分区场景罕见，且 fsSize 的 mount 与路径前缀无稳定映射关系）
 * 无法推断时返回 null（调用方据此跳过测量）。
 */
export function mountOfPath(path: string, platform: Platform): string | null {
  const p = String(path ?? '')
  if (platform === 'win32') {
    const m = p.match(WIN_MOUNT_RE)
    return m ? `${m[1].toUpperCase()}:` : null
  }
  return p.startsWith('/') ? '/' : null
}

export interface SpaceMeter {
  /** 指定挂载点的可用字节数；解析不到时返回 null */
  freeBytes(mount: string): Promise<number | null>
  /** 按路径推断挂载点后取可用字节数 */
  freeBytesForPath(path: string, platform: Platform): Promise<number | null>
}

export function createSpaceMeter(fetcher: SpaceFetcher): SpaceMeter {
  const freeBytes = async (mount: string): Promise<number | null> => {
    const target = String(mount ?? '').trim()
    if (!target) return null
    let list: FsSizeLike[]
    try {
      list = (await fetcher.fsSize()) ?? []
    } catch {
      return null
    }
    const hit = list.find((d) => normalizeMount(d.mount) === normalizeMount(target))
    if (!hit) return null
    const size = Number(hit.size) || 0
    const used = Number(hit.used) || 0
    const free =
      typeof hit.available === 'number' && Number.isFinite(hit.available)
        ? Math.max(0, hit.available)
        : Math.max(0, size - used)
    return size > 0 || free > 0 ? free : null
  }

  return {
    freeBytes,
    freeBytesForPath: (path, platform) => {
      const mount = mountOfPath(path, platform)
      return mount ? freeBytes(mount) : Promise.resolve(null)
    }
  }
}

/** 归一化挂载点用于比对：`c:\` / `C:` → `c:`；unix 去尾部斜杠 */
function normalizeMount(m: string): string {
  const t = String(m ?? '').trim().replace(/\\+$/, '').toLowerCase()
  return t.length > 1 ? t.replace(/\/+$/, '') : t
}

/**
 * 计算释放量。其他进程同时在写入时结果可能为负，此处收敛到 0，
 * 避免界面出现「释放了 -200MB」这种观感错误。
 */
export function diffReleasedBytes(before: number | null, after: number | null): number | undefined {
  if (before === null || after === null) return undefined
  if (!Number.isFinite(before) || !Number.isFinite(after)) return undefined
  return Math.max(0, after - before)
}
