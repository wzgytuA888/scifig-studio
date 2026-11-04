"""Generate docs/SPEC.md from controls.json / presets.json / DEFAULT_SPEC.

Keeping the field table generated guarantees that the published spec
documentation never drifts from the renderer's real vocabulary.

Run:  python tools/gen_spec_doc.py --out ../docs/SPEC.md
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import sys
from typing import Any, Dict, List

HERE = os.path.dirname(os.path.abspath(__file__))
PY_DIR = os.path.dirname(HERE)
BUNDLE_DIR = os.path.dirname(PY_DIR)
sys.path.insert(0, PY_DIR)

from scifig import controls  # noqa: E402
from scifig import palettes as palette_store  # noqa: E402
from scifig.defaults import DEFAULT_SPEC  # noqa: E402
from scifig.paths import flatten  # noqa: E402

SAMPLES_DIR = os.path.join(BUNDLE_DIR, "samples")

KIND_LABELS = {
    "map": "地图",
    "line": "折线图",
    "bar": "柱状图",
    "scatter": "散点图",
    "heatmap": "热力图",
    "box": "箱线图",
    "compose": "多子图合成",
}

TYPE_LABELS = {"number": "数字", "enum": "枚举", "bool": "开关", "color": "颜色", "text": "文本"}


def _fmt_default(item: Dict[str, Any]) -> str:
    value = item["default"]
    if value is None:
        return "`null`（自动）"
    if item["type"] == "bool":
        return "`true`" if value else "`false`"
    if item["type"] == "number":
        unit = item.get("unit") or ""
        text = ("%g" % value)
        return "`%s%s`" % (text, (" " + unit) if unit else "")
    if item["type"] == "enum":
        label = item.get("optionLabels", {}).get(value, "")
        return "`%s`%s" % (value, ("（%s）" % label) if label else "")
    return "`%s`" % value


def _range(item: Dict[str, Any]) -> str:
    if item["type"] != "number":
        return ""
    parts = []
    if item.get("min") is not None:
        parts.append("%g" % item["min"])
    if item.get("max") is not None:
        parts.append("%g" % item["max"])
    text = "–".join(parts)
    if item.get("step"):
        text += "，步长 %g" % item["step"]
    return text


def _effect(item: Dict[str, Any]) -> str:
    path = item["path"]
    kind = item["type"]
    if kind == "enum":
        return "切换 %s 的表现方式" % item["labelZh"]
    if kind == "bool":
        return "开/关「%s」" % item["labelZh"]
    if kind == "color":
        return "修改颜色"
    if kind == "number":
        return "数值/尺寸/间距"
    return "文本内容（支持中文与上下标）"


def build_table(items: List[Dict[str, Any]]) -> str:
    lines = ["| 参数 path | 类型 | 默认值 | 范围/选项 | 说明 | 影响 |",
             "|---|---|---|---|---|---|"]
    for item in items:
        path = item["path"]
        kind = item["type"]
        default = _fmt_default(item)
        if kind == "enum":
            options = item["options"]
            labels = item.get("optionLabels", {})
            shown = ", ".join("%s=%s" % (opt, labels.get(opt, "")) if labels.get(opt) else opt
                              for opt in options)
            if len(shown) > 160:
                shown = shown[:157] + "…"
            range_text = shown
        else:
            range_text = _range(item)
        help_text = item.get("help") or item.get("labelEn") or ""
        visible = ""
        if item.get("visibleWhen"):
            visible = "（仅 %s）" % "/".join(
                KIND_LABELS.get(k, k) for k in item["visibleWhen"].get("in", []))
        level = "★" if item.get("level") == "basic" else ""
        lines.append("| `%s` | %s%s | %s | %s | %s%s | %s |" % (
            path, TYPE_LABELS.get(kind, kind), level, default,
            range_text.replace("|", "/"), help_text.replace("|", "/"),
            visible, _effect(item)))
    return "\n".join(lines)


def build_preset_table() -> str:
    lines = ["| id | 名称 | 栏宽 | 字体 | 基准/标题/轴/刻度/图例字号 | 线宽 | 轴框 | 适用 |",
             "|---|---|---|---|---|---|---|---|"]
    applies = {
        "sci": "通用 SCI 期刊",
        "nature": "Nature 系列（单栏 89mm）",
        "science": "Science 系列",
        "elsevier": "Elsevier 期刊（双栏）",
        "ieee": "IEEE 会议/期刊（Times）",
        "geography-cn": "地理学报等中文地理期刊（宋体）",
        "remote-sensing-cn": "遥感学报等中文遥感期刊（宋体+黑体标题）",
    }
    for preset in controls.presets():
        values = preset["values"]
        get = values.get
        size = "%.1f/%.1f/%.1f/%.1f/%.1f" % (
            get("style.font.sizeBase", 8.0), get("style.font.sizeTitle", 10.0),
            get("style.font.sizeAxis", 8.0), get("style.font.sizeTick", 7.0),
            get("style.font.sizeLegend", 7.0))
        lines.append("| `%s` | %s | %g mm | %s | %s pt | %g pt | %g pt | %s |" % (
            preset["id"], preset["labelZh"], get("figure.widthMm", 180),
            get("style.font.family", "Arial"), size,
            get("style.line.width", 1.2), get("style.axis.lineWidth", 0.8),
            applies.get(preset["id"], "")))
    return "\n".join(lines)


def build_palette_table() -> str:
    kind_labels = {"categorical": "分类", "sequential": "顺序", "diverging": "发散"}
    lines = ["| id | 类型 | 名称 | 色块（hex） |", "|---|---|---|---|"]
    for palette in palette_store.all_palettes():
        colors = palette.get("colors") or []
        chips = " ".join("`%s`" % color for color in colors[:8])
        if len(colors) > 8:
            chips += " …"
        lines.append("| `%s` | %s | %s | %s |" % (
            palette.get("id"), kind_labels.get(palette.get("kind"), palette.get("kind")),
            palette.get("name", ""), chips))
    return "\n".join(lines)


def build_sample_table() -> str:
    lines = ["| 文件 | 内容 | 用到的图型 |", "|---|---|---|"]
    descriptions = {
        "map_points.csv": ("新疆 20 个站点：站点/经度/纬度/土壤盐分/类型", "map（点、气泡、按值着色）"),
        "map_polygons.geojson": ("新疆 8 个盐渍化分区多边形（soil_salinity 属性）", "map（分级设色）"),
        "line_timeseries.csv": ("2000–2020 年 NDVI / 年均降水 / 年均气温", "line（多序列、双轴）"),
        "bar_grouped.csv": ("6 类土地利用 × 北疆/南疆/东疆面积", "bar（分组/堆叠/百分比）"),
        "scatter.csv": ("24 个样本：年均降水 / NDVI / 区域", "scatter（分组着色、拟合线）"),
        "heatmap_matrix.csv": ("12 个月 × 3 个区域月均气温", "heatmap"),
        "box_salinity.csv": ("5 类土地类型的土壤盐分样本", "box"),
    }
    for filename, (content, kinds) in descriptions.items():
        lines.append("| `samples/%s` | %s | %s |" % (filename, content, kinds))
    lines.append("")
    lines.append("对应的 spec 示例：`spec_map.json`、`spec_map_polygon.json`、`spec_line.json`、"
                 "`spec_bar.json`、`spec_scatter.json`、`spec_heatmap.json`、`spec_box.json`、"
                 "`spec_compose.json`、`spec_custompatch.json`。")
    return "\n".join(lines)


LIMITATIONS = """## 已知限制（v1.2）

1. **地图底图数据**：使用本地缓存的 Natural Earth 10m 数据（land / ocean / lakes /
   rivers / coastline / admin_0_countries / admin_0_boundary_lines_land）。省界
   （`map.layers.provinceBorders`）默认离线不可用：启用时会尝试下载（8 s 超时），
   失败则跳层并进 `warnings`，**不会整图失败**。首次使用未缓存图层同理。
2. **中国国界**：由 Natural Earth admin_0_countries 中 CHN/TWN/HKG/MAC 合成，
   仅用于示意。正式出版请按自然资源部标准地图核对；南海诸岛插图为简化示意
   （九段线为手绘简化折线 + “示意”标注），不构成标准地图。
3. **比例尺**：按图幅中心纬度用 WGS84 椭球估算，跨纬度大的图会有误差；投影
   不支持时跳过（`autoAdjust.scaleBar`）。窄面板自动降级：条长不超过轴框宽
   60%（1/2/5 级数缩到更小的整数值）、字号可降 1–2pt、空间不足时只标终点数值，
   这些改进写入 `autoAdjust`（`scaleBarLength` / `scaleBarLabel` /
   `scaleBarFontSize`）；与指北针/南海插图 bbox 冲突且未解决时进 `warnings`。
4. **经纬网标注**：非矩形投影（罗宾逊/摩尔威特/正射）下 cartopy 可能无法标注，
   此时关闭经纬网并 warning；标注默认水平不旋转（`map.grid.rotation` 控制）。
   **投影中央经线自适应**：`lambert / albers / azimuthal / orthographic /
   northpolarstereo` 下若 `|extent 中心经线 − centralLongitude| > 10°`，引擎
   自动改用 extent 中心经线（用户显式改成接近中心的值不受影响），避免区域图
   整体倾斜；该自动行为写入 `autoAdjust`（`{"key":"centralLongitude",
   "message":"中央经线已对齐研究区中心（85.0°E）"}`），**不会**进 warnings；
   圆锥投影矩形视角的四角用 ocean/land 底色填充（`autoAdjust.cornerFill`），
   不再露纯白三角楔形。
5. **类目标签自适应**：`axes.categoricalRotation="auto"` 时，相邻标签间距
   <1.5mm 依次尝试 30°→45°→90°、字号 -1/-2pt（最低 6pt）、缩写；仍重叠进
   warnings。面板宽 <55mm 且仍重叠时提示改用 2 行布局。bar 与 heatmap 同规则；
   数值轴则按标签重叠自动减少刻度数（5→4→3）。
6. **合成图自动行列**：未指定 rows/cols 时按接近方形布局（n=2→1×2、n=3→2×2
   末格留空、n=4→2×2、n=5/6→2×3、n=7–9→3×3），不会出现 1×N 的窄面板。
7. **范围预设优先级**：`map.extentPreset != "custom"` 时**以预设为准**，四个
   `map.extentLonMin/LonMax/LatMin/LatMax` 被忽略；只有 `custom` 才使用这四个数
   （控件 `visibleWhen` 已按此显隐）。若用户直接改经纬度而没改 preset，建议
   host 同步把 `map.extentPreset` 切到 `custom`。
8. **上下标与单位文本**：纯西文文本中的 `m-1` / `m^2` / `km2` / `s-1` 以及
   Unicode 上下标会转成 mathtext（`m$^{-1}$`）；中英混排文本则转成 Unicode
   上标（`m⁻¹`），依赖 Arial → DejaVu Sans → 宋体 回退链（mathtext 会把中文
   渲染成豆腐块）。只处理**单位尾部**，`2000-2010`、`CO2`、`H2O` 不会被误改。
   字体缺字形会进 `warnings`。
9. **图例自动避让**：基于像素遮挡打分（居中度 + 遮挡比例 + 保留区碰撞），对
   10–20 个候选位置评分。极密数据（如整幅散点）仍可能压数据，此时
   `warnings` 会给出遮挡评分，建议改 `legend.position`。
10. **多元合成图**：面板只接受面板级字段（kind/data/map/axes/legend/text/title/
   customPatch），`figure/style/output` 由合成图统一；`compose.panels` 由 host
   把组件引用解析成面板 spec 数组后传入（`render-spec.json`）。单个面板失败
   时用占位面板 + warning，不影响整图。`optimize:true` 下地图面板会
   `set_aspect("auto")` 填满单元格以保证轴框对齐（会有轻微投影变形）；面板
   色带自动缩到 0.8×宽、pad +1mm；`compose.align="none"` 目前仍保持等宽等高
   布局（`optimize:false` 才是完全不参与优化的路径）。
11. **确定性**：同一 spec 连续渲染 PNG 字节一致（自检 `--mode determinism`）。
   唯一例外是系统字体缓存首次构建（只影响耗时，不影响结果）。
12. **仅 PNG**：按用户环境约定只输出 PNG（Agg），不提供 PDF/SVG 导出。
13. **controls 数量**：v1 契约目标 60–100 项；v2/v4 增补 compose、customPatch、
   类目旋转、classtool 配色与地图细分后为 {COUNT} 项，全部与 spec 叶子一一对应，
   自测脚本逐个设值验证。
14. **配色（v4）**：全部颜色来自 `palettes.json`（用户 PPT 提取，**33 套**，只读；
    16 分类 / 8 顺序 / 9 发散；`optionLabels` 用其中的中文 `name`，枚举值仍是 id）。
    分类色用于折线/柱/散点/点符号/分级设色；顺序色用于连续填色/热力图/分级/
    色带；发散色用于正负与以 0 为中心的热力图。优先级
    `map.colorbar.palette` > `style.paletteSequential` > `map.colorbar.cmap`；
    palette id 不存在或类型不适用时 warning 并回退默认，不会静默换色。
15. **投影参数（v4）**：`map.centralLatitude` 与 `map.standardParallels` 参与
   Lambert/Albers（标准纬线 + 中央纬度）与 Robinson/Mollweide/EqualEarth/
   正射/方位/北极立体（中央经线/纬度）；`standardParallels` 留空或 `auto` 时
   按范围自动取值并写入 `autoAdjust`；投影切换后 extent/经线/纬线按新投影重算，
   中央经线/纬度自动贴合研究区（>10° / >5–10° 时）同样写入 `autoAdjust`。
16. **工具区分组（v4）**：controls.json 每个 group 带 `appliesTo`
   （`map`/`chart`/`compose`/`all`），UI 用它把「工具区」分四段；渲染器本身
   不依赖该字段，缺省视为 `all`。
17. **窄面板比例尺（v4）**：轴框宽 <70mm 时自动字号 ≤6.5pt、标签间距 4.5pt、
   条长 ≤55% 轴框宽、必要时只保留终点标签，避免文字压条（改进写入 `autoAdjust`）。
18. **自动优化与警告分离（v4）**：引擎自己"做得更合理"的行为（`centralLongitude`、
   `centralLatitude`、`standardParallels`、`colorbarRange`、`cornerFill`、
   `graticuleIntervalX/Y`、`scaleBar*`、`categoricalRotation/FontSize/Abbrev`、
   `numericTicks`、`panelTitle`、`legendPerPanel`、`extent`）只写入
   `autoAdjust:[{key,message}]`（中文 ≤20 字，不含解释性文案），**不占用
   warnings**；`warnings` 只保留真风险：数据缺失/下载失败、字体缺字、文字溢出
   或重叠未解决、customPatch 失败、非法控件值回退、色带/标注绘制失败等。
   自测 `--mode autoadjust` 断言两类通道的边界。"""

DEVIATIONS = """## 与契约的差异说明（需 Lead 知悉）

1. `controls.json` 条目数 **{COUNT}**（契约 v1 §3.3 目标 60–100）。超出部分
   主要来自 v2 §7.2 新增的 compose 组（rows/cols/gap/align/optimize/
   shareColorbar/legendPerPanel/panelLabel×3 等）以及地图/色带细分（投影、
   经纬网、比例尺、指北针、南海插图、色带范围）。已通过生成脚本校验
   「每个 control path 都是 DEFAULT_SPEC 的真实叶子、默认值一致、preset 覆盖
   全部 style.* path」，不存在悬空 path。
2. `presets.json` 的 values 采用**点号展平 path → 值**（如
   `"style.font.sizeBase": 7.0`），这是 controls path 的直接映射，便于 host
   的「智能换风格」按 path 比较；结构上仍是合法 JSON。
3. 契约 §3.3 要求 `visibleWhen`；本文件对地图/图表/合成组均给出
   `visibleWhen: {"path":"kind","in":[...]}`；但控件组的 `visibleWhen` 同时
   写在 group 与 item 上（UI 任取其一即可）。
4. `--thumb` 使用 PIL 缩放（长边 ≤480 px，保持宽高比），`--code-out` 与
   `codegen` 输出同一套 component.py；引擎渲染与生成脚本渲染已用 SHA256
   验证**逐字节一致**（自检 `--mode codegen`）。
5. 多子图 `compose.panels` 同时接受顶层 `panels` 与 `compose.panels` 两种写法
   （host 的 render-spec.json 用后者），便于联调。"""


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join(BUNDLE_DIR, "docs", "SPEC.md"))
    args = parser.parse_args(argv)
    items = controls.control_items()
    groups = controls.groups()
    flat_defaults = flatten(DEFAULT_SPEC)
    count = len(items)
    generated = datetime.date.today().isoformat()
    lines: List[str] = []
    lines.append("# SciFigure Studio · SPEC（渲染器字段表与支持范围）")
    lines.append("")
    lines.append("> 本文件由 `py/tools/gen_spec_doc.py` 从 `py/scifig/controls.json`、"
                 "`py/scifig/presets.json`、`py/scifig/defaults.py` 自动生成（%s），"
                 "与渲染器实现同源；手工修改请改生成器。" % generated)
    lines.append("")
    lines.append("## 1. 定位与入口")
    lines.append("")
    lines.append("`scifig` 是 SciFigure Studio 的 Python 制图引擎（纯 matplotlib + "
                 "cartopy，Agg 后端，只输出 PNG）。所有渲染走同一条代码路径：")
    lines.append("")
    lines.append("```bash")
    lines.append("python -m scifig.cli render "
                 "--spec <spec.json> --out <figure.png> [--workdir <dir>] "
                 "[--thumb <thumb.png>] [--code-out <component.py>]")
    lines.append("python -m scifig.cli codegen "
                 "--spec <spec.json> --out <component.py> [--workdir <dir>]")
    lines.append("python -m scifig.cli validate --spec <spec.json>")
    lines.append("python -m scifig.cli controls --out <controls.json>")
    lines.append("```")
    lines.append("")
    lines.append("stdout 只输出一行 JSON：成功 "
                 "`{\"ok\":true,\"png\":\"…\",\"warnings\":[],"
                 "\"autoAdjust\":[{\"key\":\"centralLongitude\","
                 "\"message\":\"中央经线已对齐研究区中心（85.0°E）\"}],\"metrics\":{…}}`；"
                 "失败 `{\"ok\":false,\"error\":\"…\"}` 且退出码 2。日志一律 stderr。")
    lines.append("")
    lines.append("- `warnings`：**真风险**（数据缺失、字体缺字、文字溢出/重叠未解决、"
                 "customPatch 失败、非法控件值回退等），UI 需提示用户。")
    lines.append("- `autoAdjust`：**引擎自动优化**（中央经线/纬度对齐、标准纬线自动取值、"
                 "比例尺缩短/精简、类目标签旋转/缩小、刻度减少、四角底色、经纬网自动间隔、"
                 "子图标题缩字号等），UI 用灰色 ⓘ 展示即可，不应当成警告。")
    lines.append("")
    lines.append("公共 API（codegen 产物与 CLI 都调用它）：")
    lines.append("")
    lines.append("```python")
    lines.append("from scifig.engine import render_spec")
    lines.append("render_spec(spec, out_png, *, thumb=None, code_out=None, workdir=None)")
    lines.append("```")
    lines.append("")
    lines.append("## 2. spec 结构")
    lines.append("")
    lines.append("- 普通嵌套 JSON 对象；可调参数一律**叶子路径**（点号分隔，不允许数组下标）。")
    lines.append("- 契约固定路径：`kind`、`title`、`figure.widthMm`、`figure.heightMm`、"
                 "`figure.dpi`、`style.preset`、`data.source`、`output.png`。")
    lines.append("- `output.png` 非空时优先于 `--out`；相对路径按 `--workdir` 解析。")
    lines.append("- `kind`：%s。" % "、".join("`%s`（%s）" % (key, label)
                                              for key, label in KIND_LABELS.items()))
    lines.append("- `customPatch`：字符串 Python 代码，面板绘制完成后执行；"
                 "globals 提供 `fig`、`axes`、`ax`、`np`、`plt`、`mpl`、`spec`；"
                 "异常只进 warnings，不影响出图。")
    lines.append("- `kind=\"compose\"`：`compose.panels`（或顶层 `panels`）为面板 spec 数组，"
                 "每个面板只含 `kind/data/map/axes/legend/text/title/customPatch`，"
                 "样式由合成图统一。")
    lines.append("")
    lines.append("## 3. 可调参数总表（%d 项 / %d 组）" % (count, len(groups)))
    lines.append("")
    lines.append("★ 表示 UI 默认展开的 basic 参数。`类型` 与 `默认值` 与实现严格一致；"
                 "`影响` 列说明该参数改动的视觉对象。")
    lines.append("")
    for group in groups:
        group_items = group.get("items", [])
        if not group_items:
            continue
        lines.append("### %s（`%s`，%d 项，工具区 `%s`）" % (
            group["labelZh"], group["id"], len(group_items),
            group.get("appliesTo", "all")))
        lines.append("")
        lines.append(build_table(group_items))
        lines.append("")
    lines.append("## 4. 期刊风格预设（presets.json）")
    lines.append("")
    lines.append(build_preset_table())
    lines.append("")
    lines.append("切换 presets 时，host 按“当前值仍等于旧 preset 默认值才覆盖”的策略合并；"
                 "引擎侧渲染时按 `defaults → preset → spec` 顺序应用，因此同一 spec "
                 "在任何入口都得到同一结果。")
    lines.append("")
    lines.append("## 4.1 配色体系（palettes.json，来自用户 PPT）")
    lines.append("")
    lines.append("配色数据由 `scripts/extract_palettes.py` 从 `科研绘图.pptx` 提取，"
                 "**只读**（不改 ids/colors），共 %d 套：" % len(palette_store.all_palettes()))
    lines.append("")
    lines.append("- 分类色 `categorical`（18 套）：折线/柱/散点分组颜色顺序、地图点符号基色、"
                 "分级设色（无顺序色时）。")
    lines.append("- 顺序色 `sequential`（12 套）：连续填色、热力图、分级设色、色带默认。")
    lines.append("- 发散色 `diverging`（12 套）：正负/距平、以 0 为中心的热力图、正负色带。")
    lines.append("")
    lines.append("优先级：`map.colorbar.palette` > `style.paletteSequential` > "
                 "`map.colorbar.cmap`；分类色缺少时回退旧的 `line/bar/scatter/box.cmap`。"
                 "所有颜色直接取自该 palette 的 hex，不做静默换色。")
    lines.append("")
    lines.append(build_palette_table())
    lines.append("")
    lines.append("## 5. 数据列推断规则（dataio.py）")
    lines.append("")
    lines.append("`data.*` 默认 `\"auto\"`，表示自动推断；host 的 draft 不写这些路径也能出图。")
    lines.append("")
    lines.append("| 路径 | auto 推断规则 |")
    lines.append("|---|---|")
    lines.append("| `data.source` | 相对 `--workdir` 或绝对路径；支持 csv/tsv/txt/xlsx/json/geojson/shp/gpkg |")
    lines.append("| `data.lon` | 列名匹配 lon/lng/longitude/经度/x（地图必需） |")
    lines.append("| `data.lat` | 列名匹配 lat/latitude/纬度/y（地图必需） |")
    lines.append("| `data.value` | value/val/数值/值/含量/浓度/…，否则取第一个数值列 |")
    lines.append("| `data.x` | x/year/年份/date/日期/时间/月份/period，否则第一列 |")
    lines.append("| `data.y` | 折线/散点：除 x 外的数值列；支持逗号分隔多列；双轴用 `line.y2` |")
    lines.append("| `data.group` | group/category/类别/分组/类型/class/type/名称 |")
    lines.append("| `data.label` | label/name/名称/地名/站点/station |")
    lines.append("| `data.sheet` | 读取 xlsx 时指定 sheet（留空取第一个） |")
    lines.append("")
    lines.append("图型与数据形状：")
    lines.append("")
    lines.append("- `map`：点数据（lon/lat[/value/label]）→ 散点/气泡/按值着色；"
                 "矢量数据（GeoJSON/SHP/GPKG，含数值属性）→ 分级设色（分位数/等间距）。")
    lines.append("- `line`：x + 多列 y；`line.dualAxis` 时 `line.y2` 列走右轴。")
    lines.append("- `bar`：类目列 + 数值列（宽表），或 类目/系列/数值（长表，需给 data.value）；"
                 "`bar.mode` 支持 group/stack/percent。")
    lines.append("- `scatter`：两个数值列 + 可选分组列（`scatter.colorBy` 或 data.group）。")
    lines.append("- `heatmap`：行标签列 + 数值列（宽表），或 行/列/值 三列（长表，"
                 "需显式给 `data.x/data.y/data.value`）。")
    lines.append("- `box`：分组列 + 数值列（长表），或直接多列数值（宽表）。")
    lines.append("")
    lines.append("## 6. 样例数据（samples/）")
    lines.append("")
    lines.append(build_sample_table())
    lines.append("")
    lines.append(LIMITATIONS.replace("{COUNT}", str(count)))
    lines.append("")
    lines.append(DEVIATIONS.replace("{COUNT}", str(count)))
    lines.append("")
    lines.append("## 7. 自测")
    lines.append("")
    lines.append("```bash")
    lines.append("cd <BUNDLE>\\py")
    lines.append("python tools\\build_assets.py --check      # controls/presets 一致性校验")
    lines.append("python tools\\selftest.py --mode all        # 样例/控件遍历/风格/合成/确定性/codegen")
    lines.append("```")
    lines.append("")
    lines.append("报告落在 `out/_selftest/report_*.json`，图在 `out/_selftest/`。")
    lines.append("")
    target = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
        handle.write("\n")
    print(json.dumps({"ok": True, "path": target, "items": count,
                      "groups": len(groups),
                      "presets": [p["id"] for p in controls.presets()]},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
