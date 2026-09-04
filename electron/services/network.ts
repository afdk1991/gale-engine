import type { NetInterface, PingResult } from '../../shared/types'
import type { ExecRunner, Platform } from './shell'
import { detectPlatform } from './shell'

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

// ─────────────────────────────────────────────────────────────
// 平台脚本生成器：同一操作语义，三套平台实现
// ─────────────────────────────────────────────────────────────

/** Windows：Test-Connection 输出 JSON */
function buildPingScriptWin(host: string, count: number): string {
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

/**
 * macOS / Linux：ping 命令输出 JSON。
 * 跨平台差异处理：
 * - macOS 的 ping 默认无限循环，必须用 -c 指定次数；-t 为超时（秒）。
 * - Linux 的 ping -c 次数后自动结束；-W 为单包等待（秒，Linux）/（毫秒，部分发行版）。
 * - 时间字段：macOS 输出 "time=XX.XXX ms"，Linux 同样 "time=XX ms"，正则兼容两者。
 * - 不可达：两者 exit code 非 0，但 stdout 仍有统计行；脚本统一以 exit 0 收尾便于解析。
 */
function buildPingScriptUnix(host: string, count: number): string {
  // macOS ping -W 单位是毫秒，Linux 是秒；用 2000ms(mac)/2s(linux) 折中不可行，
  // 改用不带 -W（依赖系统默认），保证 POSIX 兼容。
  return `
host='${host}'
count=${count}
out=$(ping -c "$count" "$host" 2>/dev/null)
if [ -z "$out" ]; then
  echo '{"min":0,"avg":0,"max":0,"loss":100,"ok":false}'
  exit 0
fi
times=$(echo "$out" | grep -oE 'time=[0-9]+(\.[0-9]+)?' | grep -oE '[0-9]+(\.[0-9]+)?')
if [ -z "$times" ]; then
  echo '{"min":0,"avg":0,"max":0,"loss":100,"ok":false}'
  exit 0
fi
min=$(echo "$times" | sort -n | head -1)
max=$(echo "$times" | sort -n | tail -1)
okN=$(echo "$times" | wc -l | tr -d ' ')
avg=$(echo "$times" | awk '{s+=$1} END {printf "%.1f", s/NR}')
loss=$(awk "BEGIN {printf \"%.1f\", ($count - $okN) / $count * 100}")
echo "{\"min\":$min,\"avg\":$avg,\"max\":$max,\"loss\":$loss,\"ok\":true}"
`
}

/** 按平台分发 ping 脚本 */
export function buildPingScript(host: string, count: number, platform: Platform = detectPlatform()): string {
  return platform === 'win32'
    ? buildPingScriptWin(host, count)
    : buildPingScriptUnix(host, count)
}

/** Windows：Win32_NetworkAdapterConfiguration / Win32_NetworkAdapter */
const INTERFACES_SCRIPT_WIN = `
$out = @()
Get-CimInstance Win32_NetworkAdapterConfiguration -ErrorAction SilentlyContinue |
  Where-Object { $_.IPEnabled } | ForEach-Object {
    $ip = ''
    if ($_.IPAddress) {
      $v4 = @($_.IPAddress | Where-Object { $_ -match '^\\d{1,3}(\\.\\d{1,3}){3}$' })
      if ($v4.Count -gt 0) { $ip = [string]$v4[0] }
    }
    $out += [pscustomobject]@{ name = [string]$_.Description; ip = $ip; status = '已连接' }
  }
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

/**
 * macOS / Linux：ifconfig/ip 输出 JSON。
 * - macOS：ifconfig（默认存在）取已启用网卡名 + IPv4。
 * - Linux：ip addr（默认存在），兼容无 ifconfig 的精简发行版。
 * 状态：UP → 已连接，其余 → 未连接。
 */
const INTERFACES_SCRIPT_UNIX = `
emit() {
  # 用 printf 拼装 JSON 数组，避免依赖 jq
  printf '%s' "$1"
}
first=1
emit '['
if command -v ip >/dev/null 2>&1; then
  ip -o addr show 2>/dev/null | awk '
    $2 != "lo" {
      name=$2; st="未连接"; ip=""
      for(i=3;i<=NF;i++){ if($i=="UP") st="已连接" }
    }
    /inet \\/ { match($0,/inet ([0-9.]+)/,m); if(m[1] && m[1]!="127.0.0.1") ip=m[1] }
    { if(ip){ printf "%s{\\"name\\":\\"%s\\",\\"ip\\":\\"%s\\",\\"status\\":\\"%s\\"}", (first?"":","), name, ip, st; first=0; ip="" } }
  '
elif command -v ifconfig >/dev/null 2>&1; then
  ifconfig -a 2>/dev/null | awk '
    /^[^ \\t]/ { name=$1; sub(":","",name); st="未连接"; ip=""; if($0~/UP/) st="已连接" }
    /inet / { match($0,/inet ([0-9.]+)/,m); if(m[1] && m[1]!="127.0.0.1") ip=m[1] }
    { if(name && ip){ printf "%s{\\"name\\":\\"%s\\",\\"ip\\":\\"%s\\",\\"status\\":\\"%s\\"}", (first?"":","), name, ip, st; first=0; name=""; ip="" } }
  '
fi
if [ "$first" = "1" ]; then
  emit '{"name":"未发现网卡","ip":"","status":"未知"}'
fi
emit ']'
`

/** 按平台分发网卡脚本 */
export function buildInterfacesScript(platform: Platform = detectPlatform()): string {
  return platform === 'win32' ? INTERFACES_SCRIPT_WIN : INTERFACES_SCRIPT_UNIX
}

// ─────────────────────────────────────────────────────────────
// 解析器（平台无关，统一解析 JSON）
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// Service 工厂（接口不变，内部按平台分发脚本）
// ─────────────────────────────────────────────────────────────

export function createNetworkService(runner: ExecRunner, platform: Platform = detectPlatform()) {
  const ping = async (host: string, count?: number): Promise<PingResult> => {
    const safeHost = sanitizeHost(host)
    if (!safeHost) return { host: host || '', min: 0, avg: 0, max: 0, loss: 100, ok: false }
    const n = sanitizeCount(count)
    const { stdout } = await runner.run(buildPingScript(safeHost, n, platform))
    return parsePing(stdout, safeHost)
  }

  const interfaces = async (): Promise<NetInterface[]> => {
    const { stdout } = await runner.run(buildInterfacesScript(platform))
    return parseInterfaces(stdout)
  }

  return { ping, interfaces }
}
