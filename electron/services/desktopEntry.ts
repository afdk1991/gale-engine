/**
 * Desktop Entry（.desktop）字段转义。
 *
 * 为什么单独成模块：本项目有两处会写 .desktop 文件 ——
 * 开机自启（`autolaunch.ts`）与启用启动项（`optimizer.ts`）。
 * 两处都必须按同一套规则转义，否则会出现「一边安全一边可注入」的割裂。
 */

/**
 * 转义 `Exec=` 的单个参数。
 *
 * 按 Desktop Entry 规范：含保留字符的参数须用**双引号**包裹，且引号内的
 * `"` `` ` `` `$` `\` 必须反斜杠转义 —— 否则形如 `/opt/My $App/gale` 的路径
 * 会被 desktop 文件解析器按 shell 语义求值，导致自启项静默损坏或被注入执行。
 * `\r`/`\n` 会破坏文件结构，直接剔除。
 */
export function escapeDesktopExecArg(arg: string): string {
  const clean = String(arg ?? '').replace(/[\r\n]/g, '')
  return `"${clean.replace(/[\\"$`]/g, (ch) => `\\${ch}`)}"`
}

/** 转义 .desktop 的普通字符串字段（`Name=` 等）：单行、去首尾空白 */
export function escapeDesktopValue(value: string): string {
  return String(value ?? '')
    .replace(/[\r\n]/g, ' ')
    .trim()
}
