// spec 补丁语义：set/unset、preset 智能切换、固定路径兜底、值类型校验。
import { clone, getPath, setPath, delPath, deepEqual } from './util.js'

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** 根据控件元数据把外部值校正成合法值；返回 {ok, value, reason}。 */
export function coerceValue(item, value) {
  if (!item) return { ok: true, value } // 非控件路径：原样透传
  switch (item.type) {
    case 'number': {
      let num = typeof value === 'number' ? value : Number(String(value).trim())
      if (!Number.isFinite(num)) return { ok: false, reason: '不是数字' }
      if (item.integer) num = Math.round(num)
      if (typeof item.min === 'number' && num < item.min) num = item.min
      if (typeof item.max === 'number' && num > item.max) num = item.max
      // 消掉浮点尾巴
      num = Math.round(num * 1000) / 1000
      return { ok: true, value: num }
    }
    case 'bool': {
      if (typeof value === 'boolean') return { ok: true, value }
      if (typeof value === 'number') return { ok: true, value: value !== 0 }
      const text = String(value).trim().toLowerCase()
      if (['true', '1', 'yes', 'on', '是', '开'].includes(text)) return { ok: true, value: true }
      if (['false', '0', 'no', 'off', '否', '关'].includes(text)) return { ok: true, value: false }
      return { ok: false, reason: '不是布尔值' }
    }
    case 'enum': {
      const options = item.options || []
      const text = String(value).trim()
      if (!options.length) return { ok: true, value: text }
      const exact = options.find((o) => String(o) === text)
      if (exact !== undefined) return { ok: true, value: exact }
      const lower = text.toLowerCase()
      const ci = options.find((o) => String(o).toLowerCase() === lower)
      if (ci !== undefined) return { ok: true, value: ci }
      if (item.optionLabels) {
        for (const [option, label] of Object.entries(item.optionLabels)) {
          if (String(label).trim() === text) return { ok: true, value: option }
        }
      }
      return { ok: false, reason: `不在可选项内：${text}` }
    }
    case 'color': {
      const text = String(value).trim()
      if (HEX_COLOR.test(text)) return { ok: true, value: text.toLowerCase() }
      return { ok: false, reason: '颜色必须是 #rrggbb' }
    }
    case 'text':
    default:
      return { ok: true, value: typeof value === 'string' ? value : String(value) }
  }
}

/**
 * 应用 set 补丁。
 * @returns {{applied: Array<{path,value}>, rejected: Array<{path,reason,value}>}}
 */
export function applySet(spec, set, itemByPath) {
  const applied = []
  const rejected = []
  if (!set || typeof set !== 'object') return { applied, rejected }
  for (const [dotted, rawValue] of Object.entries(set)) {
    if (typeof dotted !== 'string' || !dotted.trim()) continue
    const pathKey = dotted.trim()
    const item = itemByPath?.get?.(pathKey)
    const coerced = coerceValue(item, rawValue)
    if (!coerced.ok) {
      rejected.push({ path: pathKey, value: rawValue, reason: coerced.reason })
      continue
    }
    setPath(spec, pathKey, coerced.value)
    applied.push({ path: pathKey, value: coerced.value })
  }
  return { applied, rejected }
}

/** 应用 unset：删除路径后，若有控件默认值则回填默认值（保持渲染器有值可用）。 */
export function applyUnset(spec, unset, itemByPath) {
  const removed = []
  if (!Array.isArray(unset)) return removed
  for (const dotted of unset) {
    if (typeof dotted !== 'string' || !dotted.trim()) continue
    delPath(spec, dotted.trim())
    const item = itemByPath?.get?.(dotted.trim())
    if (item && item.default !== undefined) setPath(spec, dotted.trim(), clone(item.default))
    removed.push(dotted.trim())
  }
  return removed
}

/**
 * 智能换期刊风格（契约 §3.4）：
 * 只有当前值仍等于旧 preset 默认值（或未设置）的 path 才被新 preset 覆盖，用户手改过的不动。
 */
export function switchPreset(spec, presets, newPresetId) {
  const oldId = getPath(spec, 'style.preset')
  const oldPreset = presets.find((p) => p.id === oldId)
  const oldValues = oldPreset?.values && typeof oldPreset.values === 'object' ? oldPreset.values : {}
  const newPreset = presets.find((p) => p.id === newPresetId)
  if (!newPreset) {
    return { ok: false, error: `未知期刊风格：${newPresetId}` }
  }
  const newValues = newPreset.values && typeof newPreset.values === 'object' ? newPreset.values : {}
  let changed = 0
  for (const [dotted, newValue] of Object.entries(newValues)) {
    const current = getPath(spec, dotted)
    const untouched = current === undefined || deepEqual(current, oldValues[dotted])
    if (!untouched) continue
    if (!deepEqual(current, newValue)) changed += 1
    setPath(spec, dotted, clone(newValue))
  }
  setPath(spec, 'style.preset', newPresetId)
  return { ok: true, changed, preset: newPresetId }
}

/**
 * 渲染前保证契约 §3.2 的固定路径存在。返回 warnings。
 */
export function ensureFixed(spec, { pngPath, presetId }) {
  const warnings = []
  if (typeof getPath(spec, 'kind') !== 'string' || !getPath(spec, 'kind')) {
    setPath(spec, 'kind', 'map')
    warnings.push('spec.kind 缺失，已按 map 处理')
  }
  if (typeof getPath(spec, 'title') !== 'string') setPath(spec, 'title', '')
  if (typeof getPath(spec, 'figure.widthMm') !== 'number') setPath(spec, 'figure.widthMm', 180)
  if (typeof getPath(spec, 'figure.heightMm') !== 'number') setPath(spec, 'figure.heightMm', 120)
  if (typeof getPath(spec, 'figure.dpi') !== 'number') setPath(spec, 'figure.dpi', 300)
  const preset = getPath(spec, 'style.preset')
  if ((typeof preset !== 'string' || !preset) && presetId) setPath(spec, 'style.preset', presetId)
  if (pngPath) setPath(spec, 'output.png', pngPath)
  // 合成图的数据在各 panel 里，顶层没有 data.source 是正常的（不要产生误导性 warning）
  if (getPath(spec, 'kind') !== 'compose') {
    const source = getPath(spec, 'data.source')
    if (typeof source !== 'string' || !source) warnings.push('spec.data.source 缺失，渲染器可能无法出图')
  }
  return warnings
}

/** 简单统计 spec 里被用户显式设置的 path 数（用于汇报/调试）。 */
export function countPaths(spec) {
  let n = 0
  const walk = (value) => {
    if (value === null || typeof value !== 'object') {
      n += 1
      return
    }
    if (Array.isArray(value)) {
      n += 1
      return
    }
    for (const child of Object.values(value)) walk(child)
  }
  walk(spec)
  return n
}
