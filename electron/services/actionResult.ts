import type { ToolResult } from '../../shared/types'

// ─────────────────────────────────────────────────────────────
// 脚本回执的统一解析
//
// 背景：各 service 原先各写一份「`stdout.includes('OK')` 即成功」，有三个真实缺陷：
//   1. 子串匹配 —— 错误信息里只要含 "OK" 字样（如 "token OK? denied"）就被判成功；
//   2. 只看 stdout 不看退出码 —— 脚本失败但残留 OK 输出时照样报成功；
//   3. 空输出被判成成功（`includes` 对空串为 false，但部分实现写了 `|| code === 0`）。
//
// 统一约定（脚本端与服务端必须一致）：
//   - 成功：**独立一行**的 `OK`（可带细节：`OK:<细节>`）
//   - 失败：**任意一行**以 `ERR:` 开头，其后为可直接展示给用户的原因
// 优先认错：只要出现 ERR: 就判失败，即使同时存在 OK。
// ─────────────────────────────────────────────────────────────

/** 成功令牌：整行恰为 `OK`，或 `OK:细节` */
const OK_RE = /^OK(?::(.*))?$/
/** 失败令牌：`ERR:原因` */
const ERR_RE = /^ERR:(.*)$/s

/** 判定用的单行回执（含原始文本，便于排查） */
export interface ActionOutcome extends ToolResult {
  /** 脚本原始输出（已 trim），失败时供诊断 */
  raw?: string
}

/**
 * 解析操作回执。
 *
 * @param stdout 脚本标准输出
 * @param code   退出码（非 0 视为失败信号之一）
 */
export function parseActionOutcome(stdout: string, code = 0): ActionOutcome {
  const raw = String(stdout ?? '').trim()
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  // 1) 优先认错：错误信息里可能夹带 OK，不能据此判成功
  for (const line of lines) {
    const m = ERR_RE.exec(line)
    // 多行 ERR: 时取第一条（通常是根因），其余作为补充丢在 raw 里
    if (m) return { ok: false, message: m[1].trim() || '操作失败', raw }
  }

  // 2) 必须是独立一行的 OK；顺带支持 OK:<细节> 回传更具体的信息
  for (const line of lines) {
    const m = OK_RE.exec(line)
    if (m) return { ok: true, message: m[1]?.trim() || '操作成功', raw }
  }

  // 3) 没有成功令牌：退出码非 0 或输出无法识别，一律如实报失败
  if (!raw) {
    return {
      ok: false,
      message: code === 0 ? '操作失败：脚本无输出' : `操作失败（退出码 ${code}）`,
      raw
    }
  }
  return { ok: false, message: code === 0 ? raw : `操作失败（退出码 ${code}）：${raw}`, raw }
}

/**
 * 非 PowerShell/bash 场景的兜底判定：只按退出码。
 * 仅用于「脚本本身没有回执令牌、但退出码可信」的工具（如 `ipconfig /flushdns`）。
 */
export function fromExitCode(
  code: number,
  stdout: string,
  stderr: string,
  okMsg: string,
  failMsg: string
): ToolResult {
  if (code === 0) return { ok: true, message: okMsg }
  const detail = String(stderr ?? '').trim() || String(stdout ?? '').trim()
  return { ok: false, message: detail || failMsg }
}
