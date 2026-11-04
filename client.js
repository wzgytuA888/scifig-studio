/**
 * SciFigure Studio · Client half (browser bundle) · v3
 * ---------------------------------------------------------------------------
 * 科研制图工作台（v3 改版，契约 docs/CONTRACT.md §8）：
 *   sidebar.panellist  id=scifig 「科研制图」图标 → 左侧任务栏入口
 *   main               key=scifig             → 覆盖对话的整页三栏工作台
 *   tool.call.toolview key=scifig             → 工具卡「打开工作台」
 *
 * 数据全部走同源 HTTP（`/scifig/api/*`），不 import 任何 `@deepseek-ai/*` 包，
 * 只 require('react')；颜色一律使用 `--dsw-alias-*` 主题 token。
 */
window.__ModuleLoader__.load({
	id: 'dsh-scifig-studio',
	factory(require) {
		'use strict';

		const React = require('react');
		const h = React.createElement;

		/** client locale 命名空间。 */
		const NS = 'scifig';
		/** 后端 API 前缀（同源）。 */
		const API = '/scifig/api';
		/** 侧栏入口 id 与 main 面板 key 必须一致（契约 §8.1）。 */
		const PANEL_ID = 'scifig';
		const TOOL_KEY = 'scifig';
		/** 会话切换下拉里「全部任务」的取值。 */
		const ALL_TASKS = '__all__';

		/* =====================================================================
		 * 文案（中文优先；注册到 client locale，服务缺失时退化为本地常量）
		 * ===================================================================== */
		const DICT = {
			zh: {
				panelLabel: '科研制图',
				workspaceTitle: '科研制图工作台',
				backendOk: '后端正常',
				backendUnready: '工作台后端未就绪',
				backendHint: '请确认 scifig-studio 插件已启用，且 Python 渲染器可用。',
				loading: '加载中…',
				retry: '重试',
				networkError: '无法连接工作台后端',
				timeoutError: '请求超时，请重试',
				badResponse: '后端返回了无法解析的响应',
				dismiss: '关闭提示',
				close: '关闭',
				refresh: '刷新',
				stateFailed: '读取图状态失败',
				controlsFailed: '读取工具清单失败（可先用自然语言调整）',
				switchFailed: '切换图失败',
				patchFailed: '工具项未保存',
				historyFailed: '撤销/重做失败',
				presetFailed: '切换期刊风格失败',
				sessionSwitcher: '会话',
				allTasks: '全部任务',
				sessionsLabel: '会话与图',
				sessionsLoading: '正在加载会话…',
				sessionsFailed: '会话列表加载失败',
				sessionsEmpty: '还没有任何图',
				sessionsEmptyHint: '在对话里生成一张图',
				sessionsBackendUnready: '会话列表后端未就绪',
				sessionUntitled: '未命名会话',
				figuresCount: '{n} 张图',
				noFigure: '未选择图',
				selectFigureHint: '从左栏选择一张图，或在上方切换会话。',
				figuresLabel: '图列表',
				previewEmpty: '暂无图像',
				previewFailed: '图像加载失败',
				rendering: '渲染中…',
				repainting: '正在重绘…',
				download: '下载 PNG',
				expandImage: '放大查看',
				undo: '撤销',
				redo: '重做',
				rev: '修订',
				copyPngPath: '复制 PNG 路径',
				pngPathCopied: '已复制 PNG 路径',
				pngPathCopyFailed: '无法复制，路径：',
				noPngPath: 'PNG 路径尚未生成',
				figureError: '渲染失败',
				warningsLabel: '警告',
				partialApplied: '部分工具项未生效',
				exportPng: '导出 PNG',
				exporting: '导出中…',
				exportDone: '已导出 PNG',
				exportFailed: '导出失败',
				deleteWorkspace: '删除工作区',
				deleteFigure: '删除当前图',
				deleteSession: '删除当前会话全部图',
				deleteAll: '删除全部工作区',
				deleteConfirmTitle: '确认删除',
				deleteCancel: '取消',
				deleteConfirm: '确认删除',
				deleting: '正在删除…',
				deleteFailed: '删除失败',
				deleteFigureConfirm: '将删除当前图「{title}」及其导出文件，无法撤销。',
				deleteSessionConfirm: '将删除会话「{title}」下全部 {n} 张图及其导出文件，无法撤销。',
				deleteAllConfirm: '将删除全部 {n} 张图与导出文件（保留 _selftest 自测产物），无法撤销。',
				deleteDone: '已删除：图 {figures} · 文件 {files}；剩余 图 {remainingFigures}',
				deleteNoFigure: '当前没有可删除的图',
				deleteNoSession: '请先选择会话',
				showParams: '显示工具区',
				hideParams: '隐藏工具区',
				tabPreview: '预览',
				tabCode: '代码',
				presets: '期刊风格',
				searchPlaceholder: '搜索工具，如「图例」「字号」',
				searchEmpty: '没有匹配的工具',
				levelBasic: '基础',
				levelAll: '全部',
				advancedTag: '高级',
				noControls: '工具清单为空（渲染器可能未就绪）',
				toolsTitle: '工具区',
				toolsAll: '全部工具',
				toolsEmptyFiltered: '当前图类没有匹配的工具，可打开「全部工具」或清除搜索。',
				classMap: '地图',
				classChart: '统计图',
				classGeneral: '通用',
				classCapsMap: '投影 / 范围 / 经纬网 / 色带 / 比例尺 / 指北针 / 图层',
				classCapsChart: '坐标轴 / 图例 / 线型标记 / 拟合 / 分组堆叠 / 标注',
				classCapsGeneral: '画幅 / 期刊风格 / 字体 / 标题 / 配色',
				sectionMap: '地图工具',
				sectionChart: '统计图工具',
				sectionAll: '通用',
				projectionTitle: '投影',
				projectionAll: '全部投影',
				centralLongitude: '中央经线',
				standardParallels: '标准纬线',
				degreeUnit: '°',
				projPlateCarree: '等经纬',
				projMercator: '墨卡托',
				projLambert: '兰伯特',
				projAlbers: '阿尔伯斯',
				projRobinson: '罗宾逊',
				projEqualEarth: '等地球',
				paletteTitle: '配色',
				paletteTabCategorical: '分类',
				paletteTabSequential: '顺序',
				paletteTabDiverging: '发散',
				paletteTabColorbar: '色带',
				paletteCurrent: '当前配色',
				paletteDefault: '默认',
				paletteSearch: '搜索配色（名称 / 色值）',
				paletteLoading: '正在加载配色…',
				paletteFailed: '配色数据未就绪（/api/palettes 不可用）',
				paletteEmpty: '没有匹配的配色',
				paletteReuse: '参考图中 {n} 张使用',
				paletteColorbarTitle: '色带配色',
				nlTitle: '一句话改图',
				nlPlaceholder: '例：图例放右下角，字号调到 8',
				nlEnterHint: 'Enter 应用，Shift+Enter 换行',
				autoAdjustMore: '详情',
				autoAdjustLess: '收起',
				nlApply: '应用',
				nlApplying: '解析中…',
				nlApplied: '已应用',
				nlUnapplied: '未识别',
				nlEmpty: '请先输入需求',
				nlFailed: '自然语言解析失败',
				nlNoChange: '没有识别到可应用的改动',
				codeTitle: '生成代码',
				codeLoading: '正在读取代码…',
				codeFailed: '读取代码失败',
				codeEmpty: '暂无代码',
				codeCopy: '复制',
				codeCopied: '已复制',
				codeCopyFailed: '复制失败，请手动选择文本',
				codeDownload: '下载 .py',
				codePathLabel: '脚本路径',
				kindMap: '地图',
				kindLine: '折线图',
				kindBar: '柱状图',
				kindScatter: '散点图',
				kindHeatmap: '热力图',
				kindBox: '箱线图',
				kindOther: '图',
				toolTitle: '科研绘图',
				toolNoFigure: '还没有生成图像',
				toolOpen: '打开工作台',
				openWorkbench: '打开工作台',
				statusPreparing: '准备中',
				statusRunning: '生成中',
				statusOk: '已完成',
				statusError: '失败',
			},
			en: {
				panelLabel: 'Figure studio',
				workspaceTitle: 'Figure workbench',
				backendOk: 'Backend ready',
				backendUnready: 'Workbench backend is not ready',
				backendHint: 'Check that the scifig-studio plugin is enabled and the Python renderer is available.',
				loading: 'Loading…',
				retry: 'Retry',
				networkError: 'Cannot reach the workbench backend',
				timeoutError: 'Request timed out, please retry',
				badResponse: 'The backend returned an unreadable response',
				dismiss: 'Dismiss',
				close: 'Close',
				refresh: 'Refresh',
				stateFailed: 'Failed to read figure state',
				controlsFailed: 'Failed to read the tool list',
				switchFailed: 'Failed to switch figure',
				patchFailed: 'Tools were not saved',
				historyFailed: 'Undo/redo failed',
				presetFailed: 'Failed to switch style preset',
				sessionSwitcher: 'Session',
				allTasks: 'All tasks',
				sessionsLabel: 'Sessions and figures',
				sessionsLoading: 'Loading sessions…',
				sessionsFailed: 'Failed to load sessions',
				sessionsEmpty: 'No figures yet',
				sessionsEmptyHint: 'Draft a figure in the conversation',
				sessionsBackendUnready: 'Sessions backend is not ready',
				sessionUntitled: 'Untitled session',
				figuresCount: '{n} figures',
				noFigure: 'No figure selected',
				selectFigureHint: 'Pick a figure on the left, or switch session above.',
				figuresLabel: 'Figures',
				previewEmpty: 'No image yet',
				previewFailed: 'Image failed to load',
				rendering: 'Rendering…',
				repainting: 'Repainting…',
				download: 'Download PNG',
				expandImage: 'Zoom in',
				undo: 'Undo',
				redo: 'Redo',
				rev: 'rev',
				copyPngPath: 'Copy PNG path',
				pngPathCopied: 'PNG path copied',
				pngPathCopyFailed: 'Copy failed, path:',
				noPngPath: 'PNG path is not ready yet',
				figureError: 'Render failed',
				warningsLabel: 'Warnings',
				partialApplied: 'Some tools were not applied',
				exportPng: 'Export PNG',
				exporting: 'Exporting…',
				exportDone: 'PNG exported',
				exportFailed: 'Export failed',
				deleteWorkspace: 'Delete workspace',
				deleteFigure: 'Delete current figure',
				deleteSession: 'Delete all figures in session',
				deleteAll: 'Delete entire workspace',
				deleteConfirmTitle: 'Confirm deletion',
				deleteCancel: 'Cancel',
				deleteConfirm: 'Delete',
				deleting: 'Deleting…',
				deleteFailed: 'Delete failed',
				deleteFigureConfirm: 'Delete the current figure "{title}" and its exported files. This cannot be undone.',
				deleteSessionConfirm: 'Delete all {n} figures of session "{title}" and their exported files. This cannot be undone.',
				deleteAllConfirm: 'Delete all {n} figures and exported files (the _selftest folder is kept). This cannot be undone.',
				deleteDone: 'Deleted: {figures} figures · {files} files; remaining {remainingFigures} figures',
				deleteNoFigure: 'No figure to delete',
				deleteNoSession: 'Select a session first',
				showParams: 'Show tools',
				hideParams: 'Hide tools',
				tabPreview: 'Preview',
				tabCode: 'Code',
				presets: 'Journal style',
				searchPlaceholder: 'Search tools',
				searchEmpty: 'No matching tools',
				levelBasic: 'Basic',
				levelAll: 'All',
				advancedTag: 'Advanced',
				noControls: 'The tool list is empty (renderer may be unavailable)',
				toolsTitle: 'Tools',
				toolsAll: 'All tools',
				toolsEmptyFiltered: 'No matching tools for this figure class; enable All tools or clear the search.',
				classMap: 'Map',
				classChart: 'Statistical chart',
				classGeneral: 'General',
				classCapsMap: 'projection / extent / graticule / colorbar / scale bar / north arrow / layers',
				classCapsChart: 'axes / legend / lines & markers / fit / grouping / annotations',
				classCapsGeneral: 'canvas / journal style / fonts / title / palettes',
				sectionMap: 'Map tools',
				sectionChart: 'Chart tools',
				sectionAll: 'General',
				projectionTitle: 'Projection',
				projectionAll: 'All projections',
				centralLongitude: 'Central meridian',
				standardParallels: 'Standard parallels',
				degreeUnit: '°',
				projPlateCarree: 'Equirectangular',
				projMercator: 'Mercator',
				projLambert: 'Lambert',
				projAlbers: 'Albers',
				projRobinson: 'Robinson',
				projEqualEarth: 'Equal Earth',
				paletteTitle: 'Palettes',
				paletteTabCategorical: 'Categorical',
				paletteTabSequential: 'Sequential',
				paletteTabDiverging: 'Diverging',
				paletteTabColorbar: 'Colorbar',
				paletteCurrent: 'Current palette',
				paletteDefault: 'Default',
				paletteSearch: 'Search palettes (name / color)',
				paletteLoading: 'Loading palettes…',
				paletteFailed: 'Palette data is not ready (/api/palettes unavailable)',
				paletteEmpty: 'No matching palettes',
				paletteReuse: 'Used in {n} reference charts',
				paletteColorbarTitle: 'Colorbar palette',
				nlTitle: 'Rewrite in one sentence',
				nlPlaceholder: 'e.g. legend at lower right, font size 8',
				nlEnterHint: 'Enter to apply, Shift+Enter for a new line',
				autoAdjustMore: 'Details',
				autoAdjustLess: 'Hide',
				nlApply: 'Apply',
				nlApplying: 'Parsing…',
				nlApplied: 'Applied',
				nlUnapplied: 'Not understood',
				nlEmpty: 'Enter a request first',
				nlFailed: 'Natural-language parsing failed',
				nlNoChange: 'No applicable change was recognised',
				codeTitle: 'Generated code',
				codeLoading: 'Reading code…',
				codeFailed: 'Failed to read code',
				codeEmpty: 'No code yet',
				codeCopy: 'Copy',
				codeCopied: 'Copied',
				codeCopyFailed: 'Copy failed, please select the text manually',
				codeDownload: 'Download .py',
				codePathLabel: 'Script path',
				kindMap: 'Map',
				kindLine: 'Line',
				kindBar: 'Bar',
				kindScatter: 'Scatter',
				kindHeatmap: 'Heatmap',
				kindBox: 'Box',
				kindOther: 'Figure',
				toolTitle: 'Scientific figure',
				toolNoFigure: 'No figure yet',
				toolOpen: 'Open workbench',
				openWorkbench: 'Open workbench',
				statusPreparing: 'Preparing',
				statusRunning: 'Rendering',
				statusOk: 'Done',
				statusError: 'Failed',
			},
		};

		function fallbackTranslate(key, params) {
			const raw = DICT.zh[key] !== undefined ? DICT.zh[key] : DICT.en[key] !== undefined ? DICT.en[key] : key;
			if (!params) return raw;
			return String(raw).replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
		}
		let translate = fallbackTranslate;
		function tr(key, params) {
			try {
				return translate(key, params);
			} catch (error) {
				return fallbackTranslate(key, params);
			}
		}

		/* =====================================================================
		 * 模块级 store：记录「当前会话 / 当前图 / 待聚焦请求」
		 * ===================================================================== */
		function createWorkbenchStore() {
			let snapshot = Object.freeze({ sessionId: null, figureId: null, focusSeq: 0, selectSeq: 0 });
			const listeners = new Set();
			function emit() {
				for (const listener of Array.from(listeners)) {
					try {
						listener();
					} catch (error) {
						console.error('[scifig] store listener failed', error);
					}
				}
			}
			function commit(next) {
				snapshot = Object.freeze(next);
				emit();
			}
			return {
				getSnapshot() {
					return snapshot;
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				/** 用户在工作台里选中的会话/图（重挂载后恢复）。 */
				select(sessionId, figureId) {
					commit({
						sessionId: sessionId === undefined ? null : sessionId,
						figureId: figureId === undefined ? null : figureId,
						focusSeq: snapshot.focusSeq,
						selectSeq: snapshot.selectSeq + 1,
					});
				},
				/** 工具卡请求：打开整页工作台并定位到某个 figure / session。 */
				focus(sessionId, figureId) {
					commit({
						sessionId: sessionId === undefined ? snapshot.sessionId : sessionId,
						figureId: figureId === undefined ? null : figureId,
						focusSeq: snapshot.focusSeq + 1,
						selectSeq: snapshot.selectSeq + 1,
					});
				},
			};
		}
		const workbenchStore = createWorkbenchStore();
		let workbenchCtx = null;

		/** 工具卡点击：记录聚焦目标并切到整页工作台（layout.selectPanel）。 */
		function openWorkbenchPanel(sessionId, figureId) {
			try {
				workbenchStore.focus(sessionId === undefined ? null : sessionId, figureId === undefined ? null : figureId);
			} catch (error) {
				console.error('[scifig] cannot record focus', error);
			}
			try {
				const ctx = workbenchCtx;
				const layout = ctx && typeof ctx.get === 'function' ? ctx.get('layout') : undefined;
				if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID);
				else console.warn('[scifig] layout.selectPanel unavailable; open 科研制图 from the sidebar');
			} catch (error) {
				console.error('[scifig] cannot select panel', error);
			}
		}

		/** 读取当前对话（main view）的 sessionId；shape 不确定时逐级降级。 */
		function readCurrentSessionId(ctx) {
			try {
				const uiSession = ctx && typeof ctx.get === 'function' ? ctx.get('uiSession') : undefined;
				const current = uiSession && uiSession.current && typeof uiSession.current.getSnapshot === 'function' ? uiSession.current.getSnapshot() : null;
				if (current && typeof current.key === 'string' && current.key) return current.key;
				if (current && typeof current.sessionId === 'string' && current.sessionId) return current.sessionId;
			} catch (error) {
				/* ignore */
			}
			try {
				const sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : undefined;
				const list = sessions && sessions.list && typeof sessions.list.getSnapshot === 'function' ? sessions.list.getSnapshot() : null;
				if (list && list.byId && typeof list.byId === 'object') {
					const values = Object.values(list.byId);
					const hinted = values.find((entry) => entry && entry.retainedBy && (entry.retainedBy.mainView || 0) > 0);
					if (hinted && typeof hinted.id === 'string' && hinted.id) return hinted.id;
				}
			} catch (error) {
				/* ignore */
			}
			return null;
		}

		function useStoreSnapshot(store) {
			const [snapshot, setSnapshot] = React.useState(() => store.getSnapshot());
			React.useEffect(() => {
				let alive = true;
				const unsubscribe = store.subscribe(() => {
					if (alive) setSnapshot(store.getSnapshot());
				});
				setSnapshot(store.getSnapshot());
				return () => {
					alive = false;
					unsubscribe();
				};
			}, [store]);
			return snapshot;
		}

		function detectNarrowViewport() {
			try {
				if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
				return window.matchMedia('(max-width: 1100px)').matches === true;
			} catch (error) {
				return false;
			}
		}

		/* =====================================================================
		 * HTTP（同源相对路径；统一中文错误）
		 * ===================================================================== */
		function buildUrl(path, query) {
			if (!query) return API + path;
			const parts = [];
			for (const [key, value] of Object.entries(query)) {
				if (value === undefined || value === null || value === '') continue;
				parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
			}
			return API + path + (parts.length ? '?' + parts.join('&') : '');
		}

		async function requestJson(path, options) {
			const opts = options || {};
			const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
			const timer =
				controller && opts.timeoutMs
					? setTimeout(() => {
							try {
								controller.abort();
							} catch (error) {
								/* ignore */
							}
						}, opts.timeoutMs)
					: undefined;
			let response;
			try {
				response = await fetch(buildUrl(path, opts.query), {
					method: opts.method || 'GET',
					headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
					body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
					signal: controller ? controller.signal : undefined,
					cache: 'no-store',
					credentials: 'same-origin',
				});
			} catch (error) {
				if (timer !== undefined) clearTimeout(timer);
				if (error && error.name === 'AbortError') throw new Error(tr('timeoutError'));
				throw new Error(tr('networkError'));
			}
			if (timer !== undefined) clearTimeout(timer);
			let text = '';
			try {
				text = await response.text();
			} catch (error) {
				throw new Error(tr('networkError'));
			}
			let data = null;
			if (text) {
				try {
					data = JSON.parse(text);
				} catch (error) {
					data = null;
				}
			}
			if (!response.ok) {
				const message = data && typeof data.error === 'string' && data.error ? data.error : 'HTTP ' + response.status;
				const failure = new Error(message);
				failure.data = data;
				failure.status = response.status;
				throw failure;
			}
			if (data === null || typeof data !== 'object') throw new Error(tr('badResponse'));
			return data;
		}

		function getJson(path, query, timeoutMs) {
			return requestJson(path, { method: 'GET', query, timeoutMs: timeoutMs === undefined ? 20000 : timeoutMs });
		}
		function postJson(path, body, timeoutMs) {
			return requestJson(path, { method: 'POST', body, timeoutMs: timeoutMs === undefined ? 90000 : timeoutMs });
		}
		function describeError(error) {
			if (error === undefined || error === null) return tr('badResponse');
			if (typeof error === 'string') return error;
			const message = typeof error.message === 'string' ? error.message : '';
			return message || tr('badResponse');
		}

		/* =====================================================================
		 * 通用工具
		 * ===================================================================== */
		function getPath(root, path) {
			if (root === null || root === undefined || typeof path !== 'string' || path === '') return undefined;
			let current = root;
			for (const segment of path.split('.')) {
				if (current === null || typeof current !== 'object') return undefined;
				current = current[segment];
			}
			return current;
		}

		function valuesEqual(left, right) {
			if (left === right) return true;
			if (typeof left !== typeof right) return false;
			if (left === null || right === null) return false;
			if (typeof left === 'object') {
				try {
					return JSON.stringify(left) === JSON.stringify(right);
				} catch (error) {
					return false;
				}
			}
			return false;
		}

		function numberOrZero(value) {
			return typeof value === 'number' && isFinite(value) ? value : 0;
		}

		function kindLabel(kind) {
			const map = { map: 'kindMap', line: 'kindLine', bar: 'kindBar', scatter: 'kindScatter', heatmap: 'kindHeatmap', box: 'kindBox', compose: 'classGeneral' };
			return tr(map[kind] || 'kindOther');
		}

		function formatValue(value) {
			if (value === undefined) return '—';
			if (value === null) return 'null';
			if (typeof value === 'boolean') return value ? '是' : '否';
			if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
			if (typeof value === 'string') return value === '' ? '（空）' : value;
			try {
				const text = JSON.stringify(value);
				return text.length > 80 ? text.slice(0, 80) + '…' : text;
			} catch (error) {
				return String(value);
			}
		}

		function formatBytes(bytes) {
			if (typeof bytes !== 'number' || !isFinite(bytes) || bytes < 0) return '';
			if (bytes < 1024) return bytes + ' B';
			if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
			return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
		}

		function figureDisplayTitle(figure) {
			if (!figure) return tr('workspaceTitle');
			return typeof figure.title === 'string' && figure.title.trim() !== '' ? figure.title : kindLabel(figure.kind);
		}

		function sessionFigures(session) {
			return session && Array.isArray(session.figures) ? session.figures : [];
		}

		function sessionFigureCount(session) {
			const figures = sessionFigures(session);
			if (figures.length > 0) return figures.length;
			return session && typeof session.count === 'number' ? session.count : 0;
		}

		function sessionDisplayTitle(session) {
			if (!session) return tr('sessionUntitled');
			if (typeof session.title === 'string' && session.title.trim() !== '') return session.title;
			const figures = sessionFigures(session);
			const latest = figures[0];
			const base = latest && latest.title ? String(latest.title) : latest ? kindLabel(latest.kind) : '';
			const rawId = String(session.sessionId || '');
			const shortId = rawId.length > 6 ? rawId.slice(-6) : rawId;
			return (base ? base + ' · ' : '') + '#' + (shortId || '?');
		}

		function figureSummary(figure) {
			if (!figure) return null;
			return {
				id: figure.id,
				title: figure.title,
				kind: figure.kind,
				rev: figure.rev,
				updatedAt: figure.updatedAt,
				imageUrl: figure.imageUrl,
				error: figure.error || null,
			};
		}

		function extractFigureId(block, text) {
			const fromText = (value) => {
				if (typeof value !== 'string') return null;
				const match = value.match(/fig-\d{8}-\d{6}-[a-z0-9]{2,16}/i);
				return match ? match[0] : null;
			};
			if (block && typeof block === 'object') {
				const direct = fromText(block.figureId) || fromText(block.call && block.call.figureId);
				if (direct) return direct;
				const argsRaw = typeof block.argsRaw === 'string' ? block.argsRaw : block.call && typeof block.call.argsRaw === 'string' ? block.call.argsRaw : '';
				const fromArgs = fromText(argsRaw);
				if (fromArgs) return fromArgs;
				if (block.args && typeof block.args.value === 'function') {
					try {
						const args = block.args.value();
						if (args && typeof args === 'object') {
							const nested = fromText(args.figureId);
							if (nested) return nested;
						}
					} catch (error) {
						/* ignore */
					}
				}
				if (block.meta && typeof block.meta === 'object') {
					const nested = fromText(block.meta.figureId);
					if (nested) return nested;
				}
			}
			return fromText(text);
		}

		/** 旧后端可能把「自动对齐中央经线」写进 warnings；这类不算警告，前端过滤掉。 */
		const AUTO_ADJUST_WARNING_HINTS = ['自动对齐', '中央经线', '已自动改用'];

		function filterWarnings(warnings) {
			if (!Array.isArray(warnings)) return [];
			return warnings.filter((entry) => {
				const text = typeof entry === 'string' ? entry : entry && typeof entry.message === 'string' ? entry.message : '';
				if (!text) return true;
				return !AUTO_ADJUST_WARNING_HINTS.some((hint) => text.indexOf(hint) >= 0);
			});
		}

		/** figure.autoAdjust（数组，元素 {key,message}）→ 低调的自动调整说明。 */
		function autoAdjustItems(figure) {
			const list = figure && Array.isArray(figure.autoAdjust) ? figure.autoAdjust : [];
			const items = [];
			for (const entry of list) {
				if (typeof entry === 'string') {
					if (entry.trim()) items.push({ message: entry.trim() });
					continue;
				}
				if (entry && typeof entry.message === 'string' && entry.message.trim()) items.push({ key: entry.key, message: entry.message });
			}
			return items;
		}

		function blockText(block) {
			try {
				if (!block || typeof block !== 'object') return '';
				if (Array.isArray(block.content)) {
					const parts = [];
					for (const item of block.content) if (item && typeof item.text === 'string') parts.push(item.text);
					return parts.join('\n');
				}
				if (typeof block.output === 'string') return block.output;
				if (typeof block.result === 'string') return block.result;
			} catch (error) {
				/* ignore */
			}
			return '';
		}

		/* =====================================================================
		 * 样式（只引用 --dsw-alias-* / --dsw-radius-* / --dsw-font-* / --dsh-* token）
		 * ===================================================================== */
		const CSS = [
			'.scf-sidebar-icon{display:inline-flex;align-items:center;justify-content:center;line-height:0}',
			'.scf-card{display:flex;align-items:flex-start;gap:10px;margin:2px 0;padding:8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background .12s ease,border-color .12s ease;text-align:left;font-family:inherit;color:inherit;width:100%}',
			'.scf-card:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.scf-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-card-thumb{width:64px;height:48px;flex:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);object-fit:contain;display:block}',
			'.scf-card-thumb-empty{width:64px;height:48px;flex:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}',
			'.scf-card-main{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}',
			'.scf-card-title{font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.scf-card-summary{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.scf-card-side{flex:none;display:flex;align-items:center;gap:6px}',
			'.scf-state{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
			'.scf-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}',
			'.scf-dot[data-tone="running"]{background:var(--dsw-alias-state-business-primary);animation:scf-pulse 1.1s ease-in-out infinite}',
			'.scf-dot[data-tone="ok"]{background:var(--dsw-alias-state-success-primary)}',
			'.scf-dot[data-tone="error"]{background:var(--dsw-alias-state-error-primary)}',
			'.scf-dot[data-tone="warn"]{background:var(--dsw-alias-state-warn-primary)}',
			'@keyframes scf-pulse{0%,100%{opacity:1}50%{opacity:.35}}',
			'.scf-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:28px;padding:0 11px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:1;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease;white-space:nowrap}',
			'.scf-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.scf-btn:disabled{opacity:.45;cursor:default}',
			'.scf-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-btn[data-tone="primary"]{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}',
			'.scf-btn[data-tone="primary"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-inverted)}',
			'.scf-btn[data-tone="danger"]{background:var(--dsw-alias-state-error-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}',
			'.scf-btn[data-tone="danger"]:hover:not(:disabled){background:var(--dsw-alias-state-error-secondary);color:var(--dsw-alias-label-primary-inverted)}',
			'.scf-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}',
			'.scf-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.scf-icon-btn:disabled{opacity:.4;cursor:default}',
			'.scf-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-page{position:relative;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;min-width:0;height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;overflow:hidden}',
			'.scf-page *{box-sizing:border-box}',
			'.scf-ws-top{display:flex;align-items:center;gap:10px;padding:10px 16px;min-height:52px;flex:none;border-bottom:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}',
			'.scf-ws-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;flex:none}',
			'.scf-ws-title-icon{display:flex;color:var(--dsw-alias-brand-primary)}',
			'.scf-ws-select{height:28px;max-width:320px;min-width:150px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;outline:none}',
			'.scf-ws-select:focus{border-color:var(--dsw-alias-brand-primary)}',
			'.scf-ws-top-spacer{flex:1;min-width:8px}',
			'.scf-ws-meta{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;max-width:340px}',
			'.scf-ws-meta-sep{width:1px;height:9px;background:var(--dsw-alias-border-l3);flex:none}',
			'.scf-ws-actions{display:flex;align-items:center;gap:4px;flex:none}',
			'.scf-strip{display:flex;align-items:flex-start;gap:8px;padding:6px 16px;flex:none;font-size:12px;line-height:1.45;border-bottom:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}',
			'.scf-strip[data-tone="error"]{border-left:3px solid var(--dsw-alias-state-error-primary)}',
			'.scf-strip[data-tone="warn"]{border-left:3px solid var(--dsw-alias-state-warn-primary)}',
			'.scf-strip-main{flex:1;min-width:0;word-break:break-word}',
			'.scf-ws-main{flex:1;min-height:0;display:flex;overflow:hidden;position:relative}',
			'.scf-ws-left{width:300px;flex:none;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border-right:.5px solid var(--dsw-alias-border-l2)}',
			'.scf-ws-left-head{display:flex;align-items:center;gap:6px;padding:8px 10px;flex:none;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
			'.scf-ws-left-toggle{display:flex;align-items:center;gap:6px;flex:1;min-width:0;height:26px;padding:0 4px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;text-align:left}',
			'.scf-ws-left-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.scf-ws-left-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-ws-left-count{margin-left:auto;font-size:10px;font-weight:400;color:var(--dsw-alias-label-tertiary)}',
			'.scf-ws-left-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:6px 8px;display:flex;flex-direction:column;gap:6px}',
			'.scf-ws-left-scroll::-webkit-scrollbar{width:8px}',
			'.scf-ws-left-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:4px;border:2px solid transparent;background-clip:padding-box}',
			'.scf-ws-left-foot{flex:none;display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
			'.scf-ws-left-foot-text{font-size:10.5px;color:var(--dsw-alias-label-tertiary);margin-left:auto;white-space:nowrap}',
			'.scf-ws-session{display:flex;flex-direction:column;gap:2px}',
			'.scf-ws-session-head{display:flex;align-items:center;gap:5px;width:100%;min-height:26px;padding:3px 4px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11.5px;cursor:pointer;text-align:left}',
			'.scf-ws-session-head:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.scf-ws-session-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-ws-session-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
			'.scf-ws-session-count{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}',
			'.scf-ws-figure{display:flex;align-items:center;gap:7px;width:100%;padding:5px;border:.5px solid transparent;border-radius:var(--dsw-radius-md);background:transparent;color:inherit;font-family:inherit;cursor:pointer;text-align:left}',
			'.scf-ws-figure:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.scf-ws-figure[data-active="true"]{background:var(--dsw-alias-interactive-bg-active);border-color:var(--dsw-alias-brand-primary)}',
			'.scf-ws-figure:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-ws-figure-thumb{width:46px;height:34px;flex:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3);object-fit:contain;display:block}',
			'.scf-ws-figure-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
			'.scf-ws-figure-title{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.scf-ws-figure[data-active="true"] .scf-ws-figure-title{color:var(--dsw-alias-label-primary);font-weight:600}',
			'.scf-ws-figure-meta{display:flex;align-items:center;gap:4px;font-size:9.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;white-space:nowrap}',
			'.scf-ws-indent{padding-left:14px;display:flex;flex-direction:column;gap:2px}',
			'.scf-ws-center{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}',
			'.scf-ws-tabs{display:flex;align-items:center;gap:2px;padding:7px 12px;flex:none;border-bottom:.5px solid var(--dsw-alias-border-l2);overflow-x:auto;scrollbar-width:none}',
			'.scf-ws-tabs::-webkit-scrollbar{display:none}',
			'.scf-ws-tab{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 12px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:12px;cursor:pointer;white-space:nowrap;flex:none}',
			'.scf-ws-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
			'.scf-ws-tab[data-active="true"]{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:600}',
			'.scf-ws-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-ws-tab-count{font-size:10px;color:var(--dsw-alias-label-tertiary)}',
			'.scf-ws-center-body{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:10px;padding:12px 16px 18px}',
			'.scf-ws-center-body::-webkit-scrollbar{width:10px}',
			'.scf-ws-center-body::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:5px;border:2px solid transparent;background-clip:padding-box}',
			'.scf-ws-preview{display:flex;flex-direction:column;gap:8px;min-height:0;flex:1}',
			'.scf-ws-preview-bar{display:flex;align-items:center;gap:8px;flex:none;min-width:0}',
			'.scf-ws-preview-meta{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden}',
			'.scf-ws-preview-actions{display:flex;align-items:center;gap:4px;margin-left:auto;flex:none}',
			'.scf-ws-preview-canvas{flex:1;min-height:260px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;padding:10px}',
			'.scf-ws-preview-canvas img{max-width:100%;max-height:100%;object-fit:contain;display:block;cursor:zoom-in;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1)}',
			'.scf-ws-preview-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur,none);cursor:progress}',
			'.scf-ws-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:36px 20px;color:var(--dsw-alias-label-tertiary);font-size:12.5px;text-align:center;line-height:1.6}',
			'.scf-ws-empty-title{color:var(--dsw-alias-label-secondary);font-size:14px;font-weight:600}',
			'.scf-ws-right{width:380px;flex:none;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border-left:.5px solid var(--dsw-alias-border-l2)}',
			'.scf-page[data-narrow="true"] .scf-ws-right{position:absolute;top:0;right:0;bottom:0;width:min(392px,92vw);z-index:30;box-shadow:var(--dsw-shadow-lv3,0 18px 44px rgba(0,0,0,.24))}',
			'.scf-page[data-narrow="true"] .scf-ws-right[data-open="false"]{display:none}',
			'.scf-ws-right-head{display:flex;align-items:center;gap:6px;padding:8px 12px;flex:none;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
			'.scf-ws-right-head-main{display:flex;align-items:center;gap:8px;flex:1;min-width:0}',
			'.scf-ws-right-meta{font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.scf-ws-right-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);letter-spacing:.02em}',
			'.scf-ws-right-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:8px 12px 16px;display:flex;flex-direction:column;gap:10px}',
			'.scf-ws-right-scroll::-webkit-scrollbar{width:8px}',
			'.scf-ws-right-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:4px;border:2px solid transparent;background-clip:padding-box}',
			'.scf-ws-right-close{margin-left:auto;display:none}',
			'.scf-page[data-narrow="true"] .scf-ws-right-close{display:inline-flex}',
			/* ---- v4：图类识别条 / 工具段 / 投影 / 配色 ---- */
			'.scf-class-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 0 7px;border-bottom:.5px solid var(--dsw-alias-border-l1)}',
			'.scf-class-badge{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 9px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-primary);flex:none}',
			'.scf-class-badge[data-class="map"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
			'.scf-class-badge[data-class="chart"]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}',
			'.scf-class-badge[data-class="compose"]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-label)}',
			'.scf-class-badge[data-class="general"]{color:var(--dsw-alias-label-tertiary)}',
			'.scf-class-caps{flex:1;min-width:120px;font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}',
			'.scf-class-all{display:inline-flex;align-items:center;gap:5px;flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
			'.scf-proj-section{display:flex;flex-direction:column;gap:7px;padding:8px 9px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2)}',
			'.scf-proj-head{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
			'.scf-proj-current{margin-left:auto;font-size:10.5px;font-weight:400;color:var(--dsw-alias-label-tertiary);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.scf-proj-chips{display:flex;flex-wrap:wrap;gap:5px}',
			'.scf-proj-select{height:26px;max-width:100%;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:11.5px;outline:none}',
			'.scf-proj-select:focus{border-color:var(--dsw-alias-brand-primary)}',
			'.scf-mini-row{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}',
			'.scf-mini-field{display:flex;flex-direction:column;gap:2px;min-width:0}',
			'.scf-mini-label{font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
			'.scf-mini-input{height:24px;width:76px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code,monospace);font-size:11px;outline:none}',
			'.scf-mini-input:focus{border-color:var(--dsw-alias-brand-primary)}',
			'.scf-mini-input[data-wide="true"]{width:96px}',
			'.scf-palette-section{display:flex;flex-direction:column;gap:6px}',
			'.scf-palette-current{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);min-width:0}',
			'.scf-palette-current-name{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.scf-palette-list{display:flex;flex-direction:column;gap:3px;max-height:236px;overflow-y:auto;overflow-x:hidden;padding-right:2px}',
			'.scf-palette-list::-webkit-scrollbar{width:8px}',
			'.scf-palette-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:4px;border:2px solid transparent;background-clip:padding-box}',
			'.scf-palette-row{display:flex;align-items:center;gap:8px;width:100%;padding:4px 6px;border:.5px solid transparent;border-radius:var(--dsw-radius-md);background:transparent;color:inherit;font-family:inherit;cursor:pointer;text-align:left}',
			'.scf-palette-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.scf-palette-row[data-active="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-active)}',
			'.scf-palette-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-swatches{display:flex;flex:none;width:88px;height:16px;border-radius:4px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3)}',
			'.scf-swatch{flex:1 1 0;min-width:0;height:100%;display:block}',
			'.scf-palette-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
			'.scf-palette-name{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.scf-palette-row[data-active="true"] .scf-palette-name{color:var(--dsw-alias-label-primary);font-weight:600}',
			'.scf-palette-meta{font-size:9.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.scf-palette-check{flex:none;display:flex;color:var(--dsw-alias-brand-primary)}',
			'.scf-tools-area{display:flex;flex-direction:column;gap:8px}',
			'.scf-tools-section{display:flex;flex-direction:column;gap:5px}',
			'.scf-tools-head{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;text-align:left}',
			'.scf-tools-head:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.scf-tools-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-tools-count{margin-left:auto;font-size:10px;font-weight:400;color:var(--dsw-alias-label-tertiary)}',
			'.scf-tools-hint{font-size:10px;color:var(--dsw-alias-label-tertiary);line-height:1.45}',
			'.scf-banner{display:flex;align-items:flex-start;gap:8px;margin-top:0;padding:7px 9px;border-radius:var(--dsw-radius-md);border-left:3px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2);font-size:12px;line-height:1.45}',
			'.scf-banner[data-tone="error"]{border-left-color:var(--dsw-alias-state-error-primary)}',
			'.scf-banner[data-tone="warn"]{border-left-color:var(--dsw-alias-state-warn-primary)}',
			'.scf-banner[data-tone="success"]{border-left-color:var(--dsw-alias-state-success-primary)}',
			'.scf-banner-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;word-break:break-word}',
			'.scf-banner-label{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
			'.scf-banner[data-tone="error"] .scf-banner-label{color:var(--dsw-alias-state-error-primary)}',
			'.scf-banner[data-tone="warn"] .scf-banner-label{color:var(--dsw-alias-state-warn-label)}',
			'.scf-banner ul{margin:0;padding-left:16px}',
			'.scf-section{display:flex;flex-direction:column;gap:6px}',
			'.scf-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
			'.scf-section-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary)}',
			'.scf-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
			'.scf-row-grow{flex:1;min-width:0}',
			'.scf-chips{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
			'.scf-chip{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11px;cursor:pointer;white-space:nowrap;transition:background .12s ease,border-color .12s ease,color .12s ease}',
			'.scf-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.scf-chip[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-active)}',
			'.scf-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-input{height:28px;min-width:0;padding:0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;outline:none}',
			'.scf-input:focus{border-color:var(--dsw-alias-brand-primary)}',
			'.scf-input::placeholder{color:var(--dsw-alias-label-tertiary)}',
			'textarea.scf-input{height:auto;padding:6px 8px;line-height:1.5;resize:vertical;min-height:54px}',
			'.scf-search{position:relative;display:flex;align-items:center;flex:1;min-width:0}',
			'.scf-search .scf-input{width:100%;padding-left:26px}',
			'.scf-search-icon{position:absolute;left:7px;top:50%;transform:translateY(-50%);color:var(--dsw-alias-label-tertiary);pointer-events:none;display:flex}',
			'.scf-seg{display:inline-flex;align-items:center;padding:2px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);flex:none}',
			'.scf-seg button{height:22px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:11px;cursor:pointer}',
			'.scf-seg button[data-active="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:var(--dsw-shadow-lv1,0 1px 2px rgba(0,0,0,.12))}',
			'.scf-group{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);overflow:hidden}',
			'.scf-group-head{display:flex;align-items:center;gap:6px;width:100%;padding:7px 9px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;text-align:left}',
			'.scf-group-head:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.scf-group-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}',
			'.scf-group-chevron{flex:none;display:flex;color:var(--dsw-alias-label-tertiary);transition:transform .12s ease}',
			'.scf-group-chevron[data-open="true"]{transform:rotate(90deg)}',
			'.scf-group-count{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary);font-weight:400}',
			'.scf-group-body{display:flex;flex-direction:column;gap:2px;padding:2px 9px 8px}',
			'.scf-group-body[data-hidden="true"]{display:none}',
			'.scf-field{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px 8px;padding:4px 0;border-top:.5px solid var(--dsw-alias-border-l1)}',
			'.scf-field:first-child{border-top:0}',
			'.scf-field-label{display:flex;align-items:center;gap:5px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden}',
			'.scf-field-label-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.scf-field-badge{flex:none;font-size:9px;padding:0 4px;border-radius:3px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary)}',
			'.scf-field-help{grid-column:1/-1;font-size:10px;color:var(--dsw-alias-label-tertiary);margin-top:-2px;line-height:1.4}',
			'.scf-field-control{display:flex;align-items:center;gap:6px;justify-content:flex-end;min-width:0}',
			'.scf-field-control[data-wide="true"]{grid-column:1/-1;justify-content:stretch}',
			'.scf-num{width:58px;height:24px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:11px;outline:none;text-align:right}',
			'.scf-num:focus{border-color:var(--dsw-alias-brand-primary)}',
			'.scf-range{width:104px;accent-color:var(--dsw-alias-brand-primary);min-width:60px}',
			'.scf-select{height:24px;max-width:150px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:11px;outline:none}',
			'.scf-select:focus{border-color:var(--dsw-alias-brand-primary)}',
			'.scf-unit{font-size:10px;color:var(--dsw-alias-label-tertiary);flex:none}',
			'.scf-switch{position:relative;width:34px;height:18px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-bg-layer-3);cursor:pointer;flex:none;transition:background .14s ease}',
			'.scf-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}',
			'.scf-switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-switch-thumb,#fff);transition:transform .14s ease;box-shadow:var(--dsw-shadow-lv1,0 1px 2px rgba(0,0,0,.18))}',
			'.scf-switch[aria-checked="true"]::after{transform:translateX(16px)}',
			'.scf-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
			'.scf-color{width:26px;height:24px;padding:0;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);cursor:pointer}',
			'.scf-hex{width:80px;height:24px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code,monospace);font-size:11px;outline:none}',
			'.scf-hex:focus{border-color:var(--dsw-alias-brand-primary)}',
			'.scf-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:26px 14px;color:var(--dsw-alias-label-tertiary);font-size:12px;text-align:center;line-height:1.6}',
			'.scf-empty-title{color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:600}',
			'.scf-loading{display:flex;align-items:center;justify-content:center;gap:8px;padding:24px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px}',
			'.scf-spinner{width:13px;height:13px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-brand-primary);animation:scf-spin .8s linear infinite;flex:none}',
			'@keyframes scf-spin{to{transform:rotate(360deg)}}',
			'.scf-list{display:flex;flex-direction:column;gap:4px}',
			'.scf-figure-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);cursor:pointer;text-align:left;font-family:inherit;color:inherit;width:100%}',
			'.scf-figure-row:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.scf-figure-row[data-active="true"]{border-color:var(--dsw-alias-brand-primary)}',
			'.scf-figure-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-figure-row-title{flex:1;min-width:0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
			'.scf-figure-row-meta{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary)}',
			'.scf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:8px}',
			'.scf-lib-item{display:flex;flex-direction:column;gap:4px;padding:5px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);cursor:pointer;text-align:left;font-family:inherit;color:inherit;min-width:0}',
			'.scf-lib-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
			'.scf-lib-item[data-selected="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-active)}',
			'.scf-lib-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-lib-thumb{position:relative;width:100%;aspect-ratio:4/3;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);overflow:hidden;display:flex;align-items:center;justify-content:center}',
			'.scf-lib-thumb img{width:100%;height:100%;object-fit:contain;display:block;background:var(--dsw-alias-bg-layer-1)}',
			'.scf-lib-check{position:absolute;right:4px;top:4px;width:16px;height:16px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary)}',
			'.scf-lib-item[data-selected="true"] .scf-lib-check{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted)}',
			'.scf-lib-title{font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.scf-lib-sub{display:flex;align-items:center;justify-content:space-between;gap:4px;font-size:9.5px;color:var(--dsw-alias-label-tertiary)}',
			'.scf-lib-code{border:0;background:transparent;color:var(--dsw-alias-link);font-family:inherit;font-size:9.5px;cursor:pointer;padding:0}',
			'.scf-lib-code:hover{text-decoration:underline}',
			'.scf-sticky-actions{position:sticky;bottom:-18px;margin:0 -16px -18px;padding:10px 16px 12px;background:var(--dsw-alias-bg-base);border-top:.5px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:8px;z-index:2}',
			'.scf-panel-row{display:flex;align-items:center;gap:8px;padding:6px;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2)}',
			'.scf-panel-thumb{width:52px;height:39px;flex:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3);object-fit:contain;display:block;border:0;padding:0}',
			'.scf-panel-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
			'.scf-panel-title{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.scf-panel-sub{font-size:9.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.scf-panel-actions{display:flex;align-items:center;gap:1px;flex:none}',
			'.scf-code-path{font-family:var(--ds-font-family-code,monospace);font-size:10px;color:var(--dsw-alias-label-tertiary);word-break:break-all;line-height:1.5}',
			'.scf-code{flex:1;min-height:200px;margin:0;padding:12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code,monospace);font-size:11.5px;line-height:1.6;white-space:pre;overflow:auto;tab-size:2}',
			'.scf-code::-webkit-scrollbar{width:9px;height:9px}',
			'.scf-code::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:4px}',
			'.scf-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.55}',
			'.scf-class-spacer{flex:1;min-width:8px}',
			'.scf-nl-compose{display:flex;align-items:flex-end;gap:6px;padding:5px 6px 5px 9px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);transition:border-color .12s ease}',
			'.scf-nl-compose:focus-within{border-color:var(--dsw-alias-brand-primary)}',
			'.scf-nl-input{flex:1;min-width:0;min-height:22px;max-height:84px;padding:3px 0;border:0;outline:none;resize:none;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:20px;overflow-y:auto}',
			'.scf-nl-input::placeholder{color:var(--dsw-alias-label-tertiary)}',
			'.scf-nl-send{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 9px;border:.5px solid transparent;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);font-family:inherit;font-size:11.5px;line-height:1;cursor:pointer;flex:none}',
			'.scf-nl-send:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
			'.scf-nl-send:disabled{opacity:.5;cursor:default}',
			'.scf-nl-send:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
			'.scf-nl-summary{margin-top:3px;font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.scf-nl-summary[data-tone="warn"]{color:var(--dsw-alias-state-warn-label)}',
			'.scf-autoadjust{display:flex;flex-direction:column;gap:2px;border-left:2px solid var(--dsw-alias-border-l2);padding-left:7px;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
			'.scf-autoadjust-head{display:flex;align-items:center;gap:5px;width:100%;min-width:0;padding:0;border:0;background:transparent;color:inherit;font-family:inherit;font-size:11px;cursor:pointer;text-align:left}',
			'.scf-autoadjust-head:hover{color:var(--dsw-alias-label-secondary)}',
			'.scf-autoadjust-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.scf-autoadjust-icon{flex:none;display:flex;color:var(--dsw-alias-label-tertiary)}',
			'.scf-autoadjust-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.scf-autoadjust-more{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}',
			'.scf-autoadjust-body{display:flex;flex-direction:column;gap:2px;padding:2px 0 1px 17px;font-family:var(--ds-font-family-code,monospace);font-size:10px;line-height:1.5;color:var(--dsw-alias-label-tertiary);word-break:break-word}',
			'.scf-boundary{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:10px;border-left:3px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-md);font-size:12px;color:var(--dsw-alias-label-secondary)}',
			'.scf-menu-anchor{position:relative;display:inline-flex}',
			'.scf-menu{position:absolute;top:calc(100% + 4px);right:0;min-width:210px;padding:4px;z-index:60;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2,0 10px 28px rgba(0,0,0,.2));display:flex;flex-direction:column;gap:1px}',
			'.scf-menu-item{display:flex;align-items:center;gap:6px;width:100%;height:30px;padding:0 9px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;cursor:pointer;text-align:left;white-space:nowrap}',
			'.scf-menu-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
			'.scf-menu-item:disabled{opacity:.45;cursor:default}',
			'.scf-menu-item[data-tone="danger"]{color:var(--dsw-alias-state-error-primary)}',
			'.scf-menu-item[data-tone="danger"]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}',
			'.scf-menu-sep{height:.5px;background:var(--dsw-alias-border-l2);margin:3px 4px}',
			'.scf-modal{position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur,blur(2px))}',
			'.scf-modal-card{width:min(440px,calc(100vw - 48px));display:flex;flex-direction:column;gap:10px;padding:18px;border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv3,0 18px 44px rgba(0,0,0,.24))}',
			'.scf-modal-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
			'.scf-modal-text{font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-secondary);word-break:break-word}',
			'.scf-modal-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:4px}',
			'.scf-lightbox{position:fixed;inset:0;z-index:130;display:flex;flex-direction:column;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur,blur(2px))}',
			'.scf-lightbox-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 16px;flex:none;color:var(--dsw-alias-label-primary);font-size:12.5px}',
			'.scf-lightbox img{flex:1;min-height:0;width:100%;object-fit:contain;display:block;padding:0 16px 16px;cursor:zoom-out}',
			'@media (prefers-reduced-motion:reduce){.scf-dot[data-tone="running"],.scf-spinner{animation:none}.scf-chip,.scf-btn,.scf-ws-tab,.scf-switch,.scf-switch::after{transition:none}}',
		].join('\n');

		function installStyles(ctx) {
			if (typeof document === 'undefined') return;
			const install = () => {
				const existing = document.querySelector('style[data-scifig-css]');
				if (existing !== null) return () => {};
				const tag = document.createElement('style');
				tag.dataset.scifigCss = '1';
				tag.dataset.plugin = 'dsh-scifig-studio';
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => {
					try {
						tag.remove();
					} catch (error) {
						/* ignore */
					}
				};
			};
			try {
				if (ctx && typeof ctx.effect === 'function') ctx.effect(install, 'scifig-studio: styles');
				else install();
			} catch (error) {
				console.error('[scifig] cannot install styles', error);
				try {
					install();
				} catch (nested) {
					/* ignore */
				}
			}
		}

		/* =====================================================================
		 * 图标（inline SVG，跟随 currentColor）
		 * ===================================================================== */
		function iconPaths(name) {
			switch (name) {
				case 'chart':
					return ['M2.5 2.5h11v11h-11z', 'M5 11v-3M8 11V6M11 11v-2'];
				case 'studio':
					return ['M3 13.5h10', 'M3.5 13.5V4.5M3.5 13.5h10', 'M5.5 11V8.5M8 11V5.5M10.5 11V7'];
				case 'close':
					return ['M4 4l8 8M12 4l-8 8'];
				case 'download':
					return ['M8 2.5v7.5M5 7l3 3 3-3M2.5 13.5h11'];
				case 'undo':
					return ['M6 4.5L3 7.5l3 3', 'M3 7.5h6a3.5 3.5 0 010 7H7.5'];
				case 'redo':
					return ['M10 4.5L13 7.5l-3 3', 'M13 7.5H7a3.5 3.5 0 000 7h1.5'];
				case 'search':
					return ['M10.5 10.5L13.5 13.5', 'M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z'];
				case 'info':
					return ['M8 14.2a6.2 6.2 0 100-12.4 6.2 6.2 0 000 12.4z', 'M8 7.3v4M8 4.9v.6'];
				case 'copy':
					return ['M5.5 5.5h7v8h-7z', 'M3.5 2.5h7v2', 'M3.5 2.5v8h2'];
				case 'chevron':
					return ['M6 3.5L10.5 8 6 12.5'];
				case 'warning':
					return ['M8 2.5l6 11H2l6-11z', 'M8 6.5v3M8 11.4v.6'];
				case 'check':
					return ['M3 8.5l3.2 3.2L13 4.8'];
				case 'image':
					return ['M2.5 3.5h11v9h-11z', 'M2.5 10l3-3 2.5 2.5 2.5-2.5 3 3', 'M6 6.2a.9.9 0 100-1.8.9.9 0 000 1.8z'];
				case 'layers':
					return ['M8 2.5l6 3-6 3-6-3 6-3z', 'M2 8.5l6 3 6-3', 'M2 11.5l6 3 6-3'];
				case 'grid':
					return ['M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z'];
				case 'code':
					return ['M5.5 5L2.5 8l3 3', 'M10.5 5l3 3-3 3', 'M9 3l-2 10'];
				case 'refresh':
					return ['M13 8a5 5 0 11-1.7-3.8', 'M13 2.5V5h-2.5'];
				case 'up':
					return ['M8 12.5v-9', 'M4.5 7L8 3.5 11.5 7'];
				case 'down':
					return ['M8 3.5v9', 'M4.5 9L8 12.5 11.5 9'];
				case 'trash':
					return ['M3.5 4.5h9', 'M6 4.5V3h4v1.5', 'M4.5 4.5l.6 9h5.8l.6-9'];
				case 'scissors':
					return ['M4 3l8 10', 'M12 3L4 13', 'M3.2 12.2a1.4 1.4 0 102 2 1.4 1.4 0 00-2-2z', 'M10.8 12.2a1.4 1.4 0 102 2 1.4 1.4 0 00-2-2z'];
				case 'spark':
					return ['M8 2.5l1.5 4L13.5 8l-4 1.5L8 13.5 6.5 9.5 2.5 8l4-1.5L8 2.5z'];
				case 'dot':
					return ['M8 9.6a1.6 1.6 0 100-3.2 1.6 1.6 0 000 3.2z'];
				default:
					return ['M2.5 2.5h11v11h-11z'];
			}
		}

		function Icon(props) {
			const size = props && props.size ? props.size : 14;
			const name = props && props.name ? props.name : 'dot';
			return h(
				'svg',
				{
					viewBox: '0 0 16 16',
					width: size,
					height: size,
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': 'true',
					focusable: 'false',
					style: { display: 'block' },
				},
				iconPaths(name).map((d, index) => h('path', { key: String(index), d: d })),
			);
		}

		/* =====================================================================
		 * 错误边界（任何组件异常都不白屏）
		 * ===================================================================== */
		class Boundary extends React.Component {
			constructor(props) {
				super(props);
				this.state = { failed: false, message: '' };
				this.handleRetry = this.handleRetry.bind(this);
			}
			static getDerivedStateFromError(error) {
				return { failed: true, message: error && error.message ? String(error.message) : String(error) };
			}
			componentDidCatch(error, info) {
				try {
					console.error('[scifig] UI component crashed', error, info && info.componentStack);
				} catch (nested) {
					/* ignore */
				}
			}
			handleRetry() {
				this.setState({ failed: false, message: '' });
			}
			render() {
				if (this.state.failed) {
					return h(
						'div',
						{ className: 'scf-boundary', 'data-scifig-boundary': this.props.label || 'ui' },
						h('span', null, (this.props.label || tr('workspaceTitle')) + ' 渲染异常：' + this.state.message),
						h('button', { type: 'button', className: 'scf-btn', onClick: this.handleRetry }, h(Icon, { name: 'refresh', size: 12 }), tr('retry')),
					);
				}
				return this.props.children;
			}
		}

		function guard(label, Component) {
			function Guarded(props) {
				return h(Boundary, { label: label }, h(Component, props));
			}
			Guarded.displayName = 'ScifigGuarded(' + label + ')';
			return Guarded;
		}

		/* =====================================================================
		 * 小部件
		 * ===================================================================== */
		function Spinner() {
			return h('span', { className: 'scf-spinner', 'aria-hidden': 'true' });
		}

		function LoadingLine(props) {
			return h('div', { className: 'scf-loading', role: 'status' }, h(Spinner, null), h('span', null, props && props.text ? props.text : tr('loading')));
		}

		function Banner(props) {
			const tone = props.tone || 'error';
			const counter = typeof props.count === 'number' ? props.count : 0;
			const children = [];
			children.push(
				h(
					'div',
					{ className: 'scf-banner-main', key: 'main' },
					h('span', { className: 'scf-banner-label' }, props.label || (tone === 'error' ? tr('figureError') : tr('warningsLabel')) + (counter ? ' (' + counter + ')' : '')),
					Array.isArray(props.items) && props.items.length > 0
						? h('ul', null, props.items.map((item, index) => h('li', { key: String(index) }, String(item))))
						: h('span', null, String(props.text || '')),
				),
			);
			if (typeof props.onDismiss === 'function') {
				children.push(h('button', { type: 'button', className: 'scf-icon-btn', key: 'dismiss', onClick: props.onDismiss, 'aria-label': tr('dismiss'), title: tr('dismiss') }, h(Icon, { name: 'close', size: 12 })));
			}
			return h('div', { className: 'scf-banner', 'data-tone': tone, role: tone === 'error' ? 'alert' : 'status' }, children);
		}

		function IconButton(props) {
			return h('button', { type: 'button', className: 'scf-icon-btn', onClick: props.onClick, disabled: props.disabled, title: props.title, 'aria-label': props.title }, h(Icon, { name: props.name, size: props.size || 14 }));
		}

		function Button(props) {
			return h(
				'button',
				{ type: 'button', className: 'scf-btn', onClick: props.onClick, disabled: props.disabled, 'data-tone': props.tone || 'default', title: props.title },
				props.icon ? h(Icon, { name: props.icon, size: 12 }) : null,
				props.children,
			);
		}

		function Switch(props) {
			const checked = props.checked === true;
			return h('button', {
				type: 'button',
				role: 'switch',
				className: 'scf-switch',
				'aria-checked': checked ? 'true' : 'false',
				'aria-label': props.label || '',
				onClick: () => props.onChange(!checked),
				disabled: props.disabled,
			});
		}

		function Segmented(props) {
			const options = props.options || [];
			return h(
				'div',
				{ className: 'scf-seg', role: 'group', 'aria-label': props.label || '' },
				options.map((option) =>
					h('button', { key: option.value, type: 'button', 'data-active': option.value === props.value ? 'true' : 'false', 'aria-pressed': option.value === props.value ? 'true' : 'false', onClick: () => props.onChange(option.value) }, option.label),
				),
			);
		}

		/** 受控输入缓冲：外部值变化（且未聚焦）时同步，避免打字被服务端回包打断。 */
		function useBufferedValue(value, onCommit) {
			const [buffer, setBuffer] = React.useState(() => (value === undefined || value === null ? '' : String(value)));
			const focused = React.useRef(false);
			React.useEffect(() => {
				if (focused.current) return;
				setBuffer(value === undefined || value === null ? '' : String(value));
			}, [value]);
			return {
				buffer: buffer,
				handleChange: (next) => {
					setBuffer(next);
					onCommit(next);
				},
				handleFocus: () => {
					focused.current = true;
				},
				handleBlur: () => {
					focused.current = false;
					setBuffer(value === undefined || value === null ? '' : String(value));
				},
			};
		}

		function NumberField(props) {
			const item = props.item;
			const value = typeof props.value === 'number' && isFinite(props.value) ? props.value : typeof item.default === 'number' ? item.default : 0;
			const min = typeof item.min === 'number' ? item.min : undefined;
			const max = typeof item.max === 'number' ? item.max : undefined;
			const step = typeof item.step === 'number' && item.step > 0 ? item.step : 1;
			const precision = String(step).indexOf('.') >= 0 ? String(step).split('.')[1].length : 0;
			const sliderEnabled = min !== undefined && max !== undefined && max > min;
			const commit = (next) => {
				if (!isFinite(next)) return;
				let output = next;
				if (min !== undefined && output < min) output = min;
				if (max !== undefined && output > max) output = max;
				output = precision > 0 ? Math.round(output * Math.pow(10, precision)) / Math.pow(10, precision) : Math.round(output);
				props.onChange(output);
			};
			const buffered = useBufferedValue(value, (text) => {
				if (String(text).trim() === '') return;
				const parsed = Number(text);
				if (isFinite(parsed)) commit(parsed);
			});
			return h(
				React.Fragment,
				null,
				sliderEnabled ? h('input', { className: 'scf-range', type: 'range', min: min, max: max, step: step, value: value, 'aria-label': item.labelZh || item.path, onChange: (event) => commit(Number(event.target.value)) }) : null,
				h('input', {
					className: 'scf-num',
					type: 'number',
					value: buffered.buffer,
					min: min,
					max: max,
					step: step,
					'aria-label': item.labelZh || item.path,
					onChange: (event) => buffered.handleChange(event.target.value),
					onBlur: buffered.handleBlur,
					onFocus: buffered.handleFocus,
				}),
				item.unit ? h('span', { className: 'scf-unit' }, String(item.unit)) : null,
			);
		}

		function EnumField(props) {
			const item = props.item;
			const options = Array.isArray(item.options) ? item.options : [];
			const labels = item.optionLabels && typeof item.optionLabels === 'object' ? item.optionLabels : {};
			const current = props.value === undefined ? item.default : props.value;
			return h(
				'select',
				{ className: 'scf-select', value: current === undefined || current === null ? '' : String(current), 'aria-label': item.labelZh || item.path, onChange: (event) => props.onChange(event.target.value) },
				options.map((option) => h('option', { key: String(option), value: String(option) }, labels[option] ? String(labels[option]) : String(option))),
			);
		}

		function ColorField(props) {
			const item = props.item;
			const current = typeof props.value === 'string' ? props.value : typeof item.default === 'string' ? item.default : '';
			const hexSafe = /^#[0-9a-fA-F]{6}$/.test(current) ? current : '#000000';
			const buffered = useBufferedValue(current, (text) => {
				if (/^#[0-9a-fA-F]{3,8}$/.test(String(text).trim())) props.onChange(String(text).trim());
			});
			return h(
				React.Fragment,
				null,
				h('input', { className: 'scf-color', type: 'color', value: hexSafe, 'aria-label': item.labelZh || item.path, onChange: (event) => props.onChange(event.target.value) }),
				h('input', { className: 'scf-hex', type: 'text', value: buffered.buffer, spellCheck: false, 'aria-label': (item.labelZh || item.path) + ' hex', onChange: (event) => buffered.handleChange(event.target.value), onBlur: buffered.handleBlur, onFocus: buffered.handleFocus }),
			);
		}

		function TextField(props) {
			const item = props.item;
			const current = props.value === undefined || props.value === null ? (item.default === undefined ? '' : item.default) : props.value;
			const buffered = useBufferedValue(current, (text) => props.onChange(text));
			if (item.multiline === true) {
				return h('textarea', { className: 'scf-input', value: buffered.buffer, rows: 2, spellCheck: false, 'aria-label': item.labelZh || item.path, onChange: (event) => buffered.handleChange(event.target.value), onBlur: buffered.handleBlur, onFocus: buffered.handleFocus });
			}
			return h('input', { className: 'scf-input', type: 'text', value: buffered.buffer, spellCheck: false, 'aria-label': item.labelZh || item.path, onChange: (event) => buffered.handleChange(event.target.value), onBlur: buffered.handleBlur, onFocus: buffered.handleFocus, style: { width: '150px' } });
		}

		/** v4：投影区紧凑数字输入（中央经线）。 */
		function SmallNumberField(props) {
			const item = props.item || {};
			const value = typeof props.value === 'number' && isFinite(props.value) ? props.value : typeof item.default === 'number' ? item.default : 0;
			const buffered = useBufferedValue(value, (text) => {
				if (String(text).trim() === '') return;
				const parsed = Number(text);
				if (isFinite(parsed)) props.onChange(parsed);
			});
			return h('input', { className: 'scf-mini-input', type: 'number', value: buffered.buffer, 'aria-label': props.label, title: props.label, onChange: (event) => buffered.handleChange(event.target.value), onBlur: buffered.handleBlur, onFocus: buffered.handleFocus });
		}

		/** v4：投影区紧凑文本输入（标准纬线 "25,47"）。 */
		function SmallTextField(props) {
			const item = props.item || {};
			const value = props.value === undefined || props.value === null ? (item.default === undefined ? '' : item.default) : props.value;
			const buffered = useBufferedValue(value, (text) => props.onChange(text));
			return h('input', { className: 'scf-mini-input', 'data-wide': 'true', type: 'text', value: buffered.buffer, spellCheck: false, 'aria-label': props.label, title: props.label, onChange: (event) => buffered.handleChange(event.target.value), onBlur: buffered.handleBlur, onFocus: buffered.handleFocus });
		}

		/** 自动调整说明：灰色单行、可折叠，不当作警告。 */
		function AutoAdjustNote(props) {
			const [open, setOpen] = React.useState(false);
			const items = Array.isArray(props.items) ? props.items : [];
			if (items.length === 0) return null;
			const first = String(items[0].message || '');
			return h(
				'div',
				{ className: 'scf-autoadjust', 'data-scifig-autoadjust': '1' },
				h(
					'button',
					{ type: 'button', className: 'scf-autoadjust-head', 'aria-expanded': open ? 'true' : 'false', title: first, onClick: () => setOpen((value) => !value) },
					h('span', { className: 'scf-autoadjust-icon' }, h(Icon, { name: 'info', size: 12 })),
					h('span', { className: 'scf-autoadjust-text' }, first),
					h('span', { className: 'scf-autoadjust-more' }, open ? tr('autoAdjustLess') : tr('autoAdjustMore')),
				),
				open ? h('div', { className: 'scf-autoadjust-body' }, items.map((item, index) => h('div', { key: String(index) }, String(item.message)))) : null,
			);
		}

		/** 一句话改图：单行自适应输入 + 右侧内联发送按钮（Enter 提交 / Shift+Enter 换行）。 */
		function NlComposer(props) {
			const ref = React.useRef(null);
			React.useEffect(() => {
				const el = ref.current;
				if (!el || typeof el.scrollHeight !== 'number') return;
				el.style.height = 'auto';
				el.style.height = Math.min(Math.max(el.scrollHeight, 22), 84) + 'px';
			}, [props.value]);
			return h(
				'div',
				{ className: 'scf-nl-compose' },
				h('textarea', {
					ref: ref,
					className: 'scf-nl-input',
					rows: 1,
					value: props.value,
					placeholder: props.placeholder,
					'aria-label': props.placeholder,
					title: tr('nlEnterHint'),
					disabled: props.disabled,
					spellCheck: false,
					onChange: (event) => props.onChange(event.target.value),
					onKeyDown: (event) => {
						if (event.key !== 'Enter' || event.shiftKey === true) return;
						event.preventDefault();
						if (!props.disabled && !props.busy) props.onSubmit();
					},
				}),
				h(
					'button',
					{ type: 'button', className: 'scf-nl-send', disabled: props.disabled || props.busy, onClick: props.onSubmit, title: props.busy ? tr('nlApplying') : tr('nlEnterHint') },
					props.busy ? h(Spinner, null) : h(Icon, { name: 'spark', size: 12 }),
					props.busy ? null : h('span', null, tr('nlApply')),
				),
			);
		}

		function nlSummaryText(result) {
			if (!result) return '';
			const parts = [];
			if (Array.isArray(result.applied) && result.applied.length > 0) {
				parts.push(tr('nlApplied') + '：' + result.applied.map((entry) => String(entry.labelZh || entry.path || '') + '→' + formatValue(entry.value)).join('；'));
			}
			if (Array.isArray(result.unapplied) && result.unapplied.length > 0) {
				parts.push(tr('nlUnapplied') + '：' + result.unapplied.map(String).join('；'));
			}
			return parts.join(' · ');
		}

		function ControlField(props) {
			const item = props.item;
			const label = item.labelZh || item.labelEn || item.path;
			const control = (() => {
				switch (item.type) {
					case 'number':
						return h(NumberField, { item: item, value: props.value, onChange: props.onChange });
					case 'enum':
						return h(EnumField, { item: item, value: props.value, onChange: props.onChange });
					case 'bool':
						return h(Switch, { checked: props.value === undefined ? item.default === true : props.value === true, label: label, onChange: props.onChange });
					case 'color':
						return h(ColorField, { item: item, value: props.value, onChange: props.onChange });
					case 'text':
					default:
						return h(TextField, { item: item, value: props.value, onChange: props.onChange });
				}
			})();
			const wide = item.type === 'text';
			return h(
				'div',
				{ className: 'scf-field', 'data-path': item.path },
				h('div', { className: 'scf-field-label', title: item.help || label }, h('span', { className: 'scf-field-label-text' }, label), props.showAdvanced && item.level === 'advanced' ? h('span', { className: 'scf-field-badge' }, tr('advancedTag')) : null),
				h('div', { className: 'scf-field-control', 'data-wide': wide ? 'true' : 'false' }, control),
			);
		}

		function isItemVisible(item, resolveValue) {
			const rule = item && item.visibleWhen;
			if (!rule || typeof rule !== 'object') return true;
			const current = resolveValue(rule.path, null);
			if (Array.isArray(rule.in)) return rule.in.some((candidate) => current === candidate || String(current) === String(candidate));
			if (Array.isArray(rule.notIn)) return !rule.notIn.some((candidate) => current === candidate || String(current) === String(candidate));
			if (rule.equals !== undefined) return current === rule.equals;
			return true;
		}

		function ControlsPanel(props) {
			const groups = props.groups || [];
			const search = (props.search || '').trim().toLowerCase();
			const cards = [];
			let rendered = 0;
			for (const group of groups) {
				const items = Array.isArray(group.items) ? group.items : [];
				const visibleItems = [];
				for (const item of items) {
					if (!search && props.level !== 'all' && item.level === 'advanced') continue;
					if (!isItemVisible(item, props.resolveValue)) continue;
					if (search) {
						const haystack = [item.path, item.labelZh, item.labelEn, item.help].filter((part) => typeof part === 'string').join(' ').toLowerCase();
						if (haystack.indexOf(search) < 0) continue;
					}
					visibleItems.push(item);
				}
				if (visibleItems.length === 0) continue;
				rendered += visibleItems.length;
				const groupKey = group.id || group.labelZh || String(cards.length);
				const open = search !== '' ? true : props.groupOpen(groupKey);
				cards.push(
					h(
						'div',
						{ className: 'scf-group', key: groupKey },
						h(
							'button',
							{ type: 'button', className: 'scf-group-head', 'aria-expanded': open ? 'true' : 'false', onClick: () => props.onToggleGroup(groupKey) },
							h('span', { className: 'scf-group-chevron', 'data-open': open ? 'true' : 'false' }, h(Icon, { name: 'chevron', size: 12 })),
							h('span', null, String(group.labelZh || group.labelEn || groupKey)),
							h('span', { className: 'scf-group-count' }, String(visibleItems.length)),
						),
						h(
							'div',
							{ className: 'scf-group-body', 'data-hidden': open ? 'false' : 'true' },
							visibleItems.map((item) => h(ControlField, { key: item.path, item: item, value: props.resolveValue(item.path, item), showAdvanced: props.level === 'all', onChange: (next) => props.onCommit(item.path, next) })),
						),
					),
				);
			}
			if (rendered === 0) {
				if (props.emptyMode === 'silent') return null;
				return h('div', { className: 'scf-hint', role: 'status' }, search ? tr('searchEmpty') : tr('noControls'));
			}
			return h('div', { className: 'scf-section' }, cards);
		}

		/* =====================================================================
		 * 侧栏图标（sidebar.panellist 组件；owner props = {size, active}）
		 * ===================================================================== */
		function SidebarIcon(props) {
			const size = typeof props.size === 'number' && props.size > 0 ? props.size : 18;
			const active = props.active === true;
			return h(
				'span',
				{ className: 'scf-sidebar-icon', 'data-scifig-sidebar': active ? 'active' : 'idle' },
				h(
					'svg',
					{
						viewBox: '0 0 20 20',
						width: size,
						height: size,
						fill: 'none',
						stroke: 'currentColor',
						strokeWidth: active ? 1.7 : 1.5,
						strokeLinecap: 'round',
						strokeLinejoin: 'round',
						'aria-hidden': 'true',
						focusable: 'false',
						style: { display: 'block', opacity: active ? 1 : 0.9 },
					},
					h('path', { d: 'M3 16.5h14' }),
					h('path', { d: 'M4 16.5V11h3v5.5M8.5 16.5V4h3v12.5M13 16.5v-6h3v6' }),
				),
			);
		}

		/* =====================================================================
		 * 工具卡（tool.call.toolview, key = scifig）
		 * ===================================================================== */
		function ToolCard(props) {
			const block = props.block || {};
			const sessionId = props.sessionId || null;
			const phase = typeof block.kind !== 'undefined' ? 'result' : block.phase === 'preparing' ? 'preparing' : 'running';
			const failed = phase === 'result' && block.isError === true;
			const text = blockText(block);
			const figureId = extractFigureId(block, text);
			const [cardState, setCardState] = React.useState({ status: 'idle', figure: null, error: null });
			React.useEffect(() => {
				if (phase === 'preparing' || !sessionId) {
					setCardState({ status: 'ready', figure: null, error: null });
					return undefined;
				}
				let cancelled = false;
				setCardState((current) => (current.status === 'ready' && current.figure ? current : { status: 'loading', figure: null, error: null }));
				(async () => {
					try {
						const data = await getJson('/state', { sessionId: sessionId }, 12000);
						if (cancelled) return;
						if (!data || data.ok !== true) {
							setCardState({ status: 'error', figure: null, error: (data && data.error) || tr('stateFailed') });
							return;
						}
						const list = Array.isArray(data.figures) ? data.figures : [];
						let match = null;
						if (figureId) {
							for (const entry of list) if (entry && entry.id === figureId) match = entry;
							if (!match && data.figure && data.figure.id === figureId) match = data.figure;
						}
						if (!match) match = data.figure || (list.length > 0 ? list[list.length - 1] : null);
						setCardState({ status: 'ready', figure: match, error: null });
					} catch (error) {
						if (!cancelled) setCardState({ status: 'error', figure: null, error: describeError(error) });
					}
				})();
				return () => {
					cancelled = true;
				};
			}, [phase, sessionId, figureId]);
			const stateLabel = failed ? tr('statusError') : phase === 'preparing' ? tr('statusPreparing') : phase === 'running' ? tr('statusRunning') : tr('statusOk');
			const tone = failed ? 'error' : phase === 'result' ? 'ok' : 'running';
			const summary = (() => {
				const firstLine = text.split('\n').map((line) => line.trim()).filter(Boolean)[0] || '';
				if (failed) return firstLine || tr('figureError');
				const figure = cardState.figure;
				if (figure) {
					const bits = [kindLabel(figure.kind)];
					if (figure.rev !== undefined) bits.push(tr('rev') + ' ' + String(figure.rev));
					if (figure.title) bits.push(String(figure.title));
					return bits.join(' · ');
				}
				return phase === 'result' ? tr('toolNoFigure') : tr('statusRunning');
			})();
			const thumbUrl = cardState.figure && cardState.figure.imageUrl ? cardState.figure.imageUrl : null;
			const open = () => {
				if (typeof props.openWorkbench === 'function') props.openWorkbench(sessionId, figureId || (cardState.figure && cardState.figure.id) || null);
			};
			return h(
				'button',
				{ type: 'button', className: 'scf-card', 'data-scifig-card': 'tool', onClick: open, 'aria-label': tr('openWorkbench') },
				thumbUrl ? h('img', { className: 'scf-card-thumb', src: thumbUrl, alt: '', loading: 'lazy' }) : h('span', { className: 'scf-card-thumb-empty' }, h(Icon, { name: 'image', size: 16 })),
				h('div', { className: 'scf-card-main' }, h('span', { className: 'scf-card-title' }, tr('toolTitle') + ' · ' + stateLabel), h('span', { className: 'scf-card-summary', title: summary }, summary)),
				h('div', { className: 'scf-card-side' }, h('span', { className: 'scf-state' }, h('span', { className: 'scf-dot', 'data-tone': tone }), stateLabel), h('span', { className: 'scf-btn', 'data-tone': 'default', style: { pointerEvents: 'none' } }, tr('toolOpen'))),
			);
		}

		/* =====================================================================
		 * 整页工作台（main 槽，key = scifig）
		 * ===================================================================== */
		let controlsCache = null;

		function normalizeControls(data) {
			const groups = Array.isArray(data.groups) ? data.groups : [];
			const presets = Array.isArray(data.presets) ? data.presets : [];
			const kinds = Array.isArray(data.kinds) ? data.kinds : [];
			const paths = [];
			for (const group of groups) for (const item of Array.isArray(group.items) ? group.items : []) if (item && typeof item.path === 'string') paths.push(item.path);
			return { groups: groups, presets: presets, kinds: kinds, paths: paths };
		}

		/* =====================================================================
		 * v4：图类识别 / 工具分段 / 投影 chips / PPT 配色
		 * ===================================================================== */
		const TOOL_SECTIONS = [
			{ key: 'map', applies: 'map', titleKey: 'sectionMap' },
			{ key: 'chart', applies: 'chart', titleKey: 'sectionChart' },
			{ key: 'all', applies: 'all', titleKey: 'sectionAll' },
		];

		const CHART_KINDS = ['line', 'bar', 'scatter', 'heatmap', 'box'];

		/** 常见 6 种投影 chips（值按 renderer 枚举；文案优先取 controls.optionLabels）。 */
		const COMMON_PROJECTIONS = [
			{ value: 'platecarree', labelKey: 'projPlateCarree', fallback: '等经纬' },
			{ value: 'mercator', labelKey: 'projMercator', fallback: '墨卡托' },
			{ value: 'lambert', labelKey: 'projLambert', fallback: '兰伯特' },
			{ value: 'albers', labelKey: 'projAlbers', fallback: '阿尔伯斯' },
			{ value: 'robinson', labelKey: 'projRobinson', fallback: '罗宾逊' },
			{ value: 'equalearth', labelKey: 'projEqualEarth', fallback: '等地球' },
		];

		/** controls 未就绪时的 11 种投影兜底（与 renderer 枚举一致）。 */
		const PROJECTION_FALLBACK = [
			{ value: 'platecarree', zh: '等经纬度' },
			{ value: 'mercator', zh: '墨卡托' },
			{ value: 'miller', zh: '米勒' },
			{ value: 'lambert', zh: '兰伯特等角圆锥' },
			{ value: 'albers', zh: '阿尔伯斯等积圆锥' },
			{ value: 'robinson', zh: '罗宾逊' },
			{ value: 'mollweide', zh: '摩尔威特' },
			{ value: 'equalearth', zh: '等地球' },
			{ value: 'orthographic', zh: '正射' },
			{ value: 'azimuthal', zh: '方位等距' },
			{ value: 'northpolarstereo', zh: '北极立体' },
		];

		const PALETTE_TABS = [
			{ key: 'categorical', labelKey: 'paletteTabCategorical' },
			{ key: 'sequential', labelKey: 'paletteTabSequential' },
			{ key: 'diverging', labelKey: 'paletteTabDiverging' },
			{ key: 'colorbar', labelKey: 'paletteTabColorbar', mapOnly: true },
		];

		const PALETTE_PATHS = {
			categorical: 'style.palette',
			sequential: 'style.paletteSequential',
			diverging: 'style.paletteDiverging',
			colorbar: 'map.colorbar.palette',
		};

		const PALETTE_KINDS = ['categorical', 'sequential', 'diverging'];

		/** 图类识别：map / chart / compose / general（契约 §9.4.2）。 */
		function figureClassOf(figure) {
			const kind = figure && typeof figure.kind === 'string' ? figure.kind : '';
			if (kind === 'map') return { key: 'map', labelKey: 'classMap', capsKey: 'classCapsMap' };
			if (CHART_KINDS.indexOf(kind) >= 0) return { key: 'chart', labelKey: 'classChart', capsKey: 'classCapsChart' };
			return { key: 'general', labelKey: 'classGeneral', capsKey: 'classCapsGeneral' };
		}

		/** 组的 appliesTo（契约 §9.2.1）；renderer 未落地时按 path 前缀兜底推断。 */
		function groupAppliesTo(group) {
			const declared = group && typeof group.appliesTo === 'string' ? group.appliesTo.toLowerCase() : '';
			if (declared === 'map' || declared === 'chart' || declared === 'compose' || declared === 'all') return declared;
			const items = Array.isArray(group && group.items) ? group.items : [];
			const paths = items.map((item) => (item && typeof item.path === 'string' ? item.path : ''));
			if (paths.some((path) => path.indexOf('map.') === 0)) return 'map';
			if (paths.some((path) => path.indexOf('compose.') === 0)) return 'compose';
			const id = String((group && group.id) || '');
			if (['axes', 'axisStyle', 'lineChart', 'barChart', 'scatterChart', 'heatmapChart', 'boxChart'].indexOf(id) >= 0) return 'chart';
			return 'all';
		}

		/** 某组在当前 level/search/visibleWhen 下可见的条目数。 */
		function countVisibleItems(groups, level, search, resolveValue) {
			const needle = String(search || '').trim().toLowerCase();
			let count = 0;
			for (const group of groups) {
				const items = Array.isArray(group && group.items) ? group.items : [];
				for (const item of items) {
					if (!needle && level !== 'all' && item.level === 'advanced') continue;
					if (!isItemVisible(item, resolveValue)) continue;
					if (needle) {
						const haystack = [item.path, item.labelZh, item.labelEn, item.help].filter((part) => typeof part === 'string').join(' ').toLowerCase();
						if (haystack.indexOf(needle) < 0) continue;
					}
					count += 1;
				}
			}
			return count;
		}

		function normalizePalettes(data) {
			const list = Array.isArray(data && data.palettes) ? data.palettes.filter((entry) => entry && typeof entry.id === 'string') : [];
			const byId = {};
			for (const entry of list) byId[entry.id] = entry;
			const byKind = { categorical: [], sequential: [], diverging: [] };
			for (const entry of list) {
				const kind = PALETTE_KINDS.indexOf(entry.kind) >= 0 ? entry.kind : 'categorical';
				byKind[kind].push(entry);
			}
			/* Host 的 byKind 可能是 id 数组（host/palettes.js）或 palette 对象数组（契约 §9.3）；两种都兼容。 */
			if (data && data.byKind && typeof data.byKind === 'object') {
				for (const kind of PALETTE_KINDS) {
					const raw = data.byKind[kind];
					if (!Array.isArray(raw) || raw.length === 0) continue;
					const mapped = raw
						.map((entry) => (typeof entry === 'string' ? byId[entry] : entry))
						.filter((entry) => entry && typeof entry.id === 'string');
					if (mapped.length > 0) byKind[kind] = mapped;
				}
			}
			for (const kind of PALETTE_KINDS) {
				byKind[kind] = byKind[kind].map((entry) => Object.assign({}, entry, { colors: Array.isArray(entry.colors) ? entry.colors.filter((color) => typeof color === 'string') : [] }));
			}
			return { list: list, byKind: byKind, source: typeof (data && data.source) === 'string' ? data.source : '' };
		}

		/** 按 path 从 controls 分组里找控件定义。 */
		function findControlItem(groups, path) {
			for (const group of groups) {
				const items = Array.isArray(group && group.items) ? group.items : [];
				for (const item of items) if (item && item.path === path) return item;
			}
			return null;
		}

		function paletteById(palettes, id) {			if (!palettes || !id) return null;
			for (const entry of palettes.list) if (entry.id === id) return entry;
			return null;
		}

		function paletteReuseCount(palette) {
			if (palette && palette.usage && typeof palette.usage.figures === 'number' && isFinite(palette.usage.figures)) return palette.usage.figures;
			const name = String((palette && palette.name) || '');
			const match = name.match(/(\d+)\s*(?:张图|图)/);
			return match ? Number(match[1]) : null;
		}

		/** 工具区过滤掉与顶部快捷区重复的 path（期刊风格 chips / 标题）。 */
		const EXCLUDED_TOOL_PATHS = ['style.preset', 'title'];

		function filterToolGroups(groups) {
			const output = [];
			for (const group of groups) {
				const items = (Array.isArray(group && group.items) ? group.items : []).filter((item) => item && EXCLUDED_TOOL_PATHS.indexOf(item.path) < 0);
				if (items.length === 0) continue;
				output.push(Object.assign({}, group, { items: items }));
			}
			return output;
		}

		/** 当前 tab 对应的 spec path。 */
		function palettePathForTab(tab) {
			return PALETTE_PATHS[tab] || PALETTE_PATHS.categorical;
		}

		function palettesOfTab(palettes, tab) {
			if (!palettes) return [];
			if (tab === 'colorbar') return (palettes.byKind.sequential || []).concat(palettes.byKind.diverging || []);
			return palettes.byKind[tab] || [];
		}

		function WorkbenchPage(props) {
			const snapshot = useStoreSnapshot(workbenchStore);
			const [isNarrow, setIsNarrow] = React.useState(() => detectNarrowViewport());
			const [rightOpen, setRightOpen] = React.useState(() => !detectNarrowViewport());
			const [tab, setTab] = React.useState('preview');
			const [sessionsState, setSessionsState] = React.useState({ status: 'loading', items: [], total: 0, error: null });
			const [scope, setScope] = React.useState('session');
			const [sessionId, setSessionId] = React.useState(null);
			const [figure, setFigure] = React.useState(null);
			const [figureSessionId, setFigureSessionId] = React.useState(null);
			const [controls, setControls] = React.useState(controlsCache);
			const [controlsError, setControlsError] = React.useState(null);
			const [phase, setPhase] = React.useState('loading');
			const [bootError, setBootError] = React.useState(null);
			const [actionError, setActionError] = React.useState(null);
			const [notice, setNotice] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [pending, setPending] = React.useState({});
			const [history, setHistory] = React.useState([]);
			const [redo, setRedo] = React.useState([]);
			const [level, setLevel] = React.useState('basic');
			const [search, setSearch] = React.useState('');
			const [collapsed, setCollapsed] = React.useState({});
			const [expanded, setExpanded] = React.useState({});
			const [sessionsOpen, setSessionsOpen] = React.useState(true);
			const [imageState, setImageState] = React.useState({ src: '', loading: false, failed: false });
			const [zoomed, setZoomed] = React.useState(false);
			const [exporting, setExporting] = React.useState(false);
			const [exportInfo, setExportInfo] = React.useState(null);
			const [nlText, setNlText] = React.useState('');
			const [nlBusy, setNlBusy] = React.useState(false);
			const [nlResult, setNlResult] = React.useState(null);
			const [codeState, setCodeState] = React.useState({ status: 'idle', code: '', path: '', error: null });
			const [codeNonce, setCodeNonce] = React.useState(0);
			const [copyState, setCopyState] = React.useState('idle');
			const [refreshToken, setRefreshToken] = React.useState(0);
			const [deleteMenuOpen, setDeleteMenuOpen] = React.useState(false);
			const [deleteConfirm, setDeleteConfirm] = React.useState(null);
			const [deleting, setDeleting] = React.useState(false);
			/* ---- v4：工具区 ---- */
			const [showAllTools, setShowAllTools] = React.useState(false);
			const [sectionOpen, setSectionOpen] = React.useState({});
			const [palettes, setPalettes] = React.useState({ status: 'idle', data: null, error: null });
			const [paletteTab, setPaletteTab] = React.useState('categorical');
			const [paletteSearch, setPaletteSearch] = React.useState('');

			const aliveRef = React.useRef(true);
			const figureRef = React.useRef(null);
			const figureSessionRef = React.useRef(null);
			const sessionIdRef = React.useRef(null);
			const scopeRef = React.useRef('session');
			const controlsRef = React.useRef(controlsCache);
			const pendingRef = React.useRef({});
			const timerRef = React.useRef(null);
			const historyRef = React.useRef([]);
			const redoRef = React.useRef([]);
			const busyRef = React.useRef(false);
			const allPathsRef = React.useRef([]);
			const suppressHistoryRef = React.useRef(false);
			const menuRef = React.useRef(null);

			figureRef.current = figure;
			figureSessionRef.current = figureSessionId;
			sessionIdRef.current = sessionId;
			scopeRef.current = scope;
			controlsRef.current = controls;
			historyRef.current = history;
			redoRef.current = redo;
			busyRef.current = busy;

			React.useEffect(() => {
				aliveRef.current = true;
				return () => {
					aliveRef.current = false;
					if (timerRef.current !== null) {
						clearTimeout(timerRef.current);
						timerRef.current = null;
					}
				};
			}, []);

			/* ---- 窄屏自适应 ---- */
			React.useEffect(() => {
				if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
				let mq;
				try {
					mq = window.matchMedia('(max-width: 1100px)');
				} catch (error) {
					return undefined;
				}
				const apply = () => {
					const narrow = mq.matches === true;
					setIsNarrow(narrow);
					setRightOpen(!narrow);
				};
				apply();
				if (typeof mq.addEventListener === 'function') {
					mq.addEventListener('change', apply);
					return () => mq.removeEventListener('change', apply);
				}
				if (typeof mq.addListener === 'function') {
					mq.addListener(apply);
					return () => mq.removeListener(apply);
				}
				return undefined;
			}, []);

			/* ---- Esc / 点外关闭菜单 ---- */
			React.useEffect(() => {
				const onKeyDown = (event) => {
					if (event.key !== 'Escape') return;
					if (zoomed) {
						setZoomed(false);
						return;
					}
					if (deleteConfirm) {
						setDeleteConfirm(null);
						return;
					}
					if (deleteMenuOpen) setDeleteMenuOpen(false);
				};
				window.addEventListener('keydown', onKeyDown);
				return () => window.removeEventListener('keydown', onKeyDown);
			}, [zoomed, deleteConfirm, deleteMenuOpen]);

			React.useEffect(() => {
				if (!deleteMenuOpen) return undefined;
				const onPointerDown = (event) => {
					try {
						const root = menuRef.current;
						if (root && event.target instanceof Node && root.contains(event.target)) return;
					} catch (error) {
						/* ignore */
					}
					setDeleteMenuOpen(false);
				};
				document.addEventListener('pointerdown', onPointerDown, true);
				return () => document.removeEventListener('pointerdown', onPointerDown, true);
			}, [deleteMenuOpen]);

			/* ---- 首屏 / 刷新 / 聚焦请求 ---- */
			React.useEffect(() => {
				let cancelled = false;
				void boot(cancelled);
				return () => {
					cancelled = true;
				};
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [refreshToken, snapshot.focusSeq]);

			async function loadPalettes(cancelled) {
				/* 不缓存 palette id 映射（palettes.json 可能整体重排），每次进入工作台都重新拉取。 */
				setPalettes({ status: 'loading', data: null, error: null });
				try {
					const data = await getJson('/palettes', undefined, 20000);
					if (cancelled || !aliveRef.current) return;
					if (!data || data.ok !== true || !Array.isArray(data.palettes)) {
						setPalettes({ status: 'error', data: null, error: (data && data.error) || tr('paletteFailed') });
						return;
					}
					setPalettes({ status: 'ready', data: normalizePalettes(data), error: null });
				} catch (error) {
					if (cancelled || !aliveRef.current) return;
					setPalettes({ status: 'error', data: null, error: describeError(error) });
				}
			}

			/* 图类切换时，确保配色 tab 仍合法（「色带」只属于地图）。 */
			React.useEffect(() => {
				const clsKey = figureClassOf(figure).key;
				if (clsKey !== 'map' && paletteTab === 'colorbar') setPaletteTab('categorical');
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [figure && figure.id, figure && figure.kind]);

			async function boot(cancelled) {
				const focus = workbenchStore.getSnapshot();
				setPhase('loading');
				setBootError(null);
				/* controls */
				if (!controlsRef.current) {
					try {
						const data = await getJson('/controls', undefined, 15000);
						if (cancelled) return;
						if (data && data.ok === true) {
							const next = normalizeControls(data);
							controlsCache = next;
							setControls(next);
							setControlsError(null);
							allPathsRef.current = next.paths;
						} else {
							setControlsError((data && data.error) || tr('controlsFailed'));
						}
					} catch (error) {
						if (!cancelled) setControlsError(describeError(error));
					}
				} else {
					allPathsRef.current = controlsRef.current.paths || [];
				}
				if (cancelled) return;
				/* v4：配色数据（失败只影响配色选择器，不阻塞其它能力） */
				void loadPalettes(cancelled);
				/* sessions */
				let items = null;
				let total = 0;
				let sessionsError = null;
				try {
					const data = await getJson('/sessions', undefined, 20000);
					if (!cancelled) {
						if (data && data.ok === true) {
							items = Array.isArray(data.sessions) ? data.sessions : [];
							total = typeof data.total === 'number' ? data.total : items.reduce((sum, item) => sum + sessionFigureCount(item), 0);
						} else {
							sessionsError = (data && data.error) || tr('sessionsFailed');
						}
					}
				} catch (error) {
					if (!cancelled) sessionsError = describeError(error);
				}
				if (cancelled) return;
				if (items === null) {
					/* /sessions 未就绪时的降级：用 /state 单会话兜底 */
					const fallbackSession = focus.sessionId || sessionIdRef.current || (typeof props.getCurrentSessionId === 'function' ? props.getCurrentSessionId() : null);
					if (fallbackSession) {
						setSessionsState({ status: 'error', items: [], total: 0, error: sessionsError });
						await loadStateOnly(fallbackSession, cancelled, focus.figureId || null);
					} else {
						setSessionsState({ status: 'error', items: [], total: 0, error: sessionsError });
						setBootError(tr('sessionsBackendUnready'));
					}
					if (!cancelled) setPhase('ready');
					return;
				}
				setSessionsState({ status: 'ready', items: items, total: total, error: null });
				const targetSession = focus.sessionId || sessionIdRef.current || (typeof props.getCurrentSessionId === 'function' ? props.getCurrentSessionId() : null);
				const targetFigureId = focus.figureId || (figureRef.current ? figureRef.current.id : null);
				const picked = resolveSelection(items, targetFigureId, targetSession);
				if (picked.sessionId) setSessionId(picked.sessionId);
				setScope(picked.summary || targetSession ? 'session' : 'all');
				if (picked.summary) {
					await activateAndLoad(picked.summary.id, picked.summary.sessionId || picked.sessionId, cancelled, false);
				} else {
					clearFigureLocal();
					workbenchStore.select(picked.sessionId || null, null);
				}
				if (!cancelled) setPhase('ready');
			}

			function resolveSelection(items, targetFigureId, targetSession) {
				if (targetFigureId) {
					for (const session of items) {
						for (const entry of sessionFigures(session)) {
							if (entry && entry.id === targetFigureId) return { sessionId: session.sessionId, summary: entry, session: session };
						}
					}
				}
				if (targetSession) {
					const session = items.find((item) => item && item.sessionId === targetSession);
					if (session) {
						const figures = sessionFigures(session);
						return { sessionId: session.sessionId, summary: figures.length > 0 ? figures[0] : null, session: session };
					}
					return { sessionId: targetSession, summary: null, session: null };
				}
				for (const session of items) {
					const figures = sessionFigures(session);
					if (figures.length > 0) return { sessionId: session.sessionId, summary: figures[0], session: session };
				}
				return { sessionId: null, summary: null, session: null };
			}

			async function loadStateOnly(sid, cancelled, preferredFigureId) {
				if (!sid) return false;
				try {
					let activeFigure = null;
					if (preferredFigureId) {
						try {
							await postJson('/active', { figureId: preferredFigureId, sessionId: sid }, 20000);
							activeFigure = preferredFigureId;
						} catch (error) {
							/* 忽略：退回 host 的 active 图 */
						}
					}
					const data = await getJson('/state', { sessionId: sid }, 20000);
					if (cancelled || !aliveRef.current) return false;
					if (!data || data.ok !== true) {
						setBootError((data && data.error) || tr('stateFailed'));
						return false;
					}
					setScope('session');
					setSessionId(sid);
					setFigureSessionId(sid);
					applyFigure(data.figure || null, { silent: true, sessionId: sid });
					const figures = Array.isArray(data.figures) ? data.figures : [];
					setSessionsState({
						status: 'error',
						items: figures.length > 0 || data.figure ? [{ sessionId: sid, title: '', count: figures.length, latestAt: (data.figure && data.figure.updatedAt) || '', figures: figures }] : [],
						total: figures.length,
						error: tr('sessionsBackendUnready'),
					});
					return !!(activeFigure || data.figure);
				} catch (error) {
					if (!cancelled && aliveRef.current) setBootError(describeError(error));
					return false;
				}
			}

			async function activateAndLoad(figureId, sid, cancelled, allowFallback) {
				if (!figureId || !sid) return false;
				setBusy(true);
				busyRef.current = true;
				try {
					await postJson('/active', { figureId: figureId, sessionId: sid }, 20000);
					const data = await getJson('/state', { sessionId: sid }, 20000);
					if (cancelled || !aliveRef.current) return false;
					if (!data || data.ok !== true) {
						setActionError((data && data.error) || tr('stateFailed'));
						return false;
					}
					setScope('session');
					setSessionId(sid);
					setFigureSessionId(sid);
					applyFigure(data.figure || null, { silent: true, sessionId: sid });
					mergeStateFigures(sid, data.figures, data.figure);
					return true;
				} catch (error) {
					if (!cancelled && aliveRef.current) {
						if (allowFallback) setBootError(tr('sessionsBackendUnready') + '：' + describeError(error));
						else setActionError(describeError(error));
					}
					return false;
				} finally {
					if (aliveRef.current) {
						busyRef.current = false;
						setBusy(false);
					}
				}
			}

			function clearFigureLocal() {
				setFigure(null);
				figureRef.current = null;
				setImageState({ src: '', loading: false, failed: false });
				clearPendingState();
				setHistory([]);
				setRedo([]);
				setNlResult(null);
				setExportInfo(null);
				setCodeState({ status: 'idle', code: '', path: '', error: null });
			}

			function clearPendingState() {
				if (timerRef.current !== null) {
					clearTimeout(timerRef.current);
					timerRef.current = null;
				}
				pendingRef.current = {};
				setPending({});
			}

			function applyFigure(nextFigure, options) {
				const opts = options || {};
				const previous = figureRef.current;
				setFigure(nextFigure || null);
				figureRef.current = nextFigure || null;
				if (opts.sessionId) setFigureSessionId(opts.sessionId);
				else if (nextFigure && nextFigure.sessionId) setFigureSessionId(nextFigure.sessionId);
				if (previous && nextFigure && !opts.silent) recordHistory(previous.spec, nextFigure.spec);
				if (nextFigure) {
					const sid = opts.sessionId || nextFigure.sessionId || figureSessionRef.current;
					if (sid) addFigureToSessions(nextFigure, sid);
					if (nextFigure.imageUrl) setImageState((current) => (current.src === nextFigure.imageUrl ? current : { src: nextFigure.imageUrl, loading: true, failed: false }));
				}
			}

			function addFigureToSessions(nextFigure, sid) {
				if (!nextFigure || !nextFigure.id || !sid) return;
				const summary = figureSummary(nextFigure);
				setSessionsState((state) => {
					let items = state.items.map((session) => Object.assign({}, session, { figures: sessionFigures(session).slice() }));
					let target = items.find((session) => session && session.sessionId === sid);
					if (!target) {
						target = { sessionId: sid, title: '', count: 0, latestAt: nextFigure.updatedAt || '', figures: [] };
						items = [target].concat(items);
					}
					target.figures = [summary].concat(target.figures.filter((entry) => entry && entry.id !== summary.id));
					target.count = target.figures.length;
					target.latestAt = nextFigure.updatedAt || target.latestAt || '';
					items.sort((left, right) => String((right && right.latestAt) || '').localeCompare(String((left && left.latestAt) || '')));
					const total = items.reduce((sum, session) => sum + sessionFigureCount(session), 0);
					return { status: state.status === 'loading' ? 'ready' : state.status, items: items, total: total, error: state.error };
				});
			}

			function mergeStateFigures(sid, figures, activeFigure) {
				if (!Array.isArray(figures)) {
					if (activeFigure) addFigureToSessions(activeFigure, sid);
					return;
				}
				setSessionsState((state) => {
					if (state.status !== 'ready' || state.items.length === 0) {
						if (activeFigure) addFigureToSessions(activeFigure, sid);
						return state;
					}
					const items = state.items.map((session) => (session && session.sessionId === sid ? Object.assign({}, session, { figures: figures.slice(), count: figures.length }) : session));
					const total = items.reduce((sum, session) => sum + sessionFigureCount(session), 0);
					return { status: state.status, items: items, total: total, error: state.error };
				});
			}

			function recordHistory(previousSpec, nextSpec) {
				if (suppressHistoryRef.current) return;
				const paths = allPathsRef.current;
				if (!Array.isArray(paths) || paths.length === 0) return;
				const before = {};
				const set = {};
				let changed = false;
				for (const path of paths) {
					const oldValue = getPath(previousSpec, path);
					const newValue = getPath(nextSpec, path);
					if (!valuesEqual(oldValue, newValue)) {
						before[path] = oldValue;
						set[path] = newValue;
						changed = true;
					}
				}
				if (!changed) return;
				setHistory((current) => [...current.slice(-49), { before: before, set: set }]);
				setRedo([]);
			}

			function resolveValue(path, item) {
				if (Object.prototype.hasOwnProperty.call(pending, path)) return pending[path];
				const specValue = getPath(figure && figure.spec, path);
				if (specValue !== undefined) return specValue;
				return item && item.default !== undefined ? item.default : undefined;
			}

			function commitPath(path, value) {
				queuePatch({ [path]: value });
			}

			function queuePatch(set) {
				if (!figureRef.current || !figureRef.current.id) {
					setActionError(tr('noFigure'));
					return;
				}
				pendingRef.current = Object.assign({}, pendingRef.current, set);
				setPending(Object.assign({}, pendingRef.current));
				if (timerRef.current !== null) clearTimeout(timerRef.current);
				timerRef.current = setTimeout(() => {
					timerRef.current = null;
					void flushPatch();
				}, 250);
			}

			async function flushPatch() {
				if (busyRef.current) {
					if (timerRef.current === null) {
						timerRef.current = setTimeout(() => {
							timerRef.current = null;
							void flushPatch();
						}, 150);
					}
					return;
				}
				const set = pendingRef.current;
				pendingRef.current = {};
				const current = figureRef.current;
				if (!current || !current.id) {
					setPending({});
					return;
				}
				if (Object.keys(set).length === 0) {
					setPending({});
					return;
				}
				setBusy(true);
				busyRef.current = true;
				setActionError(null);
				try {
					const data = await postJson('/patch', { figureId: current.id, set: set }, 90000);
					if (!aliveRef.current) return;
					if (data && data.figure) applyFigure(data.figure, { silent: false, sessionId: figureSessionRef.current });
					if (!data || data.ok !== true) {
						setActionError((data && data.error) || tr('patchFailed'));
						setPending({});
					} else {
						setPending({});
						if (Array.isArray(data.rejected) && data.rejected.length > 0) {
							setNotice({ tone: 'warn', text: tr('partialApplied') + '：' + data.rejected.map((entry) => String(entry && entry.path) + '(' + String((entry && entry.reason) || '原因未知') + ')').join('，') });
						}
					}
				} catch (error) {
					if (aliveRef.current) {
						setActionError(describeError(error));
						setPending({});
					}
				} finally {
					if (aliveRef.current) {
						busyRef.current = false;
						setBusy(false);
					}
				}
			}

			async function runHistoryStep(direction) {
				if (busyRef.current) return;
				const source = direction === 'undo' ? historyRef.current : redoRef.current;
				if (source.length === 0) return;
				const current = figureRef.current;
				if (!current || !current.id) return;
				const entry = source[source.length - 1];
				const set = {};
				const unset = [];
				if (direction === 'undo') {
					for (const [path, value] of Object.entries(entry.before)) {
						if (value === undefined) unset.push(path);
						else set[path] = value;
					}
				} else {
					for (const [path, value] of Object.entries(entry.set)) {
						if (value === undefined) unset.push(path);
						else set[path] = value;
					}
				}
				suppressHistoryRef.current = true;
				setBusy(true);
				busyRef.current = true;
				setActionError(null);
				try {
					const body = { figureId: current.id, set: set };
					if (unset.length > 0) body.unset = unset;
					const data = await postJson('/patch', body, 90000);
					if (!aliveRef.current) return;
					if (data && data.figure) applyFigure(data.figure, { silent: true, sessionId: figureSessionRef.current });
					if (!data || data.ok !== true) setActionError((data && data.error) || tr('historyFailed'));
					else if (direction === 'undo') {
						setHistory((list) => list.slice(0, -1));
						setRedo((list) => [...list.slice(-49), entry]);
					} else {
						setRedo((list) => list.slice(0, -1));
						setHistory((list) => [...list.slice(-49), entry]);
					}
					setPending({});
				} catch (error) {
					if (aliveRef.current) setActionError(describeError(error));
				} finally {
					if (aliveRef.current) {
						busyRef.current = false;
						setBusy(false);
						suppressHistoryRef.current = false;
					}
				}
			}

			async function selectFigure(summary, sid) {
				if (!summary || !summary.id) return;
				if (figureRef.current && figureRef.current.id === summary.id) return;
				clearPendingState();
				setHistory([]);
				setRedo([]);
				setNlResult(null);
				setExportInfo(null);
				setActionError(null);
				setNotice(null);
				if (sid) {
					setFigureSessionId(sid);
					setSessionId(sid);
				}
				workbenchStore.select(sid || figureSessionRef.current || null, summary.id);
				await activateAndLoad(summary.id, sid || figureSessionRef.current || null, false, false);
			}

			function changeScope(value) {
				if (value === ALL_TASKS) {
					setScope('all');
					return;
				}
				setScope('session');
				setSessionId(value);
				const session = sessionsState.items.find((item) => item && item.sessionId === value);
				const latest = sessionFigures(session)[0];
				if (latest) {
					void selectFigure(latest, value);
				} else {
					clearFigureLocal();
					setFigureSessionId(value);
					workbenchStore.select(value, null);
				}
			}

			async function applyPreset(presetId) {
				if (!figure || !figure.id || busyRef.current) return;
				setBusy(true);
				busyRef.current = true;
				setActionError(null);
				try {
					const data = await postJson('/preset', { figureId: figure.id, preset: presetId }, 90000);
					if (!aliveRef.current) return;
					if (data && data.figure) applyFigure(data.figure, { sessionId: figureSessionRef.current });
					if (!data || data.ok !== true) setActionError((data && data.error) || tr('presetFailed'));
				} catch (error) {
					if (aliveRef.current) setActionError(describeError(error));
				} finally {
					if (aliveRef.current) {
						busyRef.current = false;
						setBusy(false);
					}
				}
			}

			async function submitNaturalLanguage() {
				const text = nlText.trim();
				if (text === '') {
					setActionError(tr('nlEmpty'));
					return;
				}
				if (!figure || !figure.id || nlBusy) return;
				setNlBusy(true);
				setActionError(null);
				setNlResult(null);
				try {
					const data = await postJson('/nl', { figureId: figure.id, text: text }, 90000);
					if (!aliveRef.current) return;
					const applied = Array.isArray(data.applied) ? data.applied : [];
					const unapplied = Array.isArray(data.unapplied) ? data.unapplied : [];
					setNlResult({ applied: applied, unapplied: unapplied, ok: data.ok === true });
					if (data && data.figure) applyFigure(data.figure, { sessionId: figureSessionRef.current });
					if (!data || data.ok !== true) setActionError((data && data.error) || tr('nlFailed'));
					else if (data.error) setActionError(String(data.error));
					else if (applied.length === 0) setActionError(tr('nlNoChange'));
					else setNlText('');
				} catch (error) {
					if (aliveRef.current) setActionError(describeError(error));
				} finally {
					if (aliveRef.current) setNlBusy(false);
				}
			}

			function triggerDownload(url, filename) {
				try {
					const anchor = document.createElement('a');
					if (filename) anchor.download = filename;
					anchor.href = url;
					anchor.rel = 'noopener';
					anchor.click();
				} catch (error) {
					console.error('[scifig] download failed', error);
					setActionError(tr('exportFailed'));
				}
			}

			async function exportPng() {
				if (!figure || !figure.id || exporting) return;
				setExporting(true);
				setActionError(null);
				setExportInfo(null);
				try {
					const data = await postJson('/export', { figureId: figure.id }, 120000);
					if (!aliveRef.current) return;
					if (!data || data.ok !== true) {
						setActionError((data && data.error) || tr('exportFailed'));
						return;
					}
					setExportInfo(data);
					setNotice({ tone: 'success', text: tr('exportDone') + (data.path ? '：' + String(data.path) : '') });
					triggerDownload(data.url || buildUrl('/download', { id: figure.id, rev: figure.rev }), 'scifig-' + String(figure.id || 'figure') + '.png');
				} catch (error) {
					if (aliveRef.current) setActionError(describeError(error));
				} finally {
					if (aliveRef.current) setExporting(false);
				}
			}

			/* ---- 复制 PNG 路径（单图便利操作） ---- */
			function copyPngPath() {
				const path = figure && typeof figure.pngPath === 'string' ? figure.pngPath : '';
				if (!path) {
					setActionError(tr('noPngPath'));
					return;
				}
				const fallback = () => setNotice({ tone: 'warn', text: tr('pngPathCopyFailed') + path });
				try {
					if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
						navigator.clipboard.writeText(path).then(
							() => setNotice({ tone: 'success', text: tr('pngPathCopied') }),
							() => fallback(),
						);
					} else {
						fallback();
					}
				} catch (error) {
					fallback();
				}
			}

			/* ---- 删除工作区 ---- */
			function findSession(sid) {
				if (!sid) return null;
				return sessionsState.items.find((session) => session && session.sessionId === sid) || null;
			}

			function buildDeleteConfirm(mode) {
				if (mode === 'figure') {
					if (!figure || !figure.id) {
						setActionError(tr('deleteNoFigure'));
						return null;
					}
					const title = figureDisplayTitle(figure);
					return { mode: 'figure', figureId: figure.id, sessionId: figureSessionRef.current || figure.sessionId || null, title: title, text: tr('deleteFigureConfirm', { title: title }) };
				}
				if (mode === 'session') {
					const sid = figureSessionRef.current || sessionIdRef.current;
					if (!sid) {
						setActionError(tr('deleteNoSession'));
						return null;
					}
					const session = findSession(sid);
					const title = sessionDisplayTitle(session);
					const count = sessionFigureCount(session);
					return { mode: 'session', sessionId: sid, title: title, text: tr('deleteSessionConfirm', { title: title, n: count }) };
				}
				const total = sessionsState.total || sessionsState.items.reduce((sum, session) => sum + sessionFigureCount(session), 0);
				return { mode: 'all', text: tr('deleteAllConfirm', { n: total }) };
			}

			function beginDelete(mode) {
				setDeleteMenuOpen(false);
				const info = buildDeleteConfirm(mode);
				if (info) setDeleteConfirm(info);
			}

			async function runDelete() {
				const info = deleteConfirm;
				if (!info || deleting) return;
				setDeleting(true);
				setActionError(null);
				try {
					// confirm:true —— Host 对 mode:"all" 强制要求（HTTP 与工具同一实现，§8.3/§8.4）；
					// 用户已在二次确认对话框里确认过，这里等价转达。
					const body = { mode: info.mode, includeComponents: true, deleteFiles: true, confirm: true };
					if (info.mode === 'figure') body.figureId = info.figureId;
					if (info.mode === 'session') body.sessionId = info.sessionId;
					const data = await postJson('/workspace/delete', body, 180000);
					if (!aliveRef.current) return;
					if (!data || data.ok !== true) {
						setActionError((data && data.error) || tr('deleteFailed'));
						setDeleteConfirm(null);
						return;
					}
					const deleted = data.deleted || {};
					const remaining = data.remaining || {};
					setNotice({
						tone: 'success',
						text: tr('deleteDone', {
							figures: numberOrZero(deleted.figures),
							components: numberOrZero(deleted.components),
							composites: numberOrZero(deleted.composites),
							files: numberOrZero(deleted.files),
							remainingFigures: numberOrZero(remaining.figures),
							remainingComponents: numberOrZero(remaining.components),
						}),
					});
					setDeleteConfirm(null);
					await pickAfterDelete(info);
				} catch (error) {
					if (aliveRef.current) {
						setActionError(describeError(error));
						setDeleteConfirm(null);
					}
				} finally {
					if (aliveRef.current) setDeleting(false);
				}
			}

			async function pickAfterDelete(info) {
				let items = null;
				try {
					const data = await getJson('/sessions', undefined, 20000);
					if (data && data.ok === true) items = Array.isArray(data.sessions) ? data.sessions : [];
				} catch (error) {
					/* 保留旧列表，靠 /state 兜底 */
				}
				clearPendingState();
				clearFigureLocal();
				if (items === null) {
					const sid = info.mode === 'figure' ? info.sessionId : null;
					if (sid) {
						setSessionsState({ status: 'error', items: [], total: 0, error: tr('sessionsFailed') });
						await loadStateOnly(sid, false, null);
					} else setScope('all');
					return;
				}
				const total = items.reduce((sum, session) => sum + sessionFigureCount(session), 0);
				setSessionsState({ status: 'ready', items: items, total: total, error: null });
				let nextSessionId = null;
				let nextFigure = null;
				if (info.mode === 'figure' && info.sessionId) {
					const session = items.find((entry) => entry && entry.sessionId === info.sessionId);
					const latest = sessionFigures(session)[0];
					if (latest) {
						nextSessionId = info.sessionId;
						nextFigure = latest;
					}
				}
				if (!nextFigure) {
					for (const session of items) {
						const latest = sessionFigures(session)[0];
						if (latest) {
							nextSessionId = session && session.sessionId;
							nextFigure = latest;
							break;
						}
					}
				}
				const keepSession = info.mode === 'figure' && nextSessionId && nextSessionId === info.sessionId;
				setScope(keepSession ? 'session' : 'all');
				if (nextFigure && nextSessionId) {
					setSessionId(nextSessionId);
					setFigureSessionId(nextSessionId);
					workbenchStore.select(nextSessionId, nextFigure.id);
					await activateAndLoad(nextFigure.id, nextSessionId, false, false);
				} else {
					setSessionId(null);
					setFigureSessionId(null);
					workbenchStore.select(null, null);
				}
			}

			/* ---- 代码 ---- */
			const codeId = figure && figure.id ? figure.id : '';
			const codeRev = figure && figure.rev ? String(figure.rev) : '';
			React.useEffect(() => {
				if (tab !== 'code') return undefined;
				if (!codeId) {
					setCodeState({ status: 'empty', code: '', path: '', error: null });
					return undefined;
				}
				let cancelled = false;
				setCodeState({ status: 'loading', code: '', path: '', error: null });
				(async () => {
					try {
						const data = await getJson('/code', { id: codeId }, 20000);
						if (cancelled) return;
						if (!data || data.ok !== true) {
							setCodeState({ status: 'error', code: '', path: '', error: (data && data.error) || tr('codeFailed') });
							return;
						}
						setCodeState({ status: data.code ? 'ready' : 'empty', code: typeof data.code === 'string' ? data.code : '', path: typeof data.path === 'string' ? data.path : '', error: null });
					} catch (error) {
						if (cancelled) return;
						setCodeState({ status: 'error', code: '', path: '', error: describeError(error) });
					}
				})();
				return () => {
					cancelled = true;
				};
			}, [tab, codeId, codeRev, codeNonce]);

			function reloadCode() {
				setCodeState({ status: 'idle', code: '', path: '', error: null });
				setCodeNonce((value) => value + 1);
			}

			async function copyCode() {
				const code = codeState.code;
				if (!code) return;
				try {
					if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
						await navigator.clipboard.writeText(code);
						setCopyState('copied');
						setTimeout(() => setCopyState('idle'), 1600);
					} else {
						setActionError(tr('codeCopyFailed'));
					}
				} catch (error) {
					setActionError(tr('codeCopyFailed'));
				}
			}

			function downloadCode() {
				const code = codeState.code;
				if (!code) return;
				try {
					const blob = new Blob([code], { type: 'text/x-python;charset=utf-8' });
					const url = URL.createObjectURL(blob);
					const filename = codeState.path ? String(codeState.path).split(/[\\/]/).pop() : 'component.py';
					triggerDownload(url, filename || 'component.py');
					setTimeout(() => URL.revokeObjectURL(url), 8000);
				} catch (error) {
					setActionError(tr('codeFailed'));
				}
			}

			/* ---- 派生值 ---- */
			const groups = controls && Array.isArray(controls.groups) ? controls.groups : [];
			const presets = controls && Array.isArray(controls.presets) ? controls.presets : [];
			const imageUrl = figure && figure.imageUrl ? figure.imageUrl : '';
			const totalFigures = sessionsState.total || 0;

			/** 工具区标题旁的一行信息：图型 · 画幅 · dpi。 */
			function figureMetaText() {
				if (!figure) return '';
				const spec = figure.spec && typeof figure.spec === 'object' ? figure.spec : {};
				const fig = spec.figure && typeof spec.figure === 'object' ? spec.figure : {};
				const parts = [kindLabel(figure.kind)];
				if (typeof fig.widthMm === 'number' && typeof fig.heightMm === 'number') parts.push(String(fig.widthMm) + '×' + String(fig.heightMm) + 'mm');
				if (typeof fig.dpi === 'number') parts.push(String(fig.dpi) + 'dpi');
				return parts.join(' · ');
			}

			function toggleGroup(key) {
				setCollapsed((state) => Object.assign({}, state, { [key]: !state[key] }));
			}
			function groupOpen(key) {
				return Object.prototype.hasOwnProperty.call(collapsed, key) ? collapsed[key] === true : false;
			}
			function isExpanded(sid) {
				if (Object.prototype.hasOwnProperty.call(expanded, sid)) return expanded[sid] === true;
				return figureSessionRef.current === sid;
			}
			function toggleExpanded(sid) {
				setExpanded((state) => Object.assign({}, state, { [sid]: !isExpanded(sid) }));
			}

			/* ---- 渲染：顶栏 ---- */
			function renderTopBar() {
				const meta = [];
				if (figure) {
					meta.push(h('span', { key: 'kind' }, kindLabel(figure.kind)));
					if (figure.rev !== undefined) {
						meta.push(h('span', { key: 'sep-rev', className: 'scf-ws-meta-sep' }));
						meta.push(h('span', { key: 'rev' }, tr('rev') + ' ' + String(figure.rev)));
					}
					if (figure.rendering === true) {
						meta.push(h('span', { key: 'sep-render', className: 'scf-ws-meta-sep' }));
						meta.push(h('span', { key: 'render' }, tr('rendering')));
					}
				} else {
					meta.push(h('span', { key: 'none' }, tr('noFigure')));
				}
				meta.push(h('span', { key: 'sep-total', className: 'scf-ws-meta-sep' }));
				meta.push(h('span', { key: 'total' }, tr('figuresCount', { n: totalFigures })));
				const options = [h('option', { key: '__all__', value: ALL_TASKS }, tr('allTasks') + '（' + String(totalFigures) + '）')];
				for (const session of sessionsState.items) {
					if (!session || !session.sessionId) continue;
					options.push(h('option', { key: session.sessionId, value: session.sessionId }, sessionDisplayTitle(session) + ' · ' + String(sessionFigureCount(session)) + ' 张图'));
				}
				const selectValue = scope === 'all' ? ALL_TASKS : sessionId || '';
				const deleteDisabled = !figure && sessionsState.items.length === 0;
				return h(
					'header',
					{ className: 'scf-ws-top' },
					h('span', { className: 'scf-ws-title' }, h('span', { className: 'scf-ws-title-icon' }, h(Icon, { name: 'studio', size: 16 })), tr('workspaceTitle')),
					h('select', {
						className: 'scf-ws-select',
						value: selectValue,
						'aria-label': tr('sessionSwitcher'),
						disabled: sessionsState.status === 'loading' || sessionsState.items.length === 0,
						onChange: (event) => changeScope(event.target.value),
					}, options),
					h('span', { className: 'scf-ws-meta' }, meta),
					h('span', { className: 'scf-ws-top-spacer' }),
					isNarrow ? h(Button, { icon: 'grid', onClick: () => setRightOpen((value) => !value), title: rightOpen ? tr('hideParams') : tr('showParams') }, rightOpen ? tr('hideParams') : tr('showParams')) : null,
					h(
						'div',
						{ className: 'scf-ws-actions' },
						h(IconButton, { name: 'undo', title: tr('undo'), disabled: busy || history.length === 0, onClick: () => runHistoryStep('undo') }),
						h(IconButton, { name: 'redo', title: tr('redo'), disabled: busy || redo.length === 0, onClick: () => runHistoryStep('redo') }),
						h(IconButton, {
							name: 'refresh',
							title: tr('refresh'),
							onClick: () => {
								controlsCache = null;
								controlsRef.current = null;
								setControls(null);
								setPalettes({ status: 'idle', data: null, error: null });
								setRefreshToken((value) => value + 1);
							},
						}),
						h(Button, { icon: 'download', onClick: exportPng, disabled: !figure || exporting }, exporting ? tr('exporting') : tr('exportPng')),
						h(IconButton, { name: 'copy', title: tr('copyPngPath'), disabled: !figure, onClick: copyPngPath }),
						h(
							'div',
							{ className: 'scf-menu-anchor', ref: menuRef },
							h(Button, { icon: 'trash', onClick: () => setDeleteMenuOpen((value) => !value), disabled: deleteDisabled, title: tr('deleteWorkspace') }, tr('deleteWorkspace')),
							deleteMenuOpen
								? h(
										'div',
										{ className: 'scf-menu', role: 'menu', 'data-scifig-menu': 'delete' },
										h('button', { type: 'button', className: 'scf-menu-item', role: 'menuitem', 'data-delete-mode': 'figure', disabled: !figure, onClick: () => beginDelete('figure') }, h(Icon, { name: 'image', size: 12 }), tr('deleteFigure')),
										h('button', { type: 'button', className: 'scf-menu-item', role: 'menuitem', 'data-delete-mode': 'session', disabled: !(figureSessionRef.current || sessionId), onClick: () => beginDelete('session') }, h(Icon, { name: 'layers', size: 12 }), tr('deleteSession')),
										h('span', { className: 'scf-menu-sep' }),
										h('button', { type: 'button', className: 'scf-menu-item', role: 'menuitem', 'data-tone': 'danger', 'data-delete-mode': 'all', onClick: () => beginDelete('all') }, h(Icon, { name: 'trash', size: 12 }), tr('deleteAll')),
									)
								: null,
						),
					),
				);
			}

			function renderStrip() {
				const items = [];
				if (actionError) {
					items.push(h('div', { key: 'err', className: 'scf-strip', 'data-tone': 'error', role: 'alert' }, h('span', { className: 'scf-strip-main' }, actionError), h(IconButton, { name: 'close', title: tr('dismiss'), onClick: () => setActionError(null) })));
				}
				if (notice) {
					items.push(h('div', { key: 'notice', className: 'scf-strip', 'data-tone': notice.tone || 'success', role: 'status' }, h('span', { className: 'scf-strip-main' }, notice.text), h(IconButton, { name: 'close', title: tr('dismiss'), onClick: () => setNotice(null) })));
				}
				return items.length > 0 ? h(React.Fragment, null, items) : null;
			}

			/* ---- 渲染：左栏 ---- */
			function renderFigureRow(entry, sid) {
				if (!entry || !entry.id) return null;
				const active = figure && figure.id === entry.id;
				return h(
					'button',
					{ key: entry.id, type: 'button', className: 'scf-ws-figure', 'data-figure-id': entry.id, 'data-active': active ? 'true' : 'false', onClick: () => selectFigure(entry, sid), title: String(entry.title || entry.id) },
					entry.imageUrl ? h('img', { className: 'scf-ws-figure-thumb', src: entry.imageUrl, alt: '', loading: 'lazy' }) : h('span', { className: 'scf-ws-figure-thumb' }),
					h(
						'span',
						{ className: 'scf-ws-figure-main' },
						h('span', { className: 'scf-ws-figure-title' }, String(entry.title || entry.id)),
						h('span', { className: 'scf-ws-figure-meta' }, kindLabel(entry.kind), entry.rev !== undefined ? h('span', null, 'r' + String(entry.rev)) : null, entry.error ? h('span', { className: 'scf-dot', 'data-tone': 'error', title: String(entry.error) }) : null),
					),
				);
			}

			function renderLeftBody() {
				if (sessionsState.status === 'loading') return h(LoadingLine, { text: tr('sessionsLoading') });
				const items = sessionsState.items;
				if (items.length === 0) {
					if (sessionsState.status === 'error') {
						return h(
							'div',
							{ className: 'scf-empty' },
							h(Icon, { name: 'warning', size: 18 }),
							h('span', { className: 'scf-empty-title' }, tr('sessionsBackendUnready')),
							h('span', { className: 'scf-hint' }, sessionsState.error || tr('sessionsFailed')),
							h(Button, { icon: 'refresh', onClick: () => setRefreshToken((value) => value + 1) }, tr('retry')),
						);
					}
					return h('div', { className: 'scf-empty' }, h(Icon, { name: 'image', size: 18 }), h('span', { className: 'scf-empty-title' }, tr('sessionsEmpty')), h('span', { className: 'scf-hint' }, tr('sessionsEmptyHint')));
				}
				if (scope === 'session') {
					const session = findSession(sessionId) || findSession(figureSessionRef.current);
					const figures = sessionFigures(session);
					return h('div', { className: 'scf-list' }, figures.length > 0 ? figures.map((entry) => renderFigureRow(entry, session && session.sessionId)) : h('div', { className: 'scf-hint' }, tr('sessionsEmptyHint')));
				}
				return h(
					'div',
					{ className: 'scf-list' },
					items.map((session) => {
						if (!session || !session.sessionId) return null;
						const sid = session.sessionId;
						const open = isExpanded(sid);
						const figures = sessionFigures(session);
						return h(
							'div',
							{ className: 'scf-ws-session', key: sid },
							h(
								'button',
								{ type: 'button', className: 'scf-ws-session-head', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggleExpanded(sid), title: sessionDisplayTitle(session) },
								h('span', { className: 'scf-group-chevron', 'data-open': open ? 'true' : 'false' }, h(Icon, { name: 'chevron', size: 11 })),
								h('span', { className: 'scf-ws-session-name' }, sessionDisplayTitle(session)),
								h('span', { className: 'scf-ws-session-count' }, String(sessionFigureCount(session))),
							),
							open ? h('div', { className: 'scf-ws-indent' }, figures.length > 0 ? figures.map((entry) => renderFigureRow(entry, sid)) : h('div', { className: 'scf-hint' }, tr('sessionsEmptyHint'))) : null,
						);
					}),
				);
			}

			function renderLeftColumn() {
				return h(
					'aside',
					{ className: 'scf-ws-left', 'data-scifig-left': '1' },
					h(
						'div',
						{ className: 'scf-ws-left-head' },
						h(
							'button',
							{ type: 'button', className: 'scf-ws-left-toggle', 'aria-expanded': sessionsOpen ? 'true' : 'false', onClick: () => setSessionsOpen((value) => !value) },
							h('span', { className: 'scf-group-chevron', 'data-open': sessionsOpen ? 'true' : 'false' }, h(Icon, { name: 'chevron', size: 12 })),
							h('span', null, tr('sessionsLabel')),
							h('span', { className: 'scf-ws-left-count' }, tr('figuresCount', { n: totalFigures })),
						),
					),
					sessionsOpen ? h('div', { className: 'scf-ws-left-scroll' }, h(Boundary, { label: tr('sessionsLabel') }, renderLeftBody())) : null,
				);
			}

			/* ---- 渲染：中栏 ---- */
			function renderTabs() {
				const tabs = [
					{ id: 'preview', label: tr('tabPreview'), icon: 'image' },
					{ id: 'code', label: tr('tabCode'), icon: 'code' },
				];
				return h(
					'nav',
					{ className: 'scf-ws-tabs', role: 'tablist', 'aria-label': tr('workspaceTitle') },
					tabs.map((entry) =>
						h(
							'button',
							{ key: entry.id, type: 'button', role: 'tab', className: 'scf-ws-tab', 'data-scf-tab': entry.id, 'data-active': tab === entry.id ? 'true' : 'false', 'aria-selected': tab === entry.id ? 'true' : 'false', onClick: () => setTab(entry.id) },
							h(Icon, { name: entry.icon, size: 12 }),
							entry.label,
							entry.count !== undefined ? h('span', { className: 'scf-ws-tab-count' }, String(entry.count)) : null,
						),
					),
				);
			}

			function renderNoFigureState() {
				if (bootError || (sessionsState.status === 'error' && sessionsState.items.length === 0)) {
					return h(
						'div',
						{ className: 'scf-ws-empty' },
						h(Icon, { name: 'warning', size: 22 }),
						h('span', { className: 'scf-ws-empty-title' }, tr('backendUnready')),
						h('span', null, bootError || sessionsState.error || tr('backendHint')),
						h(Button, { icon: 'refresh', onClick: () => setRefreshToken((value) => value + 1) }, tr('retry')),
					);
				}
				return h(
					'div',
					{ className: 'scf-ws-empty' },
					h(Icon, { name: 'image', size: 22 }),
					h('span', { className: 'scf-ws-empty-title' }, tr('noFigure')),
					h('span', null, tr('selectFigureHint')),
				);
			}

			function renderPreviewTab() {
				if (!figure) {
					if (phase === 'loading') return h(LoadingLine, { text: tr('loading') });
					return renderNoFigureState();
				}
				const showSpinner = imageState.loading || busy;
				return h(
					'div',
					{ className: 'scf-ws-preview', 'data-scifig-preview': '1' },
					h(
						'div',
						{ className: 'scf-ws-preview-bar' },
						h(
							'span',
							{ className: 'scf-ws-preview-meta' },
							h('span', null, kindLabel(figure.kind)),
							figure.rev !== undefined ? h('span', { className: 'scf-ws-meta-sep' }) : null,
							figure.rev !== undefined ? h('span', null, tr('rev') + ' ' + String(figure.rev)) : null,
							figure.rendering === true || busy ? h('span', { className: 'scf-state' }, h('span', { className: 'scf-dot', 'data-tone': 'running' }), busy ? tr('repainting') : tr('rendering')) : null,
						),
						h(
							'span',
							{ className: 'scf-ws-preview-actions' },
							h(Button, { icon: 'image', disabled: !imageUrl, onClick: () => setZoomed(true) }, tr('expandImage')),
							h(Button, { icon: 'download', onClick: () => triggerDownload(buildUrl('/download', { id: figure.id, rev: figure.rev }), 'scifig-' + String(figure.id) + '.png') }, tr('download')),
						),
					),
					h(
						'div',
						{ className: 'scf-ws-preview-canvas' },
						imageUrl && !imageState.failed
							? h('img', {
									src: imageUrl,
									alt: figureDisplayTitle(figure),
									onClick: () => setZoomed(true),
									onLoad: () => setImageState((state) => Object.assign({}, state, { loading: false, failed: false })),
									onError: () => setImageState((state) => Object.assign({}, state, { loading: false, failed: true })),
								})
							: h('div', { className: 'scf-ws-empty' }, h(Icon, { name: imageState.failed ? 'warning' : 'image', size: 20 }), h('span', null, imageState.failed ? tr('previewFailed') : tr('previewEmpty'))),
						showSpinner ? h('div', { className: 'scf-ws-preview-overlay', role: 'status' }, h('span', { className: 'scf-state' }, h(Spinner, null), h('span', null, busy ? tr('repainting') : tr('rendering')))) : null,
					),
				);
			}

			function renderCodeTab() {
				const body = [];
				body.push(
					h(
						'div',
						{ key: 'head', className: 'scf-section' },
						h(
							'div',
							{ className: 'scf-section-head' },
							h('span', { className: 'scf-section-title' }, tr('codeTitle')),
							h(
								'div',
								{ className: 'scf-row' },
								h(Button, { icon: 'refresh', onClick: reloadCode }, tr('retry')),
							),
						),
					),
				);
				if (codeState.status === 'loading' || (codeState.status === 'idle' && codeId)) {
					body.push(h(LoadingLine, { key: 'loading', text: tr('codeLoading') }));
				} else if (codeState.status === 'error') {
					body.push(
						h(Banner, { key: 'code-error', tone: 'error', label: tr('codeFailed'), text: codeState.error || tr('codeFailed'), onDismiss: null }),
						h('div', { key: 'code-retry', style: { display: 'flex', justifyContent: 'center' } }, h(Button, { icon: 'refresh', onClick: reloadCode }, tr('retry'))),
					);
				} else if (!codeState.code) {
					body.push(h('div', { key: 'code-empty', className: 'scf-ws-empty' }, h(Icon, { name: 'code', size: 22 }), h('span', null, tr('codeEmpty'))));
				} else {
					body.push(
						h(
							'div',
							{ key: 'code-actions', className: 'scf-row', style: { justifyContent: 'space-between' } },
							codeState.path ? h('span', { className: 'scf-code-path' }, tr('codePathLabel') + '：' + codeState.path) : h('span'),
							h('div', { className: 'scf-row' }, h(Button, { icon: 'code', onClick: copyCode }, copyState === 'copied' ? tr('codeCopied') : tr('codeCopy')), h(Button, { icon: 'download', onClick: downloadCode }, tr('codeDownload'))),
						),
						h('pre', { key: 'code-body', className: 'scf-code', tabIndex: 0, 'aria-label': tr('codeTitle') }, codeState.code),
					);
				}
				return h(React.Fragment, null, body);
			}

			function renderCenterBody() {
				try {
					switch (tab) {
						case 'code':
							return renderCodeTab();
						case 'preview':
						default:
							return renderPreviewTab();
					}
				} catch (error) {
					console.error('[scifig] tab render failed', error);
					return h('div', { className: 'scf-empty' }, h('span', null, tr('figureError') + '：' + describeError(error)), h(Button, { icon: 'refresh', onClick: () => setRefreshToken((value) => value + 1) }, tr('retry')));
				}
			}

			function renderCenterColumn() {
				return h(
					'section',
					{ className: 'scf-ws-center', 'data-scifig-center': '1' },
					renderTabs(),
					h('div', { className: 'scf-ws-center-body' }, h(Boundary, { label: tr('workspaceTitle') }, renderCenterBody())),
				);
			}

			/* ---- 渲染：右栏 ---- */
			function renderRightBanners() {
				const banners = [];
				if (sessionsState.status === 'error' && sessionsState.items.length > 0) {
					banners.push(h(Banner, { key: 'sessions-warn', tone: 'warn', label: tr('sessionsBackendUnready'), text: sessionsState.error || tr('sessionsFailed') }));
				}
				if (figure && figure.error) {
					banners.push(h(Banner, { key: 'figure-error', tone: 'error', label: tr('figureError'), text: typeof figure.error === 'string' ? figure.error : describeError(figure.error) }));
				}
				if (figure) {
					const warnings = filterWarnings(figure.warnings);
					if (warnings.length > 0) banners.push(h(Banner, { key: 'figure-warn', tone: 'warn', label: tr('warningsLabel'), count: warnings.length, items: warnings }));
				}
				if (controlsError) banners.push(h(Banner, { key: 'controls-error', tone: 'warn', label: tr('controlsFailed'), text: controlsError, onDismiss: () => setControlsError(null) }));
				if (exportInfo) {
					const parts = [];
					if (exportInfo.widthMm && exportInfo.heightMm) parts.push(String(exportInfo.widthMm) + '×' + String(exportInfo.heightMm) + ' mm');
					if (exportInfo.dpi) parts.push(String(exportInfo.dpi) + ' dpi');
					if (exportInfo.bytes) parts.push(formatBytes(exportInfo.bytes));
					banners.push(h(Banner, { key: 'export', tone: 'success', label: tr('exportDone'), text: parts.join(' · ') + (exportInfo.path ? ' · ' + String(exportInfo.path) : ''), onDismiss: () => setExportInfo(null) }));
				}
				return banners.length > 0 ? h('div', { className: 'scf-section' }, banners) : null;
			}

			function renderPresets() {
				if (presets.length === 0 || !figure) return null;
				const activePreset = getPath(figure.spec, 'style.preset');
				return h(
					'div',
					{ className: 'scf-section' },
					h('div', { className: 'scf-section-head' }, h('span', { className: 'scf-section-title' }, tr('presets'))),
					h('div', { className: 'scf-chips' }, presets.map((preset) => h('button', { key: String(preset.id), type: 'button', className: 'scf-chip', 'data-active': activePreset === preset.id ? 'true' : 'false', disabled: busy, onClick: () => applyPreset(preset.id) }, String(preset.labelZh || preset.labelEn || preset.id)))),
				);
			}

			function renderNlBox() {
				const summary = nlSummaryText(nlResult);
				return h(
					'div',
					{ className: 'scf-section', 'data-scifig-nl': '1' },
					h('div', { className: 'scf-section-head' }, h('span', { className: 'scf-section-title' }, tr('nlTitle'))),
					h(NlComposer, { value: nlText, onChange: (next) => setNlText(next), onSubmit: submitNaturalLanguage, busy: nlBusy, disabled: !figure, placeholder: tr('nlPlaceholder') }),
					summary ? h('div', { className: 'scf-nl-summary', 'data-tone': nlResult && nlResult.unapplied && nlResult.unapplied.length > 0 ? 'warn' : undefined, title: summary }, summary) : null,
				);
			}

			function renderSearchBar() {
				return h(
					'div',
					{ className: 'scf-section' },
					h(
						'div',
						{ className: 'scf-section-head' },
						h('div', { className: 'scf-search' }, h('span', { className: 'scf-search-icon' }, h(Icon, { name: 'search', size: 12 })), h('input', { className: 'scf-input', type: 'search', value: search, placeholder: tr('searchPlaceholder'), 'aria-label': tr('searchPlaceholder'), onChange: (event) => setSearch(event.target.value) })),
						h(Segmented, {
							value: level,
							label: tr('levelBasic') + '/' + tr('levelAll'),
							options: [
								{ value: 'basic', label: tr('levelBasic') },
								{ value: 'all', label: tr('levelAll') },
							],
							onChange: (next) => setLevel(next),
						}),
					),
				);
			}

			/* ---- v4：图类识别 / 投影 / 配色 / 工具分段 ---- */
			function projectionMeta() {
				const item = findControlItem(groups, 'map.projection');
				const options = Array.isArray(item && item.options) && item.options.length > 0 ? item.options : PROJECTION_FALLBACK.map((entry) => entry.value);
				const labels = item && item.optionLabels && typeof item.optionLabels === 'object' ? item.optionLabels : {};
				const all = options.map((value) => {
					const hit = PROJECTION_FALLBACK.find((entry) => entry.value === value);
					return { value: value, label: String(labels[value] || (hit && hit.zh) || value) };
				});
				const common = COMMON_PROJECTIONS.map((entry) => {
					const exact = options.find((value) => value === entry.value);
					const match = exact || options.find((value) => String(labels[value] || '').indexOf(entry.fallback) >= 0) || null;
					const value = match || entry.value;
					const hit = PROJECTION_FALLBACK.find((item2) => item2.value === value);
					return { value: value, label: tr(entry.labelKey), fullLabel: String(labels[value] || (hit && hit.zh) || tr(entry.labelKey)) };
				});
				return { item: item, all: all, common: common };
			}

			function sectionIsOpen(key) {
				if (Object.prototype.hasOwnProperty.call(sectionOpen, key)) return sectionOpen[key] === true;
				const section = TOOL_SECTIONS.find((entry) => entry.key === key);
				if (!section) return true;
				const clsKey = figureClassOf(figure).key;
				return section.applies === 'all' || section.applies === clsKey;
			}

			function toggleSection(key) {
				setSectionOpen((state) => Object.assign({}, state, { [key]: !sectionIsOpen(key) }));
			}

			function renderClassBar() {
				const cls = figureClassOf(figure);
				return h(
					'div',
					{ className: 'scf-class-bar', 'data-figure-class': cls.key, 'data-scifig-class': cls.key },
					h('span', { className: 'scf-class-badge', 'data-class': cls.key }, tr(cls.labelKey)),
					h('span', { className: 'scf-class-spacer' }),
					h('span', { className: 'scf-class-all' }, h(Switch, { checked: showAllTools, label: tr('toolsAll'), onChange: (next) => setShowAllTools(next) }), h('span', null, tr('toolsAll'))),
				);
			}

			function renderPaletteSelector() {
				if (!figure) return null;
				const cls = figureClassOf(figure);
				const isMap = cls.key === 'map';
				const headTitle = h('span', { className: 'scf-section-title' }, tr('paletteTitle'));
				if (palettes.status === 'error') {
					return h(
						'div',
						{ className: 'scf-section', 'data-scifig-palettes': 'error' },
						h('div', { className: 'scf-section-head' }, headTitle, h(Button, { icon: 'refresh', onClick: () => {
							void loadPalettes(false);
						} }, tr('retry'))),
						h('div', { className: 'scf-hint' }, tr('paletteFailed')),
						palettes.error ? h('div', { className: 'scf-hint' }, String(palettes.error)) : null,
					);
				}
				if (palettes.status === 'idle' || palettes.status === 'loading') {
					return h('div', { className: 'scf-section', 'data-scifig-palettes': 'loading' }, h('div', { className: 'scf-section-head' }, headTitle), h(LoadingLine, { text: tr('paletteLoading') }));
				}
				const data = palettes.data;
				if (!data) return null;
				const tabs = PALETTE_TABS.filter((tab) => !tab.mapOnly || isMap);
				const activeTab = tabs.some((tab) => tab.key === paletteTab) ? paletteTab : tabs[0].key;
				const path = palettePathForTab(activeTab);
				const item = findControlItem(groups, path);
				const currentValue = resolveValue(path, item);
				const current = paletteById(data, currentValue);
				const needle = paletteSearch.trim().toLowerCase();
				const seen = {};
				const list = palettesOfTab(data, activeTab).filter((palette) => {
					if (!palette || seen[palette.id]) return false;
					seen[palette.id] = true;
					if (!needle) return true;
					const haystack = [palette.id, palette.name, palette.colorsText, (palette.colors || []).join(' ')].filter((part) => typeof part === 'string').join(' ').toLowerCase();
					return haystack.indexOf(needle) >= 0;
				});
				return h(
					'div',
					{ className: 'scf-section scf-palette-section', 'data-scifig-palettes': 'ready' },
					h(
						'div',
						{ className: 'scf-section-head' },
						headTitle,
						h('span', { className: 'scf-palette-current' }, tr('paletteCurrent') + '：', h('span', { className: 'scf-palette-current-name', title: current ? String(current.name || '') : '' }, current ? String(current.name || current.id) : tr('paletteDefault'))),
					),
					h(
						'div',
						{ className: 'scf-chips' },
						tabs.map((tab) =>
							h(
								'button',
								{
									key: tab.key,
									type: 'button',
									className: 'scf-chip',
									'data-active': activeTab === tab.key ? 'true' : 'false',
									'data-palette-tab': tab.key,
									onClick: () => setPaletteTab(tab.key),
								},
								tr(tab.labelKey),
							),
						),
					),
					h('div', { className: 'scf-search' }, h('span', { className: 'scf-search-icon' }, h(Icon, { name: 'search', size: 12 })), h('input', { className: 'scf-input', type: 'search', value: paletteSearch, placeholder: tr('paletteSearch'), 'aria-label': tr('paletteSearch'), onChange: (event) => setPaletteSearch(event.target.value) })),
					list.length === 0
						? h('div', { className: 'scf-hint' }, tr('paletteEmpty'))
						: h(
								'div',
								{ className: 'scf-palette-list' },
								list.map((palette) => {
									const usageFigures = activeTab === 'categorical' ? paletteReuseCount(palette) : null;
									const active = currentValue === palette.id;
									const colors = Array.isArray(palette.colors) ? palette.colors.slice(0, 10) : [];
									const colorsText = typeof palette.colorsText === 'string' && palette.colorsText.trim() ? palette.colorsText.trim() : colors.join(' ');
									const metaText = active ? colorsText : usageFigures ? tr('paletteReuse', { n: usageFigures }) : '';
									return h(
										'button',
										{
											key: palette.id,
											type: 'button',
											className: 'scf-palette-row',
											'data-palette-id': palette.id,
											'data-palette-tab': activeTab,
											'data-active': active ? 'true' : 'false',
											title: String(palette.name || '') + ' · ' + colorsText,
											onClick: () => commitPath(path, palette.id),
										},
										h('span', { className: 'scf-swatches' }, colors.map((color, index) => h('span', { key: index, className: 'scf-swatch', style: { backgroundColor: color } }))),
										h(
											'span',
											{ className: 'scf-palette-main' },
											h('span', { className: 'scf-palette-name' }, String(palette.name || '')),
											metaText ? h('span', { className: 'scf-palette-meta' }, metaText) : null,
										),
										active ? h('span', { className: 'scf-palette-check' }, h(Icon, { name: 'check', size: 12 })) : null,
									);
								}),
							),
				);
			}

			function renderProjectionSection() {
				if (!figure || figureClassOf(figure).key !== 'map') return null;
				const meta = projectionMeta();
				const currentValue = resolveValue('map.projection', meta.item);
				const currentLabel = (() => {
					const hit = meta.all.find((entry) => entry.value === currentValue);
					return hit ? hit.label : String(currentValue === undefined ? '' : currentValue);
				})();
				const centralItem = findControlItem(groups, 'map.centralLongitude');
				const stdItem = findControlItem(groups, 'map.standardParallels');
				return h(
					'div',
					{ className: 'scf-proj-section', 'data-scifig-projection': '1' },
					h('div', { className: 'scf-proj-head' }, h(Icon, { name: 'layers', size: 12 }), tr('projectionTitle'), currentLabel ? h('span', { className: 'scf-proj-current', title: currentLabel }, currentLabel) : null),
					h(
						'div',
						{ className: 'scf-proj-chips' },
						meta.common.map((projection) =>
							h(
								'button',
								{ key: projection.value, type: 'button', className: 'scf-chip', 'data-projection': projection.value, 'data-active': currentValue === projection.value ? 'true' : 'false', title: projection.fullLabel, onClick: () => commitPath('map.projection', projection.value) },
								projection.label,
							),
						),
					),
					h(
						'select',
						{ className: 'scf-proj-select', value: currentValue === undefined || currentValue === null ? '' : String(currentValue), 'aria-label': tr('projectionAll'), onChange: (event) => commitPath('map.projection', event.target.value) },
						meta.all.map((projection) => h('option', { key: projection.value, value: projection.value }, projection.label)),
					),
					h(
						'div',
						{ className: 'scf-mini-row' },
						h(
							'label',
							{ className: 'scf-mini-field' },
							h('span', { className: 'scf-mini-label' }, tr('centralLongitude') + '（' + tr('degreeUnit') + '）'),
							h(SmallNumberField, { item: centralItem || { path: 'map.centralLongitude', type: 'number', default: 105 }, value: resolveValue('map.centralLongitude', centralItem || { default: 105 }), label: tr('centralLongitude'), onChange: (next) => commitPath('map.centralLongitude', next) }),
						),
						h(
							'label',
							{ className: 'scf-mini-field' },
							h('span', { className: 'scf-mini-label' }, tr('standardParallels')),
							h(SmallTextField, { item: stdItem || { path: 'map.standardParallels', type: 'text', default: '25,47' }, value: resolveValue('map.standardParallels', stdItem || { default: '25,47' }), label: tr('standardParallels'), onChange: (next) => commitPath('map.standardParallels', next) }),
						),
					),
				);
			}

			function renderToolsArea() {
				const cls = figureClassOf(figure);
				const wanted = showAllTools ? TOOL_SECTIONS.map((section) => section.key) : cls.key === 'general' ? ['all'] : [cls.key, 'all'];
				const toolGroups = filterToolGroups(groups);
				const blocks = [];
				for (const section of TOOL_SECTIONS) {
					if (wanted.indexOf(section.key) < 0) continue;
					const sectionGroups = toolGroups.filter((group) => groupAppliesTo(group) === section.applies);
					const count = countVisibleItems(sectionGroups, level, search, resolveValue);
					if (count === 0 && !showAllTools) continue;
					const open = sectionIsOpen(section.key);
					blocks.push(
						h(
							'div',
							{ className: 'scf-tools-section', key: section.key, 'data-tools-section': section.key },
							h(
								'button',
								{ type: 'button', className: 'scf-tools-head', 'aria-expanded': open ? 'true' : 'false', onClick: () => toggleSection(section.key) },
								h('span', { className: 'scf-group-chevron', 'data-open': open ? 'true' : 'false' }, h(Icon, { name: 'chevron', size: 12 })),
								h('span', null, tr(section.titleKey)),
								h('span', { className: 'scf-tools-count' }, String(count)),
							),
							open && count > 0
								? h(
										'div',
										{ className: 'scf-tools-body' },
										h(ControlsPanel, { groups: sectionGroups, level: level, search: search, resolveValue: resolveValue, onCommit: commitPath, groupOpen: groupOpen, onToggleGroup: toggleGroup, emptyMode: 'silent' }),
									)
								: open && showAllTools
									? h('div', { className: 'scf-tools-hint' }, tr('toolsEmptyFiltered'))
									: null,
						),
					);
				}
				return h(
					'div',
					{ className: 'scf-tools-area', 'data-scifig-tools': '1' },
					renderSearchBar(),
					blocks.length > 0 ? blocks : h('div', { className: 'scf-hint' }, search ? tr('searchEmpty') : tr('toolsEmptyFiltered')),
				);
			}

			function renderRightColumn() {
				return h(
					'aside',
					{ className: 'scf-ws-right', 'data-open': rightOpen ? 'true' : 'false', 'data-scifig-right': '1' },
					h('div', { className: 'scf-ws-right-head' },
						h('div', { className: 'scf-ws-right-head-main' },
							h('span', { className: 'scf-ws-right-title' }, tr('toolsTitle')),
							figure ? h('span', { className: 'scf-ws-right-meta', 'data-scifig-figure-meta': '1', title: figureMetaText() }, figureMetaText()) : null,
						),
						h('span', { className: 'scf-ws-right-close' }, h(IconButton, { name: 'close', title: tr('hideParams'), onClick: () => setRightOpen(false) }))),
					h(
						'div',
						{ className: 'scf-ws-right-scroll' },
						figure ? renderClassBar() : null,
						figure ? h(AutoAdjustNote, { items: autoAdjustItems(figure) }) : null,
						renderRightBanners(),
						renderPresets(),
						figure ? renderPaletteSelector() : null,
						renderProjectionSection(),
						figure ? h(Boundary, { label: tr('toolsTitle') }, renderToolsArea()) : h('div', { className: 'scf-hint' }, tr('noFigure')),
						renderNlBox(),
					),
				);
			}

			/* ---- 渲染：确认弹窗 / 灯箱 ---- */
			function renderDeleteConfirm() {
				if (!deleteConfirm) return null;
				return h(
					'div',
					{
						className: 'scf-modal',
						role: 'dialog',
						'aria-modal': 'true',
						'aria-label': tr('deleteConfirmTitle'),
						'data-scifig-confirm': deleteConfirm.mode,
						onClick: (event) => {
							if (event.target === event.currentTarget && !deleting) setDeleteConfirm(null);
						},
					},
					h(
						'div',
						{ className: 'scf-modal-card' },
						h('span', { className: 'scf-modal-title' }, tr('deleteConfirmTitle')),
						h('span', { className: 'scf-modal-text' }, deleteConfirm.text),
						h('div', { className: 'scf-modal-actions' }, h(Button, { onClick: () => setDeleteConfirm(null), disabled: deleting }, tr('deleteCancel')), h(Button, { tone: 'danger', onClick: runDelete, disabled: deleting }, deleting ? tr('deleting') : tr('deleteConfirm'))),
					),
				);
			}

			function renderLightbox() {
				if (!zoomed || !figure || !imageUrl) return null;
				return h(
					'div',
					{ className: 'scf-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': figureDisplayTitle(figure) },
					h(
						'div',
						{ className: 'scf-lightbox-bar' },
						h('span', null, figureDisplayTitle(figure)),
						h('span', { className: 'scf-row' }, h(Button, { icon: 'download', onClick: () => triggerDownload(buildUrl('/download', { id: figure.id, rev: figure.rev }), 'scifig-' + String(figure.id) + '.png') }, tr('download')), h(IconButton, { name: 'close', title: tr('close'), onClick: () => setZoomed(false) })),
					),
					h('img', { src: imageUrl, alt: figureDisplayTitle(figure), onClick: () => setZoomed(false) }),
				);
			}

			return h(
				'div',
				{ className: 'scf-page', 'data-scifig-page': '1', 'data-narrow': isNarrow ? 'true' : 'false' },
				renderTopBar(),
				renderStrip(),
				h('div', { className: 'scf-ws-main' }, h(Boundary, { label: tr('sessionsLabel') }, renderLeftColumn()), h(Boundary, { label: tr('workspaceTitle') }, renderCenterColumn()), h(Boundary, { label: tr('toolsTitle') }, renderRightColumn())),
				renderDeleteConfirm(),
				renderLightbox(),
			);
		}

		/* =====================================================================
		 * apply：locale / 样式 / 三个注册点（§8.1）
		 * ===================================================================== */
		function bindTranslate(ctx) {
			try {
				if (ctx && typeof ctx.get === 'function' && typeof ctx.effect === 'function') {
					const locale = ctx.get('locale');
					if (locale && typeof locale.register === 'function' && typeof locale.bind === 'function') {
						ctx.effect(() => locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'scifig-studio: locale');
						const bound = locale.bind(NS);
						translate = (key, params) => {
							try {
								return bound(key, params);
							} catch (error) {
								return fallbackTranslate(key, params);
							}
						};
						return;
					}
				}
			} catch (error) {
				console.error('[scifig] locale registration failed, using fallback texts', error);
			}
			translate = fallbackTranslate;
		}

		function apply(ctx) {
			workbenchCtx = ctx;
			installStyles(ctx);
			bindTranslate(ctx);
			/* 1) 左侧任务栏图标（id 必须与 main 面板 key 一致） */
			try {
				ctx.slots.inject('sidebar.panellist', () =>
					ctx.slots.register(
						{
							name: 'sidebar.panellist',
							id: PANEL_ID,
							order: 30,
							label: () => tr('panelLabel'),
						},
						guard(tr('panelLabel'), SidebarIcon),
					),
				);
			} catch (error) {
				console.error('[scifig] cannot register sidebar entry', error);
			}
			/* 2) 工具卡（打开整页工作台） */
			try {
				ctx.slots.inject('tool.call.toolview', () =>
					ctx.slots.register(
						{
							name: 'tool.call.toolview',
							key: TOOL_KEY,
							inject: (sessionId) => ({
								sessionId: sessionId === undefined ? null : sessionId,
								openWorkbench: (sid, figureId) => openWorkbenchPanel(sid === undefined ? sessionId : sid, figureId),
							}),
						},
						guard(tr('toolTitle'), ToolCard),
					),
				);
			} catch (error) {
				console.error('[scifig] cannot register tool card', error);
			}
			/* 3) 整页工作台 */
			try {
				ctx.slots.inject('main', () =>
					ctx.slots.register(
						{
							name: 'main',
							key: PANEL_ID,
							inject: () => ({
								getCurrentSessionId: () => {
									try {
										return readCurrentSessionId(ctx);
									} catch (error) {
										return null;
									}
								},
							}),
						},
						guard(tr('workspaceTitle'), WorkbenchPage),
					),
				);
			} catch (error) {
				console.error('[scifig] cannot register workbench page', error);
			}
		}

		return {
			inject: ['slots'],
			apply: apply,
		};
	},
});
