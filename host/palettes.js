// PPT 配色数据（py/scifig/palettes.json，只读）：42 套分类/顺序/发散调色板。
// 供 /api/palettes、controls 的 optionLabels 兜底、NL 配色词表、draft 默认配色使用。
import path from 'node:path'
import { readJson, statSafe } from './util.js'

export const PALETTE_KINDS = ['categorical', 'sequential', 'diverging']

const COLOR_HUE_RANGES = [
  ['红', [345, 15]],
  ['橙', [15, 45]],
  ['黄', [45, 70]],
  ['绿', [70, 165]],
  ['青', [165, 195]],
  ['蓝', [195, 255]],
  ['紫', [255, 300]],
  ['粉', [300, 345]],
]

function hexToRgb(hex) {
  const text = String(hex || '').replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return undefined
  return [parseInt(text.slice(0, 2), 16), parseInt(text.slice(2, 4), 16), parseInt(text.slice(4, 6), 16)]
}

function rgbToHsl([r, g, b]) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const lightness = (max + min) / 2
  const delta = max - min
  if (delta === 0) return { h: 0, s: 0, l: lightness }
  const s = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let h
  if (max === rn) h = ((gn - bn) / delta) % 6
  else if (max === gn) h = (bn - rn) / delta + 2
  else h = (rn - gn) / delta + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l: lightness }
}

/** 调色板颜色与中文色彩词的匹配分（0..1）。 */
export function colorWordScore(palette, colorWord) {
  const word = String(colorWord || '').replace(/色系|色|系/g, '')
  if (!word) return 0
  const colors = Array.isArray(palette?.colors) ? palette.colors : []
  if (!colors.length) return 0
  if (/^[黑白灰]|^[黑白灰]$|灰|黑|白/.test(word)) {
    const matches = colors.filter((hex) => {
      const rgb = hexToRgb(hex)
      if (!rgb) return false
      const { s, l } = rgbToHsl(rgb)
      if (word.startsWith('黑')) return l < 0.25
      if (word.startsWith('白')) return l > 0.85
      return s < 0.18
    })
    return matches.length / colors.length
  }
  const range = COLOR_HUE_RANGES.find(([name]) => word.startsWith(name))?.[1]
  if (!range) return 0
  const [from, to] = range
  const inRange = (hue) => (from <= to ? hue >= from && hue <= to : hue >= from || hue <= to)
  let hits = 0
  for (const hex of colors) {
    const rgb = hexToRgb(hex)
    if (!rgb) continue
    const { h, s, l } = rgbToHsl(rgb)
    if (s < 0.12 || l > 0.95 || l < 0.05) continue
    if (inRange(h)) hits += 1
  }
  let score = hits / colors.length
  if (String(palette?.name || '').includes(word)) score += 0.5
  return Math.min(1, score)
}

export class PalettesService {
  constructor({ bundleDir }) {
    this.bundleDir = bundleDir
    this.palettesPath = path.join(bundleDir, 'py', 'scifig', 'palettes.json')
    this._cache = undefined
    this._cacheKey = ''
  }

  async _fingerprint() {
    const stat = await statSafe(this.palettesPath)
    return stat ? `${stat.mtimeMs}:${stat.size}` : '-'
  }

  /** 读取并缓存（mtime/size 失效）。缺失时返回 {ok:false,error}，不抛。 */
  async load() {
    const key = await this._fingerprint()
    if (this._cache && key === this._cacheKey) return this._cache
    const raw = await readJson(this.palettesPath)
    if (!raw || !Array.isArray(raw.palettes)) {
      const result = {
        ok: false,
        error: `palettes.json 尚未就绪或格式不正确（${this.palettesPath}）`,
        source: '',
        palettes: [],
        byKind: { categorical: [], sequential: [], diverging: [] },
        counts: {},
        loadedAt: Date.now(),
      }
      this._cache = result
      this._cacheKey = key
      return result
    }
    const palettes = raw.palettes
      .filter((palette) => palette && typeof palette.id === 'string' && Array.isArray(palette.colors))
      .map((palette) => ({
        id: palette.id,
        name: String(palette.name || palette.id),
        kind: PALETTE_KINDS.includes(palette.kind) ? palette.kind : 'categorical',
        colors: palette.colors.filter((color) => typeof color === 'string'),
        source: typeof palette.source === 'string' ? palette.source : '',
        colorsText: typeof palette.colorsText === 'string' ? palette.colorsText : (palette.colors || []).join(' '),
        usage: palette.usage && typeof palette.usage === 'object' ? palette.usage : undefined,
        base: typeof palette._base === 'string' ? palette._base : '',
      }))
    const byKind = { categorical: [], sequential: [], diverging: [] }
    for (const palette of palettes) (byKind[palette.kind] || byKind.categorical).push(palette)
    const result = {
      ok: true,
      source: String(raw.source || ''),
      sourcePath: String(raw.sourcePath || ''),
      counts: raw.counts && typeof raw.counts === 'object' ? raw.counts : {},
      palettes,
      byKind,
      loadedAt: Date.now(),
    }
    this._cache = result
    this._cacheKey = key
    return result
  }

  /** /api/palettes 的公开响应。缺省字段直接取自 palettes.json（name/colors/usage 均以文件为准）。 */
  async publicPayload() {
    const loaded = await this.load()
    if (!loaded.ok) {
      return {
        ok: false,
        error: loaded.error,
        palettes: [],
        byKind: { categorical: [], sequential: [], diverging: [] },
        byKindIds: { categorical: [], sequential: [], diverging: [] },
      }
    }
    const publicPalette = (palette) => {
      const entry = { id: palette.id, name: palette.name, kind: palette.kind, colors: palette.colors, colorsText: palette.colorsText }
      if (palette.usage) entry.usage = palette.usage
      if (palette.source) entry.source = palette.source
      if (palette.base) entry.base = palette.base
      return entry
    }
    return {
      ok: true,
      source: loaded.source,
      sourcePath: loaded.sourcePath,
      counts: loaded.counts,
      palettes: loaded.palettes.map(publicPalette),
      // byKind 给"按分类/顺序/发散三组显示色块条"的 UI 用（元素是完整 palette 对象）
      byKind: {
        categorical: loaded.byKind.categorical.map(publicPalette),
        sequential: loaded.byKind.sequential.map(publicPalette),
        diverging: loaded.byKind.diverging.map(publicPalette),
      },
      // byKindIds 给只要 id 列表的调用方（向后兼容）
      byKindIds: {
        categorical: loaded.byKind.categorical.map((palette) => palette.id),
        sequential: loaded.byKind.sequential.map((palette) => palette.id),
        diverging: loaded.byKind.diverging.map((palette) => palette.id),
      },
    }
  }

  /** optionLabels 兜底：{id: name}，按 kind 过滤。 */
  async optionLabels(kinds) {
    const loaded = await this.load()
    const wanted = Array.isArray(kinds) && kinds.length ? kinds : PALETTE_KINDS
    const labels = {}
    for (const kind of wanted) {
      for (const palette of loaded.byKind[kind] || []) labels[palette.id] = palette.name
    }
    return labels
  }

  /** 按 kind 取调色板列表（保持 palettes.json 生成顺序）。 */
  async listByKind(kind) {
    const loaded = await this.load()
    return (loaded.byKind[kind] || []).slice()
  }

  /** 用中文色彩词挑一套调色板（同 kind 内打分最高，其次 name 包含）。 */
  async findByColorWord(word, kind = 'categorical') {
    const palettes = await this.listByKind(kind)
    let best
    for (const palette of palettes) {
      const score = colorWordScore(palette, word)
      if (score > 0 && (!best || score > best.score)) best = { palette, score }
    }
    return best?.palette
  }

  /** 找 ppt-<n> 或数字 n 对应的调色板（按生成顺序；kind 缺省 categorical）。 */
  async findByOrdinal(ordinal, kind = 'categorical') {
    const palettes = await this.listByKind(kind)
    const index = Number(ordinal)
    if (!Number.isFinite(index) || index < 1 || index > palettes.length) return undefined
    return palettes[Math.floor(index) - 1]
  }
}
