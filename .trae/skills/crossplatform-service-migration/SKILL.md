---
name: "crossplatform-service-migration"
description: "Migrates Electron system-service modules from Windows-only to Windows/macOS/Linux cross-platform. Invoke when adding macOS/Linux support to a service in electron/services/ or when building new platform-native features."
---

# Cross-Platform Service Migration (Gale Engine)

This skill codifies the proven pattern used in this repository to migrate Windows-only system service modules (in `electron/services/`) to full cross-platform support for Windows (win32), macOS (darwin), and Linux.

## When to Invoke

- Migrating an existing Windows-only service (e.g. `disk.ts`, `network.ts`) to support macOS/Linux
- Creating a new service that must work across all three OSes
- Fixing cross-platform bugs (encoding issues, command output parsing, permission errors)
- Adding tests for platform-specific scripts

## Architecture Principles

### 1. Platform Script Generator Pattern

Each service module exports a **platform script generator function** that takes parameters and returns a platform-native script string:

- **Windows** → PowerShell script (executed via `createPowershellRunner()`)
- **macOS / Linux** → POSIX bash script (executed via `createBashRunner()`)

The generator switches on the `Platform` type from `shell.ts`:

```typescript
import { Platform } from './shell'

export function buildMyServiceScript(platform: Platform, params: MyParams): string {
  switch (platform) {
    case 'win32': return buildWindowsScript(params)
    case 'darwin': return buildMacOSScript(params)
    case 'linux': return buildLinuxScript(params)
    default: throw new Error(`Unsupported platform: ${platform}`)
  }
}
```

**Never** call platform-specific APIs (like WMI, registry, COM) outside the `'win32'` branch.

### 2. Safety First — Whitelist Validation

All services that accept **user-supplied names** (service names, firewall rule names, scheduled task names, unit names, etc.) MUST validate with a regex whitelist **in JavaScript before passing to the shell**:

- Windows services/rules: `isSafeServiceName(name)` — alphanumeric, underscore, hyphen; no shell metacharacters
- Unix unit names (systemd/launchd): `isSafeUnixUnitName(name)` — alphanumeric, underscore, hyphen, dot; no `/`, `;`, `|`, `&`, `$`, backticks, spaces

**Why double?** The native tool (PowerShell/bash) might also do quoting, but JS-side validation provides defense-in-depth and prevents injection before command construction.

### 3. Honest Degradation

When a platform simply does not support an operation (e.g., macOS `launchctl enable/disable` requires SIP-protected files; Linux minimal installs lack `ufw`):

- **Do NOT fake success.** Return a structured error with a `message` field explaining what the user should do (e.g., "在 macOS 上停止开机自启需前往「系统设置 → 通用 → 登录项」手动移除").
- **Check tool availability first.** On Linux, verify `ufw`/`systemctl` exists before running it; if missing, return a graceful "not available" result instead of a shell error.
- **Offer alternatives.** When one tool fails, try the fallback (e.g., `systemctl --user` → `crontab` for user-level scheduled tasks on Linux).

### 4. Unified Result Interface

All services must return a consistent interface regardless of platform. Do NOT leak platform-specific fields to the renderer/IPC layer:

```typescript
interface ServiceStatus {
  name: string
  running: boolean
  enabled: boolean     // maps to "startup type" concept
  pid?: number
  // Any platform-specific metadata goes in `details?: Record<string, unknown>`
}
```

Map platform-native states into these canonical fields:

| Concept | Windows | macOS | Linux |
|---|---|---|---|
| Running | `State === 'Running'` | `PID != 0` and not `-` | `ActiveState === 'active'` |
| Enabled/Disabled | `StartMode === 'Auto'/'Disabled'` | `launchctl print-disabled` (guide user) | `UnitFileState === 'enabled'/'disabled'` |
| Start/Stop | `Start-Service/Stop-Service` | `launchctl kickstart -k/bootout` (with honest note) | `systemctl start/stop` |

## Cross-Platform Command Reference

### Service Management (`winservices.ts` model)

| Operation | Windows (PowerShell) | macOS (bash) | Linux (bash) |
|---|---|---|---|
| List all | `Get-CimInstance Win32_Service \| Select Name,DisplayName,State,StartMode,ProcessId` | `launchctl list` (user) + `launchctl print system/` for system | `systemctl list-units --type=service --all --no-pager --no-legend` |
| Get status | `Get-CimInstance Win32_Service -Filter "Name='X'"` | `launchctl print system/X` or `launchctl list X` | `systemctl show X --property=ActiveState,SubState,UnitFileState,MainPID --no-pager` |
| Start | `Start-Service -Name X` | `sudo launchctl kickstart -k system/X` (limited) | `sudo systemctl start X` |
| Stop | `Stop-Service -Name X` | honest degradation → System Settings | `sudo systemctl stop X` |
| Enable (startup) | `Set-Service -Name X -StartupType Automatic` | honest degradation → System Settings | `sudo systemctl enable X` |
| Disable | `Set-Service -Name X -StartupType Disabled` | honest degradation → System Settings | `sudo systemctl disable X` |

**PROTECTED_UNIX_UNITS** must blacklist critical system services that must never be stopped/disabled, equivalent to Windows critical service protection.

### Scheduled Tasks (`tasks.ts` model)

| Operation | Windows | macOS | Linux |
|---|---|---|---|
| Create | `Register-ScheduledTask` with XML action | `launchctl submit -l NAME -- PROGRAM ARGS` | Per-user: `systemctl --user` with `.service` + `.timer`; fallback to `crontab` |
| List | `Get-ScheduledTask` | `launchctl list \| grep` user domain | `systemctl --user list-timers --all` (or `crontab -l` fallback) |
| Delete | `Unregister-ScheduledTask` | `launchctl remove NAME` | `systemctl --user stop/disable` (or `crontab -l \| sed \| crontab`) |
| Trigger | Time-based, logon | `StartInterval`/`StartCalendarInterval` | `OnCalendar` in .timer |

### Firewall (`firewall.ts` model)

| Operation | Windows | macOS | Linux |
|---|---|---|---|
| Enable/Disable | `Set-NetFirewallProfile -Enabled True/False` | `pfctl -e/-f` (requires sudo; anchor-based) | `ufw enable/disable` (if available); fallback to iptables |
| List rules | `Get-NetFirewallRule \| Get-NetFirewallPortFilter` | `pfctl -sr` (parse anchor) | `ufw status numbered` (if available) |
| Add port rule | `New-NetFirewallRule -Direction Inbound -Action Allow -Protocol TCP -LocalPort X -DisplayName Y` | `pfctl -a gale -f /tmp/pf.conf` (anchor-based, ephemeral) | `ufw allow X/tcp` (if available) |
| Delete rule | `Remove-NetFirewallRule -DisplayName Y` | `pfctl -a gale -F` (flush anchor) | `ufw delete RULE_NUM` (parse numbered list) |

**Critical Linux safety**: Always check for `ufw` existence with `command -v ufw >/dev/null 2>&1`. If `ufw` is not installed, **never fall back to raw iptables** without user confirmation — a misconfigured iptables rule can lock the user out of SSH. Return a "需要 ufw 或手动配置 iptables" message instead.

## Script Output Convention

All platform scripts MUST end output with an explicit marker so the JS parser can reliably detect success and distinguish structured data from noise:

- **PowerShell**: Write data then `Write-Host "OK"` on success. On error, use `Write-Error` and exit 1.
- **Bash**: Write data then `echo "OK"` on success. On error, echo error message to stderr and `exit 1`.

Parsing in JS: split on the marker; if "OK" is not present, treat as failure.

```typescript
// Example PowerShell output parser
const parts = result.stdout.split(/\r?\nOK\r?\n/)
if (result.code !== 0 || parts.length < 2) {
  return { success: false, error: result.stderr || parsePowershellError(result.stdout) }
}
// parse structured data from parts[0]
```

## PowerShell Encoding Fix (Windows)

Always prepend `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;` to PowerShell scripts. Without this, PowerShell 5.1 uses the system ANSI code page (e.g., GBK on Chinese Windows), and Node interprets the output as UTF-8, causing garbled Chinese characters. The default `createPowershellRunner()` already does this for you — **do not bypass it**.

## Testing Strategy

### Mock Platform-Independent Testing

Tests must run on any platform (Windows/macOS/Linux CI). Use **dependency injection** of the `ExecRunner`:

```typescript
// In service: accept runner as parameter for testability
export async function queryServices(runner: ExecRunner, platform: Platform): Promise<ServiceStatus[]>

// In tests: inject a fake runner that returns pre-canned output
const fakeRunner = { run: async () => ({ stdout: mockWindowsOutput, stderr: '', code: 0 }) }
const result = await queryServices(fakeRunner, 'win32')
expect(result[0].name).toBe('Spooler')
```

### Test Data: Use REAL Command Output

Mock data should be **copied from real system output**, not fabricated. This catches parsing bugs from unexpected whitespace, column alignment, or status strings.

### Test Matrix

For each migrated service, add test cases covering:

1. **Windows normal flow** (success parsing of real `Get-CimInstance` / `Get-NetFirewallRule` output)
2. **Windows error flow** (service not found, permission denied)
3. **macOS normal flow** (real `launchctl list` / `systemctl` output)
4. **macOS degradation flow** (operation that returns honest guidance)
5. **Linux normal flow** (real `systemctl show` / `ufw status` output)
6. **Linux missing-tool flow** (ufw not installed → safe degradation, not iptables fallback)
7. **Safety validation** (names with shell metacharacters rejected before command construction)

## Migration Checklist

When migrating a new service, work through this checklist in order:

1. [ ] Read the existing Windows-only implementation to understand all operations and result fields
2. [ ] Define a unified result interface (add platform-specific fields to `details?` only)
3. [ ] Research macOS equivalents: `man launchctl`, `man pfctl`, System Settings behavior
4. [ ] Research Linux equivalents: `systemctl`, `crontab`, `ufw`/`firewalld`/`iptables` (with availability checks)
5. [ ] Identify operations requiring **honest degradation** (macOS SIP limitations, tool not installed)
6. [ ] Define platform script generators with switch on `Platform` type
7. [ ] Add JS-side whitelist validation for any user-supplied identifiers
8. [ ] Use explicit "OK" end marker in scripts; parse by splitting on marker
9. [ ] Inject `ExecRunner` for testability; do not import concrete runners directly
10. [ ] Write tests with real captured command output for all 3 platforms
11. [ ] Run full test suite (`npm test`) to ensure no regressions
12. [ ] Run TypeScript type check (`npx tsc --noEmit`) for zero errors
13. [ ] Update `electron-builder.yml` only if new native dependencies are needed (rare)

## Common Pitfalls

1. **Forgetting PowerShell UTF-8 prefix** → Chinese output garbled. Use `createPowershellRunner()` which handles this.
2. **Assuming bash 4+ on macOS** → macOS ships bash 3.2 by default. Use POSIX-compatible syntax only; use `#!/bin/bash` (not `#!/usr/bin/env bash`), and avoid arrays, associative arrays, `[[ ]]` regex with `=~`.
3. **sudo without user context** → GUI apps launched by double-click do not have sudo. Operations requiring root should return a clear message directing users to CLI usage or polkit/Authorization Services.
4. **Race condition in CI releases** → If multiple GitHub Actions matrix jobs upload to the same Release, use `upload-artifact` + a single `release` job with `needs: build` to publish everything at once. See `.github/workflows/release.yml` for the pattern.
5. **Missing icon sizes** → electron-builder requires `build/icon.png` to be at least 512×512 (1024×1024 recommended) to auto-generate `.icns` for macOS. The `scripts/generate-icon.mjs` script generates both `icon.ico` (multi-size) and a 1024px `icon.png`.
6. **Linux cross-compilation dependencies** → Linux ARM64 builds need `qemu-user-static` and `binfmt-support`; macOS icon conversion on Linux needs `icnsutils`. Install them in the CI step before building.
