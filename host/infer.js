// draft 自动推断：读 CSV/TSV/GeoJSON/xlsx（xlsx 交给 python 侧 pandas）→ 推断列角色
// → 从 description 中文关键词选图型 → 生成 spec 骨架所需的 inferred 描述。
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { errText, statSafe, stripBom } from './util.js'

const MAX_SAMPLE_ROWS = 300
const MAX_INLINE_BYTES = 32 * 1024 * 1024

// ---------------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------------

/** 检测分隔符（逗号/制表符/分号）。 */
export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  const candidates = [',', '\t', ';', '|']
  let best = ','
  let bestCount = 0
  for (const delimiter of candidates) {
    const count = firstLine.split(delimiter).length - 1
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

/** RFC4180 风格的轻量 CSV 解析。 */
export function parseDelimited(text, delimiter) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = 0
  const source = stripBom(text)
  while (i < source.length) {
    const ch = source[i]
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === delimiter) {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r') {
      i += 1
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      if (rows.length > MAX_SAMPLE_ROWS + 1) break
      continue
    }
    field += ch
    i += 1
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  const header = (rows.shift() || []).map((name, index) => {
    const clean = String(name).trim()
    return clean || `col${index + 1}`
  })
  const body = rows.filter((r) => r.some((cell) => String(cell).trim() !== ''))
  return { header, rows: body }
}

// ---------------------------------------------------------------------------
// 列角色推断
// ---------------------------------------------------------------------------

const PATTERNS = {
  lon: [/^(lon|lng|long|longitude)$/i, /经度|longitude/i, /^x_?lon$/i],
  lat: [/^(lat|latitude)$/i, /纬度|latitude/i, /^y_?lat$/i],
  time: [/^(time|date|datetime|year|month|day|timestamp|period)$/i, /日期|时间|年份|年际|月份|年代|时段/],
  group: [/^(group|category|class|type|label|region|province|city|site)$/i, /分组|类别|类型|分类|组别|地区|区域|省份|城市|站点/],
  value: [
    /^(value|val|y|mean|avg|average|sum|count|rate|amount|total)$/i,
    /数值|值|平均|均值|浓度|含量|温度|降水|面积|产量|总量|比例|比率|速率|强度/,
  ],
  x: [/^(x|t|index)$/i],
  size: [/^(size|weight|radius|pop|population)$/i, /规模|权重|人口/],
  color: [/^(color|colour)$/i, /颜色|色标/],
}

function matchAny(name, patterns) {
  return patterns.some((re) => re.test(name))
}

function looksNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!text) return false
  return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?%?$/.test(text)
}

function looksDate(value) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (!text) return false
  return /^(\d{4})([-/.](\d{1,2}))?([-/.](\d{1,2}))?/.test(text) && !looksNumeric(text)
}

function profileColumns(header, rows) {
  return header.map((name, index) => {
    const values = rows.map((row) => row[index])
    const filled = values.filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    const numericCount = filled.filter(looksNumeric).length
    const dateCount = filled.filter(looksDate).length
    const integerCount = filled.filter((value) => looksNumeric(value) && Number.isInteger(Number(String(value).trim().replace(/%$/, '')))).length
    const unique = new Set(filled.map((value) => String(value).trim()))
    const numeric = filled.length > 0 && numericCount / filled.length >= 0.8
    return {
      name,
      index,
      filled: filled.length,
      numeric,
      datetime: filled.length > 0 && dateCount / filled.length >= 0.6,
      uniqueCount: unique.size,
      // 低基数整数列（level / 年份 / 编号）：适合当 x 轴或分类列
      allInteger: numeric && filled.length > 0 && integerCount / filled.length >= 0.95,
      categorical: unique.size <= Math.max(30, Math.ceil(filled.length * 0.5)),
      sample: filled.slice(0, 3).map((value) => String(value).slice(0, 60)),
    }
  })
}

/** 可当 x 轴/分类轴的“低基数整数列”（level、年份、序号等）。 */
function isOrdinalInteger(column) {
  return Boolean(column.numeric && column.allInteger && column.uniqueCount <= Math.max(30, Math.ceil(column.filled * 0.2)))
}

/**
 * 按图型规划 spec.data.* 列映射（返回 {role: columnName}）。
 * 只决定"该用哪些列"，最终写哪些 path 由 controls.json 里存在的 data.* 控件决定。
 * 语义对齐 renderer 的 dataio（契约 §3.2 + SPEC.md）：
 *   map: lon/lat/value/label；line: x + y（y 可为逗号分隔多列）；
 *   bar: group（宽表不指定 value，让引擎把全部数值列当系列）；scatter: x/y/group；
 *   heatmap: 仅长表（两个分类列 + 一个数值列）才指定 x/y/value；box: group/value。
 */
export function planDataMapping({ kind, info }) {
  const columns = (info?.columns || []).filter((column) => column.index >= 0)
  const numeric = columns.filter((column) => column.numeric)
  const categorical = columns.filter((column) => !column.numeric && !column.datetime)
  const mapping = info?.mapping || {}
  const nameOf = (profile) => (profile && typeof profile.name === 'string' ? profile.name : undefined)
  const lon = nameOf(mapping.lon)
  const lat = nameOf(mapping.lat)
  const time = nameOf(mapping.time)
  const notCoord = (column) => column.name !== lon && column.name !== lat
  const numericNoCoord = numeric.filter(notCoord)
  const isLabelColumn = (column) => /^(label|name|id|site|station|city|站点|站名|名称|编号)$/i.test(column.name) || /站点|站名|名称|标签/.test(column.name)
  const label = columns.find((column) => !column.numeric && isLabelColumn(column))
  const longFormat = categorical.length >= 2 && numericNoCoord.length >= 1
  const byRole = {}

  switch (kind) {
    case 'map': {
      if (lon) byRole.lon = lon
      if (lat) byRole.lat = lat
      const valueColumn = nameOf(mapping.value)
      byRole.value = valueColumn && valueColumn !== lon && valueColumn !== lat ? valueColumn : numericNoCoord[0]?.name
      byRole.label = label?.name
      break
    }
    case 'line': {
      // x 优先：时间列 > 低基数整数列（level/年份/编号）> 分类文本列 > 第一个数值列；绝不用行索引
      const ordinal = numericNoCoord.find((column) => isOrdinalInteger(column))
      byRole.x = time || ordinal?.name || categorical[0]?.name || numericNoCoord[0]?.name
      const yColumns = numericNoCoord.filter((column) => column.name !== byRole.x).map((column) => column.name)
      byRole.y = yColumns.length ? yColumns.join(',') : numericNoCoord[0]?.name
      break
    }
    case 'bar': {
      if (categorical.length >= 2 && numericNoCoord.length === 1) {
        // 长表 group|series|value
        byRole.group = categorical[0].name
        byRole.value = numericNoCoord[0].name
      } else {
        // 宽表：类别列（无分类文本列时用低基数整数列，如 level）+ 多个数值列，
        // value 留空让引擎把数值列都画成系列
        const ordinal = numericNoCoord.find((column) => isOrdinalInteger(column))
        byRole.group = categorical[0]?.name || time || ordinal?.name
      }
      break
    }
    case 'scatter': {
      byRole.x = numericNoCoord[0]?.name
      byRole.y = numericNoCoord[1]?.name || numericNoCoord[0]?.name
      byRole.group = categorical[0]?.name
      break
    }
    case 'heatmap': {
      if (longFormat) {
        byRole.x = categorical[0].name
        byRole.y = categorical[1].name
        byRole.value = numericNoCoord[0].name
      } else if (categorical.length >= 1 && numericNoCoord.length >= 1) {
        // 半长表：一个分类列 + 若干数值列 → 分类列作行、数值列作列（矩阵化交给引擎）
        byRole.x = categorical[0].name
      }
      break
    }
    case 'box': {
      const ordinal = numericNoCoord.find((column) => isOrdinalInteger(column))
      byRole.group = categorical[0]?.name || time || ordinal?.name
      byRole.value = numericNoCoord.filter((column) => column.name !== byRole.group)[0]?.name
      break
    }
    default: {
      byRole.x = time || categorical[0]?.name
      byRole.y = numericNoCoord[0]?.name
      break
    }
  }
  for (const role of Object.keys(byRole)) {
    if (!byRole[role]) delete byRole[role]
  }
  return byRole
}

/**
 * 用 description 里提到的列名细化映射（"NDVI 年际变化" → y=NDVI，而不是全部数值列）。
 * 只做保守覆盖：提到的列必须真实存在且类型匹配。
 */
export function refineDataMapping({ kind, info, description, planned }) {
  const text = String(description || '')
  if (!text) return planned
  const columns = (info?.columns || []).filter((column) => column.index >= 0)
  const mentioned = columns.filter((column) => column.name.length >= 2 && text.includes(column.name))
  if (!mentioned.length) return planned
  const mentionedNumeric = mentioned.filter((column) => column.numeric)
  const mentionedCategorical = mentioned.filter((column) => !column.numeric && !column.datetime)
  const mentionedTime = mentioned.filter((column) => column.datetime || column.name === planned.x)
  const result = { ...planned }
  switch (kind) {
    case 'map': {
      if (mentionedNumeric.length && !mentionedNumeric.some((column) => column.name === planned.lon || column.name === planned.lat)) {
        result.value = mentionedNumeric[0].name
      }
      if (mentionedCategorical.length) result.label = mentionedCategorical[0].name
      break
    }
    case 'line': {
      if (mentionedTime.length) result.x = mentionedTime[0].name
      if (mentionedNumeric.length) {
        result.y = mentionedNumeric
          .filter((column) => column.name !== result.x)
          .slice(0, 4)
          .map((column) => column.name)
          .join(',')
      }
      break
    }
    case 'bar': {
      if (mentionedCategorical.length) result.group = mentionedCategorical[0].name
      if (mentionedNumeric.length === 1) result.value = mentionedNumeric[0].name
      break
    }
    case 'scatter': {
      if (mentionedNumeric.length >= 1) result.x = mentionedNumeric[0].name
      if (mentionedNumeric.length >= 2) result.y = mentionedNumeric[1].name
      if (mentionedCategorical.length) result.group = mentionedCategorical[0].name
      break
    }
    case 'heatmap': {
      if (mentionedNumeric.length) result.value = mentionedNumeric[0].name
      if (mentionedCategorical.length >= 2) {
        result.x = mentionedCategorical[0].name
        result.y = mentionedCategorical[1].name
      }
      break
    }
    case 'box': {
      if (mentionedCategorical.length) result.group = mentionedCategorical[0].name
      if (mentionedNumeric.length) result.value = mentionedNumeric[0].name
      break
    }
    default:
      break
  }
  for (const role of Object.keys(result)) {
    if (!result[role]) delete result[role]
  }
  return result
}

/**
 * 解析 description 里的轴指定：
 *   "横轴为分级 level，纵轴为流域数量 n_basins"
 *   "x 轴=年份"、"纵坐标是 NDVI"
 * 返回 {x?: {column, label}, y?: {column, label}}；label 优先取列名前的中文名。
 */
export function parseAxisHints(description, columns) {
  const text = String(description || '')
  const profiles = (columns || []).filter((column) => column.index >= 0 || column.index === undefined)
  const names = profiles.map((column) => column.name).filter((name) => typeof name === 'string' && name.length >= 1)
  const findColumn = (phrase) => {
    const clean = String(phrase || '').trim()
    if (!clean) return undefined
    const byName = names
      .filter((name) => name.length >= 2 && clean.includes(name))
      .sort((a, b) => b.length - a.length)
    const name = byName[0] || names.find((candidate) => candidate.length >= 1 && clean.includes(candidate))
    if (!name) return undefined
    const at = clean.indexOf(name)
    let label = clean
      .slice(0, at)
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/^(?:为|是|取|用|叫做|叫|等于|=|：|:|设为|设置为|\s)+/u, '')
      .replace(/(?:列|字段|数据)$/u, '')
      .trim()
    if (!label) {
      label = clean
        .slice(at + name.length)
        .replace(/^[）)]/u, '')
        .replace(/^(?:列|字段)/u, '')
        .trim()
    }
    return { column: name, label: label || name }
  }
  const xPattern = /(?:横轴|横坐标|水平轴|x\s*轴|x轴)\s*(?:为|是|取|用|叫做|叫|等于|=|：|:|设为|设置为)?\s*([^,，。;；\n]+)/i
  const yPattern = /(?:纵轴|纵坐标|垂直轴|y\s*轴|y轴)\s*(?:为|是|取|用|叫做|叫|等于|=|：|:|设为|设置为)?\s*([^,，。;；\n]+)/i
  const xMatch = xPattern.exec(text)
  const yMatch = yPattern.exec(text)
  return {
    x: xMatch ? findColumn(xMatch[1]) : undefined,
    y: yMatch ? findColumn(yMatch[1]) : undefined,
  }
}

/** description 里的期刊风格 / 单双栏提示 → {preset?, widthMm?}。 */
export function parseStyleHints(description, presetIds = []) {
  const text = String(description || '')
  const result = {}
  const has = (id) => !presetIds.length || presetIds.includes(id)
  const presetHints = [
    [/nature/i, 'nature'],
    [/science/i, 'science'],
    [/elsevier/i, 'elsevier'],
    [/ieee/i, 'ieee'],
    [/地理学报/, 'geography-cn'],
    [/遥感学报/, 'remote-sensing-cn'],
    [/通用\s*sci|sci\s*风格|sci\s*图|sci\b/i, 'sci'],
  ]
  for (const [pattern, id] of presetHints) {
    if (pattern.test(text) && has(id)) {
      result.preset = id
      break
    }
  }
  if (/双栏|双列|通栏|全宽|two[-\s]?column|full[-\s]?width/i.test(text)) result.widthMm = 180
  else if (/单栏|单列|半宽|one[-\s]?column|half[-\s]?width/i.test(text)) result.widthMm = 89
  return result
}

/**
 * 用轴指定覆盖列映射（"横轴为 level" 的优先级最高）。
 */
export function applyAxisHints(planned, hints, kind) {
  const result = { ...planned }
  const xColumn = hints?.x?.column
  const yColumn = hints?.y?.column
  if (xColumn) {
    if (kind === 'bar' || kind === 'box') result.group = xColumn
    else if (kind === 'heatmap') result.x = xColumn
    else if (kind === 'line' || kind === 'scatter') result.x = xColumn
  }
  if (yColumn) {
    if (kind === 'bar' || kind === 'box') result.value = yColumn
    else if (kind === 'heatmap') result.y = yColumn
    else if (kind === 'line' || kind === 'scatter') result.y = yColumn
    else result.value = yColumn
  }
  for (const role of Object.keys(result)) {
    if (!result[role]) delete result[role]
  }
  return result
}

/**
 * 推导轴标题/图例标题：description 里的中文名优先，其次列名。
 * 返回 {xLabel?, yLabel?, legendTitle?}（只给能确定的，多系列 y 不硬塞标签）。
 */
export function deriveAxisLabels({ kind, planned, hints, info }) {
  const columnNames = new Set((info?.columns || []).map((column) => column.name))
  const pick = (...candidates) => candidates.find((value) => typeof value === 'string' && value.trim())
  const xColumn = kind === 'bar' || kind === 'box' ? planned.group : planned.x
  const yColumn = kind === 'bar' || kind === 'box' ? planned.value : planned.y
  const yIsSingle = typeof yColumn === 'string' && !yColumn.includes(',')
  const result = {}
  const xLabel = pick(hints?.x?.label, xColumn)
  const yLabel = pick(hints?.y?.label, yIsSingle ? yColumn : undefined)
  if (kind !== 'map') {
    if (xLabel) result.xLabel = xLabel
    if (yLabel) result.yLabel = yLabel
  }
  if (yLabel && ['line', 'bar', 'scatter', 'box', 'heatmap'].includes(kind)) result.legendTitle = yLabel
  // 地图：数值列名作为色带标题（如果用户没给中文名就保留列名）
  if (kind === 'map') {
    const valueLabel = pick(hints?.y?.label, planned.value && columnNames.has(planned.value) ? planned.value : undefined)
    if (valueLabel) result.colorbarLabel = valueLabel
  }
  return result
}

/** 从列画像挑出角色映射（lat/lon/x/y/time/value/group/size/color）。 */
export function guessMapping(columns) {
  const pick = (role, predicate) => {
    const patterns = PATTERNS[role]
    const named = columns.find((column) => matchAny(column.name, patterns))
    if (named) return named
    return columns.find(predicate)
  }
  const mapping = {}
  mapping.lon = pick('lon', () => false)
  mapping.lat = pick('lat', () => false)
  mapping.time = pick('time', (column) => column.datetime)
  mapping.group = pick('group', (column) => !column.numeric && column.categorical)
  mapping.value = pick('value', (column) => column.numeric)
  mapping.size = pick('size', () => false)
  mapping.color = pick('color', () => false)
  // 兜底：第一个数值列当 value，第一个非数值列当 group
  if (!mapping.value) mapping.value = columns.find((column) => column.numeric)
  if (!mapping.group) mapping.group = columns.find((column) => !column.numeric && !column.datetime)
  if (!mapping.time) mapping.time = columns.find((column) => column.datetime)
  // x：没有时间列时用第一个非数值列
  if (!mapping.time) {
    const candidate = columns.find((column) => column !== mapping.group)
    mapping.x = candidate?.datetime ? candidate : mapping.group
  }
  // 清理 undefined
  for (const key of Object.keys(mapping)) if (!mapping[key]) delete mapping[key]
  return mapping
}

// ---------------------------------------------------------------------------
// 描述文本启发式
// ---------------------------------------------------------------------------

const KIND_KEYWORDS = {
  map: ['地图', '研究区', '空间分布', '空间格局', '区位', '流域', '经纬', '投影', '行政区', '中国地图', '分布图', '制图', '区域图', '示意图', '海岸线', '国界', 'shapefile', 'geojson'],
  line: ['折线', '趋势', '时间序列', '时序', '年际', '逐年', '变化曲线', '走势', 'line chart'],
  bar: ['柱状', '条形', '分组柱', '对比', '比较', '差异', '柱形', 'bar chart'],
  scatter: ['散点', '相关', '回归', '关系图', 'scatter'],
  heatmap: ['热力', '热量', '热图', '矩阵', '相关矩阵', 'heatmap'],
  box: ['箱线', '箱图', '四分位', 'box', 'violin', '小提琴'],
}

/** description → 图型（没有明显关键词时返回 undefined）。 */
export function guessKindFromText(description) {
  const text = String(description || '').toLowerCase()
  if (!text) return undefined
  let bestKind
  let bestScore = 0
  for (const [kind, keywords] of Object.entries(KIND_KEYWORDS)) {
    let score = 0
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) score += keyword.length >= 3 ? 2 : 1
    }
    if (score > bestScore) {
      bestScore = score
      bestKind = kind
    }
  }
  return bestScore > 0 ? bestKind : undefined
}

/** 综合 description + 数据画像选图型。 */
export function guessKind({ description, explicitKind, info }) {
  if (explicitKind) return explicitKind
  const text = String(description || '')
  // "横轴为…纵轴为…" 是对两维统计图的明确描述：不要被"流域/区域"等词误判成地图
  const axisLanguage = /(?:横轴|纵轴|横坐标|纵坐标|x\s*轴|y\s*轴)/i.test(text)
  const spatialLanguage = /(?:地图|经纬|空间分布|空间格局|研究区|行政区|中国地图|geojson|shapefile|投影|区位)/i.test(text)
  if (axisLanguage && !spatialLanguage) {
    return /柱|条形|bar/i.test(text) ? 'bar' : 'line'
  }
  const fromText = guessKindFromText(description)
  if (fromText) return fromText
  const columns = info?.columns || []
  const hasLonLat = columns.some((c) => matchAny(c.name, PATTERNS.lon)) && columns.some((c) => matchAny(c.name, PATTERNS.lat))
  if (hasLonLat) return 'map'
  if (info?.geojson) return 'map'
  const mapping = info ? info.mapping || guessMapping(columns) : {}
  if (mapping.time && mapping.value) return 'line'
  if (mapping.group && mapping.value) return 'bar'
  const numeric = columns.filter((c) => c.numeric)
  if (numeric.length >= 2) return 'scatter'
  if (mapping.value) return 'bar'
  return 'map'
}

/** 从描述里抽标题：引号内容 > "标题/题目：xxx" > 去掉口语前缀的第一句。 */
export function guessTitle(description, fallback = '') {
  const text = String(description || '').trim()
  if (!text) return fallback
  const quoted = /[「《“"']([^」》”"']{2,60})[」》”"']/.exec(text)
  if (quoted) return quoted[1].trim()
  const labelled = /(?:标题|题目|图名)\s*[:：是为]?\s*([^，。；,;\n]{2,60})/.exec(text)
  if (labelled) {
    // "标题写研究区概况" → 去掉“写/叫/命名/取…”这类动词
    const cleaned = labelled[1]
      .trim()
      .replace(/^(?:写成|写作|写|叫做|叫|命名为|取名|设为|为|是|用|取)\s*/, '')
      .trim()
    if (cleaned) return cleaned
  }
  let first = text.split(/[。；;\n]/)[0].split(/[，,]/)[0].trim()
  first = first.replace(
    /^(?:请|帮我|帮忙|麻烦|我想|我需要|需要|给我|能否|可以)?\s*(?:帮我|用|把)*\s*(?:画|绘制|做|生成|制作|出一张|出一幅|画一张|绘制一张|来一张)?\s*(?:一张|一幅|个)?\s*/u,
    '',
  )
  first = first.replace(/^(?:的|关于)/, '').trim()
  if (!first) return fallback
  return first.length > 48 ? `${first.slice(0, 48)}…` : first
}

/** 抓单位（"单位：mm" / "（单位 mm）"）。 */
export function guessUnit(description) {
  const text = String(description || '')
  const match = /单位\s*[:：为]?\s*([A-Za-z%‰℃°][A-Za-z0-9/^%‰℃°·.-]{0,12}|[\u4e00-\u9fa5]{1,6})/.exec(text)
  return match ? match[1].trim() : ''
}

// ---------------------------------------------------------------------------
// 文件读取入口
// ---------------------------------------------------------------------------

/** xlsx 交给 python/pandas 抽样成 CSV-ish JSON（失败则降级为 warning）。 */
async function readXlsxViaPython(filePath, deps) {
  const { ctx, python, bundleDir } = deps
  if (!ctx?.subprocess) return { error: '子进程服务不可用，无法读取 xlsx' }
  const script = [
    'import sys, json',
    'try:',
    '    import pandas as pd',
    '    df = pd.read_excel(sys.argv[1], nrows=300)',
    '    columns = [str(c) for c in df.columns]',
    '    rows = []',
    '    for record in df.itertuples(index=False, name=None):',
    '        row = []',
    '        for value in record:',
    '            if value is None:',
    '                row.append(None)',
    '            elif hasattr(value, "item"):',
    '                row.append(value.item())',
    '            else:',
    '                row.append(value if isinstance(value, (int, float, str, bool)) else str(value))',
    '        rows.append(row)',
    '    print(json.dumps({"columns": columns, "rows": rows}, ensure_ascii=False, default=str))',
    'except Exception as exc:',
    '    print(json.dumps({"error": str(exc)}, ensure_ascii=False))',
  ].join('\n')
  let handle
  try {
    handle = ctx.subprocess.spawn({
      argv: [python, '-c', script, filePath],
      cwd: path.join(bundleDir, 'py'),
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 65536 } },
      graceMs: 5000,
    })
  } catch (error) {
    return { error: `无法启动 python 读取 xlsx：${errText(error)}` }
  }
  let outcome
  try {
    outcome = await handle.done
  } catch (error) {
    return { error: `python 读取 xlsx 失败：${errText(error)}` }
  }
  const text = (() => {
    try {
      return handle.collected?.stdout?.readFrom(0)?.text || ''
    } catch {
      return ''
    }
  })()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return { error: `python 读取 xlsx 无输出（exit=${outcome?.exitCode ?? '?'}）` }
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    if (parsed.error) return { error: `xlsx 读取失败：${parsed.error}` }
    return { columns: parsed.columns || [], rows: parsed.rows || [] }
  } catch (error) {
    return { error: `xlsx 输出解析失败：${errText(error)}` }
  }
}

function geojsonGeometryTypes(geometry) {
  if (!geometry) return []
  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries || []).flatMap((child) => geojsonGeometryTypes(child))
  }
  return [geometry.type]
}

function collectGeoJsonInfo(geojson) {
  const features =
    geojson.type === 'FeatureCollection'
      ? geojson.features || []
      : geojson.type === 'Feature'
        ? [geojson]
        : [{ type: 'Feature', geometry: geojson, properties: {} }]
  const propertyKeys = new Set()
  const geometryTypes = new Set()
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  const updateBBox = (coords) => {
    if (!Array.isArray(coords)) return
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      minLon = Math.min(minLon, coords[0])
      maxLon = Math.max(maxLon, coords[0])
      minLat = Math.min(minLat, coords[1])
      maxLat = Math.max(maxLat, coords[1])
      return
    }
    for (const child of coords) updateBBox(child)
  }
  for (const feature of features) {
    for (const key of Object.keys(feature?.properties || {})) propertyKeys.add(key)
    for (const type of geojsonGeometryTypes(feature?.geometry)) geometryTypes.add(type)
    updateBBox(feature?.geometry?.coordinates)
  }
  const bbox =
    Number.isFinite(minLon) && Number.isFinite(minLat)
      ? { minLon, minLat, maxLon, maxLat }
      : undefined
  return { propertyKeys: [...propertyKeys], geometryTypes: [...geometryTypes], featureCount: features.length, bbox }
}

/**
 * 读取数据文件，返回统一画像：
 * { filePath, format, columns:[profile], rows:[[...]], mapping, extras, warnings }
 */
export async function readDataFile(filePath, deps = {}) {
  const warnings = []
  const stat = await statSafe(filePath)
  if (!stat || !stat.isFile()) {
    return { error: `数据文件不存在：${filePath}`, warnings }
  }
  const ext = path.extname(filePath).toLowerCase()
  try {
    if (ext === '.geojson' || ext === '.json') {
      const text = await fsp.readFile(filePath, 'utf8')
      const geojson = JSON.parse(stripBom(text))
      const info = collectGeoJsonInfo(geojson)
      const columns = info.propertyKeys.map((name) => ({
        name,
        index: -1,
        filled: info.featureCount,
        numeric: false,
        datetime: false,
        uniqueCount: 0,
        categorical: true,
        sample: [],
      }))
      const hasPoint = info.geometryTypes.includes('Point')
      if (hasPoint) {
        columns.push({ name: 'lon', index: -2, filled: info.featureCount, numeric: true, datetime: false, uniqueCount: 0, categorical: false, sample: [] })
        columns.push({ name: 'lat', index: -1, filled: info.featureCount, numeric: true, datetime: false, uniqueCount: 0, categorical: false, sample: [] })
      }
      return {
        filePath,
        format: 'geojson',
        columns,
        rows: [],
        rowCount: info.featureCount,
        geojson: { geometryTypes: info.geometryTypes, bbox: info.bbox, featureCount: info.featureCount },
        mapping: guessMapping(columns),
        warnings,
        size: stat.size,
      }
    }
    if (ext === '.xlsx' || ext === '.xls') {
      const parsed = await readXlsxViaPython(filePath, deps)
      if (parsed.error) {
        warnings.push(parsed.error)
        return { filePath, format: 'xlsx', columns: [], rows: [], mapping: {}, warnings, size: stat.size, unreadable: true }
      }
      const header = (parsed.columns || []).map((name, index) => String(name).trim() || `col${index + 1}`)
      const rows = (parsed.rows || []).map((row) => (row || []).map((cell) => (cell === null ? '' : String(cell))))
      const columns = profileColumns(header, rows.slice(0, MAX_SAMPLE_ROWS))
      return {
        filePath,
        format: 'xlsx',
        columns,
        rows: rows.slice(0, MAX_SAMPLE_ROWS),
        rowCount: rows.length,
        mapping: guessMapping(columns),
        warnings,
        size: stat.size,
      }
    }
    // CSV / TSV / TXT
    if (stat.size > MAX_INLINE_BYTES) warnings.push(`文件较大（${Math.round(stat.size / 1048576)}MB），只抽样前 ${MAX_SAMPLE_ROWS} 行`)
    const text = await fsp.readFile(filePath, 'utf8')
    const delimiter = ext === '.tsv' ? '\t' : detectDelimiter(text)
    const { header, rows } = parseDelimited(text, delimiter)
    if (!header.length) {
      return { error: `无法解析表格：${filePath}`, warnings }
    }
    const columns = profileColumns(header, rows)
    return {
      filePath,
      format: ext === '.tsv' ? 'tsv' : 'csv',
      delimiter,
      columns,
      rows: rows.slice(0, MAX_SAMPLE_ROWS),
      rowCount: rows.length,
      mapping: guessMapping(columns),
      warnings,
      size: stat.size,
    }
  } catch (error) {
    return { error: `读取数据失败：${errText(error)}`, warnings }
  }
}

/** 把数据文件复制进 figure 目录，spec.data.source 用相对 workDir 路径（契约 §3.2）。 */
export async function stageDataFile(filePath, { figureDir, figureId, workDir }) {
  const stat = await statSafe(filePath)
  if (!stat?.isFile()) return { error: `数据文件不存在：${filePath}` }
  const ext = path.extname(filePath) || '.csv'
  if (stat.size > MAX_INLINE_BYTES) {
    return { source: path.resolve(filePath), staged: false }
  }
  const targetName = `data${ext}`
  const targetPath = path.join(figureDir, targetName)
  try {
    await fsp.copyFile(filePath, targetPath)
    return { source: path.posix.join(figureId, targetName), staged: true, stagedPath: targetPath }
  } catch (error) {
    return { source: path.resolve(filePath), staged: false, warning: `数据复制失败，改用绝对路径：${errText(error)}` }
  }
}
