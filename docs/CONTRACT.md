# SciFigure Studio · 协作契约 v1（唯一事实来源）

> 所有 worker 开工前必须完整读本文件，并严格按此契约实现。契约里写死的路径名 / 字段名 / 端点 / 命令 **不允许改动**；契约没有限制的部分（具体 tunable 参数、图表内部实现）由各 owner 自行设计，但必须写进 `docs/SPEC.md` 与 `py/scifig/controls.json`。

## 0. 产品目标（用户原话归纳）

1. 用户在普通对话里给出数据 + 内容说明，Agent 调工具生成**草图**。
2. 草图生成后，用户可从对话（工具卡 / 顶栏按钮）**进入右侧工作台**。
3. 工作台里改参数 → 图**实时重绘**（投影、经纬网、图例位置、字体字号、线宽、色带、比例尺、指北针、画幅 dpi 等）。
4. 工作台里也可以用**自然语言**提需求（"图例放右下角，字号调到 8"）→ 图也会改。
5. 输出必须符合 SCI 期刊制图标注规范；**除明确要求外只输出 PNG**。

## 1. 目录与写作用域（互不越界，越界即冲突）

| 路径 | Owner | 说明 |
|---|---|---|
| `package.json` `cordis.patch.yml` `locale/*.json` `icon.svg` `docs/CONTRACT.md` `docs/API.md` | **Lead** | 已写好，其他人只读 |
| `docs/SPEC.md` `py/**` `samples/**` | **renderer** | Python 渲染引擎、spec 定义、controls/presets 清单、示例数据 |
| `index.js` `host/**` | **hostplg** | Host 半：Agent 工具、HTTP API、状态、渲染调度、中文 NL 解析 |
| `client.js` | **clientplg** | Client 半：右侧抽屉工作台 UI、入口按钮、工具卡 |
| `out/**` | 运行时 | 渲染产物（figure 目录），手工调试可写 |
| 构建/安装/验证 | **Lead** | 安装 bundle、跑集成验收 |

工作区根目录：`<WORKSPACE>`。插件包目录：`<BUNDLE>`。
**不要**在插件目录里跑 `pnpm install`、不要写 profile 的 `package.json`/`cordis.patch.yml`，安装由 Lead 用 `plugin_manager install_bundle` 完成。

## 2. 环境

- Python（渲染唯一入口）：`python`，Python 3.11，已装 matplotlib 3.10 / cartopy 0.25 / geopandas 1.1 / shapely / pyproj / Pillow / pandas / numpy / scipy / adjustText。
- cartopy 的 Natural Earth 数据已缓存在 `<CARTOPY_DATA_DIR>`（10m land/ocean/lakes/coastline/admin_0_boundary_lines 已存在；其余首次会联网下载，渲染器必须能降级：缺数据 → 跳过该图层 + warning，禁止整图失败）。
- Node 24，Host 半用 ESM。
- 图幅/字体：Windows 本地字体（Times New Roman / Arial / SimSun / SimHei / Microsoft YaHei 都在），渲染器要给出**中文字体回退链**。

## 3. 已固定契约

### 3.1 渲染器 CLI（hostplg 只依赖 sha 这一层）

```bash
python -m scifig.cli render --spec <spec.json> --out <figure.png> [--workdir <dir>]
```

- `PYTHONPATH` 由 hostplg 设为 `<bundle>/py`，`cwd` 为 `<bundle>/py`。
- **stdout 必须是且只有一行 JSON**（日志一律写 stderr）：
  - 成功：`{"ok":true,"png":"<abs path>","warnings":["..."],"metrics":{"widthMm":180,"heightMm":120,"dpi":300,"elapsedMs":1234}}`
  - 失败：`{"ok":false,"error":"<人话错误>","trace":"<可选>"}`，退出码 `2`。
- 渲染必须是**确定性**的（同 spec → 同图），除时间戳外不引入随机。
- 明确不支持/降级的项必须进 `warnings`，禁止静默吞掉。
- 额外子命令（供自检，host 可不依赖）：`python -m scifig.cli controls --out <controls.json>`、`python -m scifig.cli validate --spec <spec.json>`。

### 3.2 spec 中**必须存在**的固定路径（host/UI/预设切换依赖）

```
kind                 string   "map" | "line" | "bar" | "scatter" | "heatmap" | "box"
title                string   可为 ""
figure.widthMm       number   默认 180
figure.heightMm      number   默认 120
figure.dpi           number   默认 300
style.preset         enum     见 presets.json 的 id
data.source          string   数据文件路径（相对 workdir 或绝对）
output.png           string   由 host 指定，渲染器写入此路径（缺失则用 --out）
```

其余所有可调参数（`map.*` `axes.*` `legend.*` `text.*` `style.font.*` …）由 renderer 设计，但**必须**同时出现在 `py/scifig/controls.json`，且 spec 里以**普通嵌套对象**表示（路径中不允许出现数组下标，如 `legend.position` 可以，`levels[0]` 不行）。

### 3.3 `py/scifig/controls.json`（UI 与 NL 解析器的唯一数据源）

```json
{
  "version": 1,
  "groups": [
    {
      "id": "legend",
      "labelZh": "图例",
      "labelEn": "Legend",
      "order": 30,
      "items": [
        {
          "path": "legend.position",
          "type": "enum",
          "labelZh": "图例位置",
          "labelEn": "Legend position",
          "level": "basic",
          "default": "auto",
          "options": ["auto", "upper right", "lower right", "outside right", "below"],
          "optionLabels": {
            "auto": "自动避让",
            "upper right": "右上",
            "lower right": "右下",
            "outside right": "图外右侧",
            "below": "图下方"
          },
          "aliases": ["图例位置", "图例放哪", "legend position"],
          "help": "auto 会按数据密度自动选遮挡最少的位置"
        },
        {
          "path": "legend.fontSize",
          "type": "number",
          "labelZh": "图例字号",
          "labelEn": "Legend font size",
          "level": "basic",
          "min": 4, "max": 20, "step": 0.5, "unit": "pt", "default": 8,
          "aliases": ["图例字号", "图例字体大小"]
        },
        { "path": "legend.show", "type": "bool", "labelZh": "显示图例", "labelEn": "Show legend", "default": true },
        { "path": "map.colorbar.label", "type": "text", "labelZh": "色带标题", "labelEn": "Colorbar label", "default": "" }
      ]
    }
  ]
}
```

类型：`number`（`min`/`max`/`step`/`integer`/`unit`）、`enum`（`options`+`optionLabels`）、`bool`、`color`（`#rrggbb`）、`text`（`multiline` 可选）。
可选字段：`visibleWhen: {"path":"kind","in":["map"]}`（按 spec 当前值显隐）、`aliases`（NL 同义词，中文优先）、`level: "basic"|"advanced"`（UI 默认只展开 basic）、`help`。
硬性要求：**分类完整、覆盖用户关心的全部可调项**（投影 / 经纬网 / 图例 / 字体字号 / 线宽 / 色带 / 比例尺 / 指北针 / 南海诸岛插图 / 画幅 dpi / 期刊风格 / 标题与标注 / 轴设置）。数量目标 60–100 项。

### 3.4 `py/scifig/presets.json`（期刊风格切换）

```json
{
  "version": 1,
  "presets": [
    {
      "id": "nature",
      "labelZh": "Nature",
      "labelEn": "Nature",
      "values": { "style.font.family": "Arial", "style.font.sizeAxis": 7, "figure.widthMm": 89 }
    }
  ]
}
```

`style.preset` 的 options 必须来自这里。`values` 的 key 必须是 controls.json 里存在的 path。
host 实现"智能换风格"：切 preset 时，凡当前值仍等于旧 preset 默认值的 path 才覆盖成新默认值，用户手工改过的不动。因此 renderer 必须保证：**每种 preset 把 `style.*`（含字体/线宽/字号）全部给出**。

### 3.5 HTTP API（clientplg ↔ hostplg，同源，全部挂在 `/scifig` 前缀下）

所有 JSON 响应带 `ok: boolean`。`figure` 对象形状：

```json
{
  "id": "fig-20261103-153012-ab12",
  "sessionId": "…",
  "title": "图 1 研究区概况",
  "kind": "map",
  "rev": 7,
  "spec": { },
  "imageUrl": "/scifig/api/image?id=fig-…&rev=7",
  "pngPath": "<BUNDLE>\\out\\fig-…\\figure.png",
  "rendering": false,
  "error": null,
  "warnings": [],
  "createdAt": "2026-11-03T15:30:12+08:00",
  "updatedAt": "2026-11-03T15:31:02+08:00"
}
```

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | `/scifig/api/health` | – | `{ok:true,version,python,renderer:true,workDir}` |
| GET | `/scifig/api/state?sessionId=<sid>` | – | `{ok:true,figure:<figure|null>,figures:[{id,title,kind,rev,updatedAt,imageUrl}]}` |
| GET | `/scifig/api/controls` | – | `{ok:true,groups:[…],presets:[{id,labelZh,labelEn}],kinds:[…]}` |
| POST | `/scifig/api/patch` | `{figureId,set:{path:value},unset:[path]}` | `{ok:true,figure}` / `{ok:false,error,figure}` |
| POST | `/scifig/api/nl` | `{figureId,text}` | `{ok:true,applied:[{path,labelZh,value}],unapplied:[text],figure}` |
| POST | `/scifig/api/preset` | `{figureId,preset}` | 同 patch |
| GET | `/scifig/api/image?id=<fig>&rev=<n>` | – | `image/png`（`Cache-Control: no-store`，rev 变化即换 URL） |
| POST | `/scifig/api/export` | `{figureId}` | `{ok:true,path,bytes,widthMm,heightMm,dpi,url}` |
| GET | `/scifig/api/download?id=<fig>&rev=<n>` | – | PNG 附件下载 |
| POST | `/scifig/api/active` | `{figureId,sessionId}` | `{ok:true}`（对话框里"打开工作台"时把该图设为当前） |

- 渲染是同步阻塞的（一次 0.5–5 s）。同一 figure 的渲染必须串行排队，后到的 patch 覆盖先到的挂起 patch（合并 set）。
- 渲染失败：HTTP 200 + `ok:false,error`，前端要能显示错误并保留上一张图。

### 3.6 Agent 工具 `scifig`（hostplg 实现）

参数（`action` 必填）：

```
action: "draft" | "patch" | "nl" | "state" | "export" | "list"
description?  string   内容说明（draft 用：画什么、标题、单位、要显示哪些要素、目标图型/期刊）
dataFile?     string   数据文件路径（csv/xlsx/geojson/gpkg），绝对路径或相对工作区
kind?         "map"|"line"|"bar"|"scatter"|"heatmap"|"box"
set?          object   直接给 spec 路径补丁（patch 用）
text?         string   自然语言需求（nl 用）
figureId?     string   缺省用当前 session 的 fig
sessionId?    string
```

- `draft`：读数据 → 自动推断列 → 组 spec → 渲染 → 建 figure，绑定到该 session，返回 figure 摘要（id、rev、png 路径、warnings、一句"可在工作台继续调整"）。若 ToolDefinition 支持图片内容块，把 PNG 一并返回；否则只返回路径。
- 返回给模型的文本必须简洁（<15 行），包含：figureId、PNG 绝对路径、图型/尺寸/dpi、warnings 摘要、下一步建议（`action:"patch"` 示例）。
- `patch` / `nl` 与 HTTP 同源复用**同一实现**（user-actions 规范）。

### 3.7 UI 入口与行为（clientplg）

1. `conversation.session.header.utilities`：常驻按钮「绘图工作台」，点击 → 打开右侧抽屉（该 session 当前 figure）。
2. `tool.call.toolview`（key = `scifig`）：工具卡内显示缩略图 + 状态（生成中/成功/失败）+「打开工作台」按钮。
3. `shell.overlay`：右侧抽屉本体（固定右侧，宽 420–520px，高度撑满，不遮左侧；可用 `ctx.layout.openRightbar` 之外自绘，**不要**替换 `rightbar` 槽）。
4. 抽屉内：图预览（大、可点开放大/下载）、参数面板（按 controls 分组、basic/advanced 切换、搜索框）、自然语言输入框、期刊风格快捷条、撤销/重做、导出 PNG、错误提示。
5. 参数改动 → 250ms 防抖 → `POST /patch` → 成功后替换 `imageUrl`（带 rev）。渲染中保留旧图 + loading 指示。
6. 只用 `--dsw-alias-*` 主题 token 上色；文案走 client locale（`ctx.get('locale')`，可退化到中文常量）；不 import 任何 `@deepseek-ai/dsh-client-*` 包。
7. 全部写在单文件 `client.js` 里（factory 内不能 ESM import），React 用 `require('react')`。

## 4. 自测要求（每个人交付前必须自己跑过）

- **renderer**：给自己造 3 组样例（中国区域地图、时间序列折线、分组柱状），用上面的 CLI 真跑出 PNG，肉眼检查（read_image 看），确认：图例不压数据、经纬网标注不重叠、中文字体正常、PNG 尺寸/dpi 符合 `figure.*`、`controls.json` 里每个 path 都能设进去并生效、presets 全部可渲染。写 `docs/SPEC.md`（字段表 + 默认值 + 支持范围 + 已知限制）。
- **hostplg**：用 Node 直接 `import('./index.js')` 不现实，改为：用 `node --input-type=module -e "..."` 语法检查；用 curl 打 `/scifig/api/*`（安装后 Lead 会同源验证）；NL 解析对 30 条中文指令表（自造）给出 ≥80% 命中，且误命中要能一眼看出。
- **clientplg**：`node --check client.js`（或 `new Function` 包装）通过；组件在渲染异常时不得白屏（自己加 try/catch 边界）；主题 token 检查。

## 5. 质量基线（SCI 制图，renderer 重点）

- 图幅按期刊栏宽：单栏 89mm、双栏 180mm；字号 6–9pt；Arial/Times New Roman/宋体可选。
- 图例：`auto` 必须真的避让数据（可用居中度 + 遮挡网格打分），不是简单 `best`；支持图外右侧、下方；列数、边框、字号可调。
- 地图：投影 ≥8 种；经纬网间距/标注格式（度/度分）、上右边框标注可开关；中国区域图默认不画南海诸岛以外的东西；南海诸岛插图可选（含九段线示意，谨慎：用 cartopy 数据或简化示意，标注"示意"）。
- 色带：可水平/垂直、位置（右/下/内嵌）、刻度格式、单位、extend、配色名。
- 比例尺、指北针、子图编号 (a)(b)(c)、数据来源脚注、坐标轴刻度朝内、去上右边框（可配）。
- 所有文本默认英文可写、中文可写（字体回退）；导出 PNG 300/600 dpi。

## 6. 时间与汇报

- 每人完成后在 `docs/` 下不写别的文件，向 Lead 汇报：交付路径、自测命令与结果、已知限制、契约偏离（如必须偏离，先说明原因）。
- 遇到契约级冲突 → 立刻停下并告知 Lead，不要自行改契约。

---

# 7. v2 增补：子图组件库 / 拆分 / 交互拼接 / 排版优化 / 全代码化

> 用户新增需求（原话要点）：① 积累所有任务中出现过的各种图；② 把图拆成各类子图并给出对应代码；③ 一个任务可能出多张子图，要能从总图拆出子图；④ 之后可跨任务挑选子图交互式拼接；⑤ 拼接后做排版优化出最终图；⑥ 所有程序均由代码给出；⑦ 组件形式绘图，可交互修改，Agent 改对应代码后给出最终结果。

**推进顺序硬性要求**：v1 单图闭环（draft → 工作台调参 → NL → 导出 PNG）必须先完全跑通可用；v2 按 `7.2 → 7.3 → 7.4` 顺序追加。若时间紧张，牺牲 `compose.optimize` 的高级排版细节，也必须保住 library / compose / decompose / code 四条主链路。

## 7.1 概念模型

- **组件 component**（子图）：`{componentId, figureId, panelIndex, sessionId, title, kind, spec, codePath, thumbPath, tags, createdAt, updatedAt}`。
  - `spec`：**面板级**参数（不含 figure/style/output 全局块；样式在合成时统一）。
  - `codePath`：`<workDir>/components/<componentId>/component.py`，由 renderer `codegen` 生成，**可独立运行**且与引擎渲染结果一致。
  - `thumbPath`：`<workDir>/components/<componentId>/thumb.png`（长边 ≤ 480px）。
- **合成图 composite**：`kind:"compose"` 的 figure；`spec.compose.panels = [{componentId, overrides?}]`。host 渲染前解析成 renderer 需要的 `panels:[panelSpec...]`（引用活组件，改组件即级联重渲染）。
- **拆分 decompose**：从已有 figure 的 panels 生成组件记录（幂等）；单图 figure 也登记为 1 个组件。

## 7.2 renderer 新增契约

1. **`kind:"compose"` 必须支持**：
   ```
   panels: [panelSpec, ...]                      // 每个 panel 只含面板级字段（kind/data/map/axes/legend/text/title/customPatch）
   compose: {
     rows?: number, cols?: number,               // 缺省自动算最接近方形的布局
     gapXMm?: number, gapYMm?: number,           // 面板间距（mm）
     panelLabel: { show, style: "a"|"(a)", position: "upper left"|..., bold, fontSizePt? },
     align?: "none"|"axes",                      // axes：各面板轴框左右上下对齐
     optimize?: boolean,                         // true 时：面板等宽等高、轴框对齐、(a)(b)(c) 统一位置字号、跨面板字号统一、总标题居中、边距最小化
     shareColorbar?: boolean,
     legendPerPanel?: boolean
   }
   ```
   `optimize:true` 必须真的做布局优化（不是空开关）；出现文字超框、面板重叠、图例压数据要进 `warnings`。
2. **`codegen` 子命令**：`python -m scifig.cli codegen --spec <spec.json> --out <component.py> [--workdir <dir>]`
   - 生成**可独立运行**的 Python 脚本：`python component.py --out x.png` 渲染出与 `render` 相同的图。
   - 脚本结构：中文头注释（用途/数据来源/如何改参数）+ 带中文注释的 `SPEC = {...}` 字面量 + `from scifig.engine import render_spec` + `if __name__ == "__main__"`。
   - 图片/代码一致性由同一代码路径保证；`customPatch` 原样嵌入或原样执行。
3. **`render` 新增可选参数**：`--thumb <path>`（同次渲染另存缩略图，长边≤480）、`--code-out <component.py>`（同次渲染产出代码）。host 一次调用拿齐 PNG + 缩略图 + 代码。
4. **`spec.customPatch`**（字符串，Python 代码）：面板绘制完成后执行；globals 提供 `fig, axes, ax, np, plt, mpl, spec`。用于参数表达不了的定制（参考线、任意注记、箭头、局部样式覆盖）。执行异常不得让整图失败：捕获后进 warnings 并标注"customPatch 执行失败"。
5. `scifig.engine.render_spec(spec, out_png, *, thumb=None, code_out=None)` 作为公共 API 暴露（codegen 产物与 CLI 都调用它）。

## 7.3 hostplg 新增

- 组件库索引：`<workDir>/library/index.json`；组件目录 `<workDir>/components/<componentId>/`（`spec.json` / `component.py` / `thumb.png`）。
- 端点（同源，前缀 `/scifig`）：
  | 方法 | 路径 | 请求/响应 |
  |---|---|---|
  | GET | `/scifig/api/library?sessionId=&scope=session\|all&limit=` | `{ok,components:[{componentId,figureId,title,kind,thumbUrl,createdAt,sessionId,tags}]}` |
  | GET | `/scifig/api/component?id=` | `{ok,component}`（含 spec、codeUrl、thumbUrl） |
  | GET | `/scifig/api/thumb?id=<componentId>` | `image/png` |
  | GET | `/scifig/api/code?id=<componentId\|figureId>` | `{ok,code,path}` |
  | POST | `/scifig/api/compose` | `{componentIds:[],rows?,cols?,title?,optimize?,sessionId?}` → `{ok,figure}` |
  | POST | `/scifig/api/decompose` | `{figureId}` → `{ok,components:[]}` |
  | POST | `/scifig/api/component/patch` | `{componentId,set:{},customPatch?,title?}` → 更新组件、重渲染其自身 figure 与引用它的合成图 |
- 依赖图：`componentId → [figureId...]`，组件更新级联重渲染（走同一串行队列）。
- 登记时机：`draft` 成功 → 登记 1 个组件；`patch` 成功 → 更新该组件（并同步 spec/code/thumb）；`compose` 成功 → 合成图自身也登记为可再拆分对象。
- 工具 action 扩充：`library` / `compose` / `decompose` / `code`，参数见 §7.5。

## 7.4 clientplg 新增

- 抽屉加页签：**「参数」「图库」「排版」「代码」**。
- **图库**页：缩略图网格（多选）、scope 筛选（本次任务 / 全部）、布局模板 chips（1×1 / 1×2 / 1×3 / 2×2 / 2×3 / 1×4）、`optimize` 开关、「拼接生成」按钮；选中后显示"已选 n 张"。
- **排版**页（合成图模式）：面板缩略列表（标题 + 上移/下移/移除）、「编辑子图」（把该组件作为单图打开编辑）、「拆分」、全局参数（compose.* + style.* + figure.* 由 controls 驱动）。
- **代码**页：只读等宽展示 `component.py`（可复制、可下载、显示路径）；提示"让 Agent 改代码：在对话里说明要改什么"。
- 新端点失败必须有中文错误提示，不白屏；图库/拼接后端未就绪时显示占位说明。

## 7.5 `scifig` 工具新增 action

```
action: "library" | "compose" | "decompose" | "code"
componentIds?: string[]      // compose 用
rows?: number, cols?: number // compose 用，缺省自动
componentId?: string         // code / decompose 用
optimize?: boolean           // compose 用，默认 true
```
语义：
- `library`：列出可用子图组件（模型据此知道有哪些图可拼）。
- `compose`：按 componentIds 拼成新合成图（自动行列 + optimize），返回新 figureId、PNG 路径、警告。
- `decompose`：把指定/当前合成图拆成组件（幂等），返回组件列表。
- `code`：返回指定图的生成代码（供模型阅读并配合 `action:"patch"` 的 `customPatch` 做定制修改）。

## 7.6 v1.1 交互增强（渲染器/宿主按余力做）

- 工具新增 `componentId` + `customPatch` 参数，允许模型直接给某组件打代码补丁（"在图上加一条 400 mm 参考线并标注"）。
- 合成图渲染时如某组件渲染失败，用占位面板 + warnings，不整图失败。

---

# 8. v3 改版：左侧任务栏入口 + 覆盖对话的整页工作台

> 用户要求（原话要点）：① 工作台入口放到**对话左侧的任务栏**；② 点开后是**覆盖对话的整页**，不是弹出的小任务框；③ 重新排版；④ 可在工作台里**切换对话**，调整不同对话里的图；⑤ 要有**删除工作区**的功能。

## 8.1 入口与承载（clientplg）

- **删除** `shell.overlay` 抽屉（id `scifig-drawer`）与 `conversation.session.header.utilities` 按钮（id `scifig-workbench`）。
- **新增** `sidebar.panellist`（id `scifig`，order 30）：owner props 是 `{ size: number; active: boolean }`，注册的是**图标组件**（SVG，尺寸用 `size`，选中态用 `active` 或 `currentColor`）；侧栏自己负责点击与选中。
- **新增** `main`（keyed，key `scifig`）：整页工作台。槽位说明："central panel selected by sidebar entry id"，id 与 `sidebar.panellist` 的 id 一致即可被侧栏按钮选中；`main` 的标准 props 含 `useSessions` / `usePanelInfo` / `useWorkspaces` 等（可用于会话标题；形状不确定时降级）。
- **保留** `tool.call.toolview`（key `scifig`）工具卡：点「打开工作台」= `ctx.get('layout').selectPanel('scifig')`（layout 服务有 `selectPanel(panelId)`）+ 客户端 store 记录要聚焦的 `figureId`/`sessionId`。
- 整页布局要求（不是窄抽屉）：

```
┌ 顶栏：科研制图工作台 │ 会话/图切换器 │ 刷新 · 导出 PNG · 删除工作区 ┐
├ 左栏 300px ────────────┬ 中栏（自适应） ────────────┬ 右栏 380px ┐
│ 会话列表（可折叠）       │ 页签：预览/图库/排版/代码    │ 期刊风格 chips │
│  └ 该会话的图（缩略图）   │ 预览：大图 + 适配宽/放大     │ 搜索 / 基础·全部 │
│ 底部：图库入口/图计数     │ 图库：缩略图多选+布局+拼接    │ 参数分组折叠     │
│                        │ 排版：面板列表+拆分          │ NL 输入框       │
│                        │ 代码：只读 component.py      │ 错误/警告条      │
└────────────────────────┴───────────────────────────┴─────────────┘
```

- 视觉：用 `--dsw-alias-*` token；页面随主面板全高，左右栏可滚动，中栏图区自适应且不裁切；窄屏（<1100px）时右栏可折叠为抽屉式滑出。

## 8.2 跨对话切换（clientplg + hostplg）

- Client：顶部「会话/图切换器」下拉，来源 `GET /scifig/api/sessions`：
  - 选项：**全部任务** → 列出所有图（按更新时间倒序，分组显示会话）；
  - 每个会话一项：`标题 · N 张图`（有标题用标题，没有则用最近一张图标题 + 短 id）。
- 切换会话 → 左栏列出该会话的图；点图 → 中栏预览 + 右栏参数加载该图；`patch`/`nl`/`export` 都作用于当前选中图。
- Host 侧：`GET /scifig/api/sessions` 返回按会话分组的数据（字段见 §8.3）。若拿到会话标题困难，`title` 可为 `""`，客户端降级显示。

## 8.3 Host 新增端点（hostplg）

| 方法 | 路径 | 请求 / 响应 |
|---|---|---|
| GET | `/scifig/api/sessions` | `{ok, sessions:[{sessionId, title, count, latestAt, figures:[{id,title,kind,rev,updatedAt,imageUrl,error}]}], total}` |
| POST | `/scifig/api/workspace/delete` | `{mode:"figure"\|"session"\|"all", figureId?, sessionId?, includeComponents?:boolean(true), deleteFiles?:boolean(true)}` → `{ok, deleted:{figures:n, components:n, files:n, composites:n}, remaining:{figures:n, components:n}}` |

删除语义（必须实现）：
1. `mode:"figure"`：删除该 figure 的 registry + 磁盘目录；若它是合成图，其成员组件不动；若它引用的组件被删除时一并清（见 3）。
2. `mode:"session"`：删除该 session 全部 figure（含合成图）+ 该 session 登记的组件 + 目录。
3. `mode:"all"`：清空全部图与组件库（`workDir/**` 里 registry 管理的目录、`library/index.json`），保留 `workDir/_selftest` 与 `workDir/exports`？——**全部删，包括 exports**，但保留 `_selftest`（自测产物不是用户数据）。
4. 组件依赖：删除组件时，**引用它的合成图一并删除并计入 `deleted.composites`**（避免留下坏图）；删除合成图不影响其成员组件。
5. 删除后：内存索引、session→figure 映射、library 反查、当前 active 全部同步；再次 `GET /state` 不得返回已删图。
6. 幂等：删除不存在的 id 返回 `ok:true` 且计数 0。
7. 安全：路径必须落在 `workDir` 内（规范化后校验前缀），拒绝 `..` 与绝对路径越界；失败返回 `{ok:false,error}`。

## 8.4 工具新增 action（hostplg）

`action:"delete"`，参数 `figureId?` / `sessionId?` / `mode:"figure"|"session"|"all"` / `confirm:boolean`：
- `mode:"all"` 必须 `confirm:true` 才执行，否则返回提示"删除全部工作区需要 confirm:true"。
- 与 HTTP 同一实现。

## 8.5 验收（Lead）

- 左侧任务栏出现「科研制图」图标，点击后主区变成工作台整页（对话被覆盖），再次点会话/侧栏其他项可切回。
- 顶栏切换会话 → 左栏图列表随会话变化 → 选图 → 右栏参数 → 改参数图实时变。
- 删除工作区：删除单图 / 删会话 / 全部删除三种模式各验一次，确认 `GET /state` 与图库数量同步下降、磁盘目录消失、无残留坏合成图。
- 工具卡「打开工作台」能直接跳到该图。
- 既有能力不回归：patch/nl/preset/export/library/compose/decompose/code 全部仍可用；`scripts/verify-api.ps1` 需扩展 sessions 与 delete 两项并保持全绿。

---

# 9. v4：工具区改造 + 图类识别 + 地图/统计图分工具组 + PPT 配色体系 + 投影切换

> 用户要求（原话要点）：① 参数区改成「工具区」；② 不同图类要识别成统计图 / 地图；③ 地图要有地图的参数调整、统计图要有统计图的参数设置；④ 配色体系参考 reference-deck.pptx，给出其中全部配色；⑤ 地图里要有投影切换功能。

## 9.1 配色数据（Lead 已生成，renderer/host/client 共同消费）

- 文件：py/scifig/palettes.json（由 scripts/extract_palettes.py 从该 PPT 提取：163+ 内嵌图配色聚类 + 主题强调色 + 形状填充高频色 + 派生顺序/发散色带，共 42 套）。
- 结构：
`json
{"version":1,"source":"科研绘图.pptx","sourcePath":"...","generatedBy":"scripts/extract_palettes.py",
 "counts":{"themes":2,"slides":104,"media":173,"palettes":42},
 "palettes":[{"id":"ppt-01","name":"PPT 图配色 01（25 张图复用）","kind":"categorical","colors":["#7EABCC",...],"source":"内嵌图片 ..."}]}
`
- kind: categorical（分类色，用于折线/柱/散点/点符号）、sequential（顺序色带，用于分级设色/热力图/连续填色）、diverging（发散色带，用于正负/距平）。
- **只读数据**：renderer 不得改写 ids/colors；需要新增时用 scripts/extract_palettes.py 重新生成（保持 id 稳定：按生成顺序编号）。

## 9.2 renderer：配色接入 + 工具分组元数据 + 投影参数

1. **controls.json 新增字段**：每个 group 增加 ppliesTo（"map" | "chart" | "compose" | "all"，缺省 "all"），UI 据此分成「地图工具 / 统计图工具 / 合成排版 / 通用」。
2. **新增控件**：
   - style.palette（enum，categorical 调色板 id；optionLabels 用 palettes.json 的 name；默认 ppt-01 或现有 	ab10 兼容值）
   - style.paletteSequential（enum，sequential id）→ 供热力图/分级设色默认色带
   - style.paletteDiverging（enum，diverging id）
   - map.colorbar.palette（enum，sequential/diverging id，空=按当前 cmap）
   - map.centralLatitude（number，默认 35）、map.standardParallels（text，如 "25,47"，Lambert/Albers 用）
   - map.projection 保持现有 11 种枚举（optionLabels 必须中文全称）
3. **渲染接入**：
   - categorical palette → 折线/柱/散点分组颜色顺序、地图点符号分级基色、choropleth 分级配色（当 map.choropleth.palette 未指定时取 style.palette）
   - sequential → 连续填色、热力图默认色带、colorbar 默认
   - diverging → 热力图/正负色带
   - 色带名/cmap 与 palette 的优先级：显式 map.colorbar.palette > style.paletteSequential > map.colorbar.cmap
4. **投影切换必须真的生效**：切投影后 extent/中央经线/标准纬线按新投影重算（Lambert/Albers 用 standardParallels+centralLatitude；Robinson/Mollweide/EqualEarth 用中央经线），并写入 warnings 说明自动取值。
5. 顺手修：拼接图窄面板（宽度 < 70mm）比例尺文字仍与条重叠（单图宽幅正常）。

## 9.3 hostplg：配色端点 + NL 词表

1. GET /scifig/api/palettes → {ok, palettes:[{id,name,kind,colors}], byKind:{categorical:[],sequential:[],diverging:[]}, source}
2. /api/controls 响应里对 style.palette* / map.colorbar.palette 的 enum optionLabels 用 palettes.json 的 name（若 renderer 没填，host 兜底填充）。
3. NL 增量：
   - "配色/颜色/色系/配色方案/换一套颜色" → style.palette（后跟 id 或名称关键词，如 "ppt-3"/"绿色系"/"第 3 套"）
   - "色带/色条" + 配色词 → map.colorbar.palette
   - "投影/投影方式/坐标系/换成墨卡托/兰伯特/罗宾逊/正射/北极立体" → map.projection（中文名映射）
   - "中央经线/标准纬线" → map.centralLongitude / map.standardParallels
4. 工具（scifig）说明补充：draft 时若用户提到"配色/参考 ppt" 可传 set: {"style.palette": "..."}；ction:"patch" 支持这些路径。

## 9.4 clientplg：右栏改动 + 图类识别 + 投影切换 + 配色选择器

1. 右栏标题与页签「参数」→ **「工具区」**（所有文案同步）。
2. **图类识别条**：顶栏或右栏顶部显示当前图类徽标与一句话：
   - kind==="map" → 「地图」+ 「投影 / 范围 / 经纬网 / 色带 / 比例尺 / 指北针 / 图层」；
   - kind 为 line/bar/scatter/heatmap/box → 「统计图」+ 「坐标轴 / 图例 / 线型标记 / 拟合 / 分组堆叠 / 标注」；
   - kind==="compose" → 「合成图」+ 「面板布局 / 编号 / 对齐 / 全局样式」；
   - 其它/未知 → 「通用」。
3. **工具区分组**：按 group.appliesTo + 当前图类过滤，分「地图工具」「统计图工具」「合成排版」「通用」四段（可折叠，图类不相关的段默认折叠或隐藏；顶部保留「全部工具」开关）。
4. **投影切换**（地图图类时置顶）：常见 6 种投影 chips（等经纬 / 墨卡托 / 兰伯特 / 阿尔伯斯 / 罗宾逊 / 等地球）+ 「全部投影」下拉（11 种中文名），当前投影高亮；点击 PATCH map.projection；旁边显示 中央经线 / 标准纬线 两个可直接改的输入框。
5. **配色选择器**：GET /api/palettes 拉取；按 categorical / sequential / diverging 三组显示色块条（每套显示色块 + id + 名称 + 复用张数），点击分别 patch style.palette / style.paletteSequential / style.paletteDiverging（地图图的色带另给 map.colorbar.palette）；顶部显示当前配色名称；支持搜索（id/名称/色值）。
6. 既有能力全部保留（预览/图库/排版/代码/NL/撤销/导出/删除/切会话）。

## 9.5 验收

- 地图图类：工具区只显示地图工具段（+通用），投影 chips 点击后 PNG 变化，中央经线/标准纬线可改且生效。
- 统计图图类：工具区显示统计图工具段，含轴/图例/线型/拟合；投影段不出现。
- 配色：选中 ppt-03 后折线/柱颜色按该套配色改变；选中顺序色带后地图分级设色与色带随之改变；/api/palettes 返回 42 套且与 palettes.json 一致。
- NL：「换成墨卡托投影」「用第 3 套配色」「图例放右下角」都能命中。
- scripts/verify-api.ps1 增加 palettes 断言，保持全绿。
---

# 10. v5：移除合成图 / 拼接，专注单图调整

> 用户要求：**去除「合成图」与「拼接」功能，专注单图的调整**。

## 10.1 产品边界

- 不再提供：子图库、拼接（compose）、拆分（decompose）、面板排版/编号/对齐/共享色带等一切多面板功能。
- 保留并强化：单张图（map / line / bar / scatter / heatmap / box）的预览、工具区调参、一句话改图、投影切换、配色选择、代码查看、导出 PNG、删除。
- 历史数据：已存在的 kind:"compose" 图仍可**只读**预览与看代码，但不提供任何拼接入口；新建图不再产生 compose。

## 10.2 三端改动

- **clientplg**：中栏页签只留「预览」「代码」；删除图库/排版页签、左栏图库入口、全部 compose 请求与状态；kind==="compose" 归入「通用」，只读展示；顶栏加「复制 PNG 路径」；工具区标题旁显示「图型 · 画幅 · dpi」。
- **hostplg**：工具 scifig 删除 compose / decompose / library action（或返回"功能已移除"）；/api/compose、/api/decompose 返回 {ok:false,error:"拼接功能已移除"}；不再接受 compose.* 的 patch；/api/code 保留；system prompt 删除拼图说明、强调单图调整。
- **renderer**：引擎内部 compose 代码保留（不阻塞、不暴露），文档标注已废弃；controls 里 compose 分组的 ppliesTo:"compose" 保留但 UI 不再展示。

## 10.3 新增约定

- **渲染输出字段 utoAdjust**（v4 起）：[{key,message}]，message ≤20 字、可直接展示；与 warnings 分离——warnings 只保留真风险（数据缺失、字体缺字、文字未解决重叠、customPatch 失败、非法控件值等）。
- 前端：warning 用琥珀/红色警示条；utoAdjust 用灰色 ⓘ 单行可折叠；历史数据 warnings 里含「自动对齐 / 中央经线 / 已自动改用」的条目前端过滤掉。

## 10.4 验收

- 工作台只有「预览 / 代码」两个页签，无任何"拼接 / 图库 / 合成"字样与按钮。
- 工具 schema 里不存在 compose/decompose/library；直接调用返回友好中文错误。
- 单图：投影切换、33 套配色、工具区四段、一句话改图、导出、删除、复制路径全部可用。
- scripts/verify-api.ps1：去掉 compose/decompose 断言，新增"compose 端点被拒"断言，保持全绿。