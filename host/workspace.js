// 工作区删除（契约 §8.3 删除语义 1–7）：
// 图/会话/全部三种模式；组件被删时级联删除引用它的合成图；同步内存索引；保留 workDir/_selftest。
// 所有磁盘路径在删除前做"规范化后必须落在 workDir 内"的校验，拒绝越界。
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { pathExists } from './util.js'

const MODES = ['figure', 'session', 'all']

export class WorkspaceService {
  constructor({ store, library, workDir }) {
    this.store = store
    this.library = library
    this.workDir = path.resolve(workDir)
  }

  /** 目标路径必须落在 workDir 内（规范化 + 相对路径校验）。 */
  isInsideWorkDir(target) {
    const resolved = path.resolve(String(target || ''))
    const relative = path.relative(this.workDir, resolved)
    return relative === '' || (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative))
  }

  /** figureId / sessionId 不允许携带路径片段（防 `..`、绝对路径注入）。 */
  static isSafeId(id) {
    const text = String(id || '')
    if (!text) return true
    if (text.includes('..') || text.includes('/') || text.includes('\\') || path.isAbsolute(text)) return false
    return /^[\w.:-]{1,200}$/u.test(text)
  }

  async _deletePath(target) {
    if (!this.isInsideWorkDir(target)) throw new Error(`拒绝删除 workDir 之外的路径：${target}`)
    let stat
    try {
      stat = await fsp.lstat(target)
    } catch {
      return 0
    }
    if (stat.isDirectory()) {
      let files = 0
      const entries = await fsp.readdir(target, { withFileTypes: true })
      for (const entry of entries) files += await this._deletePath(path.join(target, entry.name))
      await fsp.rmdir(target).catch(() => {})
      return files
    }
    await fsp.unlink(target).catch(() => {})
    return 1
  }

  /** 只读删除：不删文件，但写标记，重启恢复时跳过该目录。 */
  async _markDeleted(target) {
    if (!this.isInsideWorkDir(target)) throw new Error(`拒绝标记 workDir 之外的路径：${target}`)
    const stat = await fsp.stat(target).catch(() => undefined)
    if (!stat?.isDirectory()) return
    await fsp.writeFile(path.join(target, '.scifig-deleted'), 'deleted\n', 'utf8').catch(() => {})
  }

  /**
   * 删除工作区。
   * @param {{mode:'figure'|'session'|'all', figureId?:string, sessionId?:string, includeComponents?:boolean, deleteFiles?:boolean}} options
   */
  async delete(options = {}) {
    const mode = String(options.mode || '').trim()
    if (!MODES.includes(mode)) return { ok: false, error: 'mode 必须是 figure | session | all' }
    if (!WorkspaceService.isSafeId(options.figureId)) return { ok: false, error: `非法的 figureId：${options.figureId}` }
    if (!WorkspaceService.isSafeId(options.sessionId)) return { ok: false, error: `非法的 sessionId：${options.sessionId}` }
    if (mode === 'figure' && !options.figureId) return { ok: false, error: 'mode:"figure" 需要 figureId' }
    if (mode === 'session' && !options.sessionId) return { ok: false, error: 'mode:"session" 需要 sessionId' }

    const includeComponents = options.includeComponents !== false
    const deleteFiles = options.deleteFiles !== false

    await this.store.ensureLoaded()
    if (this.library) await this.library.ensureLoaded()

    const allFigures = this.store.list()
    const allComponents = this.library ? [...this.library.components.values()] : []
    const deletedFigures = new Map() // id -> figure
    const deletedComponents = new Map() // componentId -> record
    let composites = 0

    const markFigure = (figure, { cascade = false } = {}) => {
      if (!figure || deletedFigures.has(figure.id)) return false
      deletedFigures.set(figure.id, figure)
      if (cascade) composites += 1
      return true
    }

    // ---- 1. 直接命中的图 ----
    if (mode === 'figure') {
      markFigure(this.store.get(String(options.figureId)))
    } else if (mode === 'session') {
      for (const figure of this.store.listForSession(String(options.sessionId))) markFigure(figure)
    } else {
      for (const figure of allFigures) markFigure(figure)
    }

    // ---- 2. 需要删除/保留的组件（ownerFigureId = 直接由该图生成；figureId 仅作旧记录回退） ----
    const ownerOf = (component) => String(component?.ownerFigureId || component?.figureId || '')
    const ownedComponents = allComponents.filter(
      (component) =>
        deletedFigures.has(ownerOf(component)) || (mode === 'session' && component.sessionId === String(options.sessionId)),
    )
    const keepIds = new Set()
    if (mode === 'all') {
      for (const component of allComponents) deletedComponents.set(component.componentId, component)
    } else if (includeComponents) {
      for (const component of ownedComponents) deletedComponents.set(component.componentId, component)
    } else {
      // 显式 includeComponents:false：保留组件但取消归属，避免留下 figureId 指向已删图的孤儿
      for (const component of ownedComponents) keepIds.add(component.componentId)
    }

    // ---- 3. 级联：引用被删组件的合成图一并删除（计入 composites）；级联删除的图若自身是组件，再级联一次 ----
    if (mode !== 'all' && deletedComponents.size) {
      let changed = true
      let guard = 0
      while (changed && guard < 20) {
        changed = false
        guard += 1
        const componentIds = new Set(deletedComponents.keys())
        for (const figure of this.store.list()) {
          if (deletedFigures.has(figure.id)) continue
          const refs = figure.spec?.compose?.panels
          if (Array.isArray(refs) && refs.some((ref) => ref && componentIds.has(ref.componentId))) {
            if (markFigure(figure, { cascade: true })) changed = true
          }
        }
        for (const component of allComponents) {
          if (deletedComponents.has(component.componentId)) continue
          if (deletedFigures.has(ownerOf(component))) {
            deletedComponents.set(component.componentId, component)
            changed = true
          }
        }
      }
    }

    // ---- 4. 先同步内存索引（/state 立即可见），再删磁盘 ----
    const figureDirs = []
    const componentDirs = []
    for (const figure of deletedFigures.values()) {
      figureDirs.push(figure.dir)
      this.store.removeFigure(figure.id)
    }
    for (const component of deletedComponents.values()) {
      componentDirs.push(this.library.pathsFor(component.componentId).dir)
      this.library.removeComponent(component.componentId)
    }

    // ---- 4.5 孤儿清理：figureId 指向已删图但组件还在的，按"是否仍被合成图引用"决定 detach / 移除 ----
    const warnings = []
    let cleanedComponents = 0
    if (this.library) {
      try {
        const cleaned = await this.library.cleanupOrphans({ keepIds })
        for (const record of cleaned.removed || []) {
          cleanedComponents += 1
          componentDirs.push(this.library.pathsFor(record.componentId).dir)
        }
        for (const record of cleaned.detached || []) {
          void record
        }
      } catch (error) {
        warnings.push(`孤儿组件清理失败：${error?.message || error}`)
      }
    }

    // ---- 5. 磁盘清理 ----
    const targets = [...figureDirs, ...componentDirs]
    if (mode === 'all') {
      // 全部删除：workDir 下除 _selftest 外全清（含 exports、library、components、遗留目录），保留 _selftest
      try {
        const entries = await fsp.readdir(this.workDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name === '_selftest') continue
          targets.push(path.join(this.workDir, entry.name))
        }
      } catch {
        /* workDir 不存在时等价于已清空 */
      }
    } else if (this.library && this.library.components.size === 0) {
      // 组件库空了：顺手清掉索引文件
      targets.push(this.library.indexPath)
    }

    let files = 0
    const seenTargets = new Set()
    if (deleteFiles) {
      for (const target of targets) {
        const key = path.resolve(target).toLowerCase()
        if (seenTargets.has(key)) continue
        seenTargets.add(key)
        if (!this.isInsideWorkDir(target)) {
          return { ok: false, error: `拒绝删除 workDir 之外的路径：${target}` }
        }
        try {
          files += await this._deletePath(target)
        } catch (error) {
          warnings.push(`删除失败 ${target}：${error?.message || error}`)
        }
      }
      // 删完后组件库索引可能被重建（saveIndex），all 模式确保不残留
      if (this.library && mode !== 'all') {
        try {
          await this.library.saveIndex()
        } catch {
          /* 索引写入失败不影响删除结果 */
        }
      } else if (this.library && mode === 'all') {
        await fsp.rm(path.join(this.workDir, 'library'), { recursive: true, force: true }).catch(() => {})
      }
    } else {
      for (const target of [...figureDirs, ...componentDirs]) {
        try {
          await this._markDeleted(target)
        } catch (error) {
          warnings.push(`标记删除失败 ${target}：${error?.message || error}`)
        }
      }
      if (this.library) {
        try {
          await this.library.saveIndex()
        } catch {
          /* ignore */
        }
      }
    }
    const totalDeletedComponents = deletedComponents.size + cleanedComponents
    return {
      ok: true,
      mode,
      deleted: {
        figures: deletedFigures.size,
        components: totalDeletedComponents,
        files,
        composites,
      },
      remaining: {
        figures: this.store.list().length,
        components: this.library ? this.library.components.size : 0,
      },
      deletedFigureIds: [...deletedFigures.keys()],
      deletedComponentIds: [...deletedComponents.keys()],
      detachedComponentIds: [...(keepIds || [])],
      warnings,
    }
  }

  /** 删除后确认目标确实不存在（自测用）。 */
  async exists(target) {
    return pathExists(target)
  }
}
