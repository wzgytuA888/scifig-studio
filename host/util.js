// 通用工具：路径读写、原子写文件、JSON、最小 PNG 编码器（占位图）、文本/错误处理。
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/** 读取 JSON 文件，失败返回 undefined（不抛）。 */
export async function readJson(filePath) {
  try {
    const text = await fsp.readFile(filePath, 'utf8')
    return JSON.parse(stripBom(text))
  } catch {
    return undefined
  }
}

/** 原子写 JSON：先写临时文件再 rename，避免半截文件。 */
export async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fsp.rename(tmp, filePath)
}

/** 原子写 Buffer。 */
export async function writeBufferAtomic(filePath, buffer) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tmp, buffer)
  await fsp.rename(tmp, filePath)
}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export async function pathExists(p) {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

export async function statSafe(p) {
  try {
    return await fsp.stat(p)
  } catch {
    return undefined
  }
}

/** 深拷贝（spec 都是 JSON 值）。 */
export function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

/** 点路径读写（契约规定 spec 路径里不允许数组下标）。 */
export function getPath(obj, dotted) {
  if (!obj || !dotted) return undefined
  let cur = obj
  for (const key of String(dotted).split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[key]
  }
  return cur
}

export function setPath(obj, dotted, value) {
  const keys = String(dotted).split('.')
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (cur[key] === null || typeof cur[key] !== 'object' || Array.isArray(cur[key])) cur[key] = {}
    cur = cur[key]
  }
  cur[keys[keys.length - 1]] = value
  return obj
}

export function delPath(obj, dotted) {
  const keys = String(dotted).split('.')
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (cur === null || typeof cur !== 'object') return obj
    cur = cur[key]
  }
  if (cur && typeof cur === 'object') delete cur[keys[keys.length - 1]]
  return obj
}

/** 深合并：把 patch 合并进 target（对象递归合并，其他类型覆盖）。返回 target。 */
export function deepMerge(target, patch) {
  if (patch === undefined) return target
  if (target === undefined || target === null || typeof target !== 'object' || Array.isArray(target)) {
    return clone(patch)
  }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return clone(patch)
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = deepMerge(target[key], value)
    } else {
      target[key] = clone(value)
    }
  }
  return target
}

export function errText(error) {
  if (error === undefined || error === null) return '未知错误'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || String(error)
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function nowIso() {
  const d = new Date()
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMin)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

/** 生成 figureId：fig-YYYYMMDD-HHmmss-<4hex> */
export function makeFigureId() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const rand = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0')
  return `fig-${stamp}-${rand}`
}

// ---------------------------------------------------------------------------
// 最小 PNG 编码器（仅用于渲染器未就绪时的占位图，避免依赖任何图像库）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

/**
 * 生成一张纯色（带细边框）的 PNG，用于渲染器尚未就绪时的占位图。
 * 只依赖 node:zlib，确定性输出。
 */
export function makePlaceholderPng(width = 900, height = 600) {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const raw = Buffer.alloc((w * 3 + 1) * h)
  const bg = 0xf2
  const border = 0xc8
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 3 + 1)
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
      const v = edge ? border : bg
      const o = rowStart + 1 + x * 3
      raw[o] = v
      raw[o + 1] = v
      raw[o + 2] = v
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** 简易深比较（JSON 值）。 */
export function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return a === b
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
}

/** 把对象中的 undefined 清理掉，保证 JSON 可序列化。 */
export function jsonSafe(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}
