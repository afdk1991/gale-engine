import type { NetInterface, PingResult } from '../../shared/types'
import type { ExecRunner } from './shell'

/** 仅允许 hostname / IPv4 / IPv6 字面量字符，杜绝注入 */
const HOST_RE = /^[A-Za-z0-9._:-]+$/

export function sanitizeHost(host: string): string | null {
  const h = (host ?? '').trim().toLowerCase()
  if (!h || h.length > 253 || !HOST_RE.test(h)) return null
  return h
}

export function sanitizeCount(count: unknown): number {
  const c = Number(count)
  if (!Number.isFinite(c)) return 4
  return Math.min(20, Math.max(1, Math.trunc(c)))
}

function buildPingScript(host: string, count: number): string {
  return `
$host_ = '${host}'
$count = ${count}
$r = Test-Connection -ComputerName $host_ -Count $count -ErrorAction SilentlyContinue
if ($r) {
  $times = @($r | ForEach-Object { [int]$_.ResponseTime })
  $okN = $times.Count
  $loss = [math]::Round((($count - $okN) / $count) * 100.0, 1)
  [pscustomobject]@{
    min = ($times | Measure-Object -Minimum).Minimum
    avg = [math]::Round(($times | Measure-Object -Average).Average, 1)
    max = ($times | Measure-Object -Maximum).Maximum
    loss = $loss
    ok = $true
  } | ConvertTo-Json -Compress
} else {
  [pscustomobject]@{ min = 0; avg = 0; max = 0; loss = 100; ok = $false } | ConvertTo-Json -Compress
}
`
}

const INTERFACES_SCRIPT = `
$out = @()
# 已启用 TCP/IP 的网卡（含 IP）
Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction SilentlyContinue |
  Where-Object { $_.IPEnabled } | ForEach-Object {
    $ip = ''
    if ($_.IPAddress) {
      $v4 = @($_.IPAddress | Where-Object { $_ -match '^\\d{1,3}(\\.\\d{1,3}){3}$' })
      if ($v4.Count -gt 0) { $ip = [string]$v4[0] }
    }
    $out += [pscustomobject]@{ name = [string]$_.Description; ip = $ip; status = '已连接' }
  }
# 物理网卡但未连接（补充展示）
Get-CimInstance Win32_NetworkAdapter -ErrorAction SilentlyContinue |
  Where-Object { $_.PhysicalAdapter -and $_.NetConnectionStatus -ne 2 } | ForEach-Object {
    $name = [string]$_.Description
    if ($out.Name -notcontains $name) {
      $out += [pscustomobject]@{ name = $name; ip = ''; status = '未连接' }
    }
  }
if ($out.Count -eq 0) {
  $out = @([pscustomobject]@{ name = '未发现网卡'; ip = ''; status = '未知' })
}
$out | ConvertTo-Json -Compress
`

export function parsePing(stdout: string, host: string): PingResult {
  const trimmed = stdout.trim()
  if (!trimmed) return { host, min: 0, avg: 0, max: 0, loss: 100, ok: false }
  try {
    const raw = JSON.parse(trimmed) as Record<string, unknown>
    const n = (v: unknown, fallback: number): number => {
      const x = Number(v)
      return Number.isFinite(x) ? x : fallback
    }
    const loss = n(raw.loss, 100)
    const avg = n(raw.avg, 0)
    const ok = raw.ok === true || raw.ok === 'True' || (loss < 100 && avg > 0)
    return {
      host,
      min: n(raw.min, 0),
      avg,
      max: n(raw.max, 0),
      loss,
      ok
    }
  } catch {
    return { host, min: 0, avg: 0, max: 0, loss: 100, ok: false }
  }
}

function toInterface(raw: Record<string, unknown>): NetInterface {
  return {
    name: String(raw.name ?? ''),
    ip: String(raw.ip ?? ''),
    status: String(raw.status ?? '')
  }
}

export function parseInterfaces(stdout: string): NetInterface[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  try {
    const raw = JSON.parse(trimmed) as unknown
    const arr = Array.isArray(raw) ? raw : [raw]
    return arr.map((r) => toInterface(r as Record<string, unknown>))
  } catch {
    return []
  }
}

export function createNetworkService(runner: ExecRunner) {
  const ping = async (host: string, count?: number): Promise<PingResult> => {
    const safeHost = sanitizeHost(host)
    if (!safeHost) return { host: host || '', min: 0, avg: 0, max: 0, loss: 100, ok: false }
    const n = sanitizeCount(count)
    const { stdout } = await runner.run(buildPingScript(safeHost, n))
    return parsePing(stdout, safeHost)
  }

  const interfaces = async (): Promise<NetInterface[]> => {
    const { stdout } = await runner.run(INTERFACES_SCRIPT)
    return parseInterfaces(stdout)
  }

  return { ping, interfaces }
}
