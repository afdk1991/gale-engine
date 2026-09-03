// M3 页面级端到端验收（真实 GUI 级）
// 流程：启动应用 → CDP 导航到 进程管理 / 网络诊断 → 校验页面渲染与 IPC 调用返回。
// 用法：node scripts/verify-m3-pages.mjs [exe路径]
// 默认 exe：release/win-unpacked/疾风引擎.exe
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const EXE = process.argv[2] ?? resolve(__dirname, '../release/win-unpacked/疾风引擎.exe')
const PORT = 9223

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
      /* not ready */
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

async function waitFor(evaluate, expression, timeoutMs = 15000, what = expression) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression).catch(() => false)) return
    await sleep(250)
  }
  throw new Error(`等待超时：${what}`)
}

async function main() {
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { stdio: 'ignore' })
  try {
    const page = await waitForPage()
    const ws = await connect(page.webSocketDebuggerUrl)
    const ev = makeEval(ws)
    await waitFor(ev, `!!document.querySelector('.nav-item')`, 15000, '应用挂载完成')

    const results = []
    const checks = []

    // 1) 进程管理页：渲染表格 + 真实 IPC 取数
    await ev(`location.hash = '#/process'`)
    // 等待数据行渲染完成（.table-wrap 是静态骨架，需等 tbody 出现行）
    await waitFor(ev, `document.querySelectorAll('tbody tr').length > 0`, 20000, '进程表格数据行')
    const procRows = await ev(`document.querySelectorAll('tbody tr').length`)
    const procCount = Number(procRows) || 0
    checks.push(procCount > 0)
    results.push(`进程管理页：表格渲染 ${procCount} 行（应 >0）→ ${procCount > 0 ? '✅' : '❌'}`)

    // 进程 IPC 直测：排序 + 结束保护（用一个不可能存在的 pid 验证保护层不崩溃）
    const listLen = await ev(`window.gale.process.list('cpu').then(l => l.length)`)
    checks.push(Number(listLen) > 0)
    results.push(`window.gale.process.list('cpu') 返回 ${listLen} 项 → ${Number(listLen) > 0 ? '✅' : '❌'}`)
    const killBad = await ev(`window.gale.process.kill(999999999).then(r => r.message)`)
    results.push(`结束不存在进程：${killBad}（应给出失败回执）`)
    checks.push(typeof killBad === 'string' && killBad.length > 0)

    // 2) 网络诊断页：渲染 + Ping IPC
    await ev(`location.hash = '#/network'`)
    await waitFor(ev, `!!document.querySelector('.card')`, 15000, '网络页渲染')
    const pingResult = await ev(
      `window.gale.network.ping('127.0.0.1', 2).then(r => JSON.stringify(r))`
    )
    const ping = JSON.parse(pingResult)
    checks.push(ping.ok === true)
    results.push(`Ping 127.0.0.1：avg=${ping.avg}ms loss=${ping.loss}% → ${ping.ok ? '✅' : '❌'}`)

    const ifaceLen = await ev(`window.gale.network.interfaces().then(l => l.length)`)
    checks.push(Number(ifaceLen) > 0)
    results.push(`网卡列表：${ifaceLen} 项 → ${Number(ifaceLen) > 0 ? '✅' : '❌'}`)

    ws.close()
    console.log(results.join('\n'))
    const pass = checks.every(Boolean)
    console.log(pass ? '✅ M3 页面级验收通过' : '❌ M3 页面级验收失败')
    process.exitCode = pass ? 0 : 1
  } finally {
    await killTree(child)
  }
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
