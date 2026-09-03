import { describe, it, expect } from 'vitest'
import {
  createNetworkService,
  parsePing,
  parseInterfaces,
  sanitizeHost,
  sanitizeCount
} from './network'
import type { ExecRunner } from './shell'

function recordingRunner(respond: (script: string) => { stdout: string; stderr: string; code: number }) {
  const calls: string[] = []
  const runner: ExecRunner = {
    run: (script: string) => {
      calls.push(script)
      return Promise.resolve(respond(script))
    }
  }
  return { runner, calls }
}

const ok = (stdout = ''): { stdout: string; stderr: string; code: number } => ({
  stdout,
  stderr: '',
  code: 0
})

describe('sanitizeHost', () => {
  it('接受 hostname 与 IPv4/IPv6', () => {
    expect(sanitizeHost('baidu.com')).toBe('baidu.com')
    expect(sanitizeHost('  Baidu.COM  ')).toBe('baidu.com')
    expect(sanitizeHost('127.0.0.1')).toBe('127.0.0.1')
    expect(sanitizeHost('2001:db8::1')).toBe('2001:db8::1')
  })
  it('拒绝注入与非法字符', () => {
    expect(sanitizeHost('baidu.com; rm -rf /')).toBeNull()
    expect(sanitizeHost('baidu.com"')).toBeNull()
    expect(sanitizeHost('a b')).toBeNull()
    expect(sanitizeHost('')).toBeNull()
    expect(sanitizeHost(' ')).toBeNull()
    expect(sanitizeHost('a'.repeat(300))).toBeNull()
  })
})

describe('sanitizeCount', () => {
  it('默认 4', () => {
    expect(sanitizeCount(undefined)).toBe(4)
    expect(sanitizeCount('abc')).toBe(4)
  })
  it('钳制到 1-20', () => {
    expect(sanitizeCount(0)).toBe(1)
    expect(sanitizeCount(999)).toBe(20)
    expect(sanitizeCount(3.7)).toBe(3)
  })
})

describe('parsePing', () => {
  it('解析成功样本', () => {
    const r = parsePing(JSON.stringify({ min: 1, avg: 2.5, max: 6, loss: 0, ok: true }), 'baidu.com')
    expect(r).toMatchObject({ host: 'baidu.com', min: 1, avg: 2.5, max: 6, loss: 0, ok: true })
  })
  it('全丢包判定失败', () => {
    const r = parsePing(JSON.stringify({ min: 0, avg: 0, max: 0, loss: 100, ok: false }), 'x')
    expect(r.ok).toBe(false)
    expect(r.loss).toBe(100)
  })
  it('空输出判定失败', () => {
    const r = parsePing('', 'x')
    expect(r.ok).toBe(false)
  })
  it('非法 JSON 判定失败', () => {
    const r = parsePing('not json', 'x')
    expect(r.ok).toBe(false)
  })
  it('字段缺失容错为 0', () => {
    const r = parsePing('{"avg":"abc"}', 'x')
    expect(r.avg).toBe(0)
  })
})

describe('parseInterfaces', () => {
  it('解析数组', () => {
    const raw = [{ name: '以太网', ip: '192.168.1.5', status: '已连接' }]
    expect(parseInterfaces(JSON.stringify(raw))).toHaveLength(1)
  })
  it('解析单对象（转数组）', () => {
    const raw = { name: 'WLAN', ip: '', status: '未连接' }
    const list = parseInterfaces(JSON.stringify(raw))
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('WLAN')
  })
  it('空/非法输出返回空数组', () => {
    expect(parseInterfaces('')).toEqual([])
    expect(parseInterfaces('xxx')).toEqual([])
  })
})

describe('createNetworkService', () => {
  it('ping 脚本注入消毒后的 host 与 count', async () => {
    const { runner, calls } = recordingRunner(() => ok(JSON.stringify({ min: 1, avg: 2, max: 3, loss: 0, ok: true })))
    const res = await createNetworkService(runner).ping('BaIdU.CoM', 5)
    expect(res.ok).toBe(true)
    expect(res.host).toBe('baidu.com')
    expect(calls[0]).toContain("$host_ = 'baidu.com'")
    expect(calls[0]).toContain('$count = 5')
  })
  it('非法 host 直接返回失败且不调用执行器', async () => {
    const { runner, calls } = recordingRunner(() => ok())
    const res = await createNetworkService(runner).ping('x; whoami')
    expect(res.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
  it('interfaces 返回解析结果', async () => {
    const raw = [{ name: '以太网', ip: '192.168.1.5', status: '已连接' }]
    const { runner } = recordingRunner(() => ok(JSON.stringify(raw)))
    const list = await createNetworkService(runner).interfaces()
    expect(list[0].ip).toBe('192.168.1.5')
  })
})
