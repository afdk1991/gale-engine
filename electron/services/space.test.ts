import { describe, it, expect } from 'vitest'
import {
  diffReleasedBytes,
  mountOfPath,
  createSpaceMeter,
  type SpaceFetcher
} from './space'

describe('diffReleasedBytes', () => {
  it('返回 after - before 的正数差', () => {
    expect(diffReleasedBytes(1000, 1500)).toBe(500)
  })
  it('空间被其他进程写回导致负差时收敛为 0', () => {
    expect(diffReleasedBytes(2000, 1500)).toBe(0)
  })
  it('任一端为 null 时返回 undefined（无法测量）', () => {
    expect(diffReleasedBytes(null, 100)).toBeUndefined()
    expect(diffReleasedBytes(100, null)).toBeUndefined()
  })
  it('非有限值（NaN/Infinity）按 undefined 处理', () => {
    expect(diffReleasedBytes(NaN, 100)).toBeUndefined()
    expect(diffReleasedBytes(100, Infinity)).toBeUndefined()
  })
})

describe('mountOfPath', () => {
  it('Windows 路径推断为盘符', () => {
    expect(mountOfPath('C:\\Windows\\Temp', 'win32')).toBe('C:')
    expect(mountOfPath('d:/foo/bar', 'win32')).toBe('D:')
  })
  it('unix 路径统一推断为 /', () => {
    expect(mountOfPath('/home/tester/.cache', 'darwin')).toBe('/')
    expect(mountOfPath('/home/tester/.cache', 'linux')).toBe('/')
  })
  it('无法推断时返回 null', () => {
    expect(mountOfPath('relative/path', 'linux')).toBeNull()
    expect(mountOfPath('', 'win32')).toBeNull()
  })
})

describe('createSpaceMeter', () => {
  const fetcher: SpaceFetcher = {
    fsSize: async () => [
      { mount: 'C:', size: 1_000_000, used: 600_000, available: 400_000 },
      { mount: '/', size: 2_000_000, used: 500_000, available: 1_500_000 }
    ]
  }
  const meter = createSpaceMeter(fetcher)

  it('按挂载点返回可用字节（大小写/斜杠归一化）', async () => {
    expect(await meter.freeBytes('c:')).toBe(400_000)
    expect(await meter.freeBytes('C:\\')).toBe(400_000)
  })
  it('未匹配挂载点返回 null', async () => {
    expect(await meter.freeBytes('Z:')).toBeNull()
  })
  it('freeBytesForPath 自动推断挂载点', async () => {
    expect(await meter.freeBytesForPath('C:\\Users\\x', 'win32')).toBe(400_000)
    expect(await meter.freeBytesForPath('/home/x', 'linux')).toBe(1_500_000)
  })
  it('available 缺失时回退用 size - used 估算', async () => {
    const m = createSpaceMeter({
      fsSize: async () => [{ mount: 'X:', size: 100, used: 30 }]
    })
    expect(await m.freeBytes('X:')).toBe(70)
  })
  it('fetcher 抛错时安全返回 null', async () => {
    const m = createSpaceMeter({ fsSize: async () => { throw new Error('boom') } })
    expect(await m.freeBytes('C:')).toBeNull()
  })
})
