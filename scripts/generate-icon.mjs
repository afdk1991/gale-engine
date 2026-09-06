// 疾风引擎应用图标生成器
// 设计与落地页 favicon 保持一致：蓝色渐变圆角方块 + 白色闪电。
// 纯 Node 实现（zlib 内置），无外部依赖：光栅化（8x 超采样抗锯齿）→ PNG 编码 → ICO 封装。
// 用法：node scripts/generate-icon.mjs  → 生成 build/icon.ico 与 build/icon.png
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../build')

// ---- 设计定义（32x32 设计空间，与 landing favicon 同源）----
const D = 32 // 画布边长（设计单位）
const R = 8 // 圆角半径
// 渐变：顶部 #2f7cf6 → 底部 #2158d6
const TOP = [0x2f, 0x7c, 0xf6]
const BOT = [0x21, 0x58, 0xd6]
// 闪电多边形（landing favicon path "M18 5 L8 18 H14 L12 27 L24 12 H17 Z"）
const BOLT = [
  [18, 5],
  [8, 18],
  [14, 18],
  [12, 27],
  [24, 12],
  [17, 12]
]

function inRoundRect(px, py) {
  if (px < 0 || py < 0 || px > D || py > D) return false
  const cx = Math.min(Math.max(px, R), D - R)
  const cy = Math.min(Math.max(py, R), D - R)
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= R * R
}

function inBolt(px, py) {
  let c = false
  for (let i = 0, j = BOLT.length - 1; i < BOLT.length; j = i++) {
    const [xi, yi] = BOLT[i]
    const [xj, yj] = BOLT[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

/** 以 size*SS 分辨率硬边渲染，再按 SS×SS 盒式降采样为 size（预乘 alpha 平均） */
function renderSize(size, SS = 8) {
  const W = size * SS
  const sub = new Uint8Array(W * W * 4)
  const scale = W / D
  for (let y = 0; y < W; y++) {
    const dy = (y + 0.5) / scale
    const t = dy / D
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5) / scale
      const i = (y * W + x) * 4
      if (!inRoundRect(dx, dy)) continue // alpha 保持 0
      if (inBolt(dx, dy)) {
        sub[i] = sub[i + 1] = sub[i + 2] = 255
      } else {
        sub[i] = Math.round(TOP[0] + (BOT[0] - TOP[0]) * t)
        sub[i + 1] = Math.round(TOP[1] + (BOT[1] - TOP[1]) * t)
        sub[i + 2] = Math.round(TOP[2] + (BOT[2] - TOP[2]) * t)
      }
      sub[i + 3] = 255
    }
  }
  // 降采样
  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * W + (x * SS + sx)) * 4
          const al = sub[i + 3] / 255
          r += sub[i] * al
          g += sub[i + 1] * al
          b += sub[i + 2] * al
          a += al
        }
      }
      const o = (y * size + x) * 4
      if (a > 0) {
        out[o] = Math.round(r / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(b / a)
        out[o + 3] = Math.round((a / (SS * SS)) * 255)
      }
    }
  }
  return out
}

// ---- PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // filter: None
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ---- ICO 封装（PNG 压缩条目，Vista+ 标准）----
function encodeICO(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach((e, idx) => {
    const base = idx * 16
    dir[base] = e.size === 256 ? 0 : e.size // 宽（0 表示 256）
    dir[base + 1] = e.size === 256 ? 0 : e.size // 高
    dir[base + 2] = 0 // 调色板数
    dir[base + 3] = 0 // 保留
    dir.writeUInt16LE(1, base + 4) // planes
    dir.writeUInt16LE(32, base + 6) // bit count
    dir.writeUInt32LE(e.png.length, base + 8) // 数据大小
    dir.writeUInt32LE(offset, base + 12) // 数据偏移
    offset += e.png.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)])
}

// ---- 生成 ----
mkdirSync(OUT_DIR, { recursive: true })
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const entries = SIZES.map((size) => {
  const rgba = renderSize(size)
  return { size, png: encodePNG(size, size, rgba) }
})
const ico = encodeICO(entries)
writeFileSync(resolve(OUT_DIR, 'icon.ico'), ico)
// icon.png 输出 1024px，满足 electron-builder 跨平台图标自动生成要求
// （macOS icns 需 ≥512px，Linux 图标集也需要高分辨率源图）
const BIG_SIZE = 1024
const bigRgba = renderSize(BIG_SIZE)
const bigPng = encodePNG(BIG_SIZE, BIG_SIZE, bigRgba)
writeFileSync(resolve(OUT_DIR, 'icon.png'), bigPng)
console.log(`build/icon.ico  ${(ico.length / 1024).toFixed(1)} KB（${SIZES.join('/')} px）`)
console.log(`build/icon.png  ${(bigPng.length / 1024).toFixed(1)} KB（${BIG_SIZE} px）`)
