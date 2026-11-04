// 图 registry：<workDir>/<figureId>/{spec.json,figure.png,meta.json,history/<n>.json}
// 内存索引 + 磁盘持久化（重启后按目录恢复，sessionId 绑定关系存在 meta.json 里）。
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { readJson, writeJsonAtomic, writeBufferAtomic, pathExists, nowIso, makeFigureId, clone } from './util.js'

export class FigureStore {
  constructor({ workDir }) {
    this.workDir = workDir
    this.figures = new Map()
    this.order = []
    this.sessionFigures = new Map() // sessionId -> figureId[]
    this.sessionActive = new Map() // sessionId -> figureId
    this._loading = undefined
  }

  /** 只扫描一次磁盘目录，恢复历史图（重启后 UI 仍能看到之前的图）。 */
  async ensureLoaded() {
    if (!this._loading) this._loading = this._restore()
    return this._loading
  }

  async _restore() {
    await fsp.mkdir(this.workDir, { recursive: true })
    let entries = []
    try {
      entries = await fsp.readdir(this.workDir, { withFileTypes: true })
    } catch {
      return
    }
    const dirs = entries
      .filter((entry) => entry.isDirectory() && /^fig-/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
    for (const name of dirs) {
      const dir = path.join(this.workDir, name)
      // deleteFiles:false 的删除会留下标记文件，重启时跳过，避免"删了又回来"
      if (await pathExists(path.join(dir, '.scifig-deleted'))) continue
      const spec = await readJson(path.join(dir, 'spec.json'))
      if (!spec) continue
      const meta = (await readJson(path.join(dir, 'meta.json'))) || {}
      const figure = this._makeFigure({
        id: typeof meta.id === 'string' && meta.id ? meta.id : name,
        dir,
        spec,
        sessionId: typeof meta.sessionId === 'string' ? meta.sessionId : '',
        title: typeof meta.title === 'string' ? meta.title : String(spec.title || ''),
        kind: typeof meta.kind === 'string' ? meta.kind : String(spec.kind || ''),
        rev: Number.isFinite(meta.rev) ? meta.rev : 0,
        renders: Number.isFinite(meta.renders) ? meta.renders : 0,
        createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : nowIso(),
        updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : nowIso(),
        warnings: sanitizeWarnings(Array.isArray(meta.warnings) ? meta.warnings : [], String(spec.kind || meta.kind || '')),
        error: typeof meta.error === 'string' ? meta.error : null,
        autoAdjust: Array.isArray(meta.autoAdjust) ? meta.autoAdjust : [],
      })
      figure.pngExists = await pathExists(figure.pngPath)
      this._register(figure)
      // 历史 meta 里的误导性 warning（旧版对 compose 也校验顶层 data.source）读取时清掉并回写
      const rawWarnings = Array.isArray(meta.warnings) ? meta.warnings : []
      if (rawWarnings.length !== figure.warnings.length) {
        await this.saveMeta(figure).catch(() => {})
      }
    }
  }

  _makeFigure(input) {
    const dir = input.dir || path.join(this.workDir, input.id)
    return {
      id: input.id,
      dir,
      specPath: path.join(dir, 'spec.json'),
      // renderer 实际读取的 spec：合成图的 compose.panels 会被解析成面板 spec（host 的 spec.json 保存组件引用）
      renderSpecPath: path.join(dir, 'render-spec.json'),
      pngPath: path.join(dir, 'figure.png'),
      metaPath: path.join(dir, 'meta.json'),
      historyDir: path.join(dir, 'history'),
      sessionId: input.sessionId || '',
      title: input.title || '',
      kind: input.kind || '',
      spec: input.spec || {},
      rev: input.rev || 0,
      renders: input.renders || 0,
      rendering: false,
      error: input.error || null,
      warnings: input.warnings || [],
      // 引擎自动优化（autoAdjust）与 warnings 分开存；不参与"警告"展示
      autoAdjust: Array.isArray(input.autoAdjust) ? input.autoAdjust : [],
      createdAt: input.createdAt || nowIso(),
      updatedAt: input.updatedAt || nowIso(),
      dirty: false,
      renderLoop: null,
      pngExists: input.pngExists === true,
    }
  }

  _register(figure) {
    this.figures.set(figure.id, figure)
    if (!this.order.includes(figure.id)) this.order.push(figure.id)
    if (figure.sessionId) {
      const list = this.sessionFigures.get(figure.sessionId) || []
      if (!list.includes(figure.id)) list.push(figure.id)
      this.sessionFigures.set(figure.sessionId, list)
      this.sessionActive.set(figure.sessionId, figure.id)
    }
  }

  async createFigure({ sessionId, spec, title, kind }) {
    await this.ensureLoaded()
    const id = makeFigureId()
    const dir = path.join(this.workDir, id)
    await fsp.mkdir(path.join(dir, 'history'), { recursive: true })
    const figure = this._makeFigure({
      id,
      dir,
      spec,
      sessionId: sessionId || '',
      title: title !== undefined ? title : String(spec?.title || ''),
      kind: kind !== undefined ? kind : String(spec?.kind || ''),
      rev: 0,
      renders: 0,
    })
    this._register(figure)
    await this.saveSpec(figure)
    await this.saveMeta(figure)
    return figure
  }

  get(id) {
    if (!id) return undefined
    return this.figures.get(id)
  }

  /** 某 session 的图，按创建顺序。 */
  listForSession(sessionId) {
    const ids = this.sessionFigures.get(sessionId || '') || []
    return ids.map((id) => this.figures.get(id)).filter(Boolean)
  }

  list() {
    return this.order.map((id) => this.figures.get(id)).filter(Boolean)
  }

  activeFigure(sessionId) {
    const id = this.sessionActive.get(sessionId || '')
    if (id) {
      const figure = this.figures.get(id)
      if (figure) return figure
    }
    const list = this.listForSession(sessionId)
    return list.length ? list[list.length - 1] : null
  }

  /** 把图设为该 session 当前图。 */
  setActive(sessionId, figureId) {
    const key = sessionId || ''
    const figure = this.figures.get(figureId)
    if (!figure) return false
    if (!figure.sessionId) figure.sessionId = key
    this.sessionActive.set(key, figureId)
    if (figure.sessionId === key && !(this.sessionFigures.get(key) || []).includes(figureId)) {
      const list = this.sessionFigures.get(key) || []
      list.push(figureId)
      this.sessionFigures.set(key, list)
    }
    return true
  }

  /** 绑定图到 session（同时设为当前图）。 */
  bindSession(sessionId, figureId) {
    const key = sessionId || ''
    const figure = this.figures.get(figureId)
    if (!figure) return false
    if (figure.sessionId && figure.sessionId !== key) {
      const old = (this.sessionFigures.get(figure.sessionId) || []).filter((id) => id !== figureId)
      this.sessionFigures.set(figure.sessionId, old)
    }
    figure.sessionId = key
    const list = this.sessionFigures.get(key) || []
    if (!list.includes(figureId)) list.push(figureId)
    this.sessionFigures.set(key, list)
    this.sessionActive.set(key, figureId)
    return true
  }

  /**
   * 从内存索引移除一张图（磁盘删除由 WorkspaceService 负责）：
   * 同步 figures / order / sessionFigures / sessionActive。
   */
  removeFigure(figureId) {
    const id = String(figureId || '')
    const figure = this.figures.get(id)
    if (!figure) return false
    this.figures.delete(id)
    const index = this.order.indexOf(id)
    if (index >= 0) this.order.splice(index, 1)
    const sessionId = figure.sessionId || ''
    const list = (this.sessionFigures.get(sessionId) || []).filter((item) => item !== id)
    if (list.length) this.sessionFigures.set(sessionId, list)
    else this.sessionFigures.delete(sessionId)
    if (this.sessionActive.get(sessionId) === id) {
      if (list.length) this.sessionActive.set(sessionId, list[list.length - 1])
      else this.sessionActive.delete(sessionId)
    }
    // 兜底：其他 session 的 active 指向该图时也清掉
    for (const [key, value] of [...this.sessionActive.entries()]) {
      if (value === id) this.sessionActive.delete(key)
    }
    return true
  }

  async saveSpec(figure) {
    await writeJsonAtomic(figure.specPath, figure.spec)
  }

  /** 交给 renderer 的 spec（合成图已把组件引用解析成面板 spec）。 */
  async writeRenderSpec(figure, renderSpec) {
    await writeJsonAtomic(figure.renderSpecPath, renderSpec)
  }

  async saveMeta(figure) {
    await writeJsonAtomic(figure.metaPath, {
      id: figure.id,
      sessionId: figure.sessionId,
      title: figure.title,
      kind: figure.kind,
      rev: figure.rev,
      renders: figure.renders,
      createdAt: figure.createdAt,
      updatedAt: figure.updatedAt,
      warnings: figure.warnings,
      error: figure.error,
      autoAdjust: Array.isArray(figure.autoAdjust) ? figure.autoAdjust : [],
    })
  }

  /** 追加一版历史快照（每次渲染尝试一条）。 */
  async recordHistory(figure, attempt, payload) {
    try {
      await fsp.mkdir(figure.historyDir, { recursive: true })
      await writeJsonAtomic(path.join(figure.historyDir, `${attempt}.json`), payload)
    } catch {
      // 历史快照失败不影响主流程
    }
  }

  async writePlaceholderPng(figure, buffer) {
    await writeBufferAtomic(figure.pngPath, buffer)
    figure.pngExists = true
  }

  /** HTTP 契约里的 figure 形状（§3.5）。 */
  snapshot(figure, { includeSpec = true } = {}) {
    if (!figure) return null
    const out = {
      id: figure.id,
      sessionId: figure.sessionId,
      title: figure.title,
      kind: figure.kind,
      rev: figure.rev,
      imageUrl: `/scifig/api/image?id=${encodeURIComponent(figure.id)}&rev=${figure.rev}`,
      pngPath: figure.pngPath,
      rendering: figure.rendering === true,
      error: figure.error || null,
      warnings: Array.isArray(figure.warnings) ? figure.warnings.slice() : [],
      autoAdjust: Array.isArray(figure.autoAdjust) ? figure.autoAdjust.map((item) => ({ ...item })) : [],
      createdAt: figure.createdAt,
      updatedAt: figure.updatedAt,
    }
    if (includeSpec) out.spec = clone(figure.spec)
    return out
  }

  /** /api/state 里的轻量列表项。 */
  summary(figure) {
    return {
      id: figure.id,
      title: figure.title,
      kind: figure.kind,
      rev: figure.rev,
      updatedAt: figure.updatedAt,
      imageUrl: `/scifig/api/image?id=${encodeURIComponent(figure.id)}&rev=${figure.rev}`,
    }
  }
}

/**
 * 过滤历史 meta 里已知的误导性 warning：
 * 旧版本对 compose 也检查顶层 data.source，把这条写进了 meta，读取时清掉。
 */
function sanitizeWarnings(warnings, kind) {
  return warnings.filter((warning) => {
    if (typeof warning !== 'string' || !warning) return false
    if (kind === 'compose' && /data\.source 缺失/.test(warning)) return false
    return true
  })
}
