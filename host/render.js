// 渲染调度：同一 figure 串行 + 挂起 patch 合并；单次渲染 90s 超时并 kill；
// 渲染器未就绪时写占位 PNG 保证整条链路可验证（不抛异常）。
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { ensureFixed } from './spec.js'
import { makePlaceholderPng, nowIso, errText, statSafe, stripBom, clone } from './util.js'

const DEFAULT_TIMEOUT_MS = 90_000
const DEFAULT_CONCURRENCY = 2
const STDERR_TAIL = 1200

class Semaphore {
  constructor(limit) {
    this.limit = limit
    this.active = 0
    this.waiters = []
  }
  async acquire() {
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    await new Promise((resolve) => this.waiters.push(resolve))
    this.active += 1
  }
  release() {
    this.active -= 1
    const next = this.waiters.shift()
    if (next) next()
  }
  async run(task) {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }
}

export class RenderService {
  constructor({ ctx, python, workDir, bundleDir, store, controls, library, timeoutMs, concurrency }) {
    this.ctx = ctx
    this.python = python
    this.workDir = workDir
    this.bundleDir = bundleDir
    this.pyDir = path.join(bundleDir, 'py')
    this.store = store
    this.controls = controls
    this.library = library || undefined
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
    this.semaphore = new Semaphore(Number.isFinite(concurrency) && concurrency > 0 ? concurrency : DEFAULT_CONCURRENCY)
    this._placeholderWarned = false
    // renderer 是否支持 --thumb / --code-out（首次遇到 unrecognized arguments 时自动降级）
    this._codegenCapable = true
  }

  /** renderer 的 CLI 是否就绪（py/scifig/cli.py 或 py/scifig/cli/__init__.py）。 */
  async rendererAvailable() {
    return this.controls.rendererAvailable()
  }

  /**
   * 用 renderer 的 python 执行一小段代码并解析 stdout 的最后一行 JSON。
   * 供 host 读取 renderer 的权威常量（如 spec.EXTENT_PRESETS），避免 host 复制一份表。
   */
  async runPython(code, { timeoutMs = 20_000, maxBytes = 65536 } = {}) {
    if (!(await this.rendererAvailable())) return undefined
    let handle
    try {
      handle = this.ctx.subprocess.spawn({
        argv: [this.python, '-c', String(code)],
        cwd: this.pyDir,
        env: { ...process.env, PYTHONPATH: this.pyDir, PYTHONIOENCODING: 'utf-8' },
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes },
          stderr: { maxBytes: 16384 },
        },
        graceMs: 5000,
      })
    } catch {
      return undefined
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        handle.terminate()
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    try {
      await handle.done
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
    if (timedOut) return undefined
    const stdout = readCollected(handle, 'stdout')
    return parseCliJson(stdout)
  }

  /**
   * 请求渲染（合并挂起请求）：
   * - 已有渲染在跑时只把 dirty 置位，本轮渲染结束立刻用最新 spec 再渲染一次；
   * - 返回的 promise 在该 figure 的渲染队列排空后 resolve。
   */
  schedule(figure) {
    figure.dirty = true
    if (!figure.renderLoop) {
      figure.rendering = true
      figure.renderLoop = (async () => {
        try {
          while (figure.dirty) {
            figure.dirty = false
            await this.renderOnce(figure)
          }
        } finally {
          figure.renderLoop = null
          figure.rendering = false
        }
      })()
    }
    return figure.renderLoop
  }

  /**
   * 确保 figure 已有一张可用的 PNG（export 等只读路径用），不会为了无变化的 spec 重复渲染。
   */
  async ensure(figure) {
    if (figure.renderLoop) return figure.renderLoop
    if (figure.pngExists) return
    return this.schedule(figure)
  }

  /** 单次渲染尝试（不合并；由 schedule 串行调用）。 */
  async renderOnce(figure) {
    const attempt = (figure.renders || 0) + 1
    figure.renders = attempt
    // 合成图：渲染前把组件引用解析成 renderer 需要的 panels（活引用）
    let composeWarnings = []
    if (this.library && figure.spec?.kind === 'compose') {
      try {
        composeWarnings = (await this.library.resolvePanels(figure)) || []
      } catch (error) {
        composeWarnings = [`合成图面板解析失败：${errText(error)}`]
      }
    }
    // 同步快照 spec，避免渲染过程中被后续 patch 撕裂
    const available = await this.rendererAvailable()
    const presetId = (await this.controls.load()).presets[0]?.id
    // 固定路径（output.png / figure.* 默认值）写回 host spec，保证 UI 读到的 spec 完整
    const fixWarnings = ensureFixed(figure.spec, { pngPath: figure.pngPath, presetId })
    const renderSpec = clone(figure.spec) || {}
    if (renderSpec.kind === 'compose') {
      // renderer §7.2：compose.panels 是面板 spec 数组；host spec.json 里保存的是组件引用
      renderSpec.compose = { ...(renderSpec.compose || {}), panels: Array.isArray(renderSpec.panels) ? renderSpec.panels : [] }
    }
    await this.store.saveSpec(figure)
    await this.store.writeRenderSpec(figure, renderSpec)

    let result
    if (!available) {
      result = await this._placeholder(figure, renderSpec, fixWarnings)
    } else if (renderSpec?.kind === 'compose') {
      // compose：数据在各 panel 里，顶层不要求 data.source；只要求 panels 非空。
      // 面板自身缺 kind / data.source 时自动兜底（占位面板），并把问题写进 warnings。
      const panels = Array.isArray(renderSpec?.compose?.panels) ? renderSpec.compose.panels : []
      const panelWarnings = []
      for (let index = 0; index < panels.length; index++) {
        const panel = panels[index]
        if (!panel || typeof panel !== 'object') {
          panelWarnings.push(`面板 ${index + 1} 不是对象，已跳过`)
          panels[index] = { kind: 'line', title: `面板 ${index + 1}`, data: { source: '' } }
          continue
        }
        if (typeof panel.kind !== 'string' || !panel.kind) {
          panel.kind = 'line'
          panelWarnings.push(`面板 ${index + 1} 缺少 kind，已按 line 处理`)
        }
        if (typeof panel.data?.source !== 'string' || !panel.data.source) {
          panelWarnings.push(`面板 ${index + 1}（${panel.title || '未命名'}）缺少 data.source，已用占位数据`)
        }
      }
      renderSpec.compose.panels = panels
      if (!panels.length) {
        result = {
          ok: false,
          error: '合成图没有可用面板：请用 action:"compose" 选择至少一个子图组件（或先 decompose/draft 生成组件）',
          warnings: [...fixWarnings, ...composeWarnings],
          metrics: null,
        }
      } else {
        composeWarnings = composeWarnings.concat(panelWarnings)
        result = await this.semaphore.run(() => this._spawnRender(figure, renderSpec, fixWarnings))
      }
    } else if (renderSpec?.data?.source === undefined || renderSpec?.data?.source === '') {
      result = {
        ok: false,
        error: 'spec.data.source 缺失：请提供 dataFile 或在 set 里指定 data.source',
        warnings: fixWarnings,
        metrics: null,
      }
    } else {
      result = await this.semaphore.run(() => this._spawnRender(figure, renderSpec, fixWarnings))
    }

    // 合并 warnings 并去重
    const merged = []
    for (const text of [].concat(composeWarnings, fixWarnings, result.warnings || [])) {
      if (typeof text === 'string' && text && !merged.includes(text)) merged.push(text)
    }
    figure.warnings = merged
    // v5：autoAdjust = 引擎自动做的优化（中央经线对齐、四角配色、比例尺降级…），与 warnings 分开存，
    // 不拼进 warnings（不要吓用户）。成功渲染时覆盖，失败保留上一次/置空由调用方决定。
    if (result.ok) {
      figure.autoAdjust = Array.isArray(result.autoAdjust) ? result.autoAdjust.filter((item) => item && typeof item === 'object') : []
    } else if (Array.isArray(result.autoAdjust)) {
      figure.autoAdjust = result.autoAdjust
    }
    figure.rendering = figure.renderLoop !== null
    figure.updatedAt = nowIso()
    if (result.ok) {
      figure.rev = attempt
      figure.error = null
      figure.pngExists = true
      if (result.metrics) figure.lastMetrics = result.metrics
      figure.title = typeof renderSpec.title === 'string' && renderSpec.title ? renderSpec.title : figure.title
      figure.kind = typeof renderSpec.kind === 'string' ? renderSpec.kind : figure.kind
    } else {
      figure.error = result.error || '渲染失败'
    }
    await this.store.recordHistory(figure, attempt, {
      rev: attempt,
      at: figure.updatedAt,
      ok: result.ok === true,
      error: figure.error,
      warnings: merged,
      autoAdjust: figure.autoAdjust || [],
      metrics: result.metrics || null,
      spec: renderSpec,
    })
    await this.store.saveMeta(figure)
    return result
  }

  /** 渲染器尚未就绪：写占位 PNG，让 HTTP/工具链路可以先打通。 */
  async _placeholder(figure, spec, warnings) {
    const dims = this._placeholderSize(spec)
    const buffer = makePlaceholderPng(dims.width, dims.height)
    await this.store.writePlaceholderPng(figure, buffer)
    if (!this._placeholderWarned) {
      this._placeholderWarned = true
      try {
        this.ctx?.logger?.warn?.('[scifig] 渲染器未就绪，使用占位图')
      } catch {
        /* ignore */
      }
    }
    return {
      ok: false,
      placeholder: true,
      error: '渲染器尚未就绪（py/scifig 缺失）：当前是占位图，渲染器就绪后任意 patch 都会重绘',
      warnings: warnings.concat(['占位图：py/scifig 未就绪']),
      metrics: { widthMm: spec?.figure?.widthMm, heightMm: spec?.figure?.heightMm, dpi: spec?.figure?.dpi },
    }
  }

  _placeholderSize(spec) {
    const widthMm = Number(spec?.figure?.widthMm)
    const heightMm = Number(spec?.figure?.heightMm)
    const dpi = Number(spec?.figure?.dpi)
    if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || !Number.isFinite(dpi)) {
      return { width: 900, height: 600 }
    }
    const width = Math.min(1400, Math.max(240, Math.round((widthMm / 25.4) * dpi)))
    const height = Math.min(1400, Math.max(160, Math.round((heightMm / 25.4) * dpi)))
    return { width, height }
  }

  /** 真正 spawn python CLI，解析 stdout 的单行 JSON。 */
  async _spawnRender(figure, spec, warnings) {
    const baseArgv = [
      this.python,
      '-m',
      'scifig.cli',
      'render',
      '--spec',
      figure.renderSpecPath || figure.specPath,
      '--out',
      figure.pngPath,
      '--workdir',
      this.workDir,
    ]
    const extra = []
    const targets = figure.renderTargets || {}
    if (this._codegenCapable) {
      if (targets.thumbPath) extra.push('--thumb', targets.thumbPath)
      if (targets.codePath) extra.push('--code-out', targets.codePath)
    }
    const withExtras = baseArgv.concat(extra)
    let result = await this._runOnce(withExtras, warnings, figure.pngPath)
    if (!result.ok && extra.length && /unrecognized arguments|no such option|unknown option|invalid choice/i.test(result.detail || '')) {
      // renderer 还没实现 §7.2 的 --thumb/--code-out：自动降级重试
      this._codegenCapable = false
      result = await this._runOnce(baseArgv, warnings, figure.pngPath)
      if (result.ok) {
        result.warnings = (result.warnings || []).concat([
          '渲染器暂不支持 --thumb/--code-out：缩略图退化为复制 PNG、代码退化为 host 兜底脚本',
        ])
      }
    }
    return result
  }

  /** 单次 spawn + 90s 超时 + stdout JSON 解析。 */
  async _runOnce(argv, warnings, expectedPng) {
    const stdio = {
      stdin: 'ignore',
      stdout: { maxBytes: 65536 },
      stderr: { maxBytes: 65536 },
    }
    let handle
    try {
      handle = this.ctx.subprocess.spawn({
        argv,
        cwd: this.pyDir,
        env: { ...process.env, PYTHONPATH: this.pyDir, PYTHONIOENCODING: 'utf-8' },
        stdio,
        graceMs: 5000,
      })
    } catch (error) {
      return { ok: false, error: `无法启动 python 渲染进程：${errText(error)}`, warnings, metrics: null, detail: errText(error) }
    }

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try {
        handle.terminate()
      } catch {
        /* ignore */
      }
    }, this.timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    let outcome
    try {
      outcome = await handle.done
    } catch (error) {
      clearTimeout(timer)
      return { ok: false, error: `渲染进程失败：${errText(error)}`, warnings, metrics: null, detail: errText(error) }
    } finally {
      clearTimeout(timer)
    }

    const stdout = readCollected(handle, 'stdout')
    const stderr = readCollected(handle, 'stderr')
    const exitCode = outcome?.exitCode
    const stderrTail = stderr.length > STDERR_TAIL ? `…${stderr.slice(-STDERR_TAIL)}` : stderr

    if (timedOut) {
      return {
        ok: false,
        error: `渲染超时（>${Math.round(this.timeoutMs / 1000)}s），已终止进程${stderrTail ? `：${stderrTail}` : ''}`,
        warnings,
        metrics: null,
        detail: stderr,
      }
    }

    const parsed = parseCliJson(stdout)
    if (!parsed) {
      return {
        ok: false,
        error: `渲染器未返回合法 JSON（exit=${exitCode ?? '?'}）${stderrTail ? `：${stderrTail}` : ''}`,
        warnings,
        metrics: null,
        detail: stderr,
      }
    }
    if (parsed.ok !== true) {
      return {
        ok: false,
        error: typeof parsed.error === 'string' && parsed.error ? parsed.error : '渲染失败',
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : warnings,
        autoAdjust: Array.isArray(parsed.autoAdjust) ? parsed.autoAdjust : [],
        metrics: parsed.metrics || null,
        detail: stderr,
      }
    }

    const resultWarnings = Array.isArray(parsed.warnings) ? parsed.warnings.slice() : []
    const resultAutoAdjust = Array.isArray(parsed.autoAdjust) ? parsed.autoAdjust.slice() : []
    let pngPath = typeof parsed.png === 'string' && parsed.png ? parsed.png : expectedPng
    if (!(await statSafe(pngPath))) {
      if (await statSafe(expectedPng)) {
        pngPath = expectedPng
      } else {
        return {
          ok: false,
          error: `渲染器报告成功但找不到 PNG：${pngPath}`,
          warnings: resultWarnings,
          metrics: parsed.metrics || null,
          detail: stderr,
        }
      }
    }
    if (path.resolve(pngPath) !== path.resolve(expectedPng)) {
      // 渲染器写到别处时，复制回 figure 目录，保证 imageUrl 稳定
      try {
        await fsp.copyFile(pngPath, expectedPng)
        pngPath = expectedPng
      } catch {
        resultWarnings.push(`PNG 不在预期路径：${pngPath}`)
      }
    }
    return { ok: true, pngPath, warnings: resultWarnings, autoAdjust: resultAutoAdjust, metrics: parsed.metrics || null }
  }
}

function readCollected(handle, stream) {
  const reader = handle?.collected?.[stream]
  if (!reader || typeof reader.readFrom !== 'function') return ''
  try {
    const read = reader.readFrom(0)
    return stripBom(typeof read?.text === 'string' ? read.text : '')
  } catch {
    return ''
  }
}

/** 容错解析 CLI stdout：取最后一个能解析的 JSON 行。 */
export function parseCliJson(stdout) {
  const text = stripBom(String(stdout || '')).trim()
  if (!text) return undefined
  try {
    const value = JSON.parse(text)
    if (value && typeof value === 'object') return value
  } catch {
    /* 继续按行解析 */
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('{') && !line.startsWith('[')) continue
    try {
      const value = JSON.parse(line)
      if (value && typeof value === 'object') return value
    } catch {
      /* 下一条 */
    }
  }
  // 兜底：抓第一个 { 到最后一个 } 之间的内容
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const value = JSON.parse(text.slice(start, end + 1))
      if (value && typeof value === 'object') return value
    } catch {
      /* ignore */
    }
  }
  return undefined
}
