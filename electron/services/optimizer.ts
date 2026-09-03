import type {
  CleanupPlan,
  CleanupResult,
  StartupItem,
  OptimizerTargetKind
} from '../../shared/types'
import type { ExecRunner } from './shell'

/** 允许的临时目录白名单（仅这些路径下的清理被视为 safe） */
function allowedTempRoots(): string[] {
  const temp = process.env.TEMP || process.env.TMP || ''
  const sysroot = process.env.SystemRoot || 'C:\\Windows'
  return [temp, `${sysroot}\\Temp`].filter(Boolean)
}

/** 允许的浏览器缓存根目录（仅 %LOCALAPPDATA% 下指定浏览器的 User Data） */
function allowedBrowserRoots(): string[] {
  const local = process.env.LOCALAPPDATA || ''
  if (!local) return []
  return [
    `${local}\\Google\\Chrome\\User Data`,
    `${local}\\Microsoft\\Edge\\User Data`
  ].filter(Boolean)
}

const SCAN_SCRIPT = `
$temps = @($env:TEMP, "$env:SystemRoot\\Temp") | Where-Object { $_ -and (Test-Path $_) }
$plans = @()
foreach ($t in $temps) {
  $sz = (Get-ChildItem $t -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t))
  $plans += [pscustomobject]@{ id="temp:$b64"; kind="temp"; label="临时文件：$t"; path=$t; size=[int]($sz ?? 0); safe=$true }
}
try {
  $shell = New-Object -ComObject Shell.Application
  $rb = $shell.NameSpace(10)
  $sz = 0
  foreach ($i in $rb.Items()) { $sz += $i.Size }
  $plans += [pscustomobject]@{ id="recycle"; kind="recycle"; label="回收站"; path="RecycleBin"; size=[int]$sz; safe=$true }
} catch {}
$browsers = @(
  @{ name = 'Chrome'; base = "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\Default" },
  @{ name = 'Edge';   base = "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\Default" }
)
foreach ($b in $browsers) {
  foreach ($sub in @('Cache', 'Code Cache')) {
    $p = Join-Path $b.base $sub
    if (Test-Path $p) {
      $sz = (Get-ChildItem $p -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
      $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p))
      $plans += [pscustomobject]@{ id="browser:$b64"; kind="browser"; label="$($b.name) 缓存：$sub"; path=$p; size=[int]($sz ?? 0); safe=$true }
    }
  }
}
$plans | ConvertTo-Json -Compress
`

const STARTUP_SCRIPT = `
$keys = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run')
$items = @()
foreach ($k in $keys) {
  if (Test-Path $k) {
    $loc = if ($k.StartsWith('HKCU')) { 'HKCU' } else { 'HKLM' }
    $props = Get-ItemProperty $k
    $props.PSObject.Properties | Where-Object { $_.Name -notin @('PSPath','PSParentPath','PSChildName','PSDrive','PSProvider') } | ForEach-Object {
      $items += [pscustomobject]@{ name=$_.Name; command=[string]$_.Value; location=$loc; enabled=$true }
    }
  }
}
$items | ConvertTo-Json -Compress
`

function parseJsonArray(stdout: string): unknown[] {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  try {
    return JSON.parse(trimmed) as unknown[]
  } catch {
    return []
  }
}

function toPlan(raw: Record<string, unknown>): CleanupPlan {
  const kind = raw.kind
  const validKind: OptimizerTargetKind =
    kind === 'recycle' || kind === 'browser' || kind === 'temp' ? kind : 'temp'
  const size = raw.size
  return {
    id: String(raw.id ?? ''),
    kind: validKind,
    label: String(raw.label ?? ''),
    path: String(raw.path ?? ''),
    sizeBytes: typeof size === 'number' ? size : Number(size) || 0,
    safe: raw.safe === true || raw.safe === 'True'
  }
}

function toStartupItem(raw: Record<string, unknown>): StartupItem {
  const loc = raw.location === 'HKLM' ? 'HKLM' : 'HKCU'
  const name = String(raw.name ?? '')
  return {
    id: `${loc}:${name}`,
    name,
    command: String(raw.command ?? ''),
    location: loc,
    enabled: raw.enabled !== false
  }
}

export function createOptimizerService(runner: ExecRunner) {
  const scanCleanup = async (): Promise<CleanupPlan[]> => {
    const { stdout } = await runner.run(SCAN_SCRIPT)
    return parseJsonArray(stdout).map((r) => toPlan(r as Record<string, unknown>))
  }

  const runCleanup = async (
    items: { id: string; path: string; kind: OptimizerTargetKind }[]
  ): Promise<CleanupResult[]> => {
    const roots = [...allowedTempRoots(), ...allowedBrowserRoots()]
    const isSafePath = (p: string): boolean =>
      roots.some((r) => p === r || p.startsWith(r + '\\') || p.startsWith(r + '/'))
    const results: CleanupResult[] = []
    for (const item of items) {
      if (item.kind === 'recycle') {
        const { code, stderr } = await runner.run(
          'Clear-RecycleBin -Force -ErrorAction SilentlyContinue; if ($?) { "OK" } else { "FAIL" }'
        )
        results.push({
          id: item.id,
          ok: code === 0,
          error: code === 0 ? undefined : stderr.trim() || '清理回收站失败'
        })
        continue
      }
      if (!isSafePath(item.path)) {
        results.push({ id: item.id, ok: false, error: '路径不在安全白名单内，已跳过' })
        continue
      }
      const script = `Get-ChildItem "${item.path}" -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; if ($?) { "OK" } else { "FAIL" }`
      const { code, stdout, stderr } = await runner.run(script)
      const ok = code === 0 && stdout.includes('OK')
      results.push({ id: item.id, ok, error: ok ? undefined : stderr.trim() || '清理失败' })
    }
    return results
  }

  const listStartup = async (): Promise<StartupItem[]> => {
    const { stdout } = await runner.run(STARTUP_SCRIPT)
    return parseJsonArray(stdout).map((r) => toStartupItem(r as Record<string, unknown>))
  }

  const toggleStartup = async (
    id: string,
    enable: boolean,
    command?: string
  ): Promise<StartupItem[]> => {
    const idx = id.indexOf(':')
    const location = idx > 0 ? id.slice(0, idx) : 'HKCU'
    const name = idx > 0 ? id.slice(idx + 1) : id
    const regKey = `${location}:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`
    if (enable) {
      const cmd = (command ?? '').replace(/"/g, '`"')
      await runner.run(`Set-ItemProperty -Path "${regKey}" -Name "${name}" -Value "${cmd}" -ErrorAction Stop; "OK"`)
    } else {
      await runner.run(`Remove-ItemProperty -Path "${regKey}" -Name "${name}" -ErrorAction SilentlyContinue; "OK"`)
    }
    return listStartup()
  }

  return { scanCleanup, runCleanup, listStartup, toggleStartup }
}
