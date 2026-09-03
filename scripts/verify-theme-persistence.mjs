// 主题持久化端到端验收（真实 GUI 级）
// 流程：备份并清空配置 → 启动应用（--remote-debugging-port）→ 通过 CDP 驱动真实 DOM
// 点击「深色 + 能量橙」→ 关闭应用 → 再次启动（不做任何操作）→ 验证主题保持。
// 用法：node scripts/verify-theme-persistence.mjs [exe路径]
// 默认 exe：release/win-unpacked/疾风引擎.exe
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const EXE = process.argv[2] ?? resolve(__dirname, '../release/win-unpacked/疾风引擎.exe')
const PORT = 9222
// Electron 的 userData 目录取 package.json 的 name（gale-engine），而非 productName
const CONFIG = join(homedir(), 'AppData', 'Roaming', 'gale-engine', 'config.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!existsSync(EXE)) {
  console.error(`❌ 找不到应用：${EXE}`)
  process.exit(2)
}

async function waitForPage(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = targets.find((t) => t.type === 'page')
      if (page) return page
    } catch {
      /* 应用尚未就绪，继续等 */
    }
    await sleep(300)
  }
  throw new Error('等待应用页面超时')
}

function connect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => res(ws)
    ws.onerror = () => rej(new Error('CDP WebSocket 连接失败'))
  })
}

function makeEval(ws) {
  let seq = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  return (expression) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, (msg) =>
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result?.result?.value)
      )
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
}

function killTree(child) {
  return new Promise((res) => {
    if (!child.pid) return res()
    const tk = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    tk.on('exit', () => res())
  })
}

async function launch() {
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore' })
  const page = await waitForPage()
  const ws = await connect(page.webSocketDebuggerUrl)
  return { child, ws, eval: makeEval(ws) }
}

const readTheme = (evaluate) =>
  evaluate(
    `JSON.stringify({
      theme: document.documentElement.dataset.theme,
      accent: document.documentElement.style.getPropertyValue('--accent').trim()
    })`
  ).then(JSON.parse)

/** 轮询等待页面内表达式为真（应用启动/路由渲染均有时延，不能靠固定 sleep） */
async function waitFor(evaluate, expression, timeoutMs = 15000, what = expression) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression).catch(() => false)) return
    await sleep(250)
  }
  throw new Error(`等待超时：${what}`)
}

async function main() {
  // 备份原配置并清空，确保从默认主题（system/blue）开始
  const backup = existsSync(CONFIG) ? readFileSync(CONFIG, 'utf8') : null
  if (backup !== null) rmSync(CONFIG)

  try {
    // 第一次启动：真实点击切换到 深色 + 能量橙
    {
      const app = await launch()
      await waitFor(app.eval, `!!document.querySelector('.nav-item')`, 15000, '应用挂载完成')
      await app.eval(`location.hash = '#/settings'`)
      await waitFor(app.eval, `!!document.querySelector('.seg-btn')`, 15000, '设置页渲染完成')
      const dark = await app.eval(
        `(() => { const b = [...document.querySelectorAll('.seg-btn')].find(b => b.textContent.trim() === '深色'); if (!b) return 'NOT_FOUND'; b.click(); return 'CLICKED'; })()`
      )
      if (dark !== 'CLICKED') throw new Error('未找到「深色」按钮')
      await waitFor(
        app.eval,
        `[...document.querySelectorAll('.seg-btn')].some(b => b.textContent.trim() === '深色' && b.classList.contains('on'))`,
        5000,
        '深色按钮选中态'
      )
      const orange = await app.eval(
        `(() => { const b = [...document.querySelectorAll('.color')].find(b => b.textContent.includes('能量橙')); if (!b) return 'NOT_FOUND'; b.click(); return 'CLICKED'; })()`
      )
      if (orange !== 'CLICKED') throw new Error('未找到「能量橙」色板')
      await sleep(1200) // 等待 IPC 持久化写盘
      const state = await readTheme(app.eval)
      console.log('切换后  :', JSON.stringify(state))
      app.ws.close()
      await killTree(app.child)
      await sleep(1500)
    }

    // 第二次启动：不做任何操作，验证主题保持
    {
      const app = await launch()
      await waitFor(app.eval, `!!document.querySelector('.nav-item')`, 15000, '应用挂载完成')
      const state = await readTheme(app.eval)
      const saved = JSON.parse(readFileSync(CONFIG, 'utf8'))
      console.log('重启后  :', JSON.stringify(state))
      console.log('落盘配置:', JSON.stringify(saved.theme))
      app.ws.close()
      await killTree(app.child)

      const pass =
        state.theme === 'dark' &&
        state.accent === '#f97316' &&
        saved.theme?.appearance === 'dark' &&
        saved.theme?.accent === 'orange'
      console.log(pass ? '✅ 主题持久化验收通过（深色 + 能量橙 跨重启保持）' : '❌ 主题持久化验收失败')
      process.exitCode = pass ? 0 : 1
    }
  } finally {
    // 恢复原配置（无原配置则清掉测试产物）
    if (backup !== null) writeFileSync(CONFIG, backup)
    else if (existsSync(CONFIG)) rmSync(CONFIG)
  }
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
