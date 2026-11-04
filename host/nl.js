// 中文自然语言 → spec 补丁。
// 索引来源：renderer 的 controls.json（labelZh / aliases / optionLabels / unit / min / max / step）。
// 不做字段硬编码：所有可识别目标都来自索引；少量句式与量词规则是通用的。
//
// parse() 输出：
//   { set: {path: value}, hits: [{path,value,labelZh,matched,clause}], unapplied: [原文子句], reasons: {子句: 原因} }
import { getPath } from './util.js'
import { colorWordScore } from './palettes.js'

// ---------------------------------------------------------------------------
// 归一化
// ---------------------------------------------------------------------------

export function normalizeText(input) {
  return String(input ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；;,：:!！?？~～]/g, '')
}

function norm(input) {
  return normalizeText(input)
}

// ---------------------------------------------------------------------------
// 词表
// ---------------------------------------------------------------------------

const NEGATION = /不要|不用|不需要|去掉|去除|删除|关闭|关掉|隐藏|取消|禁用|别用|别加|别显示|别画|不显示|不画|不标/
const ADD = /加上|添加|加上|增加|显示|打开|开启|启用|勾选|画上|标上|要|保留|开启/
const INCREASE = /调大|大一点|大一些|大些|大不少|增大|加大|加粗|调粗|变粗|粗一点|粗一些|粗些|提高|增加|加|放大|拉大|变长|长一点/
const DECREASE = /调小|小一点|小一些|小些|减小|缩小|变细|调细|细一点|细一些|细些|降低|减|缩短|短一点/
const BIG_DELTA = /很多|大幅|明显|不少|一大截|好几|好多|大幅度|大得多|小得多|很多倍/
const SMALL_DELTA = /一点|一些|稍微|略微|稍|一点点|些许/
const SET_VERB = /改成|改为|换成|设为|设置成|设置|调成|调到|调整为|调整|变成|放到|放在|挪到|移到|移至|摆到|摆放|置于|放在|用|选用|选择|选|变成|变为|为|是/
const QUOTE = /[「『《“"']([^」』》”"']{1,80})[」』》”"']/

const DIRECTION_CANON = [
  ['右下角', '右下'], ['左下角', '左下'], ['右上角', '右上'], ['左上角', '左上'],
  ['右下方', '右下'], ['左下方', '左下'], ['右上方', '右上'], ['左上方', '左上'],
  ['右下边', '右下'], ['左下边', '左下'], ['右上边', '右上'], ['左上边', '左上'],
  ['下边', '下方'], ['下面', '下方'], ['底部', '下方'], ['下方', '下方'], ['下侧', '下方'],
  ['上边', '上方'], ['上面', '上方'], ['顶部', '上方'], ['上方', '上方'], ['上侧', '上方'],
  ['右边', '右侧'], ['右面', '右侧'], ['右侧', '右侧'], ['右方', '右侧'],
  ['左边', '左侧'], ['左面', '左侧'], ['左侧', '左侧'], ['左方', '左侧'],
  ['中间', '居中'], ['中心', '居中'], ['正中', '居中'], ['居中', '居中'],
  ['图外', '图外'], ['外面', '图外'], ['外部', '图外'], ['外侧', '图外'],
  ['横向', '水平'], ['水平', '水平'], ['竖向', '竖直'], ['竖直', '竖直'], ['纵向', '竖直'],
]

const COLOR_NAMES = [
  ['深红', '#8b0000'], ['红色', '#d62728'], ['红', '#d62728'],
  ['深蓝', '#08306b'], ['浅蓝', '#9ecae1'], ['蓝色', '#1f77b4'], ['蓝', '#1f77b4'],
  ['深绿', '#006d2c'], ['浅绿', '#a1d99b'], ['绿色', '#2ca02c'], ['绿', '#2ca02c'],
  ['黑色', '#000000'], ['黑', '#000000'],
  ['白色', '#ffffff'], ['白', '#ffffff'],
  ['灰色', '#7f7f7f'], ['灰', '#7f7f7f'],
  ['橙色', '#ff7f0e'], ['橙', '#ff7f0e'],
  ['紫色', '#9467bd'], ['紫', '#9467bd'],
  ['黄色', '#ffd700'], ['黄', '#ffd700'],
  ['棕色', '#8c564b'], ['棕', '#8c564b'],
  ['青色', '#17becf'], ['青', '#17becf'],
  ['粉色', '#e377c2'], ['粉', '#e377c2'],
]

// ---------------------------------------------------------------------------
// v4：配色意图 / 投影中文名映射（契约 §9.3）
// ---------------------------------------------------------------------------

const PALETTE_TRIGGER = /配色|色系|调色板|palette|换一套颜色|换一套配色/
const PALETTE_ORDINAL = /第\s*([0-9零一二三四五六七八九十百]{1,3})\s*套/
const COLORBAR_CONTEXT = /色带|色条|colorbar/
const PALETTE_COLOR_WORDS = ['红', '橙', '黄', '绿', '青', '蓝', '紫', '粉', '灰', '黑', '白']

const CHINESE_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

function parseOrdinalNumber(text) {
  const value = String(text || '').trim()
  if (/^\d+$/.test(value)) return Number(value)
  if (!value) return NaN
  if (value === '十') return 10
  if (value.startsWith('十')) return 10 + (CHINESE_DIGITS[value[1]] ?? 0)
  if (value.includes('十')) {
    const [tens, ones] = value.split('十')
    return (CHINESE_DIGITS[tens] ?? 0) * 10 + (ones ? CHINESE_DIGITS[ones] ?? 0 : 0)
  }
  return CHINESE_DIGITS[value] ?? NaN
}

/** 常见投影中文名/别名 → renderer 的枚举值（覆盖 11 种）。 */
const PROJECTION_ALIASES = [
  ['等经纬度', 'platecarree'], ['等经纬', 'platecarree'], ['等距圆柱', 'platecarree'], ['圆柱等距', 'platecarree'], ['equirectangular', 'platecarree'],
  ['墨卡托', 'mercator'], ['mercator', 'mercator'],
  ['米勒', 'miller'], ['miller', 'miller'],
  ['兰伯特', 'lambert'], ['兰勃特', 'lambert'], ['兰贝特', 'lambert'], ['lambert', 'lambert'],
  ['阿尔伯斯', 'albers'], ['亚尔勃斯', 'albers'], ['阿伯斯', 'albers'], ['albers', 'albers'],
  ['罗宾逊', 'robinson'], ['罗宾森', 'robinson'], ['robinson', 'robinson'],
  ['莫尔韦德', 'mollweide'], ['摩尔威特', 'mollweide'], ['莫尔魏德', 'mollweide'], ['摩尔魏特', 'mollweide'], ['mollweide', 'mollweide'],
  ['等地球', 'equalearth'], ['等面积地球', 'equalearth'], ['equal earth', 'equalearth'], ['equalearth', 'equalearth'],
  ['正射', 'orthographic'], ['正射投影', 'orthographic'], ['orthographic', 'orthographic'],
  ['方位等距', 'azimuthal'], ['方位投影', 'azimuthal'], ['方位等距投影', 'azimuthal'], ['azimuthal', 'azimuthal'],
  ['北极立体', 'northpolarstereo'], ['极射赤面', 'northpolarstereo'], ['立体投影', 'northpolarstereo'], ['stereographic', 'northpolarstereo'],
]

function projectionAliasValue(item, clauseNorm) {
  if (!/projection/i.test(item.path)) return undefined
  const options = Array.isArray(item.options) ? item.options : []
  let best
  for (const [alias, value] of PROJECTION_ALIASES) {
    const key = norm(alias)
    if (!key || !clauseNorm.includes(key)) continue
    if (!options.includes(value)) continue
    if (!best || key.length > best.length) best = { value, length: key.length }
  }
  return best?.value
}

/** 标准纬线文本规范化："30 和 50" / "25、47" / "25度,47度" / "25~47" → "25,47" */
function normalizeStandardParallels(text) {
  const numbers = String(text || '')
    .replace(/[度°]/g, ' ')
    .split(/[,，、;；~和与及\s]+/u)
    .map((part) => part.trim())
    .filter((part) => /^-?\d+(?:\.\d+)?$/.test(part))
  return numbers.join(',')
}

/**
 * 配色意图（"换一套配色"/"第 3 套"/"参考我的 PPT 配色"/"绿色系"/"色带配色…"）。
 * @returns {{item: object, value: string}|undefined}
 */
function matchPaletteIntent(clauseNorm, spec, index) {
  const ordinalMatch = PALETTE_ORDINAL.exec(clauseNorm)
  const colorWord = PALETTE_COLOR_WORDS.find((word) => clauseNorm.includes(word))
  const colorbar = COLORBAR_CONTEXT.test(clauseNorm)
  const wantsPalette =
    PALETTE_TRIGGER.test(clauseNorm) ||
    Boolean(ordinalMatch) ||
    (colorbar && Boolean(colorWord)) ||
    (/换一套|换一个|下一套|换个/.test(clauseNorm) && colorbar) ||
    /参考\s*(?:我的\s*)?ppt|ppt\s*配色|参考我的/.test(clauseNorm)
  if (!wantsPalette) return undefined

  let path
  let kinds
  if (colorbar) {
    path = 'map.colorbar.palette'
    kinds = ['sequential', 'diverging']
  } else if (/发散|正负|距平/.test(clauseNorm)) {
    path = 'style.paletteDiverging'
    kinds = ['diverging']
  } else if (/顺序|连续|热力|分级/.test(clauseNorm)) {
    path = 'style.paletteSequential'
    kinds = ['sequential']
  } else {
    path = 'style.palette'
    kinds = ['categorical']
  }
  const item = index.byPath?.get(path)
  if (!item || !Array.isArray(item.options) || !item.options.length) return undefined
  const options = item.options
  const kindOf = (id) => index.paletteById?.get(id)?.kind
  // 只把 palettes.json 里真实存在且 kind 匹配的 id 当候选；palettes 缺失时退回 options
  const knownPool = options.filter((id) => kinds.includes(kindOf(id)))
  const loosePool = options.filter((id) => kinds.includes(kindOf(id) || 'categorical'))
  const candidates = knownPool.length ? knownPool : loosePool.length ? loosePool : options

  // 1) 显式 id：ppt-03 / ppt3
  const idMatch = /pp?t[-\s_]?(\d{1,2})/i.exec(clauseNorm)
  if (idMatch) {
    const id = `ppt-${String(Number(idMatch[1])).padStart(2, '0')}`
    if (options.includes(id)) return { item, value: id }
  }
  // 2) 第 N 套（按该 kind 的生成顺序）
  if (ordinalMatch) {
    const order = Number(ordinalMatch[1]) || parseOrdinalNumber(ordinalMatch[1])
    if (Number.isFinite(order) && order >= 1 && order <= candidates.length) {
      return { item, value: candidates[Math.floor(order) - 1] }
    }
    return undefined
  }
  // 3) 参考我的 PPT 配色（无编号）→ 该 kind 第一套（分类色 = ppt-01）
  if (/参考\s*(?:我的\s*)?ppt|ppt\s*配色|参考我的/.test(clauseNorm)) {
    if (path === 'style.palette' && options.includes('ppt-01')) return { item, value: 'ppt-01' }
    return { item, value: candidates[0] }
  }
  // 4) 色彩关键词（绿色系/蓝色/红色系…）
  if (colorWord) {
    let best
    for (const id of candidates) {
      const palette = index.paletteById?.get(id)
      if (!palette) continue
      const score = colorWordScore(palette, colorWord)
      if (score > 0 && (!best || score > best.score)) best = { id, score }
    }
    if (best) return { item, value: best.id }
  }
  // 5) 换一套 / 下一套 → 当前值的下一个（循环）
  if (/换一套|换一个|下一套|换个/.test(clauseNorm)) {
    const current = getPath(spec, path)
    const start = typeof current === 'string' ? candidates.indexOf(current) : 0
    const next = candidates[(start + 1 + candidates.length) % candidates.length]
    return { item, value: next }
  }
  // 6) 只有"配色/色带配色"没给具体值 → 该 kind 第一套
  if (/换成|改成|改为|设为|调到|用|换|套/.test(clauseNorm)) {
    return { item, value: candidates[0] }
  }
  return undefined
}

// 通用意图提示：当没有直接命中控件名时，用 path/label 语义 + 上下文挑控件。
const GENERIC_HINTS = [
  { re: /字号|字体大小|字大小|字号大小|字大小/, test: (it) => /fontsize|font_size|fontsizept/i.test(it.path) || /字号|字体大小/.test(it.labelZh) },
  { re: /字体|字形|font/, test: (it) => /fontfamily|font_family|fontname|font\.family/i.test(it.path) || (/字体/.test(it.labelZh) && !/字号/.test(it.labelZh)) },
  { re: /线宽|线粗|粗细|线条|边框宽/, test: (it) => /linewidth|line_width|edgewidth|linewidthpt/i.test(it.path) || /线宽|粗细/.test(it.labelZh) },
  { re: /分辨率|清晰度|dpi/, test: (it) => /(?:^|\.)dpi(?:$|\.)/i.test(it.path) || /dpi|分辨率/.test(it.labelZh) },
  { re: /图宽|画幅宽|宽度|多宽/, test: (it) => /widthmm|width_mm|^figure\.width/i.test(it.path) || /宽度|图宽/.test(it.labelZh) },
  { re: /图高|画幅高|高度|多高/, test: (it) => /heightmm|height_mm|^figure\.height/i.test(it.path) || /高度|图高/.test(it.labelZh) },
  { re: /投影|坐标系|projection/, test: (it) => /projection|crs/i.test(it.path) || /投影|坐标系/.test(it.labelZh) },
  { re: /经纬网|经纬线|网格线|网格/, test: (it) => /graticule|gridline|grid/i.test(it.path) },
  { re: /色带|颜色条|色标|colorbar/, test: (it) => /colorbar|colormap|colourmap|color_bar/i.test(it.path) },
  { re: /比例尺|scalebar/, test: (it) => /scalebar|scale_bar|scale/i.test(it.path) },
  { re: /指北针|指北|罗盘|northarrow/, test: (it) => /northarrow|north_arrow|compass|north/i.test(it.path) },
  { re: /标题|题目|title/, test: (it) => /(?:^|\.)title(?:$|\.)/i.test(it.path) || /标题|题目/.test(it.labelZh) },
  { re: /刻度|tick/, test: (it) => /tick/i.test(it.path) || /刻度/.test(it.labelZh) },
  { re: /边框|boundary|spine/, test: (it) => /spine|border|frame/i.test(it.path) || /边框/.test(it.labelZh) },
  { re: /图例|legend/, test: (it) => /legend/i.test(it.path) },
  { re: /子图|分图|panel/, test: (it) => /subplot|panel|compose/i.test(it.path) },
]

const CONTEXT_RULES = [
  { re: /标题|题目/, tokens: ['title', '标题'] },
  { re: /图例|legend/, tokens: ['legend', '图例'] },
  { re: /色带|颜色条|色标|colorbar/, tokens: ['colorbar', '色带'] },
  { re: /坐标轴|轴|刻度|tick|axis/, tokens: ['axis', 'axes', 'tick', '轴', '刻度'] },
  { re: /子图|分图|panel/, tokens: ['subplot', 'panel', '子图'] },
  { re: /比例尺/, tokens: ['scalebar', 'scale', '比例尺'] },
  { re: /指北针|指北/, tokens: ['northarrow', 'north', '指北'] },
  { re: /图注|注释|脚注|caption/, tokens: ['caption', 'footnote', '注释', '脚注'] },
]

// ---------------------------------------------------------------------------
// 索引
// ---------------------------------------------------------------------------

function uniquePush(list, value) {
  if (typeof value !== 'string' || !value) return
  const key = norm(value)
  if (!key) return
  if (!list.some((existing) => norm(existing) === key)) list.push(value)
}

/** 由 ControlsService.load() 的结果建立 NL 索引。 */
export function buildIndex(controls) {
  const items = (controls?.items || []).map((item) => ({
    ...item,
    // 直接命中用的同义词：中文名 > 英文名 > aliases
    synonyms: (() => {
      const list = []
      uniquePush(list, item.labelZh)
      uniquePush(list, item.labelEn)
      for (const alias of item.aliases || []) uniquePush(list, alias)
      return list
    })(),
    // enum 选项：值 + 中文标签 + 位置变体
    optionEntries: (() => {
      if (item.type !== 'enum' || !Array.isArray(item.options)) return []
      const entries = []
      const labels = item.optionLabels || {}
      for (const option of item.options) {
        const texts = [String(option)]
        const label = labels[option] ?? labels[String(option)]
        if (typeof label === 'string') texts.push(label)
        for (const text of texts) {
          const variants = [text, `${text}角`, `${text}方`, `${text}侧`, `${text}边`]
          for (const variant of variants) entries.push({ option, text, variant, key: norm(variant) })
        }
      }
      // 去掉空变体并去重
      return entries.filter((entry, index) => entry.key && entries.findIndex((other) => other.key === entry.key && other.option === entry.option) === index)
    })(),
  }))

  const byPath = new Map(items.map((item) => [item.path, item]))
  // v4：palette 元数据（id → {kind,colors,name}）供"绿色系/第3套"这类配色意图解析
  const paletteDoc = controls?.palettes
  const paletteById = new Map()
  const paletteByKind = { categorical: [], sequential: [], diverging: [] }
  if (paletteDoc && Array.isArray(paletteDoc.palettes)) {
    for (const palette of paletteDoc.palettes) {
      if (!palette || typeof palette.id !== 'string') continue
      paletteById.set(palette.id, palette)
      const kind = paletteByKind[palette.kind] ? palette.kind : 'categorical'
      paletteByKind[kind].push(palette)
    }
  }
  return { items, byPath, paletteById, paletteByKind }
}

// ---------------------------------------------------------------------------
// 匹配
// ---------------------------------------------------------------------------

function matchDirect(clauseNorm, index) {
  let best
  for (const item of index.items) {
    for (const synonym of item.synonyms) {
      const key = norm(synonym)
      if (key.length < 2) continue
      const at = clauseNorm.indexOf(key)
      if (at < 0) continue
      const isLabel = norm(item.labelZh) === key
      const score = (isLabel ? 100 : 90) + key.length + (isLabel ? 3 : 0)
      if (!best || score > best.score) {
        best = { item, score, matched: synonym, key, at }
      }
    }
  }
  return best
}

function directionCanon(textNorm) {
  for (const [variant, canon] of DIRECTION_CANON) {
    if (textNorm.includes(norm(variant))) return canon
  }
  return undefined
}

function matchOption(item, clauseNorm) {
  let best
  for (const entry of item.optionEntries) {
    if (!entry.key) continue
    let score = 0
    const at = clauseNorm.indexOf(entry.key)
    if (at >= 0) {
      score = entry.key.length + (entry.variant === entry.text ? 2 : 0)
    } else if (entry.variant === entry.text) {
      // 用户可能只说选项标签的一部分（"兰伯特" vs "兰伯特等角圆锥"）：按前缀回退匹配
      const maxLen = Math.min(entry.key.length - 1, 8)
      for (let len = maxLen; len >= 2; len--) {
        if (clauseNorm.includes(entry.key.slice(0, len))) {
          score = len - 1
          break
        }
      }
    }
    if (!score) continue
    if (!best || score > best.score) best = { entry, score, at }
  }
  return best
}

function groupLabelScore(item, clauseNorm) {
  const groupLabel = norm(item.groupLabelZh)
  if (groupLabel && clauseNorm.includes(groupLabel)) return 25 + groupLabel.length
  return 0
}

function contextScore(item, clauseNorm) {
  let score = 0
  const haystack = `${item.path} ${item.labelZh} ${item.groupLabelZh}`.toLowerCase()
  for (const rule of CONTEXT_RULES) {
    if (!rule.re.test(clauseNorm)) continue
    for (const token of rule.tokens) {
      if (haystack.includes(token.toLowerCase())) {
        score += 8
        break
      }
    }
  }
  return score
}

function typePreference(item, clauseNorm) {
  const hasNumber = /-?\d+(?:\.\d+)?/.test(clauseNorm)
  if (item.type === 'bool' && (NEGATION.test(clauseNorm) || ADD.test(clauseNorm))) return 12
  if (item.type === 'number' && (hasNumber || INCREASE.test(clauseNorm) || DECREASE.test(clauseNorm))) return 10
  if (item.type === 'enum' && item.optionEntries.some((entry) => entry.key && clauseNorm.includes(entry.key))) return 14
  if (item.type === 'text' && (QUOTE.test(clauseNorm) || /标题|题目/.test(clauseNorm))) return 6
  if (item.type === 'color' && COLOR_NAMES.some(([name]) => clauseNorm.includes(norm(name)))) return 8
  return 0
}

/**
 * 语义亲和度：控件名/别名与子句的最长公共子串（≥2 字）。
 * 用于消除歧义，例如“柱子改成横向”里 bar.orientation(横向柱) 优于 axes.categoricalRotation(水平)。
 */
function affinityScore(item, clauseNorm) {
  let best = 0
  const texts = [item.labelZh, item.labelEn, ...(item.aliases || [])]
    .filter((text) => typeof text === 'string' && text)
    .map((text) => norm(text))
  for (const text of texts) {
    const maxLen = Math.min(text.length, clauseNorm.length)
    for (let len = maxLen; len >= 2; len--) {
      let found = false
      for (let start = 0; start + len <= text.length; start++) {
        if (clauseNorm.includes(text.slice(start, start + len))) {
          found = true
          break
        }
      }
      if (found) {
        best = Math.max(best, len)
        break
      }
    }
  }
  return best
}

/**
 * 直接命中的是 bool（如“图例”命中“显示图例”），但子句里出现了别的枚举控件的选项
 * （如“右下角”），说明用户真正想改的是那个枚举项 → 让位。没有开关意图（显示/隐藏）时才让位。
 */
function preferOptionEnum(candidate, clauseNorm, index) {
  const item = candidate?.item
  if (!item || item.type !== 'bool') return candidate
  if (NEGATION.test(clauseNorm) || ADD.test(clauseNorm)) return candidate
  let best
  for (const other of index.items) {
    if (other.type !== 'enum' || !other.optionEntries.length) continue
    const option = matchOption(other, clauseNorm)
    if (!option) continue
    const score =
      option.score +
      groupLabelScore(other, clauseNorm) +
      (other.groupId && other.groupId === item.groupId ? 20 : 0) +
      contextScore(other, clauseNorm) +
      affinityScore(other, clauseNorm) * 6
    if (!best || score > best.score) best = { item: other, score, matched: option.entry.text }
  }
  return best && best.score >= 20 ? best : candidate
}

/** 一个子句里第二轮及以后：剩余文本必须还留有明确的指令证据，否则视为残留词，不再匹配。 */
function hasDirective(item, clauseNorm, originalClause) {
  // “比例尺与指北针”“上边框和右边框”这类并列：说明是两条独立指令
  const conjoined = /[和与及]|以及/.test(clauseNorm)
  if (conjoined) return true
  switch (item.type) {
    case 'bool': {
      const negated = NEGATION.test(clauseNorm)
      if (negated) return true
      return ADD.test(clauseNorm) && !/不要|别/.test(clauseNorm)
    }
    case 'enum':
      return Boolean(matchOption(item, clauseNorm)) || Boolean(directionCanon(clauseNorm))
    case 'number':
      return /-?\d/.test(clauseNorm) || INCREASE.test(clauseNorm) || DECREASE.test(clauseNorm)
    case 'color':
      return Boolean(colorFromClause(clauseNorm))
    case 'text':
      return QUOTE.test(originalClause)
    default:
      return false
  }
}

/** 没有直接命中控件名时：枚举选项命中 + 通用意图提示。 */function matchIndirect(clauseNorm, index) {
  const candidates = []
  for (const item of index.items) {
    if (item.type === 'enum' && item.optionEntries.length) {
      const option = matchOption(item, clauseNorm)
      if (option) {
        const score =
          40 +
          option.score +
          groupLabelScore(item, clauseNorm) +
          contextScore(item, clauseNorm) +
          typePreference(item, clauseNorm) +
          affinityScore(item, clauseNorm) * 6
        candidates.push({ item, score, matched: option.entry.text })
      }
    }
  }
  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score)
    return candidates[0]
  }
  // 方位/方向同义词（"横向"→"水平"、"右边"→"右侧"）：找含该方向选项的枚举控件
  const canon = directionCanon(clauseNorm)
  if (canon) {
    const directionMatches = []
    for (const item of index.items) {
      if (item.type !== 'enum') continue
      const entry = item.optionEntries.find((candidate) => candidate.key && (candidate.key.includes(norm(canon)) || norm(canon).includes(candidate.key)))
      if (!entry) continue
      directionMatches.push({
        item,
        score:
          30 +
          entry.key.length +
          groupLabelScore(item, clauseNorm) +
          contextScore(item, clauseNorm) +
          typePreference(item, clauseNorm) +
          affinityScore(item, clauseNorm) * 6,
        matched: entry.text,
      })
    }
    if (directionMatches.length) {
      directionMatches.sort((a, b) => b.score - a.score)
      return directionMatches[0]
    }
  }
  // 通用意图
  for (const hint of GENERIC_HINTS) {
    if (!hint.re.test(clauseNorm)) continue
    const matched = index.items.filter((item) => hint.test(item))
    if (!matched.length) continue
    const scored = matched
      .map((item) => ({
        item,
        score: 20 + groupLabelScore(item, clauseNorm) + contextScore(item, clauseNorm) + typePreference(item, clauseNorm) + hint.re.source.length / 100,
        matched: hint.re.source,
      }))
      .sort((a, b) => b.score - a.score)
    return scored[0]
  }
  return undefined
}

// ---------------------------------------------------------------------------
// 取值
// ---------------------------------------------------------------------------

function currentValue(item, spec) {
  const value = spec ? getPath(spec, item.path) : undefined
  if (value !== undefined && value !== null) return value
  // 控件 default 可能为 null（表示"继承/未设置"）：相对量运算用 min 作为基准
  if (item.default !== undefined && item.default !== null) return item.default
  if (typeof item.min === 'number') return item.min
  return undefined
}

function stepOf(item) {
  if (typeof item.step === 'number' && item.step > 0) return item.step
  if (item.integer) return 1
  return 1
}

function clampNumber(item, value) {
  let num = value
  if (typeof item.min === 'number' && num < item.min) num = item.min
  if (typeof item.max === 'number' && num > item.max) num = item.max
  if (item.integer) num = Math.round(num)
  return Math.round(num * 1000) / 1000
}

function extractNumber(clauseNorm, item) {
  // 取 "数字 + 可选单位"，优先带单位/靠近关键词的数字
  const pattern = /(-?\d+(?:\.\d+)?)(pt|mm|px|dpi|%|‰|倍|厘米|毫米|磅|号)?/g
  let match
  let best
  while ((match = pattern.exec(clauseNorm)) !== null) {
    const num = Number(match[1])
    if (!Number.isFinite(num)) continue
    const unit = match[2] || ''
    let score = 1
    if (unit) score += 4
    if (item.unit && unit && norm(item.unit) === norm(unit)) score += 6
    if (!best || score > best.score) best = { value: num, unit, score }
  }
  return best
}

function percentToValue(item, num) {
  // 控件量纲是 0..1 时，50% → 0.5
  if (typeof item.min === 'number' && typeof item.max === 'number') {
    if (item.max <= 1 && item.min >= 0) return num / 100
    if (item.max <= 100 && item.min >= 0) return num
  }
  return num
}

function colorFromClause(clauseNorm) {
  const hex = /#([0-9a-f]{6})/i.exec(clauseNorm)
  if (hex) return `#${hex[1].toLowerCase()}`
  const hex3 = /#([0-9a-f]{3})\b/i.exec(clauseNorm)
  if (hex3) return `#${hex3[1].toLowerCase()}`
  for (const [name, value] of COLOR_NAMES) {
    if (clauseNorm.includes(norm(name))) return value
  }
  return undefined
}

function enumValueFromClause(item, clauseNorm) {
  const option = matchOption(item, clauseNorm)
  if (option) return option.entry.option
  // v4：投影常见中文别名（莫尔韦德/摩尔威特/北极立体…）→ 枚举值
  const projectionValue = projectionAliasValue(item, clauseNorm)
  if (projectionValue !== undefined) return projectionValue
  // 方向词兜底：找 label 里同时含方向词的选项
  const canon = directionCanon(clauseNorm)
  if (canon) {
    const entry = item.optionEntries.find((candidate) => {
      const labelKey = candidate.key
      return labelKey.includes(norm(canon)) || norm(canon).includes(labelKey)
    })
    if (entry) return entry.option
    // 直接看 option 值里是否含方向英文
    const englishMap = { 右下: 'lower right', 左下: 'lower left', 右上: 'upper right', 左上: 'upper left', 居中: 'center', 下方: 'below', 上方: 'upper', 右侧: 'right', 左侧: 'left', 图外: 'outside' }
    const english = englishMap[canon]
    if (english) {
      const byValue = item.options.find((option) => String(option).toLowerCase().includes(english))
      if (byValue !== undefined) return byValue
    }
  }
  if (/自动|auto/i.test(clauseNorm)) {
    const auto = item.optionEntries.find((entry) => /自动|auto/i.test(entry.text))
    if (auto) return auto.option
  }
  // 颜色词 → 选项里含该颜色名
  for (const [name] of COLOR_NAMES) {
    if (!clauseNorm.includes(norm(name))) continue
    const entry = item.optionEntries.find((candidate) => candidate.key.includes(norm(name).replace(/色$/, '')))
    if (entry) return entry.option
  }
  return undefined
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 用控件同义词（忽略大小写/空格差异）从原文里剔除控件名，剩下的才是取值。 */
function stripSynonyms(text, item) {
  let rest = String(text)
  for (const synonym of item.synonyms || []) {
    const key = norm(synonym)
    if (!key) continue
    const pattern = String(synonym)
      .trim()
      .split(/\s+/)
      .map((part) => escapeRegExp(part))
      .join('\\s*')
    if (!pattern) continue
    rest = rest.replace(new RegExp(pattern, 'gi'), ' ')
  }
  return rest
}

function textValueFromClause(originalClause, clauseNorm, item) {
  const quoted = QUOTE.exec(originalClause)
  if (quoted) return quoted[1].trim()
  // 去掉控件名与动词后剩下的内容
  let rest = stripSynonyms(originalClause, item)
  rest = rest.replace(SET_VERB, ' ').replace(/^(?:把|将|的|了|吧|呢|啊|请|帮我)/, '').trim()
  rest = rest.replace(/^[，,。；;：:\s]+/, '').replace(/[，,。；;：:\s]+$/, '')
  if (rest.length > 0) return rest
  return undefined
}

// ---------------------------------------------------------------------------
// 子句解析
// ---------------------------------------------------------------------------

function applyNumber(item, clauseNorm, spec, { increase, decrease }) {
  const token = extractNumber(clauseNorm, item)
  const current = Number(currentValue(item, spec))
  const step = stepOf(item)
  if (token) {
    let value = token.value
    if (token.unit === '%' || token.unit === '‰') value = percentToValue(item, value)
    if (increase && !decrease) {
      // "加2" 这种相对增量
      if (/加|增|提高/.test(clauseNorm) && !/调到|设为|改成|到/.test(clauseNorm)) value = current + token.value
    } else if (decrease && !increase) {
      if (/减|降|少/.test(clauseNorm) && !/调到|设为|改成|到/.test(clauseNorm)) value = current - token.value
    }
    return { ok: true, value: clampNumber(item, value) }
  }
  if (!increase && !decrease) return { ok: false, reason: '没有识别到数字' }
  const base = Number.isFinite(current) ? current : Number.isFinite(item.max) ? item.max : 0
  const magnitude = BIG_DELTA.test(clauseNorm) ? 3 : SMALL_DELTA.test(clauseNorm) ? 1 : 1
  const delta = step * magnitude
  const value = increase ? base + delta : base - delta
  return { ok: true, value: clampNumber(item, value) }
}

function resolveOne(item, clauseNorm, originalClause, spec) {
  const increase = INCREASE.test(clauseNorm)
  const decrease = DECREASE.test(clauseNorm)
  const negation = NEGATION.test(clauseNorm)

  if (item.type === 'bool') {
    if (negation) return { ok: true, value: false }
    if (ADD.test(clauseNorm) || !SET_VERB.test(clauseNorm)) return { ok: true, value: true }
    return { ok: true, value: true }
  }

  if (item.type === 'enum') {
    if (negation) {
      const off = item.options.find((option) => /^(none|off|hide|hidden|不显示|无|否)$/i.test(String(option).trim()))
      if (off !== undefined) return { ok: true, value: off }
      const notShown = item.optionEntries.find((entry) => /隐藏|不显示|关闭|无/.test(entry.text))
      if (notShown) return { ok: true, value: notShown.option }
      return { ok: false, reason: '该选项没有“关闭/隐藏”取值' }
    }
    const value = enumValueFromClause(item, clauseNorm)
    if (value !== undefined) return { ok: true, value }
    return { ok: false, reason: '没有识别到可选项' }
  }

  if (item.type === 'number') {
    return applyNumber(item, clauseNorm, spec, { increase, decrease })
  }

  if (item.type === 'color') {
    const color = colorFromClause(clauseNorm)
    if (color) return { ok: true, value: color }
    return { ok: false, reason: '没有识别到颜色' }
  }

  // text / 其他
  let text = textValueFromClause(originalClause, clauseNorm, item)
  if (text !== undefined && item.path === 'map.standardParallels') {
    text = normalizeStandardParallels(text)
    if (!text) return { ok: false, reason: '没有识别到标准纬线数值（如 "25,47"）' }
  }
  if (text !== undefined && item.path === 'map.standardParallels' && !/^[-0-9.,]+$/.test(text)) {
    return { ok: false, reason: '标准纬线需要两个数字，如 "25,47"' }
  }
  if (text !== undefined) return { ok: true, value: text }
  return { ok: false, reason: '没有识别到文本内容' }
}

/** 特殊裸标题：控件清单里没有标题项时，允许直接设置 spec.title。 */
function matchTitleFallback(clauseNorm) {
  if (!/标题|题目|图名/.test(clauseNorm)) return undefined
  return {
    item: {
      path: 'title',
      type: 'text',
      labelZh: '标题',
      labelEn: 'Title',
      synonyms: ['标题', '题目', '图名'],
      groupLabelZh: '',
      optionEntries: [],
    },
    matched: '标题',
  }
}

const SPLITTER = /[，,、；;。\n]|然后|并且|接着|同时|以及|随后/

/**
 * 解析一段中文指令。
 * @param {string} text
 * @param {ReturnType<typeof buildIndex>} index
 * @param {{spec?: object}} options
 */
export function parse(text, index, options = {}) {
  const spec = options.spec
  const set = {}
  const hits = []
  const unapplied = []
  const reasons = {}
  // "标准纬线 25,47" 这类"数字,数字"不能被子句逗号切分 → 先用 ~ 占位（normalizeStandardParallels 再还原）
  const source = String(text ?? '').replace(/(\d+(?:\.\d+)?)\s*[,，]\s*(\d+(?:\.\d+)?)/g, '$1~$2')
  const rawClauses = source.split(SPLITTER).map((clause) => clause.trim()).filter(Boolean)
  const clauses = rawClauses.length ? rawClauses : [source.trim()].filter(Boolean)

  for (const originalClause of clauses) {
    let clauseNorm = norm(originalClause)
    if (!clauseNorm) continue
    let matchedCount = 0
    let clauseFailed = false
    let lastReason = ''
    const hitPaths = new Set()

    // 一个子句里最多抽 3 个指令（如“图例字号和图例颜色都改大”）；
    // 第二轮起只接受“控件名直接命中”，避免同一个位置被重复推断成别的控件。
    for (let round = 0; round < 3; round++) {
      if (round === 0) {
        // v4：配色意图优先（"换一套配色"/"第 3 套"/"参考我的 PPT 配色"/"绿色系"/"色带配色…"）
        const paletteHit = matchPaletteIntent(clauseNorm, spec, index)
        if (paletteHit && !hitPaths.has(paletteHit.item.path)) {
          const item = paletteHit.item
          set[item.path] = paletteHit.value
          hitPaths.add(item.path)
          hits.push({
            path: item.path,
            value: paletteHit.value,
            labelZh: item.labelZh || item.path,
            matched: '配色',
            clause: originalClause,
          })
          matchedCount += 1
          // 遮蔽配色相关词与编号，避免重复命中
          clauseNorm = clauseNorm
            .replace(PALETTE_TRIGGER, ' ')
            .replace(PALETTE_ORDINAL, ' ')
            .replace(/pp?t[-\s_]?\d{1,2}/gi, ' ')
            .replace(/参考\s*(?:我的\s*)?ppt|ppt\s*配色|参考我的/g, ' ')
            .replace(/色带|色条|colorbar/g, ' ')
            .replace(/顺序|连续|热力|发散|正负|距平|分级填色|分级设色|分级配色/g, ' ')
            .replace(/换成|改成|改为|设为|调到|调整|用|换一套|换一个|换种|换成一套|换|一套|第|套/g, ' ')
          for (const word of PALETTE_COLOR_WORDS) {
            if (clauseNorm.includes(word)) {
              clauseNorm = clauseNorm.replaceAll(word, ' ')
              break
            }
          }
          clauseNorm = clauseNorm.replace(/-?\d+(?:\.\d+)?/g, ' ')
          if (!clauseNorm.trim()) break
          continue
        }
      }
      const direct = matchDirect(clauseNorm, index)
      let candidate = direct
      if (!candidate && round === 0) {
        // “标题改成xxx”：控件清单里没有标题项时，直接落到 spec.title 固定路径
        if (/标题|题目|图名/.test(clauseNorm) && !/字号|字体|大小|位置|颜色|加粗/.test(clauseNorm)) {
          candidate = matchTitleFallback(clauseNorm)
        }
      }
      if (!candidate && round === 0) candidate = matchIndirect(clauseNorm, index)
      if (!candidate) break
      if (direct) {
        // 直接命中后，用上下文挑更精确的同名控件（例如多处“字号”）
        const sameKey = index.items.filter((item) => {
          return (item.synonyms || []).some((synonym) => norm(synonym) === direct.key)
        })
        if (sameKey.length > 1) {
          const ranked = sameKey
            .map((item) => ({
              item,
              score: groupLabelScore(item, clauseNorm) + contextScore(item, clauseNorm) + (item.path.split('.').length <= 2 ? 3 : 0),
            }))
            .sort((a, b) => b.score - a.score)
          candidate = { ...direct, item: ranked[0].item }
        }
      }
      // 命中 bool 但子句里其实匹配到了某个枚举选项（“图例放右下角”）→ 让位给枚举项
      candidate = preferOptionEnum(candidate, clauseNorm, index)

      const item = candidate.item
      if (hitPaths.has(item.path)) break
      const resolved = resolveOne(item, clauseNorm, originalClause, spec)
      if (!resolved.ok) {
        lastReason = resolved.reason || '无法应用'
        clauseFailed = true
        break
      }
      // 同路径后写的覆盖先写的
      set[item.path] = resolved.value
      hitPaths.add(item.path)
      hits.push({
        path: item.path,
        value: resolved.value,
        labelZh: item.labelZh || item.path,
        matched: candidate.matched || '',
        clause: originalClause,
      })
      matchedCount += 1
      // 遮蔽已消费的文本，避免同一处被重复匹配
      const maskKeys = [candidate.matched, ...(item.synonyms || [])]
        .map((value) => norm(value))
        .filter((key) => key && key.length >= 2)
      for (const key of maskKeys) {
        if (clauseNorm.includes(key)) clauseNorm = clauseNorm.replaceAll(key, ' ')
      }
      // 数值消费掉
      clauseNorm = clauseNorm.replace(/-?\d+(?:\.\d+)?(?:pt|mm|px|dpi|%|‰|倍|厘米|毫米|磅|号)?/g, ' ')
      if (!clauseNorm.trim()) break
      // 第二轮及以后：剩余文本必须还有明确的指令证据（如“不要”+另一个控件名），
      // 否则只是第一句的残留词（“图例放右下角”里的“图例”），不能再产出一条修改。
      const next = matchDirect(clauseNorm, index)
      if (!next || !hasDirective(next.item, clauseNorm, originalClause)) break
    }

    if (matchedCount === 0) {
      unapplied.push(originalClause)
      reasons[originalClause] = lastReason || '没有匹配到可调参数'
    } else if (clauseFailed && !unapplied.includes(originalClause)) {
      unapplied.push(originalClause)
      reasons[originalClause] = lastReason
    }
  }

  return { set, hits, unapplied, reasons }
}

/** 给 HTTP /api/nl 的 applied 数组用：把 parse 结果映射成契约字段。 */
export function toApplied(hits) {
  return hits.map((hit) => ({ path: hit.path, labelZh: hit.labelZh, value: hit.value }))
}
