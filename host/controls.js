// controls.json / presets.json 动态加载（renderer 的产物，host 不重复实现字段清单）。
// 两个文件都可能还没生成：此时返回空清单并给出 warning，链路照常可跑。
// v4：palettes.json 用于 /api/palettes、palette 控件 optionLabels 兜底、NL 配色词表。
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { readJson, statSafe, clone, getPath } from './util.js'
import { PalettesService } from './palettes.js'
import { applyV4Fallback } from './v4controls.js'

const DEFAULT_KINDS = ['map', 'line', 'bar', 'scatter', 'heatmap', 'box']

function flattenGroups(groups) {
  const items = []
  for (const group of Array.isArray(groups) ? groups : []) {
    const groupLabel = group?.labelZh || group?.labelEn || group?.id || ''
    for (const item of Array.isArray(group?.items) ? group.items : []) {
      if (!item || typeof item.path !== 'string') continue
      items.push({
        path: item.path,
        type: item.type || 'text',
        labelZh: item.labelZh || item.labelEn || item.path,
        labelEn: item.labelEn || '',
        groupId: group.id || '',
        groupLabelZh: groupLabel,
        level: item.level === 'advanced' ? 'advanced' : 'basic',
        default: item.default,
        options: Array.isArray(item.options) ? item.options : undefined,
        optionLabels:
          item.optionLabels && typeof item.optionLabels === 'object' ? item.optionLabels : undefined,
        aliases: Array.isArray(item.aliases) ? item.aliases.filter((a) => typeof a === 'string') : [],
        help: typeof item.help === 'string' ? item.help : '',
        min: typeof item.min === 'number' ? item.min : undefined,
        max: typeof item.max === 'number' ? item.max : undefined,
        step: typeof item.step === 'number' ? item.step : undefined,
        integer: item.integer === true,
        unit: typeof item.unit === 'string' ? item.unit : '',
        visibleWhen: item.visibleWhen,
        multiline: item.multiline === true,
      })
    }
  }
  return items
}

export class ControlsService {
  constructor({ bundleDir }) {
    this.bundleDir = bundleDir
    this.controlsPath = path.join(bundleDir, 'py', 'scifig', 'controls.json')
    this.presetsPath = path.join(bundleDir, 'py', 'scifig', 'presets.json')
    this.palettes = new PalettesService({ bundleDir })
    this._cache = undefined
    this._cacheKey = ''
  }

  /** renderer 产物是否已就位（仅用于 health / 诊断）。 */
  async rendererAvailable() {
    const pyDir = path.join(this.bundleDir, 'py', 'scifig')
    const candidates = [
      path.join(pyDir, 'cli.py'),
      path.join(pyDir, 'cli', '__init__.py'),
      path.join(pyDir, '__init__.py'),
    ]
    for (const candidate of candidates) {
      if (await statSafe(candidate)) return true
    }
    return false
  }

  async _fingerprint() {
    const parts = []
    for (const file of [this.controlsPath, this.presetsPath]) {
      const stat = await statSafe(file)
      parts.push(stat ? `${stat.mtimeMs}:${stat.size}` : '-')
    }
    const paletteStat = await statSafe(this.palettes.palettesPath)
    parts.push(paletteStat ? `${paletteStat.mtimeMs}:${paletteStat.size}` : '-')
    return parts.join('|')
  }

  /** 读取并缓存；文件变化（mtime/size）自动失效。 */
  async load() {
    const key = await this._fingerprint()
    if (this._cache && key === this._cacheKey) return this._cache

    const rawControls = await readJson(this.controlsPath)
    const rawPresets = await readJson(this.presetsPath)
    const warnings = []
    if (!rawControls) warnings.push(`controls.json 尚未就绪（${this.controlsPath}）`)
    if (!rawPresets) warnings.push(`presets.json 尚未就绪（${this.presetsPath}）`)

    const groups = Array.isArray(rawControls?.groups) ? clone(rawControls.groups) : []
    const items = flattenGroups(groups)
    const byPath = new Map(items.map((item) => [item.path, item]))

    // v4：palette / 投影辅助控件兜底 + group.appliesTo 缺省补全
    const palettes = await this.palettes.load()
    const fallbackChanges = applyV4Fallback({ groups, items, byPath, palettes })
    if (!palettes.ok) warnings.push(palettes.error)

    const presets = Array.isArray(rawPresets?.presets)
      ? clone(rawPresets.presets).filter((p) => p && typeof p.id === 'string')
      : []

    // kinds 优先取 kind 控件的 options，否则用契约里的六种图型
    let kinds = DEFAULT_KINDS.slice()
    const kindItem = byPath.get('kind')
    if (kindItem && Array.isArray(kindItem.options) && kindItem.options.length) {
      kinds = kindItem.options.filter((k) => typeof k === 'string')
    }

    const cache = {
      groups,
      items,
      byPath,
      presets,
      kinds,
      warnings,
      palettes,
      fallbackChanges,
      loadedAt: Date.now(),
    }
    this._cache = cache
    this._cacheKey = key
    return cache
  }

  /** GET /api/palettes 的响应（透传 palettes.json，缺失时 ok:false）。 */
  async palettesPayload() {
    return this.palettes.publicPayload()
  }

  /** 由控件 default 值构建 spec 骨架（只含有 default 的 path）。 */
  async defaults() {
    const { items } = await this.load()
    const spec = {}
    for (const item of items) {
      if (item.default === undefined) continue
      setByPath(spec, item.path, clone(item.default))
    }
    return spec
  }

  /** 图型默认参数（不同 kind 可能带不同默认值，这里只给通用兜底）。 */
  async presetDefaults(presetId) {
    const { presets } = await this.load()
    const preset = presets.find((p) => p.id === presetId)
    return preset?.values && typeof preset.values === 'object' ? clone(preset.values) : {}
  }

  /** 控件元数据（HTTP /api/controls 用）。 */
  async publicControls() {
    const { groups, presets, kinds, warnings } = await this.load()
    // 右栏顶部已有「期刊风格」快捷 chips，标 quickCovered 让 UI 可默认隐藏通用段里的重复控件
    for (const group of groups) {
      for (const item of group?.items || []) {
        if (item?.path === 'style.preset') item.quickCovered = true
      }
    }
    return {
      groups,
      presets: presets.map((p) => ({
        id: p.id,
        labelZh: p.labelZh || p.labelEn || p.id,
        labelEn: p.labelEn || p.id,
      })),
      kinds,
      warnings,
    }
  }
}

function setByPath(obj, dotted, value) {
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

/** 找出 spec 里数据列映射类控件（path 形如 data.x / data.y / data.value ...）。 */
export function dataMappingPaths(items) {
  const result = {}
  const roles = ['x', 'y', 'value', 'group', 'lat', 'lon', 'time', 'label', 'color', 'size', 'sheet']
  for (const item of items) {
    const m = /^data\.([A-Za-z0-9_]+)$/.exec(item.path)
    if (!m) continue
    const role = m[1]
    if (roles.includes(role)) result[role] = item
  }
  return result
}

export { getPath }
