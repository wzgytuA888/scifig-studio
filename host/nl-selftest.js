// 中文 NL 解析自测：优先用 renderer 真实的 py/scifig/controls.json（当前已就绪），
// 缺失时回退到 host/nl-fixture-controls.json。命令：
//   node host/nl-selftest.js
// 结果写入 host/nl-selftest.json（含逐条预期的 actual / 失败原因）。
import path from 'node:path'
import os from 'node:os'
import { promises as fsp } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ControlsService } from './controls.js'
import { buildIndex, parse } from './nl.js'
import { colorWordScore } from './palettes.js'
import { getPath } from './util.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE_DIR = path.dirname(HERE)

async function exists(filePath) {
  return fsp
    .access(filePath)
    .then(() => true)
    .catch(() => false)
}

async function makeControlsService() {
  const realControls = path.join(BUNDLE_DIR, 'py', 'scifig', 'controls.json')
  const realPresets = path.join(BUNDLE_DIR, 'py', 'scifig', 'presets.json')
  if (await exists(realControls)) {
    return { service: new ControlsService({ bundleDir: BUNDLE_DIR }), source: 'py/scifig/controls.json（renderer 真实产物）' }
  }
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scifig-nl-'))
  const pyScifig = path.join(tempDir, 'py', 'scifig')
  await fsp.mkdir(pyScifig, { recursive: true })
  await fsp.copyFile(path.join(HERE, 'nl-fixture-controls.json'), path.join(pyScifig, 'controls.json'))
  await fsp.copyFile(
    (await exists(realPresets)) ? realPresets : path.join(HERE, 'nl-fixture-presets.json'),
    path.join(pyScifig, 'presets.json'),
  )
  return {
    service: new ControlsService({ bundleDir: tempDir }),
    source: 'host/nl-fixture-controls.json（renderer 的 controls.json 尚未就绪，暂用 fixture）',
  }
}

/** 相对量测试的期望值：默认值 + n 个 step（与解析器同一规则）。 */
function makeHelpers(baseSpec, byPath) {
  const valueOf = (dotted) => {
    let value = getPath(baseSpec, dotted)
    if (value === undefined || value === null) value = byPath.get(dotted)?.default
    // 控件 default 可能为 null（继承/未设置）→ 与解析器一致，用 min 作为基准
    if (value === undefined || value === null) value = byPath.get(dotted)?.min
    return value
  }
  const stepOf = (dotted) => {
    const step = byPath.get(dotted)?.step
    return typeof step === 'number' && step > 0 ? step : 1
  }
  const plus = (dotted, n = 1) => {
    const value = Number(valueOf(dotted))
    if (!Number.isFinite(value)) return valueOf(dotted)
    return Math.round((value + n * stepOf(dotted)) * 1000) / 1000
  }
  return { valueOf, stepOf, plus }
}

function makeCases(helpers, ctx) {
  const { plus } = helpers
  return [
    { text: '图例放右下角', expect: { 'legend.position': 'lower right' } },
    { text: '图例位置改成右上', expect: { 'legend.position': 'upper right' } },
    { text: '把图例放到图外右侧', expect: { 'legend.position': 'outside right' } },
    { text: '图例放到图下方', expect: { 'legend.position': 'below' } },
    { text: '图例字号调到8', expect: { 'legend.fontSize': 8 } },
    { text: '图例字号大一点', expect: { 'legend.fontSize': plus('legend.fontSize') } },
    { text: '去掉图例', expect: { 'legend.show': false } },
    { text: '不要显示图例', expect: { 'legend.show': false } },
    { text: '加上图例', expect: { 'legend.show': true } },
    { text: '字号调到10', expect: { 'style.font.sizeBase': 10 } },
    { text: '轴标题字号调到8', expect: { 'style.font.sizeAxis': 8 } },
    { text: '标题字号改大一点', expect: { 'style.font.sizeTitle': plus('style.font.sizeTitle') } },
    { text: '字体改成Arial', expect: { 'style.font.family': 'Arial' } },
    { text: '字体换成宋体', expect: { 'style.font.family': 'SimSun' } },
    { text: '线宽调到1.5', expect: { 'style.line.width': 1.5 } },
    { text: '线宽粗一点', expect: { 'style.line.width': plus('style.line.width') } },
    { text: '分辨率改成600', expect: { 'figure.dpi': 600 } },
    { text: 'dpi调到300', expect: { 'figure.dpi': 300 } },
    { text: '图宽改成89', expect: { 'figure.widthMm': 89 } },
    { text: '画幅高度调到120', expect: { 'figure.heightMm': 120 } },
    { text: '投影改成兰伯特', expect: { 'map.projection': 'lambert' } },
    { text: '用墨卡托投影', expect: { 'map.projection': 'mercator' } },
    { text: '显示经纬网', expect: { 'map.grid.show': true } },
    { text: '不要经纬网', expect: { 'map.grid.show': false } },
    { text: '经度间隔调到5', expect: { 'map.grid.intervalX': 5 } },
    { text: '加上指北针', expect: { 'map.northArrow.show': true } },
    { text: '去掉比例尺', expect: { 'map.scaleBar.show': false } },
    { text: '色带改到下方', expect: { 'map.colorbar.location': 'bottom' } },
    { text: '色带标题改成浓度', expect: { 'map.colorbar.label': '浓度' } },
    { text: '图例标题改成站点', expect: { 'legend.title': '站点' } },
    { text: '打开南海诸岛插图', expect: { 'map.layers.scsInset': true } },
    { text: '期刊风格换成Nature', expect: { 'style.preset': 'nature' } },
    { text: '标题改成研究区概况', expect: { title: '研究区概况' } },
    { text: '上边框不要', expect: { 'style.axis.showTop': false } },
    { text: '刻度朝内', expect: { 'style.axis.tickDirection': 'in' } },
    { text: '图例列数改成2', expect: { 'legend.ncol': 2 } },
    { text: '把图例放到右下角，字号调到8', expect: { 'legend.position': 'lower right', 'style.font.sizeBase': 8 } },
    { text: '不要上边框和右边框', expect: { 'style.axis.showTop': false, 'style.axis.showRight': false } },
    { text: '海洋不要画', expect: { 'map.layers.ocean': false } },
    { text: '显示数值标签', expect: { 'bar.valueLabels': true } },
    { text: '拟合线改成线性', expect: { 'scatter.fit': 'linear' } },
    { text: '显示单元格数值', expect: { 'heatmap.annotate': true } },
    { text: '数据来源改成自造数据', expect: { 'text.note': '自造数据' } },
    // 更口语/更难的句式（不是控件名逐字命中）
    { text: '图例挪到右下角，别挡住数据', expect: { 'legend.position': 'lower right' } },
    { text: '字号都调大一点', expect: { 'style.font.sizeBase': plus('style.font.sizeBase') } },
    { text: '图例字号调小到6', expect: { 'legend.fontSize': 6 } },
    { text: '比例尺长度改成300', expect: { 'map.scaleBar.lengthKm': 300 } },
    { text: '把投影换成罗宾逊', expect: { 'map.projection': 'robinson' } },
    { text: '柱子改成横向', expect: { 'bar.orientation': 'horizontal' } },
    { text: '箱体宽度改成0.5', expect: { 'box.boxWidth': 0.5 } },
    { text: '显示拟合方程关掉', expect: { 'scatter.showEquation': false } },
    { text: '中文字体改成黑体', expect: { 'style.font.cjkFallback': 'SimHei' } },
    { text: '双轴打开', expect: { 'line.dualAxis': true } },
    // ---- v4（契约 §9.3）：配色 / 色带配色 / 投影 / 中央经线与标准纬线 ----
    { text: '换成墨卡托投影', expect: { 'map.projection': 'mercator' } },
    { text: '投影改成兰伯特', expect: { 'map.projection': 'lambert' } },
    { text: '用罗宾逊投影', expect: { 'map.projection': 'robinson' } },
    { text: '换成正射投影', expect: { 'map.projection': 'orthographic' } },
    { text: '投影换成等经纬', expect: { 'map.projection': 'platecarree' } },
    { text: '北极立体投影', expect: { 'map.projection': 'northpolarstereo' } },
    { text: '用莫尔韦德投影', expect: { 'map.projection': 'mollweide' } },
    { text: '投影改为等地球', expect: { 'map.projection': 'equalearth' } },
    { text: '换成米勒投影', expect: { 'map.projection': 'miller' } },
    { text: '阿尔伯斯投影', expect: { 'map.projection': 'albers' } },
    { text: '方位等距投影', expect: { 'map.projection': 'azimuthal' } },
    { text: '中央经线改成105度', expect: { 'map.centralLongitude': 105 } },
    { text: '中央经线设为90', expect: { 'map.centralLongitude': 90 } },
    { text: '标准纬线改成25,47', expect: { 'map.standardParallels': '25,47' } },
    { text: '标准纬线设为 30 和 50', expect: { 'map.standardParallels': '30,50' } },
    { text: '配色换成ppt-07', expect: { 'style.palette': 'ppt-07' } },
    { text: '用第3套配色', expect: { 'style.palette': ctx.catIds[2] } },
    { text: '用第5套颜色', expect: { 'style.palette': ctx.catIds[4] } },
    { text: '参考我的PPT配色', expect: { 'style.palette': 'ppt-01' } },
    {
      text: '换一套配色',
      verify: (set) => {
        const current = ctx.baseSpecValue('style.palette')
        const start = typeof current === 'string' ? ctx.catIds.indexOf(current) : -1
        const expected = ctx.catIds[(start + 1 + ctx.catIds.length) % ctx.catIds.length]
        return set['style.palette'] === expected
          ? { ok: true }
          : { ok: false, detail: `期望 ${expected}，实际 ${JSON.stringify(set['style.palette'])}` }
      },
    },
    {
      text: '配色方案改成蓝色系',
      verify: (set) => {
        const id = set['style.palette']
        if (!id) return { ok: false, detail: '未命中 style.palette' }
        const palette = ctx.paletteById.get(id)
        if (!palette || palette.kind !== 'categorical') return { ok: false, detail: `不是分类配色：${id}` }
        if (colorWordScore(palette, '蓝') <= 0.3) return { ok: false, detail: `${id} 不是蓝色系（score=${colorWordScore(palette, '蓝')}）` }
        return { ok: true }
      },
    },
    {
      text: '热力配色用第2套',
      verify: (set) => (set['style.paletteSequential'] === ctx.seqIds[1]
        ? { ok: true }
        : { ok: false, detail: `期望 ${ctx.seqIds[1]}，实际 ${JSON.stringify(set['style.paletteSequential'])}` }),
    },
    { text: '热力配色换成灰阶', expect: { 'style.paletteSequential': ctx.seqIds[0] } },
    {
      text: '色带配色换成绿色系',
      verify: (set) => {
        const id = set['map.colorbar.palette']
        if (!id) return { ok: false, detail: '未命中 map.colorbar.palette' }
        const palette = ctx.paletteById.get(id)
        if (!palette || !['sequential', 'diverging'].includes(palette.kind)) return { ok: false, detail: `不是顺序/发散色带：${id}` }
        if (colorWordScore(palette, '绿') <= 0.3) return { ok: false, detail: `${id} 不是绿色系（score=${colorWordScore(palette, '绿')}）` }
        return { ok: true }
      },
    },
    {
      text: '色带配色换成红黄蓝',
      verify: (set) => {
        const id = set['map.colorbar.palette']
        if (!id) return { ok: false, detail: '未命中 map.colorbar.palette（v4 语义应改色带配色）' }
        if (set['map.colorbar.show'] !== undefined) return { ok: false, detail: '误命中 map.colorbar.show' }
        const palette = ctx.paletteById.get(id)
        if (!palette || !['sequential', 'diverging'].includes(palette.kind)) return { ok: false, detail: `不是顺序/发散色带：${id}` }
        return { ok: true }
      },
    },
    {
      text: '发散配色改成红色系',
      verify: (set) => {
        const id = set['style.paletteDiverging']
        if (!id) return { ok: false, detail: '未命中 style.paletteDiverging' }
        const palette = ctx.paletteById.get(id)
        if (!palette || palette.kind !== 'diverging') return { ok: false, detail: `不是发散色带：${id}` }
        if (colorWordScore(palette, '红') <= 0.3) return { ok: false, detail: `${id} 不是红色系` }
        return { ok: true }
      },
    },
    {
      text: '换一套色带',
      verify: (set) => {
        const candidates = ctx.colorbarCandidates
        const current = ctx.baseSpecValue('map.colorbar.palette')
        const start = typeof current === 'string' ? candidates.indexOf(current) : -1
        const expected = candidates[(start + 1 + candidates.length) % candidates.length]
        return set['map.colorbar.palette'] === expected
          ? { ok: true }
          : { ok: false, detail: `期望 ${expected}，实际 ${JSON.stringify(set['map.colorbar.palette'])}` }
      },
    },
  ]
}

function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6
  return a === b
}

async function main() {
  const { service, source } = await makeControlsService()
  const loaded = await service.load()
  const index = buildIndex(loaded)
  const baseSpec = { ...(await service.defaults()), kind: 'map', title: '', data: { source: 'sample.csv' } }
  const helpers = makeHelpers(baseSpec, loaded.byPath)
  const paletteDoc = loaded.palettes || { palettes: [], byKind: { categorical: [], sequential: [], diverging: [] } }
  const paletteById = new Map((paletteDoc.palettes || []).map((palette) => [palette.id, palette]))
  const kindOf = (id) => paletteById.get(id)?.kind
  const optionsOf = (dotted) => loaded.byPath.get(dotted)?.options || []
  const ctx = {
    // 与 NL 的候选一致：以 controls 的 options 顺序 + palettes.json 的 kind 过滤
    catIds: optionsOf('style.palette').filter((id) => kindOf(id) === 'categorical'),
    seqIds: optionsOf('style.paletteSequential').filter((id) => kindOf(id) === 'sequential'),
    divIds: optionsOf('style.paletteDiverging').filter((id) => kindOf(id) === 'diverging'),
    colorbarCandidates: optionsOf('map.colorbar.palette').filter((id) => ['sequential', 'diverging'].includes(kindOf(id))),
    paletteById,
    baseSpecValue: (dotted) => getPath(baseSpec, dotted),
  }

  const applied = []
  const skipped = []
  for (const testCase of makeCases(helpers, ctx)) {
    if (testCase.expect) {
      const missing = Object.keys(testCase.expect).filter((dotted) => dotted !== 'title' && !loaded.byPath.has(dotted))
      if (missing.length) {
        skipped.push({ text: testCase.text, missing })
        continue
      }
    }
    const parsed = parse(testCase.text, index, { spec: baseSpec })
    const failures = []
    if (typeof testCase.verify === 'function') {
      const verdict = testCase.verify(parsed.set, ctx) || { ok: false, detail: 'verify 无返回' }
      if (!verdict.ok) failures.push(verdict.detail || 'verify 未通过')
    } else {
      for (const [expectedPath, expectedValue] of Object.entries(testCase.expect)) {
        if (!(expectedPath in parsed.set)) {
          failures.push(`缺少 ${expectedPath}`)
          continue
        }
        if (!sameValue(parsed.set[expectedPath], expectedValue)) {
          failures.push(`${expectedPath} 期望 ${JSON.stringify(expectedValue)}，实际 ${JSON.stringify(parsed.set[expectedPath])}`)
        }
      }
      const extra = Object.keys(parsed.set).filter((key) => !(key in testCase.expect))
      if (!failures.length && extra.length) failures.push(`额外命中 ${extra.join(',')}`)
    }
    const pass = failures.length === 0
    applied.push({
      text: testCase.text,
      expect: testCase.expect || '(verify)',
      actual: parsed.set,
      hits: parsed.hits.map((hit) => ({ path: hit.path, labelZh: hit.labelZh, value: hit.value, matched: hit.matched })),
      unapplied: parsed.unapplied,
      reasons: parsed.reasons,
      pass,
      failure: failures.join('；'),
    })
  }

  const passed = applied.filter((item) => item.pass).length
  const hitRate = applied.length ? Math.round((passed / applied.length) * 1000) / 10 : 0
  const report = {
    generatedAt: new Date().toISOString(),
    indexSource: source,
    controlsItems: loaded.items.length,
    presets: loaded.presets.map((preset) => preset.id),
    total: applied.length,
    passed,
    hitRate,
    skipped,
    cases: applied,
  }
  await fsp.writeFile(path.join(HERE, 'nl-selftest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(`\nNL 自测：${passed}/${applied.length} 命中（${hitRate}%）`)
  console.log(`索引来源：${source}`)
  console.log(`控件项数：${loaded.items.length}；presets：${report.presets.join(', ')}${skipped.length ? `；跳过 ${skipped.length} 条（控件里没有对应 path）` : ''}`)
  const failed = applied.filter((item) => !item.pass)
  if (failed.length) {
    console.log('\n未通过用例：')
    for (const item of failed) console.log(`- ${item.text}  ⇒  ${item.failure}（actual=${JSON.stringify(item.actual)}）`)
  } else {
    console.log('全部用例通过。')
  }
  process.exitCode = hitRate >= 80 ? 0 : 1
}

await main()
