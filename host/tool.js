// Agent 工具 `scifig`（契约 §3.6 + §7.5 + §8.4 + v5 单图化）：所有 action 都走 Operations 的共享实现（与 HTTP 端点同源）。
import { promises as fsp } from 'node:fs'

const ACTIONS = ['draft', 'patch', 'nl', 'state', 'export', 'list', 'code', 'delete']

// v5：拼接/拆分/图库功能已移除；老调用方误用时给明确中文提示，不暴露 schema。
const REMOVED_ACTIONS = {
  compose: '拼接功能已移除，请直接调整单张图',
  decompose: '拆分功能已移除，请直接调整单张图',
  library: '图库功能已移除，请直接调整单张图',
}

const DESCRIPTION = [
  '科研制图工具（SciFigure Studio）：生成并调整单张 SCI 论文配图，在「科研制图工作台」里迭代调参。',
  '触发场景：用户要画论文配图/科研图/示意图，包括地图、研究区图、空间分布图、区位图、中国地图，',
  '以及柱状图、折线图、时间序列、散点图、热力图、箱线图；不提供拼接/合成/图库功能。',
  'action 用法：',
  '"draft" 用 dataFile + description 生成草图（description 写清画什么/标题/单位/要显示哪些要素/目标图型与期刊）；',
  '"patch" 用 set（spec 路径→值）精调，或 customPatch（Python 代码）做参数表达不了的定制；',
  '"nl" 用中文自然语言改图（如"换成墨卡托投影，用第3套配色"）；"state" 看当前图；"export" 导出 PNG；',
  '"list" 列出本任务的图；"code" 取某张图的可独立运行 Python 代码；',
  '"delete" 删除工作区（mode=figure/session/all；mode=all 必须 confirm:true）。',
  '换配色用 set:{"style.palette":"ppt-03"}（PPT 提取的配色；顺序/发散分别用 style.paletteSequential / style.paletteDiverging，地图色带用 map.colorbar.palette）；',
  '换投影用 set:{"map.projection":"mercator"}（可选 platecarree/mercator/miller/lambert/albers/robinson/mollweide/equalearth/orthographic/azimuthal/northpolarstereo）；',
  'draft 时用户说"参考我的PPT配色"会自动用 ppt-01。',
  '生成后告诉用户：可点左侧任务栏的「科研制图」图标进入整页工作台实时调参。',
].join('')

export function createTool(deps) {
  const { ops, ctx } = deps
  const tool = {
    name: 'scifig',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description:
            'draft=生成草图；patch=按 spec 路径改；nl=中文自然语言改；state=当前图；export=导出；list=图列表；code=取代码；delete=删除工作区',
        },
        description: {
          type: 'string',
          description:
            'draft 用：画什么、标题、单位、要显示哪些要素、目标图型/期刊。例如"研究区区位图，标注省界与流域边界，标题写研究区概况，双栏宽"',
        },
        dataFile: {
          type: 'string',
          description: '数据文件路径（csv/tsv/xlsx/geojson），绝对路径或相对工作区',
        },
        kind: {
          type: 'string',
          enum: ['map', 'line', 'bar', 'scatter', 'heatmap', 'box'],
          description: '图型；缺省按 description 关键词与数据列自动推断',
        },
        set: {
          type: 'object',
          description: 'spec 路径→值 的补丁对象，路径用点号（如 {"legend.position":"lower right","figure.dpi":600}）',
          additionalProperties: true,
        },
        text: { type: 'string', description: 'nl 用：中文自然语言需求' },
        figureId: { type: 'string', description: '目标图 id；缺省用当前 session 的当前图' },
        sessionId: { type: 'string', description: '会话 id；通常不用填，默认取当前 agent 的 session' },
        componentId: { type: 'string', description: 'code 用：可选的组件 id（一般用 figureId 即可）' },
        customPatch: {
          type: 'string',
          description:
            'Python 代码片段，在面板绘制完成后执行（可用 fig/axes/ax/np/plt/mpl/spec），用于加参考线、箭头、任意注记等参数表达不了的定制',
        },
        mode: {
          type: 'string',
          enum: ['figure', 'session', 'all'],
          description: 'delete 用：figure=删单图；session=删该会话全部图；all=清空全部工作区（必须 confirm:true）',
        },
        confirm: {
          type: 'boolean',
          description: 'delete 用：mode:"all" 时必须传 true 才执行；其它模式可省略',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          text: { type: 'string', description: '给模型看的简洁结论' },
          figureId: { type: 'string' },
          componentId: { type: 'string' },
          pngPath: { type: 'string' },
          imageUrl: { type: 'string' },
          rev: { type: 'number' },
          warnings: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
          attachment: { type: 'object' },
          deleted: { type: 'object' },
          remaining: { type: 'object' },
          willDelete: { type: 'object' },
          autoAdjust: { type: 'array' },
          mode: { type: 'string' },
          needsConfirm: { type: 'boolean' },
        },
        required: ['ok', 'action', 'text'],
        additionalProperties: true,
      },
      render(_args, value) {
        const blocks = [{ type: 'text', text: String(value?.text ?? '') }]
        if (value?.attachment?.attachmentId) {
          blocks.push({ type: 'image', attachment: value.attachment })
        }
        return blocks
      },
    },
    async execute(args, exec) {
      return runAction({ ops, ctx, args: args || {}, exec })
    },
  }
  return tool
}

async function runAction({ ops, ctx, args, exec }) {
  const action = String(args.action || '').trim()
  const sessionId = String(args.sessionId || exec?.agent?.id || '')
  if (REMOVED_ACTIONS[action]) {
    const message = REMOVED_ACTIONS[action]
    return { ok: false, action, removed: true, error: message, text: `该功能已移除：${message}` }
  }
  if (!ACTIONS.includes(action)) {
    return { ok: false, action, text: `未知 action：${action}（可用：${ACTIONS.join('/')}）` }
  }

  let result
  try {
    result = await dispatch({ ops, action, args, sessionId })
  } catch (error) {
    result = { ok: false, error: `scifig ${action} 失败：${error?.message || error}` }
  }
  if (!result || typeof result !== 'object') result = { ok: false, error: '内部错误：无返回' }

  const text = formatResult(action, result)
  const payload = buildPayload(action, result, text)
  const attachment = await attachPng(ctx, result)
  if (attachment) payload.attachment = attachment
  return payload
}

async function dispatch({ ops, action, args, sessionId }) {
  switch (action) {
    case 'draft':
      return ops.draft({
        description: args.description,
        dataFile: args.dataFile,
        kind: args.kind,
        sessionId,
      })
    case 'patch': {
      if (args.componentId && !args.figureId) {
        return { ok: false, error: '图库/拼接功能已移除，请直接用 figureId、通过 set 调整单张图' }
      }
      return ops.patch({
        figureId: args.figureId,
        set: args.set,
        customPatch: args.customPatch,
        sessionId,
      })
    }
    case 'nl':
      return ops.nl({ figureId: args.figureId, text: args.text, sessionId })
    case 'state':
      return ops.state({ sessionId, figureId: args.figureId })
    case 'export':
      return ops.exportFigure({ figureId: args.figureId, sessionId })
    case 'list':
      return ops.list({ sessionId })
    case 'code':
      return ops.code({ id: args.componentId || args.figureId })
    case 'delete': {
      // mode:"all" 的 confirm 校验在 Operations.deleteWorkspace 里（HTTP 与工具同一实现）
      return ops.deleteWorkspace({
        mode: String(args.mode || '').trim(),
        figureId: args.figureId,
        sessionId: args.sessionId || sessionId,
        includeComponents: args.includeComponents,
        deleteFiles: args.deleteFiles,
        confirm: args.confirm,
      })
    }
    default:
      return { ok: false, error: `未知 action：${action}` }
  }
}

// ---------------------------------------------------------------------------
// 文本小结（给模型，<15 行）
// ---------------------------------------------------------------------------

function oneLine(text, max = 46) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function specSize(result) {
  const spec = result?.figure?.spec
  const figure = spec?.figure || {}
  const widthMm = Number(figure.widthMm)
  const heightMm = Number(figure.heightMm)
  const dpi = Number(figure.dpi)
  const parts = []
  if (Number.isFinite(widthMm) && Number.isFinite(heightMm)) parts.push(`${widthMm}×${heightMm}mm`)
  if (Number.isFinite(dpi)) parts.push(`${dpi}dpi`)
  return parts.join(' · ')
}

function warningLine(warnings) {
  const list = Array.isArray(warnings) ? warnings.filter(Boolean) : []
  if (!list.length) return '警告: 无'
  const shown = list.slice(0, 3).map((warning) => oneLine(warning, 40))
  const more = list.length > 3 ? ` 等 ${list.length} 条` : ''
  return `警告: ${shown.join('；')}${more}`
}

/**
 * 引擎自动优化（autoAdjust）与 warnings 分开显示：用一句话收尾，不吓用户、不算警告。
 */
function autoAdjustLine(result) {
  const list = result?.figure?.autoAdjust ?? result?.autoAdjust
  if (!Array.isArray(list) || !list.length) return ''
  const messages = list.map((item) => (item && typeof item === 'object' ? item.message : '')).filter(Boolean)
  if (messages.length) return `已自动优化: ${oneLine(messages.slice(0, 2).join('；'), 80)}`
  return `已自动优化 ${list.length} 项（引擎按范围/投影自动对齐）`
}

function nextStepHint(result) {
  const figureId = result?.figureId || result?.figure?.id
  if (!figureId) return ''
  return `下一步: 点左侧任务栏「科研制图」进整页工作台调参；或 scifig{action:"patch",figureId:"${figureId}",set:{"legend.position":"lower right"}}`
}

function formatResult(action, result) {
  if (result.ok === false && result.error && !result.figureId && !result.figure) {
    return `未完成：${oneLine(result.error, 120)}`
  }
  switch (action) {
    case 'draft': {
      const lines = []
      lines.push(`草图已生成：${oneLine(result.title || '未命名', 40)}`)
      lines.push(`figureId: ${result.figureId}${result.componentId ? `（组件 ${result.componentId}）` : ''}`)
      lines.push(`PNG: ${result.pngPath}`)
      const size = specSize(result)
      lines.push(`规格: ${result.kind || result.figure?.kind || '?'}${size ? ` · ${size}` : ''} · rev ${result.revision ?? result.figure?.rev ?? 0}`)
      if (result.descriptionApplied?.length) {
        const applied = result.descriptionApplied.slice(0, 4).map((item) => `${item.path}=${JSON.stringify(item.value)}`)
        lines.push(`按描述设置: ${applied.join('，')}`)
      }
      lines.push(warningLine(result.warnings))
      { const adjust = autoAdjustLine(result); if (adjust) lines.push(adjust) }
      if (result.error) lines.push(`渲染错误: ${oneLine(result.error, 80)}`)
      const hint = nextStepHint(result)
      if (hint) lines.push(hint)
      return lines.join('\n')
    }
    case 'patch':
    case 'componentPatch': {
      const lines = []
      const rev = result.figure?.rev
      lines.push(result.ok ? `已更新并重绘（rev ${rev ?? '?'}）` : `更新未完全成功：${oneLine(result.error || '未知错误', 80)}`)
      if (result.applied?.length) lines.push(`已应用: ${result.applied.map((item) => `${item.path}=${JSON.stringify(item.value)}`).join('，')}`)
      if (result.rejected?.length) lines.push(`被拒绝: ${result.rejected.map((item) => `${item.path}(${item.reason})`).join('，')}`)
      if (result.component?.componentId) lines.push(`组件: ${result.component.componentId}`)
      if (result.cascaded?.length) lines.push(`级联重绘: ${result.cascaded.map((item) => item.figureId).join('，')}`)
      lines.push(warningLine(result.warnings || result.figure?.warnings))
      { const adjust = autoAdjustLine(result); if (adjust) lines.push(adjust) }
      return lines.join('\n')
    }
    case 'nl': {
      const lines = []
      if (result.applied?.length) {
        lines.push(`已应用 ${result.applied.length} 条：${result.applied.map((item) => `${item.labelZh}→${JSON.stringify(item.value)}`).join('，')}`)
      } else {
        lines.push(`未应用：${oneLine(result.error || '没有识别出可修改的参数', 100)}`)
      }
      if (result.unapplied?.length) lines.push(`未识别: ${result.unapplied.map((text) => oneLine(text, 30)).join('；')}`)
      if (result.figure?.rev !== undefined) lines.push(`当前 rev: ${result.figure.rev}`)
      lines.push(warningLine(result.warnings || result.figure?.warnings))
      { const adjust = autoAdjustLine(result); if (adjust) lines.push(adjust) }
      return lines.join('\n')
    }
    case 'state': {
      const figure = result.figure
      if (!figure) return '当前还没有图。用 action:"draft" 生成草图。'
      const lines = [
        `当前图: ${oneLine(figure.title || figure.id, 40)}`,
        `figureId: ${figure.id} · ${figure.kind} · rev ${figure.rev}`,
        `PNG: ${figure.pngPath}`,
        warningLine(figure.warnings),
        `本任务共 ${result.figures?.length ?? 0} 张图`,
      ]
      return lines.join('\n')
    }
    case 'export': {
      if (!result.ok) return `导出失败：${oneLine(result.error || '未知错误', 100)}`
      const kb = Math.max(1, Math.round((result.bytes || 0) / 1024))
      return `已导出: ${result.path}\n大小: ${kb} KB · ${result.widthMm ?? '?'}×${result.heightMm ?? '?'}mm · ${result.dpi ?? '?'}dpi`
    }
    case 'list': {
      const figures = result.figures || []
      if (!figures.length) return '本任务还没有图。'
      const lines = [`共 ${figures.length} 张图：`]
      for (const figure of figures.slice(0, 8)) lines.push(`- ${figure.id} · ${figure.kind} · ${oneLine(figure.title, 30)} · rev ${figure.rev}`)
      if (figures.length > 8) lines.push(`…还有 ${figures.length - 8} 张`)
      return lines.join('\n')
    }
    case 'code': {
      if (!result.ok) return `取代码失败：${oneLine(result.error, 100)}`
      const code = String(result.code || '')
      const lines = code.split('\n')
      const shown = lines.slice(0, 220).join('\n')
      const truncated = lines.length > 220 ? `\n# …（已截断，共 ${lines.length} 行，完整代码见 ${result.path}）` : ''
      return `代码: ${result.path}（${lines.length} 行）\n\`\`\`python\n${shown}${truncated}\n\`\`\``
    }
    case 'delete': {
      if (result.ok !== true) {
        if (result.needsConfirm) {
          const will = result.willDelete || {}
          const counts =
            result.willDelete !== undefined
              ? `（将删除 图 ${will.figures ?? 0} 张 / 组件 ${will.components ?? 0} 个）`
              : ''
          return `需要确认：${oneLine(result.error || '删除全部工作区需要 confirm:true', 120)}${counts}\n如果用户确实要清空，请带 confirm:true 再调用。`
        }
        return `删除失败：${oneLine(result.error || '未知错误', 120)}`
      }
      const deleted = result.deleted || {}
      const remaining = result.remaining || {}
      const modeText = { figure: '删除当前图', session: '删除当前会话', all: '清空全部工作区' }[result.mode] || result.mode
      const lines = [
        `${modeText}完成`,
        `已删除: 图 ${deleted.figures ?? 0} 张 · 组件 ${deleted.components ?? 0} 个 · 文件 ${deleted.files ?? 0} 个${deleted.composites ? ` · 级联合成图 ${deleted.composites} 张` : ''}`,
        `剩余: 图 ${remaining.figures ?? 0} 张 · 组件 ${remaining.components ?? 0} 个`,
      ]
      if (Array.isArray(result.orphansCleaned) && result.orphansCleaned.length) lines.push(`顺带清理孤儿组件: ${result.orphansCleaned.join('，')}`)
      if (Array.isArray(result.warnings) && result.warnings.length) lines.push(warningLine(result.warnings))
      return lines.join('\n')
    }
    default:
      return JSON.stringify(result).slice(0, 1500)
  }
}

/** 工具返回值：只保留稳定/结构化字段（不含完整 spec，避免会话日志膨胀）。 */
function buildPayload(action, result, text) {
  const payload = { ok: result.ok === true, action, text }
  const figure = result.figure
  const figureId = result.figureId || figure?.id
  if (figureId) payload.figureId = figureId
  const componentId = result.componentId || result.component?.componentId
  if (componentId) payload.componentId = componentId
  if (result.pngPath) payload.pngPath = result.pngPath
  else if (figure?.pngPath) payload.pngPath = figure.pngPath
  const imageUrl = result.imageUrl || figure?.imageUrl
  if (imageUrl) payload.imageUrl = imageUrl
  const rev = result.revision ?? result.figure?.rev
  if (rev !== undefined) payload.rev = rev
  const warnings = result.warnings || figure?.warnings
  if (Array.isArray(warnings) && warnings.length) payload.warnings = warnings
  const autoAdjust = figure?.autoAdjust ?? result.autoAdjust
  if (Array.isArray(autoAdjust) && autoAdjust.length) payload.autoAdjust = autoAdjust
  if (result.error) payload.error = String(result.error)
  if (action === 'export') {
    payload.exportPath = result.path
    payload.bytes = result.bytes
  }
  if (action === 'delete') {
    payload.deleted = result.deleted
    payload.remaining = result.remaining
    payload.mode = result.mode
    if (result.needsConfirm) payload.needsConfirm = true
    if (result.willDelete !== undefined) payload.willDelete = result.willDelete
    if (Array.isArray(result.orphansCleaned) && result.orphansCleaned.length) payload.orphansCleaned = result.orphansCleaned
  }
  return payload
}

/** 把 PNG 存成附件，工具结果里可直接给模型看图（附件服务不可用时静默跳过）。 */
async function attachPng(ctx, result) {
  try {
    const attachments = ctx?.get?.('attachments')
    if (!attachments?.saveImage) return undefined
    const pngPath = result?.pngPath || result?.figure?.pngPath || result?.figure?.pngPath
    if (!pngPath) return undefined
    const data = await fsp.readFile(pngPath)
    const limits = attachments.imageLimits
    if (limits?.maxImageBytes && data.length > limits.maxImageBytes) return undefined
    const ref = await attachments.saveImage({
      data: new Uint8Array(data),
      mediaType: 'image/png',
      name: `${result?.figureId || result?.figure?.id || 'scifig'}.png`,
    })
    return ref
  } catch {
    return undefined
  }
}

export { ACTIONS }
