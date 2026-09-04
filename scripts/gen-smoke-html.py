#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 docs/smoke-test-checklist.md 解析检查项，生成可勾选的交互式 HTML 清单。
输出: docs/smoke-test-checklist.html
特性: 分组折叠、勾选持久化(localStorage)、进度统计、结果导出(.json/.csv)、重置。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "smoke-test-checklist.md"
OUT = ROOT / "docs" / "smoke-test-checklist.html"

text = SRC.read_text(encoding="utf-8")
lines = text.splitlines()

sections = []  # list of {title, items:[{text, machine}]}
current = None
for line in lines:
    m = re.match(r"^##\s+(.*)$", line)
    if m:
        current = {"title": m.group(1).strip(), "items": []}
        sections.append(current)
        continue
    m = re.match(r"^- \[ \]\s+(.*)$", line)
    if m and current is not None:
        item = m.group(1).strip()
        # 「需 Windows 实机」标注在章节标题（如「四、GUI 冒烟（⚙️ 需 Windows 实机）」），
        # 该章节下所有项均需在真实 Windows 执行。
        machine = "实机" in current["title"] or "GUI" in current["title"]
        current["items"].append({"text": item, "machine": machine})

# 总项数与实机项数
total = sum(len(s["items"]) for s in sections)
machine_total = sum(1 for s in sections for it in s["items"] if it["machine"])

# 构建 HTML 数据
data = {
    "total": total,
    "machineTotal": machine_total,
    "sections": [
        {"title": s["title"], "items": s["items"]} for s in sections
    ],
}

html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>疾风引擎 — 发布前冒烟清单</title>
<style>
  :root { --bg:#0f1115; --panel:#1a1d24; --panel2:#21252e; --line:#2c313c;
    --txt:#e6e9ef; --muted:#9aa3b2; --accent:#4f9dff; --ok:#36c275; --warn:#e0a93b; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
    background:var(--bg); color:var(--txt); line-height:1.55; }
  header { position:sticky; top:0; z-index:10; padding:16px 20px;
    background:linear-gradient(180deg,#161a22,#12151b); border-bottom:1px solid var(--line); }
  h1 { margin:0 0 8px; font-size:19px; }
  .bar { height:10px; border-radius:6px; background:var(--panel2); overflow:hidden; }
  .bar > i { display:block; height:100%; width:0; background:linear-gradient(90deg,#4f9dff,#36c275); transition:width .25s; }
  .meta { display:flex; gap:16px; flex-wrap:wrap; margin-top:8px; font-size:13px; color:var(--muted); }
  .meta b { color:var(--txt); }
  .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  button { background:var(--panel2); color:var(--txt); border:1px solid var(--line);
    padding:6px 12px; border-radius:8px; cursor:pointer; font-size:13px; }
  button:hover { border-color:var(--accent); }
  main { padding:18px 20px 60px; max-width:920px; margin:0 auto; }
  section { background:var(--panel); border:1px solid var(--line); border-radius:12px;
    margin-bottom:14px; overflow:hidden; }
  .sec-head { display:flex; align-items:center; gap:10px; padding:12px 14px; cursor:pointer;
    background:var(--panel2); user-select:none; }
  .sec-head h2 { margin:0; font-size:15px; flex:1; }
  .sec-head .cnt { font-size:12px; color:var(--muted); }
  .sec-head .arrow { transition:transform .2s; color:var(--muted); }
  section.collapsed .arrow { transform:rotate(-90deg); }
  section.collapsed .body { display:none; }
  .body { padding:6px 14px 12px; }
  label.item { display:flex; gap:10px; align-items:flex-start; padding:7px 4px;
    border-bottom:1px dashed var(--line); cursor:pointer; }
  label.item:last-child { border-bottom:none; }
  label.item input { margin-top:4px; width:16px; height:16px; accent-color:var(--ok); flex:none; }
  label.item .t { font-size:14px; }
  label.item.machine .t::after { content:" ⚙️实机"; font-size:11px; color:var(--warn); margin-left:6px; }
  label.item.done .t { color:var(--ok); text-decoration:line-through; opacity:.8; }
  .empty { color:var(--muted); padding:30px; text-align:center; }
  footer { color:var(--muted); font-size:12px; text-align:center; padding:20px; }
</style>
</head>
<body>
<header>
  <h1>疾风引擎 · 发布前冒烟与检查清单</h1>
  <div class="bar"><i id="bar"></i></div>
  <div class="meta">
    <span>完成 <b id="done">0</b> / <b id="total">0</b></span>
    <span>进度 <b id="pct">0%</b></span>
    <span>实机项 <b id="mtotal">0</b>（<b id="mdone">0</b> 已点）</span>
    <span>最后保存 <b id="saved">—</b></span>
  </div>
  <div class="actions">
    <button id="expand">全部展开</button>
    <button id="collapse">全部折叠</button>
    <button id="export">导出结果 (JSON)</button>
    <button id="exportCsv">导出 (CSV)</button>
    <button id="reset">重置全部</button>
  </div>
</header>
<main id="app"></main>
<footer>勾选状态保存在本机浏览器（localStorage），不会上传。供真实 Windows 上逐项点检。</footer>
<script>
const DATA = __DATA__;
const KEY = "gale-smoke-v1";
const STORE = {};
try { Object.assign(STORE, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch(e){}

function save(){ localStorage.setItem(KEY, JSON.stringify(STORE));
  document.getElementById("saved").textContent = new Date().toLocaleString("zh-CN"); }

function render(){
  const app = document.getElementById("app");
  app.innerHTML = "";
  DATA.sections.forEach((sec, si) => {
    const sec_el = document.createElement("section");
    const done = sec.items.filter((_,i)=>STORE[si+"-"+i]).length;
    sec_el.innerHTML = `<div class="sec-head"><span class="arrow">▾</span>
      <h2>${si+1}. ${sec.title}</h2><span class="cnt">${done}/${sec.items.length}</span></div>
      <div class="body"></div>`;
    const body = sec_el.querySelector(".body");
    sec.items.forEach((it, i) => {
      const lab = document.createElement("label");
      lab.className = "item" + (it.machine ? " machine":"") + (STORE[si+"-"+i] ? " done":"");
      lab.innerHTML = `<input type="checkbox" ${STORE[si+"-"+i]?"checked":""}/>
        <span class="t">${it.text.replace(/⚙️/g,"")}</span>`;
      lab.querySelector("input").addEventListener("change", e => {
        if (e.target.checked) STORE[si+"-"+i] = 1; else delete STORE[si+"-"+i];
        lab.classList.toggle("done", e.target.checked);
        save(); update();
      });
      body.appendChild(lab);
    });
    sec_el.querySelector(".sec-head").addEventListener("click", () =>
      sec_el.classList.toggle("collapsed"));
    app.appendChild(sec_el);
  });
  update();
}

function update(){
  let d=0, md=0;
  DATA.sections.forEach((sec,si)=>sec.items.forEach((it,i)=>{
    if (STORE[si+"-"+i]){ d++; if(it.machine) md++; }
  }));
  document.getElementById("done").textContent = d;
  document.getElementById("total").textContent = DATA.total;
  document.getElementById("mtotal").textContent = DATA.machineTotal;
  document.getElementById("mdone").textContent = md;
  const pct = DATA.total ? Math.round(d/DATA.total*100) : 0;
  document.getElementById("pct").textContent = pct + "%";
  document.getElementById("bar").style.width = pct + "%";
}

document.getElementById("expand").onclick = () =>
  document.querySelectorAll("section").forEach(s=>s.classList.remove("collapsed"));
document.getElementById("collapse").onclick = () =>
  document.querySelectorAll("section").forEach(s=>s.classList.add("collapsed"));
document.getElementById("reset").onclick = () => {
  if (confirm("确认清空所有勾选状态？")) { for (const k in STORE) delete STORE[k]; save(); render(); }
};
document.getElementById("export").onclick = () => {
  const out = { exportedAt: new Date().toISOString(), total: DATA.total,
    done: Object.keys(STORE).length, sections: DATA.sections.map((s,si)=>({
      title: s.title,
      items: s.items.map((it,i)=>({ text: it.text, machine: it.machine, checked: !!STORE[si+"-"+i] }))
    })) };
  const blob = new Blob([JSON.stringify(out,null,2)], {type:"application/json"});
  download(blob, "gale-smoke-" + stamp() + ".json");
};
document.getElementById("exportCsv").onclick = () => {
  let rows = ["section,item,machine,checked"];
  DATA.sections.forEach((s,si)=>s.items.forEach((it,i)=>
    rows.push(`${si+1}. ${csv(s.title)},${csv(it.text)},${it.machine?1:0},${STORE[si+"-"+i]?1:0}`)));
  download(new Blob([rows.join("\\n")], {type:"text/csv"}), "gale-smoke-" + stamp() + ".csv");
};
function csv(s){ return '"' + s.replace(/"/g,'""') + '"'; }
function stamp(){ return new Date().toISOString().slice(0,19).replace(/[:T]/g,"-"); }
function download(blob, name){ const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href); }

render();
</script>
</body>
</html>
"""

html = html.replace("__DATA__", json.dumps(data, ensure_ascii=False))
OUT.write_text(html, encoding="utf-8")
print(f"generated {OUT} | sections={len(sections)} total={total} machine={machine_total}")
