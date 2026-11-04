// /scifig 前缀 HTTP 路由（契约 §3.5）。全部 JSON 响应带 ok；异常一律捕获成 {ok:false,error}，不抛栈。
import { promises as fsp } from 'node:fs'
import { errText } from './util.js'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

// v5：拼接/合成/图库整体移除，旧客户端命中原端点时返回明确中文提示
const REMOVED_MESSAGE = {
  compose: '拼接功能已移除，请直接调整单张图',
  decompose: '拆分功能已移除，请直接调整单张图',
  library: '图库功能已移除，请直接调整单张图',
}

async function readFileSafe(filePath) {
  if (!filePath) return undefined
  try {
    return await fsp.readFile(filePath)
  } catch {
    return undefined
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload === undefined ? null : payload)
  res.writeHead(status, { ...JSON_HEADERS, 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

async function readBody(req, maxBytes = 2 * 1024 * 1024) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('请求体过大（>2MB）')
    chunks.push(chunk)
  }
  if (!chunks.length) return undefined
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`请求体不是合法 JSON：${errText(error)}`)
  }
}

function safeFilename(name) {
  const base = String(name || 'figure').replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80)
  return base || 'figure'
}

export function createHttpHandler({ ops, store }) {
  return async function scifigHttpHandler(req, res) {
    try {
      const url = new URL(req.url || '/scifig', 'http://127.0.0.1')
      const method = String(req.method || 'GET').toUpperCase()
      let route = url.pathname.replace(/^\/scifig(?=\/|$)/, '')
      route = route.replace(/\/+$/, '')
      if (!route) route = '/'

      // -------- 图片（PNG 字节） --------
      if (route === '/api/image' && (method === 'GET' || method === 'HEAD')) {
        const id = url.searchParams.get('id') || ''
        await store.ensureLoaded().catch(() => {})
        const figure = store.get(id)
        if (!figure) return sendJson(res, 404, { ok: false, error: `未找到图：${id}` })
        const bytes = await ops.readPng(figure)
        if (!bytes) return sendJson(res, 404, { ok: false, error: figure.error || 'PNG 尚未生成' })
        res.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'no-store, max-age=0',
          'content-length': bytes.length,
        })
        res.end(method === 'HEAD' ? undefined : bytes)
        return
      }

      // -------- v5：组件缩略图（拼接/图库功能已移除） --------
      if (route === '/api/thumb' && (method === 'GET' || method === 'HEAD')) {
        return sendJson(res, 200, { ok: false, error: REMOVED_MESSAGE.library })
      }

      // -------- 下载 --------
      if (route === '/api/download' && (method === 'GET' || method === 'HEAD')) {
        const id = url.searchParams.get('id') || ''
        await store.ensureLoaded().catch(() => {})
        const figure = store.get(id)
        if (!figure) return sendJson(res, 404, { ok: false, error: `未找到图：${id}` })
        const bytes = await ops.readPng(figure)
        if (!bytes) return sendJson(res, 404, { ok: false, error: figure.error || 'PNG 尚未生成' })
        const filename = `${safeFilename(figure.title || figure.id)}-r${figure.rev}.png`
        res.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'no-store',
          'content-length': bytes.length,
          'content-disposition': `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        })
        res.end(method === 'HEAD' ? undefined : bytes)
        return
      }

      // -------- JSON 端点 --------
      const body = await readBody(req)
      const payload = body && typeof body === 'object' ? body : {}
      const sessionId = payload.sessionId || url.searchParams.get('sessionId') || ''

      switch (`${method} ${route}`) {
        case 'GET /':
          return sendJson(res, 200, { ok: true, name: 'scifig', routes: listRoutes() })
        case 'GET /api/health':
          return sendJson(res, 200, await ops.health())
        case 'GET /api/state':
          return sendJson(
            res,
            200,
            await ops.state({
              sessionId,
              // 精确查单图：查不到就是 figure:null（只有完全不带 figureId 才回退当前/最近一张）
              figureId: url.searchParams.get('figureId') || undefined,
            }),
          )
        case 'GET /api/controls':
          return sendJson(res, 200, await ops.controlsPayload())
        case 'GET /api/palettes':
          return sendJson(res, 200, await ops.palettesPayload())
        case 'POST /api/patch':
          return sendJson(
            res,
            200,
            await ops.patch({
              figureId: payload.figureId,
              set: payload.set,
              unset: payload.unset,
              sessionId,
            }),
          )
        case 'POST /api/nl':
          return sendJson(res, 200, await ops.nl({ figureId: payload.figureId, text: payload.text, sessionId }))
        case 'POST /api/preset':
          return sendJson(
            res,
            200,
            await ops.preset({ figureId: payload.figureId, preset: payload.preset, sessionId }),
          )
        case 'POST /api/export':
          return sendJson(res, 200, await ops.exportFigure({ figureId: payload.figureId, sessionId }))
        case 'POST /api/active':
          return sendJson(res, 200, await ops.active({ figureId: payload.figureId, sessionId }))
        // v5：拼接/图库功能已移除（历史 compose 图仍可读，但不再提供创建/拆分/图库入口）
        case 'GET /api/library':
        case 'GET /api/component':
        case 'GET /api/thumb':
        case 'GET /api/component/thumb':
          return sendJson(res, 200, { ok: false, error: REMOVED_MESSAGE.library })
        case 'GET /api/code':
          return sendJson(res, 200, await ops.code({ id: url.searchParams.get('id') || '' }))
        case 'POST /api/compose':
          return sendJson(res, 200, { ok: false, error: REMOVED_MESSAGE.compose })
        case 'POST /api/decompose':
          return sendJson(res, 200, { ok: false, error: REMOVED_MESSAGE.decompose })
        case 'POST /api/component/patch':
          return sendJson(res, 200, { ok: false, error: REMOVED_MESSAGE.library })
        case 'GET /api/sessions':
          return sendJson(res, 200, await ops.sessions())
        case 'POST /api/workspace/delete':
          return sendJson(
            res,
            200,
            await ops.deleteWorkspace({
              mode: payload.mode,
              figureId: payload.figureId,
              sessionId: payload.sessionId,
              includeComponents: payload.includeComponents,
              deleteFiles: payload.deleteFiles,
              confirm: payload.confirm,
            }),
          )
        default:
          return sendJson(res, 404, { ok: false, error: `未知端点或方法：${method} ${url.pathname}` })
      }
    } catch (error) {
      try {
        sendJson(res, 200, { ok: false, error: `scifig 服务异常：${errText(error)}` })
      } catch {
        /* 响应已发出 */
      }
    }
  }
}

function listRoutes() {
  return [
    'GET /scifig/api/health',
    'GET /scifig/api/state?sessionId=',
    'GET /scifig/api/controls',
    'GET /scifig/api/palettes',
    'POST /scifig/api/patch',
    'POST /scifig/api/nl',
    'POST /scifig/api/preset',
    'GET /scifig/api/image?id=&rev=',
    'POST /scifig/api/export',
    'GET /scifig/api/download?id=&rev=',
    'POST /scifig/api/active',
    'GET /scifig/api/code?id=',
    'GET /scifig/api/sessions',
    'POST /scifig/api/workspace/delete',
  ]
}
