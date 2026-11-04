// v4 兜底控件（契约 §9.2/§9.3）：renderer 尚未补齐 palette / 投影辅助控件时，host 用 palettes.json 兜底，
// 保证 /api/controls（UI 配色选择器）和中文 NL 在 renderer 更新前后都能用。renderer 一旦提供同名 path
// 只补缺失的 optionLabels/aliases/options，不覆盖已有值。
/** 需要以 palettes.json 为权威刷新 options/optionLabels 的枚举 path。 */
const PALETTE_PATHS = new Set([
  'style.palette',
  'style.paletteSequential',
  'style.paletteDiverging',
  'map.colorbar.palette',
  'map.choropleth.palette',
])

export const V4_GROUP_APPLIES_TO = {  mapProjection: 'map',
  mapLayers: 'map',
  mapColors: 'map',
  mapGrid: 'map',
  colorbar: 'map',
  scaleBar: 'map',
  northArrow: 'map',
  mapPoint: 'map',
  lineChart: 'chart',
  barChart: 'chart',
  scatterChart: 'chart',
  heatmapChart: 'chart',
  boxChart: 'chart',
  compose: 'compose',
}

/** path → 兜底定义；kinds 决定可选的 palette kind 列表。 */
export const V4_ITEMS = [
  {
    path: 'style.palette',
    type: 'enum',
    labelZh: '分类配色',
    labelEn: 'Categorical palette',
    groupId: 'style',
    kinds: ['categorical'],
    level: 'basic',
    aliases: ['配色', '颜色', '色系', '配色方案', '调色板', '换一套颜色', '参考PPT', 'palette'],
    help: 'PPT 提取的分类配色（折线/柱/散点/地图点符号）；也可直接用 id，如 "ppt-03"',
  },
  {
    path: 'style.paletteSequential',
    type: 'enum',
    labelZh: '顺序色带',
    labelEn: 'Sequential palette',
    groupId: 'style',
    kinds: ['sequential'],
    level: 'advanced',
    aliases: ['顺序配色', '顺序色带', '连续色带', 'sequential', '热力配色'],
    help: '连续填色/热力图/色带的默认色带',
  },
  {
    path: 'style.paletteDiverging',
    type: 'enum',
    labelZh: '发散色带',
    labelEn: 'Diverging palette',
    groupId: 'style',
    kinds: ['diverging'],
    level: 'advanced',
    aliases: ['发散配色', '正负配色', '距平配色', 'diverging'],
    help: '正负/距平类数据的双向色带',
  },
  {
    path: 'map.colorbar.palette',
    type: 'enum',
    labelZh: '色带配色',
    labelEn: 'Colorbar palette',
    groupId: 'colorbar',
    kinds: ['sequential', 'diverging'],
    level: 'basic',
    aliases: ['色带配色', '色条配色', '色带颜色', '色带调色板', 'colorbar palette'],
    help: '优先级：色带配色 > 顺序色带 > 色带 cmap',
  },
  {
    path: 'map.choropleth.palette',
    type: 'enum',
    labelZh: '分级填色配色',
    labelEn: 'Choropleth palette',
    groupId: 'mapColors',
    kinds: ['sequential'],
    level: 'basic',
    aliases: ['分级配色', '分级填色', '分级设色', 'choropleth 配色'],
  },
  {
    path: 'map.centralLatitude',
    type: 'number',
    labelZh: '中央纬度',
    labelEn: 'Central latitude',
    groupId: 'mapProjection',
    min: -90,
    max: 90,
    step: 0.5,
    unit: '°',
    defaultValue: 35,
    aliases: ['中央纬度', '中心纬度', 'central latitude'],
    help: 'Lambert/Albers 等圆锥投影用',
  },
  {
    path: 'map.standardParallels',
    type: 'text',
    labelZh: '标准纬线',
    labelEn: 'Standard parallels',
    groupId: 'mapProjection',
    defaultValue: '25,47',
    aliases: ['标准纬线', '标准平行线', '标准纬线组', 'standard parallels', 'parallels'],
    help: 'Lambert/Albers 用，逗号分隔，如 "25,47"',
  },
]

function makeItem(def, options, optionLabels) {
  const defaultValue = def.defaultValue !== undefined ? def.defaultValue : def.type === 'enum' ? options?.[0] : undefined
  return {
    path: def.path,
    type: def.type,
    labelZh: def.labelZh,
    labelEn: def.labelEn,
    groupId: def.groupId,
    groupLabelZh: '',
    level: def.level || 'basic',
    default: defaultValue,
    options: def.type === 'enum' ? options : undefined,
    optionLabels: def.type === 'enum' ? optionLabels : undefined,
    aliases: (def.aliases || []).slice(),
    help: def.help || '',
    min: def.min,
    max: def.max,
    step: def.step,
    integer: def.integer === true,
    unit: def.unit || '',
    synthetic: true,
  }
}

function toRawItem(item) {
  const raw = {
    path: item.path,
    type: item.type,
    labelZh: item.labelZh,
    labelEn: item.labelEn,
    level: item.level,
    aliases: item.aliases,
    help: item.help,
    min: item.min,
    max: item.max,
    step: item.step,
    unit: item.unit,
  }
  if (item.type === 'enum') {
    raw.options = item.options
    raw.optionLabels = item.optionLabels
  }
  if (item.default !== undefined) raw.default = item.default
  return raw
}

/**
 * 把 v4 兜底控件合进 controls 文档与扁平索引（就地修改传入的 groups/items/byPath）。
 * @param {{groups: any[], items: any[], byPath: Map<string, any>, palettes: {byKind: Record<string, any[]>}|undefined}} input
 */
export function applyV4Fallback({ groups, items, byPath, palettes }) {
  const byKind = palettes?.byKind || {}
  const changes = { added: [], patched: [] }

  // 1) group.appliesTo 缺省补全（渲染器已给的不要覆盖）
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue
    if (typeof group.appliesTo !== 'string' || !group.appliesTo) {
      group.appliesTo = V4_GROUP_APPLIES_TO[group.id] || 'all'
    }
  }

  for (const def of V4_ITEMS) {
    const options = def.type === 'enum'
      ? (def.kinds || []).flatMap((kind) => (byKind[kind] || []).map((palette) => palette.id))
      : undefined
    const optionLabels = def.type === 'enum'
      ? Object.fromEntries((def.kinds || []).flatMap((kind) => (byKind[kind] || []).map((palette) => [palette.id, palette.name])))
      : undefined
    const existing = byPath.get(def.path)

    if (existing) {
      let patched = false
      // palette 枚举：以 palettes.json 为准（id 重排/name 改名后 renderer 旧 options/labels 会失效）
      if (PALETTE_PATHS.has(def.path) && options?.length) {
        const keepIds = (Array.isArray(existing.options) ? existing.options : []).filter((id) => !/^ppt-\d+$/.test(String(id)))
        const nextOptions = keepIds.slice()
        for (const id of options) if (!nextOptions.includes(id)) nextOptions.push(id)
        const nextLabels = {}
        for (const id of keepIds) {
          if (existing.optionLabels?.[id]) nextLabels[id] = existing.optionLabels[id]
        }
        for (const [id, label] of Object.entries(optionLabels || {})) nextLabels[id] = label
        // 旧默认值若已不在新 options 里（id 重排）→ 用第一个有效值
        const defaultValue = existing.default
        existing.options = nextOptions
        existing.optionLabels = nextLabels
        if (defaultValue !== undefined && !nextOptions.includes(defaultValue)) {
          existing.default = nextOptions.find((id) => id !== '') ?? nextOptions[0]
        }
        patched = true
      }
      // 补 options / optionLabels 里缺失的键（renderer 填过的不动）
      if (options?.length) {
        if (!Array.isArray(existing.options) || existing.options.length === 0) {
          existing.options = options.slice()
          patched = true
        } else {
          const missingOptions = options.filter((id) => !existing.options.includes(id))
          if (missingOptions.length) {
            existing.options = existing.options.concat(missingOptions)
            patched = true
          }
        }
      }
      if (optionLabels) {
        existing.optionLabels = existing.optionLabels || {}
        for (const [id, label] of Object.entries(optionLabels)) {
          if (typeof existing.optionLabels[id] !== 'string' || !existing.optionLabels[id]) {
            existing.optionLabels[id] = label
            patched = true
          }
        }
      }
      const missingAliases = (def.aliases || []).filter((alias) => !existing.aliases.includes(alias))
      if (missingAliases.length) {
        existing.aliases = existing.aliases.concat(missingAliases)
        patched = true
      }
      if (patched) {
        changes.patched.push(def.path)
        // 同步回 groups 里的原始 item（publicControls 用 groups 渲染 UI）
        for (const group of groups) {
          const raw = (group?.items || []).find((item) => item?.path === def.path)
          if (!raw) continue
          if (existing.options) raw.options = existing.options.slice()
          if (existing.optionLabels) raw.optionLabels = { ...(raw.optionLabels || {}), ...existing.optionLabels }
          if (existing.aliases) raw.aliases = existing.aliases.slice()
          if (raw.type === 'enum' && raw.optionLabels) raw.optionLabels = existing.optionLabels
          break
        }
      }
      continue
    }

    // 2) 完全缺失 → 造一条兜底控件并挂到对应分组
    const item = makeItem(def, options, optionLabels)
    items.push(item)
    byPath.set(def.path, item)
    let group = groups.find((candidate) => candidate?.id === def.groupId)
    if (!group) group = groups.find((candidate) => candidate?.id === 'paletteTools')
    if (!group) {
      group = { id: 'paletteTools', labelZh: '配色与投影', labelEn: 'Palette & projection', order: 95, appliesTo: 'all', items: [] }
      groups.push(group)
    }
    group.items = Array.isArray(group.items) ? group.items : []
    group.items.push(toRawItem(item))
    if (!group.appliesTo) group.appliesTo = V4_GROUP_APPLIES_TO[group.id] || 'all'
    changes.added.push(def.path)
  }

  return changes
}
