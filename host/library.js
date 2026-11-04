// 子图组件库（契约 §7.1 / §7.3）：
//   <workDir>/library/index.json
//   <workDir>/components/<componentId>/{spec.json, component.py, thumb.png}
// 组件 spec 是「面板级」参数（去掉 figure/style/output/compose/panels 全局块）。
// 合成图 spec.compose.panels 保存组件引用，渲染前解析成 renderer 需要的 spec.panels（活引用）。
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import {
  readJson,
  writeJsonAtomic,
  pathExists,
  statSafe,
  clone,
  nowIso,
  errText,
} from './util.js'

/** 全局块：不属于面板级参数。 */
const GLOBAL_BLOCKS = ['figure', 'style', 'output', 'compose', 'panels']

export const COMPONENT_ID_RE = /^cmp-.+-p\d+$/

export function componentIdFor(figureId, panelIndex = 0) {
  return `cmp-${figureId}-p${Math.max(0, Math.floor(panelIndex))}`
}

/** 提取面板级 spec（去掉 figure/style/output/compose/panels）。 */
export function panelSpecOf(spec) {
  const panel = clone(spec) || {}
  for (const key of GLOBAL_BLOCKS) delete panel[key]
  return panel
}

/** 兜底代码：renderer 的 codegen 不可用时，生成可独立运行的等价脚本。 */
export function fallbackComponentCode(panelSpec, { componentId, figureId }) {
  const json = JSON.stringify(panelSpec, null, 2)
  return [
    '# -*- coding: utf-8 -*-',
    `# 组件 ${componentId}（来自 figure ${figureId}）`,
    '# 由 Scifigure Studio host 兜底生成：renderer 的 codegen 尚未可用时，',
    '# 本脚本与引擎渲染结果一致（同一 render_spec 代码路径）。',
    '#',
    '# 用法: python component.py --out figure.png',
    '# 改参数: 直接改下面的 SPEC（JSON 字面量），或让 Agent 通过 action:"patch" 的 customPatch 定制。',
    'import sys',
    'import json',
    '',
    'SPEC = json.loads(r"""',
    json,
    '""")',
    '',
    'from scifig.engine import render_spec',
    '',
    '',
    'if __name__ == "__main__":',
    '    argv = sys.argv[1:]',
    '    out = "component.png"',
    '    if "--out" in argv:',
    '        out = argv[argv.index("--out") + 1]',
    '    render_spec(SPEC, out)',
    '',
  ].join('\n')
}

export class ComponentLibrary {
  constructor({ workDir, store, ctx }) {
    this.workDir = workDir
    this.store = store
    this.ctx = ctx
    this.indexPath = path.join(workDir, 'library', 'index.json')
    this.componentsDir = path.join(workDir, 'components')
    this.components = new Map()
    this._loading = undefined
  }

  pathsFor(componentId) {
    const dir = path.join(this.componentsDir, componentId)
    return {
      dir,
      specPath: path.join(dir, 'spec.json'),
      codePath: path.join(dir, 'component.py'),
      thumbPath: path.join(dir, 'thumb.png'),
    }
  }

  async ensureLoaded() {
    if (!this._loading) this._loading = this._restore()
    return this._loading
  }

  async _restore() {
    await fsp.mkdir(path.join(this.workDir, 'library'), { recursive: true })
    await fsp.mkdir(this.componentsDir, { recursive: true })
    const index = (await readJson(this.indexPath)) || {}
    for (const record of Array.isArray(index.components) ? index.components : []) {
      if (!record || typeof record.componentId !== 'string') continue
      // deleteFiles:false 的删除会留下标记，重启时跳过
      if (await pathExists(path.join(this.componentsDir, record.componentId, '.scifig-deleted'))) continue
      // 兼容旧索引：ownerFigureId 缺省回填为 figureId
      if (typeof record.ownerFigureId !== 'string') record.ownerFigureId = typeof record.figureId === 'string' ? record.figureId : ''
      this.components.set(record.componentId, record)
    }
    // 目录里存在但索引缺失的组件（索引丢了/手工拷贝）→ 用目录名重建最小记录
    let entries = []
    try {
      entries = await fsp.readdir(this.componentsDir, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !COMPONENT_ID_RE.test(entry.name)) continue
      if (this.components.has(entry.name)) continue
      const paths = this.pathsFor(entry.name)
      const spec = await readJson(paths.specPath)
      if (!spec) continue
      const figureId = entry.name.replace(/^cmp-/, '').replace(/-p\d+$/, '')
      this.components.set(entry.name, {
        componentId: entry.name,
        figureId,
        ownerFigureId: figureId,
        panelIndex: Number(/-p(\d+)$/.exec(entry.name)?.[1] || 0),
        sessionId: '',
        title: String(spec.title || entry.name),
        kind: String(spec.kind || ''),
        spec,
        codePath: (await pathExists(paths.codePath)) ? paths.codePath : '',
        thumbPath: (await pathExists(paths.thumbPath)) ? paths.thumbPath : '',
        tags: [],
        detached: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
    }
  }

  async saveIndex() {
    await writeJsonAtomic(this.indexPath, {
      version: 1,
      updatedAt: nowIso(),
      components: [...this.components.values()],
    })
  }

  async list({ sessionId, scope = 'all', limit = 100 } = {}) {
    await this.ensureLoaded()
    let components = [...this.components.values()]
    if (sessionId && scope === 'session') components = components.filter((item) => item.sessionId === sessionId)
    components.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    const max = Number.isFinite(limit) && limit > 0 ? Math.min(500, Math.floor(limit)) : 100
    return components.slice(0, max).map((record) => this.summary(record))
  }

  summary(record) {
    return {
      componentId: record.componentId,
      figureId: record.figureId,
      title: record.title,
      kind: record.kind,
      thumbUrl: `/scifig/api/thumb?id=${encodeURIComponent(record.componentId)}`,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      sessionId: record.sessionId,
      tags: record.tags || [],
    }
  }

  async get(componentId) {
    await this.ensureLoaded()
    return this.components.get(String(componentId || ''))
  }

  /** 从内存索引移除组件（磁盘删除由 WorkspaceService 负责）。 */
  removeComponent(componentId) {
    return this.components.delete(String(componentId || ''))
  }

  /** 完整组件对象（契约 §7.3：含 spec、codeUrl、thumbUrl）。 */
  publicComponent(record) {
    if (!record) return null
    return {
      ...this.summary(record),
      ownerFigureId: record.ownerFigureId || '',
      detached: record.detached === true,
      spec: clone(record.spec),
      codePath: record.codePath || '',
      codeUrl: `/scifig/api/code?id=${encodeURIComponent(record.componentId)}`,
      thumbPath: record.thumbPath || '',
    }
  }

  /**
   * 由 figure 登记/更新一个组件。
   * @param {object} figure
   * @param {{panelIndex?: number, spec?: object, title?: string, thumbPath?: string, codePath?: string, tags?: string[]}} options
   */
  async upsertFromFigure(figure, options = {}) {
    await this.ensureLoaded()
    const panelIndex = options.panelIndex ?? 0
    const componentId = componentIdFor(figure.id, panelIndex)
    const paths = this.pathsFor(componentId)
    await fsp.mkdir(paths.dir, { recursive: true })

    let panelSpec = options.spec ? clone(options.spec) : panelSpecOf(figure.spec)
    if (!panelSpec.kind) panelSpec.kind = figure.kind || 'line'
    if (options.title !== undefined) panelSpec.title = options.title
    await writeJsonAtomic(paths.specPath, panelSpec)

    // 代码：优先 renderer codegen 产物，缺失则生成兜底脚本
    let codePath = options.codePath || paths.codePath
    const codeExists = await pathExists(codePath)
    if (!codeExists) {
      try {
        await fsp.writeFile(
          paths.codePath,
          fallbackComponentCode(panelSpec, { componentId, figureId: figure.id }),
          'utf8',
        )
        codePath = paths.codePath
      } catch {
        codePath = ''
      }
    }

    // 缩略图：优先 renderer --thumb 产物，缺失则复制 PNG（不做缩放，仅兜底）
    let thumbPath = options.thumbPath || paths.thumbPath
    if (!(await pathExists(thumbPath))) {
      if (await pathExists(figure.pngPath)) {
        try {
          await fsp.copyFile(figure.pngPath, paths.thumbPath)
          thumbPath = paths.thumbPath
        } catch {
          thumbPath = ''
        }
      } else {
        thumbPath = ''
      }
    }

    const existing = this.components.get(componentId)
    const record = {
      componentId,
      figureId: figure.id,
      // ownerFigureId：直接由哪张图生成（删除该图时连同组件一起删）；figureId 是"当前所属图"，
      // 当图被删除但组件要保留复用时会被清空（detached=true），由 cleanupOrphans 处理。
      ownerFigureId: existing?.ownerFigureId || (existing?.figureId ? existing.figureId : figure.id),
      panelIndex,
      sessionId: figure.sessionId || existing?.sessionId || '',
      title: options.title !== undefined ? options.title : String(panelSpec.title || existing?.title || componentId),
      kind: String(panelSpec.kind || figure.kind || existing?.kind || ''),
      spec: panelSpec,
      codePath,
      thumbPath,
      tags: options.tags || existing?.tags || [],
      detached: existing?.detached === true,
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso(),
    }
    this.components.set(componentId, record)
    await this.saveIndex()
    return record
  }

  /** 把组件的 figureId 清空（保留组件本身，供跨任务复用），并落盘索引。 */
  async detachComponent(componentId) {
    const record = this.components.get(String(componentId || ''))
    if (!record) return undefined
    record.figureId = ''
    record.detached = true
    record.updatedAt = nowIso()
    await this.saveIndex()
    return record
  }

  /**
   * 孤儿组件清理：figureId 指向的图已不存在时——
   *  - 仍被某张现存合成图引用，或调用方要求保留（keepIds） → 视为可复用独立面板，detach（清 figureId、保留组件）；
   *  - 没有引用 → 直接移除（内存，磁盘目录由调用方删除）。
   * @param {{keepIds?: Set<string>}} [options]
   * @returns {Promise<{removed: object[], detached: object[]}>}
   */
  async cleanupOrphans({ keepIds = new Set() } = {}) {
    await this.ensureLoaded()
    const removed = []
    const detached = []
    let changed = false
    for (const record of [...this.components.values()]) {
      if (!record.figureId) continue
      const figureExists = Boolean(this.store?.get(record.figureId))
      if (figureExists) continue
      const stillReferenced = this.dependents(record.componentId).length > 0
      if (stillReferenced || keepIds.has(record.componentId)) {
        record.figureId = ''
        record.detached = true
        record.updatedAt = nowIso()
        detached.push(record)
      } else {
        this.components.delete(record.componentId)
        removed.push(record)
      }
      changed = true
    }
    if (changed) await this.saveIndex()
    return { removed, detached }
  }

  /** 从合成图拆出组件（幂等）；单图 figure 也登记为 1 个组件。 */
  async decompose(figure) {
    await this.ensureLoaded()
    const records = []
    const refs = figure?.spec?.kind === 'compose' ? figure.spec.compose?.panels : undefined
    if (Array.isArray(refs) && refs.length) {
      const resolved = await this.resolvePanelSpecs(refs)
      for (let position = 0; position < resolved.panels.length; position++) {
        const panel = resolved.panels[position]
        const index = resolved.indices[position]
        const ref = refs[index]
        const existing = await this.get(ref.componentId)
        if (existing) {
          records.push(existing)
          continue
        }
        const record = await this.upsertFromFigure(figure, {
          panelIndex: index,
          spec: panel,
          title: panel.title || ref.componentId,
          tags: ref.overrides ? ['from-compose'] : [],
        })
        // 让组件 id 与引用保持一致（compose 引用的 id 未必等于 cmp-figureId-pN）
        if (record.componentId !== ref.componentId) {
          this.components.delete(record.componentId)
          record.componentId = ref.componentId
          const paths = this.pathsFor(ref.componentId)
          await fsp.mkdir(paths.dir, { recursive: true })
          await writeJsonAtomic(paths.specPath, record.spec)
          record.codePath = record.codePath || ((await pathExists(paths.codePath)) ? paths.codePath : '')
          record.thumbPath = record.thumbPath || ((await pathExists(paths.thumbPath)) ? paths.thumbPath : '')
          this.components.set(ref.componentId, record)
        }
        records.push(record)
      }
      await this.saveIndex()
      return records
    }
    // 单图：登记 1 个组件
    const record = await this.upsertFromFigure(figure, { panelIndex: 0 })
    return [record]
  }

  /** 读取组件代码（也接受 figureId，映射到该图 panel 0 组件）。 */
  async code(idOrFigureId) {
    await this.ensureLoaded()
    const key = String(idOrFigureId || '')
    let component = this.components.get(key)
    if (!component) {
      const figure = this.store.get(key)
      if (figure) component = this.components.get(componentIdFor(figure.id, 0))
    }
    if (!component) return { ok: false, error: `未找到组件或图：${key}` }
    let codePath = component.codePath
    let code
    if (codePath && (await pathExists(codePath))) {
      try {
        code = await fsp.readFile(codePath, 'utf8')
      } catch (error) {
        return { ok: false, error: `读取代码失败：${errText(error)}` }
      }
    } else {
      code = fallbackComponentCode(component.spec, { componentId: component.componentId, figureId: component.figureId })
      try {
        const paths = this.pathsFor(component.componentId)
        await fsp.mkdir(paths.dir, { recursive: true })
        await fsp.writeFile(paths.codePath, code, 'utf8')
        component.codePath = paths.codePath
        codePath = paths.codePath
        await this.saveIndex()
      } catch {
        /* 落盘失败仍返回代码文本 */
      }
    }
    return { ok: true, componentId: component.componentId, path: codePath || '', code }
  }

  /** data.source 是否可用（相对 workDir 或绝对）。 */
  async _dataSourceExists(source) {
    if (!source) return false
    if (path.isAbsolute(source)) return pathExists(source)
    return pathExists(path.resolve(this.workDir, source))
  }

  /**
   * 解析组件引用 → renderer 需要的 panelSpec 数组（活引用：每次渲染都重新解析）。
   * 组件缺失/数据缺失时用占位面板 + warning，不整图失败。
   */
  async resolvePanelSpecs(refs, { figureId } = {}) {
    await this.ensureLoaded()
    const panels = []
    const indices = []
    const warnings = []
    for (let index = 0; index < (refs || []).length; index++) {
      const ref = refs[index] || {}
      const component = await this.get(ref.componentId)
      if (!component) {
        warnings.push(`面板 ${index + 1}：组件 ${ref.componentId || '?'} 不存在，已跳过（占位）`)
        continue
      }
      const panel = clone(component.spec) || {}
      panel.kind = panel.kind || component.kind || 'line'
      panel.title = panel.title || component.title || ''
      if (ref.overrides && typeof ref.overrides === 'object') {
        for (const [dotted, value] of Object.entries(ref.overrides)) {
          setByPath(panel, dotted, clone(value))
        }
      }
      // 数据缺失（没给 source / 文件不存在）→ 写空占位 CSV，让 renderer 仍能画占位面板
      const hasSource = typeof panel.data?.source === 'string' && panel.data.source
      if (!hasSource || !(await this._dataSourceExists(panel.data.source))) {
        const placeholder = await this._writePlaceholderData(component.componentId)
        if (placeholder) {
          panel.data = { ...(panel.data || {}), source: placeholder }
          warnings.push(
            hasSource
              ? `面板 ${index + 1}（${component.title}）：数据文件缺失，已用空占位数据`
              : `面板 ${index + 1}（${component.title}）：缺少 data.source，已用空占位数据`,
          )
        } else if (!hasSource) {
          warnings.push(`面板 ${index + 1}（${component.title}）：缺少 data.source 且无法写占位数据`)
        }
      }
      panels.push(panel)
      indices.push(index)
    }
    return { panels, warnings, indices }
  }

  async _writePlaceholderData(componentId) {
    const paths = this.pathsFor(componentId)
    const target = path.join(paths.dir, 'placeholder.csv')
    try {
      await fsp.mkdir(paths.dir, { recursive: true })
      await fsp.writeFile(target, 'x,y\n0,0\n', 'utf8')
      return path.posix.join('components', componentId, 'placeholder.csv')
    } catch {
      return undefined
    }
  }

  /** 渲染前把 figure.spec.compose.panels 解析成 figure.spec.panels（活引用）。 */
  async resolvePanels(figure) {
    const refs = figure?.spec?.compose?.panels
    if (!Array.isArray(refs)) return []
    const { panels, warnings } = await this.resolvePanelSpecs(refs, { figureId: figure.id })
    figure.spec.panels = panels
    return warnings
  }

  /** /api/state 里 compose figure 的面板摘要（供 UI 排版页）。 */
  async panelSummaries(figure) {
    const refs = figure?.spec?.compose?.panels
    if (!Array.isArray(refs)) return []
    await this.ensureLoaded()
    const result = []
    for (const ref of refs) {
      const component = await this.get(ref?.componentId)
      result.push({
        componentId: ref?.componentId || '',
        title: component?.title || ref?.componentId || '',
        thumbUrl: `/scifig/api/thumb?id=${encodeURIComponent(ref?.componentId || '')}`,
        overrides: ref?.overrides || undefined,
      })
    }
    return result
  }

  /** 依赖图：引用该组件的合成图（按当前 store 里的 compose spec 实时计算）。 */
  dependents(componentId) {
    const id = String(componentId || '')
    return this.store
      .list()
      .filter((figure) => {
        const refs = figure?.spec?.compose?.panels
        return Array.isArray(refs) && refs.some((ref) => ref?.componentId === id)
      })
      .map((figure) => figure.id)
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

export { statSafe }
