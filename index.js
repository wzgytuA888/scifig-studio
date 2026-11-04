// SciFigure Studio · Host entry (Cordis plugin)
// Provides: the `scifig` agent tool, the /scifig HTTP API, the figure registry,
// the render scheduler, Chinese NL parsing and the per-figure code artifacts.
// Rendering always goes through the Python CLI in py/scifig (single source of truth).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FigureStore } from './host/store.js'
import { RenderService } from './host/render.js'
import { ControlsService } from './host/controls.js'
import { ComponentLibrary } from './host/library.js'
import { Operations } from './host/ops.js'
import { createHttpHandler } from './host/api.js'
import { createTool } from './host/tool.js'

export const inject = ['tools', 'webServer', 'subprocess']

/** Local, git-ignored override file (so the repo stays portable). */
const LOCAL_CONFIG_FILE = '.scifig-config.json'

const SYSTEM_PROMPT_SECTION = [
  '用户需要给论文做图、画地图/研究区图、画统计图（柱状/折线/散点/热力/箱线）时，用 scifig 工具专注调整**单张图**：',
  '先 action:"draft"（带 dataFile 与 description）生成草图，再用 action:"patch"（spec 路径）或 action:"nl"（中文要求）迭代投影、配色、图例、字体、坐标轴等，action:"export" 导出。',
  '不提供拼接/合成/图库功能（compose/decompose/library 已移除，不要尝试）。删除工作区用 action:"delete"（mode=figure/session/all，all 需 confirm:true）。',
  '换配色用 set:{"style.palette":"ppt-03"}（内置配色；顺序/发散分别用 style.paletteSequential / style.paletteDiverging，地图色带用 map.colorbar.palette）；换投影用 set:{"map.projection":"mercator"}。',
  '每次生成后提醒用户：可以点击左侧任务栏的「科研制图」图标进入整页工作台，在那里实时调参、切换会话、切换配色与投影、查看与修改生成代码。',
].join('')

function readLocalConfig(bundleDir) {
  try {
    const raw = fs.readFileSync(path.join(bundleDir, LOCAL_CONFIG_FILE), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Resolve the Python executable, most specific first:
 * plugin config -> SCIFIG_PYTHON env -> .scifig-config.json -> bundle-local venv -> PATH.
 */
function resolvePython(cfg, bundleDir, local) {
  const explicit = [cfg.python, process.env.SCIFIG_PYTHON, local.python]
  for (const candidate of explicit) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  const venvCandidates = [
    path.join('.venv', 'Scripts', 'python.exe'),
    path.join('.venv', 'bin', 'python'),
    path.join('venv', 'Scripts', 'python.exe'),
    path.join('venv', 'bin', 'python'),
  ]
  for (const rel of venvCandidates) {
    const full = path.join(bundleDir, rel)
    if (fs.existsSync(full)) return full
  }
  return process.platform === 'win32' ? 'python.exe' : 'python3'
}

function resolveWorkDir(cfg, bundleDir, local) {
  const explicit = [cfg.workDir, process.env.SCIFIG_WORKDIR, local.workDir]
  for (const candidate of explicit) {
    if (typeof candidate === 'string' && candidate.trim()) return path.resolve(candidate.trim())
  }
  return path.join(bundleDir, 'out')
}

export function apply(ctx, config) {
  const cfg = config && typeof config === 'object' ? config : {}
  const bundleDir = path.dirname(fileURLToPath(import.meta.url))
  const workspaceRoot = path.dirname(bundleDir)
  const local = readLocalConfig(bundleDir)
  const python = resolvePython(cfg, bundleDir, local)
  const workDir = resolveWorkDir(cfg, bundleDir, local)
  const timeoutMs = Number(cfg.timeoutMs) > 0 ? Number(cfg.timeoutMs) : undefined
  const concurrency = Number(cfg.concurrency) > 0 ? Number(cfg.concurrency) : undefined

  const controls = new ControlsService({ bundleDir })
  const store = new FigureStore({ workDir })
  const library = new ComponentLibrary({ workDir, store, ctx })
  const renderer = new RenderService({
    ctx,
    python,
    workDir,
    bundleDir,
    store,
    controls,
    library,
    timeoutMs,
    concurrency,
  })
  const ops = new Operations({
    store,
    renderer,
    controls,
    library,
    python,
    workDir,
    bundleDir,
    workspaceRoot,
    ctx,
  })

  // /scifig/api/* prefix routes
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/scifig',
      handler: createHttpHandler({ ops, store }),
    }),
  )

  // Agent tool `scifig`
  ctx.effect(() => ctx.tools.register(createTool({ ops, ctx })))

  // system prompt fragment: when to use scifig and where the workbench lives (optional dependency)
  try {
    const systemPrompt = ctx.get?.('systemPrompt')
    if (systemPrompt?.section) {
      ctx.effect(() =>
        systemPrompt.section({
          name: 'scifig-studio',
          order: 850,
          text: SYSTEM_PROMPT_SECTION,
        }),
      )
    }
  } catch {
    /* fall back to the tool description when systemPrompt is unavailable */
  }

  // Warm the figure registry / component dir and drop orphaned components (best effort)
  void store
    .ensureLoaded()
    .then(() => library.ensureLoaded())
    .then(() => ops.cleanupOrphans())
    .catch(() => {})
}
