// 共享操作层：Agent 工具 scifig 与 HTTP /scifig/api/* 都调用这里（同一实现，两种入口）。
// v1：draft / patch / nl / preset / state / export / list
// v2：library / component / compose / decompose / code / componentPatch（契约 §7.3）
// v3：sessions / workspace delete（契约 §8.3/§8.4）
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { applySet, applyUnset, switchPreset } from './spec.js'
import { buildIndex, parse, toApplied } from './nl.js'
import {
  readDataFile,
  guessKind,
  guessTitle,
  guessUnit,
  stageDataFile,
  planDataMapping,
  refineDataMapping,
  parseAxisHints,
  parseStyleHints,
  applyAxisHints,
  deriveAxisLabels,
} from './infer.js'
import { dataMappingPaths } from './controls.js'
import { componentIdFor, panelSpecOf } from './library.js'
import { WorkspaceService } from './workspace.js'
import { deepMerge, getPath, setPath, clone, statSafe, pathExists, nowIso } from './util.js'

const PACKAGE_VERSION = '1.0.0'
const PANEL_WIDTH_MM = 89
// 合成图单面板高度：单行 75mm（地图不至于扁），多行 75mm/行
const PANEL_HEIGHT_MM = 75
const MAX_COMPOSE_WIDTH_MM = 180
// 地图范围联动（对应 renderer 的 spec.BOUND_PATHS / spec.EXTENT_PRESETS）
const EXTENT_PRESET_PATH = 'map.extentPreset'
const EXTENT_BOUND_PATHS = ['map.extentLonMin', 'map.extentLonMax', 'map.extentLatMin', 'map.extentLatMax']

export class Operations {
  constructor({ store, renderer, controls, library, python, workDir, bundleDir, workspaceRoot, ctx }) {
    this.store = store
    this.renderer = renderer
    this.controls = controls
    this.library = library
    this.python = python
    this.workDir = workDir
    this.bundleDir = bundleDir
    this.workspaceRoot = workspaceRoot
    this.ctx = ctx
    this.workspace = new WorkspaceService({ store, library, workDir })
    this._nlCache = undefined
    this._titleCache = new Map()
  }

  // -------------------------------------------------------------------------
  // 小工具
  // -------------------------------------------------------------------------

  async _nlIndex() {
    const loaded = await this.controls.load()
    if (!this._nlCache || this._nlCache.loadedAt !== loaded.loadedAt) {
      this._nlCache = { loadedAt: loaded.loadedAt, index: buildIndex(loaded) }
    }
    return this._nlCache.index
  }

  // -------------------------------------------------------------------------
  // 地图范围预设 ↔ 经纬度数字联动
  // -------------------------------------------------------------------------

  /**
   * renderer 的命名范围表（懒加载 + 缓存）。表来自 scifig.spec.EXTENT_PRESETS，
   * host 不复制一份，避免和 renderer 常量漂移。renderer 不可用时返回 {}（只做正向联动）。
   */
  async extentPresets() {
    if (this._extentPresets) return this._extentPresets
    if (this._extentPresetsFailedAt && Date.now() - this._extentPresetsFailedAt < 15_000) return {}
    try {
      const table = await this.renderer.runPython(
        'import json\nfrom scifig.spec import EXTENT_PRESETS as E\nprint(json.dumps({k: list(v) for k, v in E.items()}))',
      )
      if (table && typeof table === 'object' && Object.keys(table).length) {
        this._extentPresets = table
        return table
      }
    } catch {
      /* 忽略，走降级 */
    }
    this._extentPresetsFailedAt = Date.now()
    return {}
  }

  /**
   * 预设名 → 同步四个经纬度数字，并把投影中心（中央经线/中央纬度）对齐到 bbox 中心。
   * onlyMissing 时跳过显式给出的数字 path；syncCentral:false 时不改中央经线/纬度。
   */
  async syncExtentBounds(spec, table, { onlyMissing = false, explicit = new Set(), syncCentral = true } = {}) {
    const preset = getPath(spec, EXTENT_PRESET_PATH)
    const bounds = table?.[preset]
    if (!Array.isArray(bounds) || bounds.length !== 4) return false
    EXTENT_BOUND_PATHS.forEach((dotted, index) => {
      if (onlyMissing && explicit.has(dotted)) return
      setPath(spec, dotted, bounds[index])
    })
    if (syncCentral) this._applyCentralFromBounds(spec, bounds, { onlyMissing, explicit })
    return true
  }

  _round2(value) {
    return Math.round(Number(value) * 100) / 100
  }

  /** 把 map.centralLongitude / map.centralLatitude 设为 bbox 中心（不改显式值）。 */
  _applyCentralFromBounds(spec, bounds, { onlyMissing = false, explicit = new Set() } = {}) {
    if (!Array.isArray(bounds) || bounds.length !== 4) return []
    const changed = []
    const lon = this._round2((bounds[0] + bounds[1]) / 2)
    const lat = this._round2((bounds[2] + bounds[3]) / 2)
    if (!(onlyMissing && explicit.has('map.centralLongitude')) && getPath(spec, 'map.centralLongitude') !== lon) {
      setPath(spec, 'map.centralLongitude', lon)
      changed.push('map.centralLongitude')
    }
    if (!(onlyMissing && explicit.has('map.centralLatitude')) && getPath(spec, 'map.centralLatitude') !== lat) {
      setPath(spec, 'map.centralLatitude', lat)
      changed.push('map.centralLatitude')
    }
    return changed
  }

  /**
   * 切换投影后按当前 extent 归正中央经线/中央纬度（Lambert/Albers/Robinson 都用得到），
   * 避免引擎再做"中央经线与研究区中心相差过大"的自动修正（那会进 autoAdjust 而不是 warnings）。
   */
  async syncCentralFromExtent(spec, { explicit = new Set() } = {}) {
    if (!spec || spec.kind !== 'map') return []
    const table = await this.extentPresets()
    const preset = getPath(spec, EXTENT_PRESET_PATH)
    let bounds
    if (preset && preset !== 'custom' && table[preset]) {
      bounds = table[preset]
    } else {
      const lonMin = Number(getPath(spec, 'map.extentLonMin'))
      const lonMax = Number(getPath(spec, 'map.extentLonMax'))
      const latMin = Number(getPath(spec, 'map.extentLatMin'))
      const latMax = Number(getPath(spec, 'map.extentLatMax'))
      if ([lonMin, lonMax, latMin, latMax].every((value) => Number.isFinite(value))) bounds = [lonMin, lonMax, latMin, latMax]
    }
    if (!bounds) return []
    return this._applyCentralFromBounds(spec, bounds, { onlyMissing: true, explicit })
  }

  /**
   * 工作台 UX：改经纬度数字时自动把范围预设切成 custom，避免"命名预设优先、数字改了没反应"；
   * 反过来显式选命名预设时把四个数字同步成该预设 bbox。
   * @returns {Promise<string[]>} 被联动修改的 path 列表
   */
  async linkExtentPreset(spec, { set, unset } = {}) {
    if (!spec || spec.kind !== 'map') return []
    const setObject = set && typeof set === 'object' ? set : {}
    const setKeys = new Set(Object.keys(setObject))
    const touched = new Set([...setKeys, ...(Array.isArray(unset) ? unset : [])])
    const touchedBounds = EXTENT_BOUND_PATHS.filter((dotted) => touched.has(dotted))
    const presetTouched = touched.has(EXTENT_PRESET_PATH)
    if (!touchedBounds.length && !presetTouched) return []

    const changed = []
    const table = await this.extentPresets()

    if (presetTouched && setKeys.has(EXTENT_PRESET_PATH)) {
      // 同一次 patch 显式给了范围预设 → 以它为准，并把未显式给出的数字/中心同步成预设 bbox
      const preset = getPath(spec, EXTENT_PRESET_PATH)
      if (table[preset]) {
        const explicit = new Set(setKeys)
        const synced = await this.syncExtentBounds(spec, table, { onlyMissing: true, explicit, syncCentral: false })
        if (synced) {
          changed.push(EXTENT_PRESET_PATH)
          for (const dotted of EXTENT_BOUND_PATHS) if (!explicit.has(dotted)) changed.push(dotted)
          changed.push(...this._applyCentralFromBounds(spec, table[preset], { onlyMissing: true, explicit }))
        }
      }
      return changed
    }

    if (touchedBounds.length && getPath(spec, EXTENT_PRESET_PATH) !== 'custom') {
      setPath(spec, EXTENT_PRESET_PATH, 'custom')
      changed.push(EXTENT_PRESET_PATH)
    }
    return changed
  }

  resolveFigure({ figureId, sessionId } = {}) {
    if (figureId) return this.store.get(figureId)
    return this.store.activeFigure(sessionId)
  }

  /** dataFile 解析：绝对路径，或相对工作区/进程目录/插件目录/workDir。 */
  async resolveDataFile(dataFile) {
    const raw = String(dataFile || '').trim()
    if (!raw) return undefined
    const candidates = []
    if (path.isAbsolute(raw)) candidates.push(raw)
    else {
      candidates.push(path.resolve(this.workspaceRoot, raw))
      candidates.push(path.resolve(process.cwd(), raw))
      candidates.push(path.resolve(this.bundleDir, raw))
      candidates.push(path.resolve(this.workDir, raw))
    }
    for (const candidate of candidates) {
      if (await pathExists(candidate)) return candidate
    }
    return candidates[0]
  }

  async _syncFigureMeta(figure) {
    const spec = figure.spec || {}
    if (typeof spec.title === 'string') figure.title = spec.title
    if (typeof spec.kind === 'string') figure.kind = spec.kind
    await this.store.saveSpec(figure)
  }

  snapshot(figure, options) {
    return this.store.snapshot(figure, options)
  }

  /** figure 的 HTTP/工具载荷；compose 图额外带 panels（UI 排版页用）。 */
  async figurePayload(figure, options) {
    const snapshot = this.store.snapshot(figure, options)
    if (!snapshot) return null
    if (figure.spec?.kind === 'compose' && this.library) {
      try {
        snapshot.panels = await this.library.panelSummaries(figure)
      } catch {
        snapshot.panels = []
      }
    }
    return snapshot
  }

  /** 给 figure 挂上缩略图/代码产物路径（renderer --thumb/--code-out 直接写到组件目录）。 */
  async _ensureRenderTargets(figure, panelIndex = 0) {
    if (!this.library) return
    const componentId = figure.componentId || componentIdFor(figure.id, panelIndex)
    figure.componentId = componentId
    const paths = this.library.pathsFor(componentId)
    try {
      await fsp.mkdir(paths.dir, { recursive: true })
    } catch {
      /* 目录失败不阻断渲染 */
    }
    figure.renderTargets = { thumbPath: paths.thumbPath, codePath: paths.codePath }
  }

  /** 渲染后把 figure 同步进组件库（单图 = 1 个 panel 0 组件）。 */
  async _syncComponent(figure, options = {}) {
    if (!this.library) return undefined
    const targets = figure.renderTargets || {}
    try {
      return await this.library.upsertFromFigure(figure, {
        panelIndex: 0,
        thumbPath: targets.thumbPath,
        codePath: targets.codePath,
        title: options.title,
        tags: options.tags,
      })
    } catch {
      return undefined
    }
  }

  // -------------------------------------------------------------------------
  // 只读端点
  // -------------------------------------------------------------------------

  async health() {
    const rendererReady = await this.renderer.rendererAvailable()
    const loaded = await this.controls.load()
    await this.store.ensureLoaded()
    if (this.library) await this.library.ensureLoaded()
    return {
      ok: true,
      version: PACKAGE_VERSION,
      api: 2,
      python: this.python,
      renderer: rendererReady,
      workDir: this.workDir,
      controlsReady: loaded.items.length > 0,
      presetsReady: loaded.presets.length > 0,
      figures: this.store.list().length,
      components: this.library ? this.library.components.size : 0,
      node: process.version,
    }
  }

  async controlsPayload() {
    const payload = await this.controls.publicControls()
    return { ok: true, ...payload }
  }

  /** GET /scifig/api/palettes：PPT 提取的 42 套配色（palettes.json 缺失时 ok:false 不崩）。 */
  async palettesPayload() {
    return this.controls.palettesPayload()
  }

  async state({ sessionId, figureId } = {}) {
    await this.store.ensureLoaded()
    const byUpdatedDesc = (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
    const allFigures = this.store.list().slice().sort(byUpdatedDesc)
    if (figureId) {
      const figure = this.store.get(figureId)
      return {
        ok: true,
        figure: figure ? await this.figurePayload(figure) : null,
        figures: allFigures.map((item) => this.store.summary(item)),
      }
    }
    // 没有 sessionId（工具卡解析失败 / 验收脚本 / 跨会话打开）：回退为全部图，figure 取最近一张
    if (!sessionId) {
      const latest = allFigures[0]
      return {
        ok: true,
        figure: latest ? await this.figurePayload(latest) : null,
        figures: allFigures.map((item) => this.store.summary(item)),
      }
    }
    const mine = this.store.listForSession(sessionId).slice().sort(byUpdatedDesc)
    const mineIds = new Set(mine.map((item) => item.id))
    const others = allFigures.filter((item) => !mineIds.has(item.id))
    const current = this.store.activeFigure(sessionId) || mine[0] || null
    return {
      ok: true,
      figure: current ? await this.figurePayload(current) : null,
      figures: [...mine, ...others].map((item) => this.store.summary(item)),
    }
  }

  async list({ sessionId } = {}) {
    await this.store.ensureLoaded()
    const figures = (sessionId ? this.store.listForSession(sessionId) : this.store.list()).map((figure) =>
      this.store.summary(figure),
    )
    return { ok: true, figures }
  }

  // -------------------------------------------------------------------------
  // v3：按会话分组的图列表 + 会话标题（契约 §8.2/§8.3）
  // -------------------------------------------------------------------------

  /** 尝试从宿主 sessionQuery 服务读会话标题（拿不到就返回空串，不编造）。 */
  async sessionTitles(sessionIds) {
    const titles = new Map()
    const ids = [...new Set((sessionIds || []).filter((id) => typeof id === 'string' && id))]
    if (!ids.length) return titles
    const now = Date.now()
    const pending = []
    for (const id of ids) {
      const cached = this._titleCache.get(id)
      if (cached && now - cached.at < 30_000) titles.set(id, cached.title)
      else pending.push(id)
    }
    if (!pending.length) return titles
    const sessionQuery = this.ctx?.get?.('sessionQuery')
    if (!sessionQuery?.readTitleSnapshots) return titles
    const controller = new AbortController()
    const timer = setTimeout(() => {
      try {
        controller.abort()
      } catch {
        /* ignore */
      }
    }, 3000)
    if (typeof timer.unref === 'function') timer.unref()
    try {
      const results = await sessionQuery.readTitleSnapshots(pending, controller.signal)
      for (const result of Array.isArray(results) ? results : []) {
        if (!result || result.status !== 'fulfilled') continue
        const sessionId = String(result.sessionId || result.value?.session?.id || '')
        const title = result.value?.title?.title
        const text = typeof title === 'string' ? title.trim() : ''
        if (sessionId) {
          titles.set(sessionId, text)
          this._titleCache.set(sessionId, { title: text, at: Date.now() })
        }
      }
    } catch {
      /* 标题失败不影响 sessions 主功能 */
    } finally {
      clearTimeout(timer)
    }
    return titles
  }

  /** GET /scifig/api/sessions：按 sessionId 分组的图列表。 */
  async sessions() {
    await this.store.ensureLoaded()
    const allFigures = this.store.list()
    const groups = new Map()
    for (const figure of allFigures) {
      const key = figure.sessionId || ''
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(figure)
    }
    const titles = await this.sessionTitles([...groups.keys()])
    const sessions = []
    for (const [sessionId, figures] of groups.entries()) {
      const sorted = figures.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
      sessions.push({
        sessionId,
        // 未绑定会话的图（HTTP/工具直接建图）给中文占位，避免 UI 出现一列空白
        title: sessionId ? titles.get(sessionId) || '' : '未绑定会话',
        count: sorted.length,
        latestAt: sorted[0]?.updatedAt || '',
        figures: sorted.map((figure) => ({
          id: figure.id,
          title: figure.title || '',
          kind: figure.kind || '',
          rev: figure.rev || 0,
          updatedAt: figure.updatedAt,
          imageUrl: `/scifig/api/image?id=${encodeURIComponent(figure.id)}&rev=${figure.rev || 0}`,
          error: figure.error || null,
        })),
      })
    }
    sessions.sort((a, b) => String(b.latestAt || '').localeCompare(String(a.latestAt || '')))
    return { ok: true, sessions, total: allFigures.length }
  }

  /**
   * 清理历史孤儿组件（figureId 指向已不存在的图）：
   * 仍被合成图引用的 detach 保留，其余连同磁盘目录删除。返回被处理的 componentId。
   */
  async cleanupOrphans() {
    if (!this.library) return { removed: [], detached: [], warnings: [] }
    await this.store.ensureLoaded()
    await this.library.ensureLoaded()
    const result = await this.library.cleanupOrphans()
    const warnings = []
    for (const record of result.removed || []) {
      const dir = this.library.pathsFor(record.componentId).dir
      if (!this.workspace.isInsideWorkDir(dir)) {
        warnings.push(`跳过越界孤儿目录：${dir}`)
        continue
      }
      try {
        await fsp.rm(dir, { recursive: true, force: true })
      } catch (error) {
        warnings.push(`删除孤儿组件目录失败 ${dir}：${error?.message || error}`)
      }
    }
    return {
      removed: (result.removed || []).map((record) => record.componentId),
      detached: (result.detached || []).map((record) => record.componentId),
      warnings,
    }
  }

  /**
   * POST /scifig/api/workspace/delete：删除图/会话/全部工作区（契约 §8.3 语义 1–7）。
   * 安全：mode:"all" 必须先通过 confirm === true 校验——校验发生在任何写操作之前，
   * 被拒时只做只读统计（willDelete）供 UI 二次确认，绝不做删除动作。
   */
  async deleteWorkspace(options = {}) {
    const mode = String(options.mode || '').trim()
    // 只读预热，保证 willDelete 计数准确（ensureLoaded 只扫描目录，不修改）
    await this.store.ensureLoaded()
    if (this.library) await this.library.ensureLoaded()

    const willDelete =
      mode === 'all'
        ? {
            figures: this.store.list().length,
            components: this.library ? this.library.components.size : 0,
          }
        : undefined

    if (mode === 'all' && options.confirm !== true) {
      return {
        ok: false,
        mode,
        needsConfirm: true,
        willDelete,
        error: '删除全部工作区需要 confirm:true（会清空所有图与组件库，只保留 _selftest）',
      }
    }

    // 通过校验后才允许写操作：先清理历史孤儿组件（例如旧版本 includeComponents:false 留下的）
    const orphanResult = await this.cleanupOrphans().catch(() => ({ removed: [], detached: [], warnings: [] }))
    const result = await this.workspace.delete(options)
    if (result.ok) {
      // 删完后同步一次内存映射/总数，保证 /state、/library 立即反映
      await this.store.ensureLoaded()
      if (this.library) await this.library.ensureLoaded()
      const orphans = [...(orphanResult.removed || [])]
      if (orphans.length) result.orphansCleaned = orphans
      result.warnings = [...(result.warnings || []), ...(orphanResult.warnings || [])]
      result.remaining = {
        figures: this.store.list().length,
        components: this.library ? this.library.components.size : 0,
      }
      if (willDelete) result.willDelete = willDelete
    }
    return result
  }

  // -------------------------------------------------------------------------
  // v1 写操作
  // -------------------------------------------------------------------------

  async patch({ figureId, set, unset, customPatch, sessionId } = {}) {
    await this.store.ensureLoaded()
    const figure = this.resolveFigure({ figureId, sessionId })
    if (!figure) return this._noFigure()
    // v5：合成图功能已移除 → 拒绝 compose.* 补丁（历史 compose 图的其它字段仍可改）
    const touchedComposePaths = [...Object.keys(set || {}), ...(Array.isArray(unset) ? unset : [])].filter(
      (dotted) => dotted === 'compose' || String(dotted).startsWith('compose.'),
    )
    if (touchedComposePaths.length) {
      return {
        ok: false,
        error: '合成图/拼接功能已移除，不能修改 compose.* 参数；请直接调整单张图（投影、配色、图例、字体、导出等）',
        figure: await this.figurePayload(figure),
        rejected: touchedComposePaths.map((dotted) => ({ path: dotted, reason: '合成图功能已移除' })),
        extentLinked: [],
      }
    }
    const loaded = await this.controls.load()
    const { applied, rejected } = applySet(figure.spec, set || {}, loaded.byPath)
    const removed = applyUnset(figure.spec, unset, loaded.byPath)
    // 经纬度数字 ↔ 范围预设联动（改数字自动切 custom；显式选预设同步 bbox）
    const extentLinked = await this.linkExtentPreset(figure.spec, { set: set || {}, unset })
    // 切换投影后按当前 extent 归正中央经线/中央纬度（减少引擎自动修正 → autoAdjust）
    const patchSetKeys = new Set(Object.keys(set || {}))
    const projectionTouched =
      patchSetKeys.has('map.projection') || (Array.isArray(unset) && unset.includes('map.projection'))
    if (projectionTouched) {
      const centralLinked = await this.syncCentralFromExtent(figure.spec, { explicit: patchSetKeys })
      for (const dotted of centralLinked) if (!extentLinked.includes(dotted)) extentLinked.push(dotted)
    }
    let customPatchApplied = false
    if (customPatch !== undefined) {
      setPath(figure.spec, 'customPatch', String(customPatch))
      customPatchApplied = true
    }
    if (!applied.length && !removed.length && !customPatchApplied && !extentLinked.length) {
      return {
        ok: false,
        error: rejected.length
          ? `补丁未生效：${rejected.map((r) => `${r.path}(${r.reason})`).join('，')}`
          : '没有可应用的 set/unset',
        figure: await this.figurePayload(figure),
        rejected,
      }
    }
    await this._syncFigureMeta(figure)
    await this._ensureRenderTargets(figure)
    await this.renderer.schedule(figure)
    await this._syncComponent(figure)
    return {
      ok: figure.error === null,
      error: figure.error,
      figure: await this.figurePayload(figure),
      applied,
      rejected,
      removed,
      extentLinked,
      customPatchApplied,
    }
  }

  async nl({ figureId, text, sessionId } = {}) {
    await this.store.ensureLoaded()
    const figure = this.resolveFigure({ figureId, sessionId })
    if (!figure) return this._noFigure()
    const statement = String(text || '').trim()
    if (!statement) return { ok: false, error: 'text 不能为空', figure: await this.figurePayload(figure) }
    // v5：拼接/合成/图库意图 → 不猜测，直接返回 unapplied + 移除提示
    const removedIntent = /拼接|合成图|合成|拼图|图库|子图库|排版页|拆分/.test(statement)
    let removedHint = removedIntent ? '拼接/合成/图库功能已移除，请直接调整单张图（投影、配色、图例、字体、导出等）' : undefined
    const index = await this._nlIndex()
    const parsed = parse(statement, index, { spec: figure.spec })
    // compose.* 的 NL 指令一律过滤（历史 controls 可能还留着 compose 分组）
    const composePathKeys = Object.keys(parsed.set).filter((dotted) => dotted === 'compose' || String(dotted).startsWith('compose.'))
    if (composePathKeys.length) {
      for (const dotted of composePathKeys) delete parsed.set[dotted]
      parsed.unapplied.push(...composePathKeys.map((dotted) => `${dotted}（合成图功能已移除）`))
      removedHint = removedHint || '合成图/拼接功能已移除，请直接调整单张图'
    }
    const paths = Object.keys(parsed.set)
    if (!paths.length) {
      return {
        ok: false,
        error: removedHint || '没有识别出可应用的参数修改',
        applied: [],
        unapplied: parsed.unapplied.length ? parsed.unapplied : [statement],
        reasons: parsed.reasons,
        ...(removedHint ? { removedHint, removedFeatures: ['compose', 'library'] } : {}),
        figure: await this.figurePayload(figure),
      }
    }
    const loaded = await this.controls.load()
    const { applied, rejected } = applySet(figure.spec, parsed.set, loaded.byPath)
    const extentLinked = await this.linkExtentPreset(figure.spec, { set: parsed.set })
    const nlSetKeys = new Set(Object.keys(parsed.set))
    if (nlSetKeys.has('map.projection')) {
      const centralLinked = await this.syncCentralFromExtent(figure.spec, { explicit: nlSetKeys })
      for (const dotted of centralLinked) if (!extentLinked.includes(dotted)) extentLinked.push(dotted)
    }
    if (applied.length || extentLinked.length) {
      await this._syncFigureMeta(figure)
      await this._ensureRenderTargets(figure)
      await this.renderer.schedule(figure)
      await this._syncComponent(figure)
    }
    const appliedHits = toApplied(parsed.hits.filter((hit) => applied.some((entry) => entry.path === hit.path)))
    return {
      ok: figure.error === null && (applied.length > 0 || extentLinked.length > 0),
      error:
        figure.error ||
        (rejected.length ? `部分未生效：${rejected.map((r) => `${r.path}(${r.reason})`).join('，')}` : null),
      applied: appliedHits,
      unapplied: parsed.unapplied,
      reasons: parsed.reasons,
      rejected,
      extentLinked,
      ...(removedHint ? { removedHint, removedFeatures: ['compose', 'library'] } : {}),
      figure: await this.figurePayload(figure),
    }
  }

  async preset({ figureId, preset, sessionId } = {}) {
    await this.store.ensureLoaded()
    const figure = this.resolveFigure({ figureId, sessionId })
    if (!figure) return this._noFigure()
    if (!preset) return { ok: false, error: 'preset 不能为空', figure: await this.figurePayload(figure) }
    const loaded = await this.controls.load()
    if (!loaded.presets.length) {
      return { ok: false, error: 'presets.json 尚未就绪，无法切换期刊风格', figure: await this.figurePayload(figure) }
    }
    const result = switchPreset(figure.spec, loaded.presets, String(preset))
    if (!result.ok) return { ok: false, error: result.error, figure: await this.figurePayload(figure) }
    await this._syncFigureMeta(figure)
    await this._ensureRenderTargets(figure)
    await this.renderer.schedule(figure)
    await this._syncComponent(figure)
    return {
      ok: figure.error === null,
      error: figure.error,
      changed: result.changed,
      figure: await this.figurePayload(figure),
    }
  }

  async exportFigure({ figureId, sessionId } = {}) {
    await this.store.ensureLoaded()
    const figure = this.resolveFigure({ figureId, sessionId })
    if (!figure) return this._noFigure()
    await this.renderer.ensure(figure)
    const stat = await statSafe(figure.pngPath)
    if (!stat?.isFile()) {
      return { ok: false, error: figure.error || 'PNG 不存在，请先渲染', figure: await this.figurePayload(figure) }
    }
    const spec = figure.spec || {}
    const metrics = figure.lastMetrics || {}
    const widthMm = Number(metrics.widthMm ?? getPath(spec, 'figure.widthMm'))
    const heightMm = Number(metrics.heightMm ?? getPath(spec, 'figure.heightMm'))
    const dpi = Number(metrics.dpi ?? getPath(spec, 'figure.dpi'))
    return {
      ok: true,
      path: figure.pngPath,
      bytes: stat.size,
      widthMm: Number.isFinite(widthMm) ? widthMm : undefined,
      heightMm: Number.isFinite(heightMm) ? heightMm : undefined,
      dpi: Number.isFinite(dpi) ? dpi : undefined,
      url: `/scifig/api/download?id=${encodeURIComponent(figure.id)}&rev=${figure.rev}`,
      figure: await this.figurePayload(figure),
    }
  }

  async active({ figureId, sessionId } = {}) {
    await this.store.ensureLoaded()
    const figure = this.store.get(figureId)
    if (!figure) return this._noFigure()
    const session = sessionId || figure.sessionId || ''
    this.store.bindSession(session, figureId)
    await this.store.saveMeta(figure)
    return { ok: true, figure: await this.figurePayload(figure) }
  }

  _noFigure() {
    return {
      ok: false,
      error: '还没有可用的图：请先用 scifig 工具 action:"draft" 生成草图（或从对话里打开工作台）',
      figure: null,
    }
  }

  // -------------------------------------------------------------------------
  // draft：读数据 → 推断 → 组 spec → 渲染 → 注册 figure + 组件
  // -------------------------------------------------------------------------

  async draft({ description, dataFile, kind, sessionId, explicitTitle } = {}) {
    await this.store.ensureLoaded()
    const loaded = await this.controls.load()
    const warnings = []
    for (const warning of loaded.warnings) warnings.push(warning)

    // 1. 读数据
    let info
    let resolvedData
    if (dataFile) {
      resolvedData = await this.resolveDataFile(dataFile)
      const stat = await statSafe(resolvedData)
      if (!stat?.isFile()) {
        warnings.push(`数据文件不存在：${resolvedData}`)
      } else {
        info = await readDataFile(resolvedData, { ctx: this.ctx, python: this.python, bundleDir: this.bundleDir })
        if (info?.error) {
          warnings.push(info.error)
          info = undefined
        } else if (info) {
          for (const warning of info.warnings || []) warnings.push(warning)
        }
      }
    } else {
      warnings.push('未提供 dataFile：已创建 spec 骨架，但没有数据源时渲染器可能无法出图')
    }

    // 2. 选图型 / 标题
    const chosenKind = guessKind({ description, explicitKind: kind, info })
    // v5：合成图功能已移除（单图专注）
    if (chosenKind === 'compose' || kind === 'compose') {
      return { ok: false, error: '合成图功能已移除，请直接生成/调整单张图（draft 用 map/line/bar/scatter/heatmap/box）' }
    }
    if (loaded.kinds.length && !loaded.kinds.includes(chosenKind)) {
      warnings.push(`图型 ${chosenKind} 不在 renderer 的 kinds 列表内（${loaded.kinds.join('/')}）`)
    }
    const title =
      explicitTitle !== undefined ? explicitTitle : guessTitle(description, resolvedData ? path.parse(resolvedData).name : '')
    const unit = guessUnit(description)

    // 3. 组 spec：renderer 默认值 + 期刊风格/单双栏 + 固定路径
    const spec = deepMerge({}, await this.controls.defaults())
    const presetIds = loaded.presets.map((preset) => preset.id)
    const styleHints = parseStyleHints(description, presetIds)
    setPath(spec, 'kind', chosenKind)
    setPath(spec, 'title', title || '')
    if (getPath(spec, 'figure.widthMm') === undefined) setPath(spec, 'figure.widthMm', 180)
    if (getPath(spec, 'figure.heightMm') === undefined) setPath(spec, 'figure.heightMm', 120)
    if (getPath(spec, 'figure.dpi') === undefined) setPath(spec, 'figure.dpi', 300)
    const presetId = styleHints.preset || getPath(spec, 'style.preset') || presetIds[0]
    if (presetId) {
      setPath(spec, 'style.preset', presetId)
      // presets 的 values 是「点号 path → 值」的扁平映射，直接按 path 写入
      const presetValues = loaded.presets.find((preset) => preset.id === presetId)?.values
      if (presetValues && typeof presetValues === 'object') {
        for (const [dotted, value] of Object.entries(presetValues)) setPath(spec, dotted, clone(value))
      }
    }
    if (styleHints.widthMm) setPath(spec, 'figure.widthMm', styleHints.widthMm)

    // v4：description 提到"参考我的 PPT 配色 / ppt-03" → 默认 style.palette（contract §9.3）
    const paletteItem = loaded.byPath.get('style.palette')
    let paletteHint
    if (paletteItem && Array.isArray(paletteItem.options) && paletteItem.options.length) {
      const descriptionText = String(description || '')
      const idMatch = /pp?t[-\s_]?(\d{1,2})/i.exec(descriptionText)
      if (idMatch) {
        const id = `ppt-${String(Number(idMatch[1])).padStart(2, '0')}`
        if (paletteItem.options.includes(id)) paletteHint = id
      }
      if (!paletteHint && /参考\s*(?:我的\s*)?ppt|ppt\s*配色|参考我的/.test(descriptionText)) {
        paletteHint = paletteItem.options.includes('ppt-01') ? 'ppt-01' : paletteItem.options[0]
      }
      if (paletteHint) setPath(spec, 'style.palette', paletteHint)
    }

    // 4. 建 figure（先建目录，数据文件复制进去，spec.data.source 用相对 path）
    const figure = await this.store.createFigure({ sessionId: sessionId || '', spec, title: title || '', kind: chosenKind })
    if (resolvedData) {
      const staged = await stageDataFile(resolvedData, {
        figureDir: figure.dir,
        figureId: figure.id,
        workDir: this.workDir,
      })
      if (staged.error) {
        warnings.push(staged.error)
      } else {
        setPath(figure.spec, 'data.source', staged.source)
        if (staged.warning) warnings.push(staged.warning)
      }
    }

    // 5. 数据列映射：description 的"横轴/纵轴"指定 > 列名提及 > 列画像规划
    const mappingItems = dataMappingPaths(loaded.items)
    const mappingApplied = {}
    const axisHints = parseAxisHints(description, info?.columns || [])
    const plannedMapping = applyAxisHints(
      refineDataMapping({
        kind: chosenKind,
        info,
        description,
        planned: planDataMapping({ kind: chosenKind, info }),
      }),
      axisHints,
      chosenKind,
    )
    for (const [role, column] of Object.entries(plannedMapping)) {
      const item = mappingItems[role]
      if (!item || typeof column !== 'string' || !column) continue
      setPath(figure.spec, item.path, column)
      mappingApplied[item.path] = column
    }
    // 轴标题 / 图例标题：description 中文名优先，其次列名（renderer 不会自动补轴标题）
    const axisLabels = deriveAxisLabels({ kind: chosenKind, planned: plannedMapping, hints: axisHints, info })
    for (const [label, pathCandidates] of [
      [axisLabels.xLabel, ['axes.xlabel']],
      [axisLabels.yLabel, ['axes.ylabel']],
      [axisLabels.legendTitle, ['legend.title']],
      [axisLabels.colorbarLabel, ['map.colorbar.label']],
    ]) {
      if (!label) continue
      const target = pathCandidates.find((dotted) => loaded.byPath.has(dotted))
      if (!target) continue
      const item = loaded.byPath.get(target)
      if (item && item.type !== 'text') continue
      setPath(figure.spec, target, String(label))
    }
    if (info?.geojson) {
      warnings.push(
        `GeoJSON 要素 ${info.geojson.featureCount} 个，几何类型：${info.geojson.geometryTypes.join('/') || '未知'}`,
      )
    }
    // 单位：只写 controls 里存在 .unit 的 path
    if (unit) {
      for (const item of loaded.items) {
        if (!/\.unit$/.test(item.path) || item.type !== 'text') continue
        setPath(figure.spec, item.path, unit)
      }
    }

    // 5.5 description 里提到的要素开关（"显示经纬网、比例尺与指北针"，"不要图例"）交给同一个 NL 解析器
    let descriptionApplied = []
    if (description && loaded.items.length) {
      try {
        const index = await this._nlIndex()
        const parsed = parse(String(description), index, { spec: figure.spec })
        const entries = Object.entries(parsed.set).filter(([dotted]) => dotted !== 'title')
        if (entries.length) {
          const result = applySet(figure.spec, Object.fromEntries(entries), loaded.byPath)
          descriptionApplied = result.applied
        }
      } catch {
        /* 描述解析失败不影响主流程 */
      }
    }
    if (paletteHint && !descriptionApplied.some((entry) => entry.path === 'style.palette')) {
      descriptionApplied.unshift({ path: 'style.palette', value: paletteHint })
    }
    // 5.6 地图：若范围预设是命名预设（来自 description 关键词/控件默认），同步四个经纬度数字，
    // 让工作台里的数字与预设一致（renderer 侧命名预设优先，不同步会让用户觉得数字可调但没反应）
    if (chosenKind === 'map' && getPath(figure.spec, EXTENT_PRESET_PATH) !== 'custom') {
      const extentTable = await this.extentPresets()
      const explicitFromDescription = new Set(descriptionApplied.map((entry) => entry.path))
      const synced = await this.syncExtentBounds(figure.spec, extentTable, {
        onlyMissing: true,
        explicit: explicitFromDescription,
      })
      if (!synced && Object.keys(extentTable).length === 0) {
        warnings.push('未能从 renderer 读取命名范围表，地图经纬度数字未随预设同步')
      }
    }
    await this._syncFigureMeta(figure)
    await this._ensureRenderTargets(figure, 0)

    // 6. 渲染（draft 阶段 warnings 与渲染 warnings 合并去重）
    const draftWarnings = warnings.slice()
    await this.renderer.schedule(figure)
    await this._syncComponent(figure)
    const merged = dedupe([...draftWarnings, ...(figure.warnings || [])])
    figure.warnings = merged
    await this.store.saveMeta(figure)

    // 7. 绑定 session
    if (sessionId) this.store.bindSession(sessionId, figure.id)

    const component = await this.library?.get(componentIdFor(figure.id, 0))
    return {
      ok: figure.error === null,
      error: figure.error,
      figureId: figure.id,
      componentId: component?.componentId,
      pngPath: figure.pngPath,
      title: figure.title,
      kind: figure.kind,
      warnings: figure.warnings,
      revision: figure.rev,
      descriptionApplied,
      inferred: info
        ? {
            format: info.format,
            rowCount: info.rowCount,
            columns: (info.columns || []).map((column) => ({
              name: column.name,
              numeric: column.numeric,
              datetime: column.datetime,
              uniqueCount: column.uniqueCount,
            })),
            mapping: Object.fromEntries(
              Object.entries(info.mapping || {}).map(([role, profile]) => [role, profile?.name]),
            ),
            mappingApplied,
          }
        : null,
      figure: await this.figurePayload(figure),
    }
  }

  /** 确保 figure 至少渲染过一次（export 用）。 */
  async ensureRendered(figure) {
    await this.renderer.ensure(figure)
  }

  /** 读 PNG 字节（image / download 端点）。 */
  async readPng(figure) {
    const stat = await statSafe(figure.pngPath)
    if (!stat?.isFile()) return undefined
    try {
      return await fsp.readFile(figure.pngPath)
    } catch {
      return undefined
    }
  }

  // -------------------------------------------------------------------------
  // v2：组件库 / 合成 / 拆分 / 代码 / 组件补丁
  // -------------------------------------------------------------------------

  async library_({ sessionId, scope = 'all', limit } = {}) {
    await this.store.ensureLoaded()
    if (!this.library) return { ok: false, error: '组件库未初始化' }
    await this.library.ensureLoaded()
    const components = await this.library.list({ sessionId, scope, limit })
    return { ok: true, components, total: components.length }
  }

  async component({ id } = {}) {
    if (!this.library) return { ok: false, error: '组件库未初始化' }
    await this.library.ensureLoaded()
    const record = await this.library.get(id)
    if (!record) return { ok: false, error: `未找到组件：${id || '(空)'}` }
    return { ok: true, component: this.library.publicComponent(record) }
  }

  async code({ id } = {}) {
    if (!this.library) return { ok: false, error: '组件库未初始化' }
    await this.store.ensureLoaded()
    await this.library.ensureLoaded()
    let target = String(id || '').trim()
    if (!target) {
      const figure = this.store.activeFigure('')
      target = figure ? figure.id : ''
    }
    if (!target) return { ok: false, error: '请提供 id（componentId 或 figureId）' }
    const result = await this.library.code(target)
    if (!result.ok) return result
    return { ...result, lines: result.code.split('\n').length }
  }

  async decompose({ figureId, sessionId } = {}) {
    if (!this.library) return { ok: false, error: '组件库未初始化' }
    await this.store.ensureLoaded()
    await this.library.ensureLoaded()
    const figure = this.resolveFigure({ figureId, sessionId })
    if (!figure) return this._noFigure()
    const records = await this.library.decompose(figure)
    return {
      ok: true,
      figureId: figure.id,
      components: records.map((record) => this.library.summary(record)),
      figure: await this.figurePayload(figure),
    }
  }

  async compose({ componentIds, rows, cols, title, optimize, sessionId } = {}) {
    if (!this.library) return { ok: false, error: '组件库未初始化' }
    await this.store.ensureLoaded()
    await this.library.ensureLoaded()
    const ids = Array.isArray(componentIds) ? componentIds.map((id) => String(id || '').trim()).filter(Boolean) : []
    if (!ids.length) return { ok: false, error: 'componentIds 不能为空（先用 action:"library" 查看可用子图）' }
    const components = []
    const missing = []
    for (const id of ids) {
      const record = await this.library.get(id)
      if (record) components.push(record)
      else missing.push(id)
    }
    if (!components.length) return { ok: false, error: `组件都不存在：${missing.join('，')}` }

    const layout = autoLayout(components.length, rows, cols)
    const loaded = await this.controls.load()
    const spec = deepMerge({}, await this.controls.defaults())
    const gapX = 2
    const gapY = 2
    const panelWidth = Math.min(
      PANEL_WIDTH_MM,
      Math.max(45, Math.floor(((MAX_COMPOSE_WIDTH_MM - (layout.cols - 1) * gapX) / layout.cols) * 10) / 10),
    )
    const widthMm = Math.round((panelWidth * layout.cols + (layout.cols - 1) * gapX) * 10) / 10
    const heightMm = Math.round((PANEL_HEIGHT_MM * layout.rows + (layout.rows - 1) * gapY) * 10) / 10
    const presetId = getPath(spec, 'style.preset') || loaded.presets[0]?.id

    setPath(spec, 'kind', 'compose')
    setPath(spec, 'title', title || '多子图拼接')
    setPath(spec, 'figure.widthMm', widthMm)
    setPath(spec, 'figure.heightMm', heightMm)
    if (getPath(spec, 'figure.dpi') === undefined) setPath(spec, 'figure.dpi', 300)
    if (presetId) setPath(spec, 'style.preset', presetId)
    setPath(spec, 'compose', {
      rows: layout.rows,
      cols: layout.cols,
      gapXMm: gapX,
      gapYMm: gapY,
      panelLabel: { show: true, style: '(a)', position: 'upper left' },
      align: 'axes',
      optimize: optimize !== false,
    })
    setPath(spec, 'compose.panels', components.map((record) => ({ componentId: record.componentId })))
    setPath(spec, 'panels', [])

    const figure = await this.store.createFigure({
      sessionId: sessionId || '',
      spec,
      title: String(title || '多子图拼接'),
      kind: 'compose',
    })
    await this._ensureRenderTargets(figure, 0)
    await this.store.saveSpec(figure)
    const draftWarnings = []
    if (missing.length) draftWarnings.push(`以下组件不存在，已跳过：${missing.join('，')}`)
    await this.renderer.schedule(figure)
    await this._syncComponent(figure)
    figure.warnings = dedupe([...draftWarnings, ...(figure.warnings || [])])
    await this.store.saveMeta(figure)
    if (sessionId) this.store.bindSession(sessionId, figure.id)

    return {
      ok: figure.error === null,
      error: figure.error,
      figureId: figure.id,
      componentId: figure.componentId,
      pngPath: figure.pngPath,
      warnings: figure.warnings,
      layout,
      panels: components.map((record, index) => ({
        index,
        componentId: record.componentId,
        title: record.title,
        kind: record.kind,
      })),
      figure: await this.figurePayload(figure),
    }
  }

  /**
   * 组件补丁：改面板级参数 / customPatch / 标题 → 重渲染自身 figure + 级联引用它的合成图。
   */
  async componentPatch({ componentId, set, customPatch, title, sessionId } = {}) {
    if (!this.library) return { ok: false, error: '组件库未初始化' }
    await this.store.ensureLoaded()
    await this.library.ensureLoaded()
    const record = await this.library.get(componentId)
    if (!record) return { ok: false, error: `未找到组件：${componentId || '(空)'}` }
    const loaded = await this.controls.load()

    let figure = this.store.get(record.figureId)
    let applied = []
    let rejected = []
    if (figure) {
      const result = applySet(figure.spec, set || {}, loaded.byPath)
      applied = result.applied
      rejected = result.rejected
      // 组件级 patch 也做经纬度数字 ↔ 范围预设联动
      const extentLinked = await this.linkExtentPreset(figure.spec, { set: set || {} })
      const componentSetKeys = new Set(Object.keys(set || {}))
      if (componentSetKeys.has('map.projection')) {
        const centralLinked = await this.syncCentralFromExtent(figure.spec, { explicit: componentSetKeys })
        for (const dotted of centralLinked) if (!extentLinked.includes(dotted)) extentLinked.push(dotted)
      }
      if (customPatch !== undefined) setPath(figure.spec, 'customPatch', String(customPatch))
      if (title !== undefined) setPath(figure.spec, 'title', String(title))
      await this._syncFigureMeta(figure)
      await this._ensureRenderTargets(figure)
      await this.renderer.schedule(figure)
      await this._syncComponent(figure, title !== undefined ? { title: String(title) } : {})
      figure = this.store.get(record.figureId) || figure
      if (extentLinked.length) applied.push(...extentLinked.map((dotted) => ({ path: dotted, value: getPath(figure.spec, dotted) })))
    } else {
      // 没有对应 figure（例如历史遗留组件）：只更新组件 spec 与代码
      const spec = clone(record.spec) || {}
      const result = applySet(spec, set || {}, loaded.byPath)
      applied = result.applied
      rejected = result.rejected
      if (customPatch !== undefined) setPath(spec, 'customPatch', String(customPatch))
      if (title !== undefined) setPath(spec, 'title', String(title))
      record.spec = spec
      record.updatedAt = nowIso()
      if (title !== undefined) record.title = String(title)
      const paths = this.library.pathsFor(record.componentId)
      await fsp.mkdir(paths.dir, { recursive: true })
      await fsp.writeFile(paths.specPath, JSON.stringify(spec, null, 2), 'utf8')
      await this.library.saveIndex()
    }

    // 级联：引用该组件的合成图重渲染（同一串行队列）
    const cascaded = []
    const dependents = this.library.dependents(record.componentId)
    for (const figureId of dependents) {
      if (figure && figureId === figure.id) continue
      const dependent = this.store.get(figureId)
      if (!dependent) continue
      try {
        await this.renderer.schedule(dependent)
        await this._syncComponent(dependent)
        cascaded.push({ figureId: dependent.id, error: dependent.error || null, rev: dependent.rev })
      } catch (error) {
        cascaded.push({ figureId: dependent.id, error: String(error?.message || error) })
      }
    }

    const updated = await this.library.get(record.componentId)
    return {
      ok: figure ? figure.error === null : true,
      error: figure ? figure.error : null,
      applied,
      rejected,
      component: this.library.publicComponent(updated || record),
      figure: figure ? await this.figurePayload(figure) : null,
      cascaded,
    }
  }

  /** 组件库里存的是面板级 spec（去掉 figure/style/output 全局块）。 */
  panelSpecOf(spec) {
    return panelSpecOf(spec)
  }
}

/** 拼接布局：手动行列优先；缺省按张数挑论文常用排版。 */
export function autoLayout(count, rows, cols) {
  const n = Math.max(1, Math.floor(count))
  let r = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 0
  let c = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 0
  if (r && c) {
    if (r * c < n) c = Math.ceil(n / r)
    return { rows: r, cols: c }
  }
  if (r) return { rows: r, cols: Math.ceil(n / r) }
  if (c) return { rows: Math.ceil(n / c), cols: c }
  // 论文常用排版：1 张单栏；2 张 1×2；3 张 2×2（末格留空，避免 1×3 过宽）；4 张 2×2；5–6 张 3 列
  if (n === 1) return { rows: 1, cols: 1 }
  if (n === 2) return { rows: 1, cols: 2 }
  if (n === 3) return { rows: 2, cols: 2 }
  if (n === 4) return { rows: 2, cols: 2 }
  if (n <= 6) return { rows: Math.ceil(n / 3), cols: 3 }
  const cc = Math.ceil(Math.sqrt(n))
  return { rows: Math.ceil(n / cc), cols: cc }
}

function dedupe(list) {
  const out = []
  for (const item of list) {
    if (typeof item === 'string' && item && !out.includes(item)) out.push(item)
  }
  return out
}

export { PACKAGE_VERSION }
