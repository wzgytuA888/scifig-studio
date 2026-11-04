"""Generator + validator for scifig/controls.json and scifig/presets.json.

controls.json is the single source of truth for the workbench UI and the
Chinese natural-language parser (host side).  It must stay in lockstep with
``scifig.defaults.DEFAULT_SPEC``: every control path exists there and its
``default`` equals the spec default.  This script enforces that and fails loudly.

Run:  python tools/build_assets.py [--check]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List

HERE = os.path.dirname(os.path.abspath(__file__))
PY_DIR = os.path.dirname(HERE)
sys.path.insert(0, PY_DIR)

from scifig.defaults import DEFAULT_SPEC  # noqa: E402
from scifig.paths import flatten  # noqa: E402

CONTROLS_PATH = os.path.join(PY_DIR, "scifig", "controls.json")
PRESETS_PATH = os.path.join(PY_DIR, "scifig", "presets.json")

GROUPS: List[Dict[str, Any]] = []
PRESETS: List[Dict[str, Any]] = []


# ---------------------------------------------------------------------------
# small builders
# ---------------------------------------------------------------------------
def group(group_id: str, zh: str, en: str, order: int, visible=None) -> Dict[str, Any]:
    entry: Dict[str, Any] = {"id": group_id, "labelZh": zh, "labelEn": en,
                             "order": order, "items": []}
    if visible:
        entry["visibleWhen"] = visible
    GROUPS.append(entry)
    return entry


def _item(bucket, path, kind, zh, en, level, default, extra, aliases, help_text, visible):
    item: Dict[str, Any] = {"path": path, "type": kind, "labelZh": zh,
                            "labelEn": en, "level": level, "default": default}
    item.update(extra)
    if aliases:
        item["aliases"] = list(aliases)
    if help_text:
        item["help"] = help_text
    if visible:
        item["visibleWhen"] = visible
    bucket["items"].append(item)


def num(bucket, path, zh, en, default, lo, hi, step=None, unit="", level="advanced",
        aliases=(), help_text="", integer=False, nullable=False, visible=None):
    extra: Dict[str, Any] = {"min": lo, "max": hi}
    if step is not None:
        extra["step"] = step
    if unit:
        extra["unit"] = unit
    if integer:
        extra["integer"] = True
    if nullable:
        extra["nullable"] = True
    _item(bucket, path, "number", zh, en, level, default, extra, aliases, help_text, visible)


def enum(bucket, path, zh, en, default, options, labels, level="basic", aliases=(),
         help_text="", visible=None):
    extra = {"options": list(options), "optionLabels": dict(labels)}
    _item(bucket, path, "enum", zh, en, level, default, extra, aliases, help_text, visible)


def flag(bucket, path, zh, en, default, level="advanced", aliases=(), help_text="",
         visible=None):
    _item(bucket, path, "bool", zh, en, level, default, {}, aliases, help_text, visible)


def col(bucket, path, zh, en, default, level="advanced", aliases=(), help_text="",
        visible=None):
    _item(bucket, path, "color", zh, en, level, default, {}, aliases, help_text, visible)


def txt(bucket, path, zh, en, default, level="advanced", aliases=(), help_text="",
        visible=None, multiline=False):
    extra = {"multiline": True} if multiline else {}
    _item(bucket, path, "text", zh, en, level, default, extra, aliases, help_text, visible)


# ---------------------------------------------------------------------------
# journal presets (defined first: style.preset options come from here)
# ---------------------------------------------------------------------------
BASE_STYLE: Dict[str, Any] = {
    "style.font.family": "Arial",
    "style.font.cjkFallback": "SimSun",
    "style.font.sizeBase": 8.0,
    "style.font.sizeTitle": 10.0,
    "style.font.sizeAxis": 8.0,
    "style.font.sizeTick": 7.0,
    "style.font.sizeLegend": 7.0,
    "style.axis.lineWidth": 0.8,
    "style.axis.tickWidth": 0.8,
    "style.axis.tickLength": 3.0,
    "style.axis.tickDirection": "in",
    "style.axis.showTop": False,
    "style.axis.showRight": False,
    "style.axis.grid": False,
    "style.line.width": 1.2,
    "style.line.marker": "none",
    "style.line.markerSize": 3.5,
    "style.bar.width": 0.7,
}


def style_values(**overrides) -> Dict[str, Any]:
    values = dict(BASE_STYLE)
    values.update(overrides)
    return values


def preset(pid: str, zh: str, en: str, values: Dict[str, Any]) -> None:
    PRESETS.append({"id": pid, "labelZh": zh, "labelEn": en, "values": values})


preset("sci", "通用 SCI", "Generic SCI", style_values(**{"figure.widthMm": 180}))
preset("nature", "Nature", "Nature", style_values(**{
    "figure.widthMm": 89,
    "style.font.sizeBase": 7.0, "style.font.sizeTitle": 8.0,
    "style.font.sizeAxis": 7.0, "style.font.sizeTick": 6.0,
    "style.font.sizeLegend": 6.0,
    "style.axis.lineWidth": 0.5, "style.axis.tickWidth": 0.5,
    "style.axis.tickLength": 2.5,
    "style.line.width": 1.0, "style.line.markerSize": 3.0, "style.bar.width": 0.6,
}))
preset("science", "Science", "Science", style_values(**{
    "figure.widthMm": 120,
    "style.font.sizeBase": 7.0, "style.font.sizeTitle": 8.0,
    "style.font.sizeAxis": 7.0, "style.font.sizeTick": 6.0,
    "style.font.sizeLegend": 6.0,
    "style.axis.lineWidth": 0.6, "style.axis.tickWidth": 0.6,
    "style.line.width": 1.0, "style.line.markerSize": 3.0, "style.bar.width": 0.65,
}))
preset("elsevier", "Elsevier", "Elsevier", style_values(**{
    "figure.widthMm": 180,
    "style.font.sizeTitle": 9.0,
    "style.axis.lineWidth": 0.75, "style.axis.tickWidth": 0.75,
}))
preset("ieee", "IEEE", "IEEE", style_values(**{
    "figure.widthMm": 89,
    "style.font.family": "Times New Roman",
    "style.font.sizeTitle": 9.0,
    "style.axis.lineWidth": 0.7, "style.axis.tickWidth": 0.7,
    "style.line.width": 1.0,
}))
preset("geography-cn", "地理学报", "Acta Geographica Sinica", style_values(**{
    "figure.widthMm": 180,
    "style.font.family": "SimSun",
    "style.font.sizeTitle": 9.5,
    "style.axis.lineWidth": 0.7, "style.axis.tickWidth": 0.7,
    "style.line.width": 1.1,
}))
preset("remote-sensing-cn", "遥感学报", "National Remote Sensing Bulletin",
       style_values(**{
           "figure.widthMm": 180,
           "style.font.family": "SimSun",
           "style.font.cjkFallback": "SimHei",
           "style.font.sizeTitle": 9.0,
           "style.axis.lineWidth": 0.7, "style.axis.tickWidth": 0.7,
           "style.line.width": 1.1,
       }))

PRESET_IDS = [entry["id"] for entry in PRESETS]
PRESET_LABELS = {entry["id"]: entry["labelZh"] for entry in PRESETS}

MAP_ONLY = {"path": "kind", "in": ["map"]}
CBAR_ON = {"path": "kind", "in": ["map", "heatmap"]}

# ---------------------------------------------------------------------------
# figure / text / style
# ---------------------------------------------------------------------------
FIG = group("figure", "画幅输出", "Figure", 10)
num(FIG, "figure.widthMm", "图幅宽度", "Figure width", 180.0, 40, 400, 1, "mm", "basic",
    ["宽度", "图宽", "画幅宽度", "width"], "单栏期刊常用 89mm，双栏 180mm")
num(FIG, "figure.heightMm", "图幅高度", "Figure height", 120.0, 30, 400, 1, "mm", "basic",
    ["高度", "图高", "画幅高度", "height"])
num(FIG, "figure.dpi", "输出分辨率", "DPI", 300, 72, 1200, 1, "dpi", "basic",
    ["分辨率", "dpi", "清晰度"], "SCI 印前一般 300 或 600 dpi")

TXT = group("text", "标题与标注", "Titles", 20)
txt(TXT, "title", "图标题", "Title", "", "basic",
    ["标题", "图名", "title", "大标题"], "总标题；合成图会居中显示")
txt(TXT, "text.note", "数据来源脚注", "Data note", "", "advanced",
    ["脚注", "数据来源", "注记", "note", "source"])

STYLE = group("style", "期刊风格", "Journal preset", 30)
enum(STYLE, "style.preset", "期刊风格", "Journal preset", "sci", PRESET_IDS,
     PRESET_LABELS, "basic", ["风格", "期刊", "preset", "期刊风格", "模板"],
     "切换风格统一字体/字号/线宽（用户改过的项不会被覆盖）")

FONT = group("font", "字体字号", "Fonts", 32)
enum(FONT, "style.font.family", "西文字体", "Latin font", "Arial",
     ["Arial", "Times New Roman", "Helvetica", "SimSun", "SimHei", "Microsoft YaHei"],
     {"Arial": "Arial（无衬线）", "Times New Roman": "Times New Roman（衬线）",
      "Helvetica": "Helvetica", "SimSun": "宋体", "SimHei": "黑体",
      "Microsoft YaHei": "微软雅黑"},
     "basic", ["字体", "西文字体", "font", "family"], "中文会自动回退到下面的中文字体")
enum(FONT, "style.font.cjkFallback", "中文字体回退", "CJK fallback", "SimSun",
     ["auto", "SimSun", "SimHei", "Microsoft YaHei", "KaiTi", "none"],
     {"auto": "自动选择", "SimSun": "宋体", "SimHei": "黑体",
      "Microsoft YaHei": "微软雅黑", "KaiTi": "楷体", "none": "不回退"},
     "advanced", ["中文字体", "汉字字体", "cjk", "中文回退"])
num(FONT, "style.font.sizeBase", "基准字号", "Base font size", 8.0, 5, 16, 0.5, "pt",
    "basic", ["字号", "整体字号", "font size"], "SCI 正文图一般 6–9pt")
num(FONT, "style.font.sizeTitle", "标题字号", "Title size", 10.0, 5, 20, 0.5, "pt",
    "basic", ["标题大小", "标题字号"])
num(FONT, "style.font.sizeAxis", "轴标题字号", "Axis label size", 8.0, 5, 16, 0.5, "pt",
    "advanced", ["轴标签字号", "轴名字号"])
num(FONT, "style.font.sizeTick", "刻度字号", "Tick label size", 7.0, 4, 14, 0.5, "pt",
    "advanced", ["刻度数字", "刻度字号"])
num(FONT, "style.font.sizeLegend", "图例字号(默认)", "Legend size", 7.0, 4, 14, 0.5, "pt",
    "advanced", ["图例字号", "图例字体大小"])

# ---------------------------------------------------------------------------
# colour palettes (read-only PPT data -> enum options for UI / NL)
# ---------------------------------------------------------------------------
from scifig import palettes as palette_store  # noqa: E402

CAT_IDS = palette_store.ids("categorical") or ["ppt-01"]
SEQ_IDS = palette_store.ids("sequential") or ["ppt-19"]
DIV_IDS = palette_store.ids("diverging") or ["ppt-20"]
CAT_LABELS = palette_store.labels("categorical")
SEQ_LABELS = palette_store.labels("sequential")
DIV_LABELS = palette_store.labels("diverging")

PALETTE_GROUP = group("palette", "配色", "Palette", 33)
enum(PALETTE_GROUP, "style.palette", "分类配色", "Categorical palette",
     CAT_IDS[0], CAT_IDS, CAT_LABELS, "basic",
     ["配色", "颜色", "色系", "配色方案", "换一套颜色", "分类配色", "palette"],
     "PPT 提取的 18 套分类配色，用于折线/柱/散点/点符号/分级设色")
enum(PALETTE_GROUP, "style.paletteSequential", "顺序配色", "Sequential palette",
     SEQ_IDS[0], SEQ_IDS, SEQ_LABELS, "basic",
     ["顺序配色", "连续配色", "色带配色", "sequential palette"],
     "用于连续填色、热力图、分级设色与色带默认")
enum(PALETTE_GROUP, "style.paletteDiverging", "发散配色", "Diverging palette",
     DIV_IDS[0], DIV_IDS, DIV_LABELS, "advanced",
     ["发散配色", "正负配色", "diverging palette"],
     "用于正负值/距平/以 0 为中心的热力图")

LINE = group("line", "线宽与填充", "Lines", 34)
num(LINE, "style.line.width", "线宽", "Line width", 1.2, 0.2, 5, 0.1, "pt", "basic",
    ["线宽", "线条粗细", "linewidth"])
enum(LINE, "style.line.marker", "数据点标记", "Marker", "none",
     ["none", "o", "s", "^", "D", "v", "P", "*"],
     {"none": "无", "o": "圆点", "s": "方块", "^": "上三角", "D": "菱形",
      "v": "下三角", "P": "加号", "*": "星号"},
     "advanced", ["标记", "点型", "marker", "符号"])
num(LINE, "style.line.markerSize", "标记大小", "Marker size", 3.5, 1, 15, 0.5, "pt",
    "advanced", ["标记大小", "点大小"])
num(LINE, "style.bar.width", "柱宽比例", "Bar width", 0.7, 0.1, 1, 0.05, "",
    "advanced", ["柱宽", "柱子宽度", "bar width"])

AXST = group("axisStyle", "轴与边框", "Axes frame", 36)
num(AXST, "style.axis.lineWidth", "轴框线宽", "Spine width", 0.8, 0.2, 3, 0.1, "pt",
    "advanced", ["轴框线宽", "边框粗细"])
num(AXST, "style.axis.tickWidth", "刻度线宽", "Tick width", 0.8, 0.2, 3, 0.1, "pt",
    "advanced", ["刻度线宽", "刻度粗细"])
num(AXST, "style.axis.tickLength", "刻度长度", "Tick length", 3.0, 1, 12, 0.5, "pt",
    "advanced", ["刻度长度", "刻度线长度"])
enum(AXST, "style.axis.tickDirection", "刻度朝向", "Tick direction", "in",
     ["in", "out", "inout"],
     {"in": "朝内", "out": "朝外", "inout": "双向"},
     "basic", ["刻度朝内", "刻度方向", "tick direction"], "SCI 制图通常朝内")
flag(AXST, "style.axis.showTop", "显示上边框", "Show top spine", False, "advanced",
     ["上边框", "顶部边框", "top spine"])
flag(AXST, "style.axis.showRight", "显示右边框", "Show right spine", False, "advanced",
     ["右边框", "右侧边框", "right spine"])
flag(AXST, "style.axis.grid", "显示网格", "Show grid", False, "basic",
     ["网格", "网格线", "grid"], "折线/散点图可开启；地图用经纬网")

# ---------------------------------------------------------------------------
# map
# ---------------------------------------------------------------------------
PROJ = group("mapProjection", "地图投影", "Map projection", 40, MAP_ONLY)
enum(PROJ, "map.projection", "投影方式", "Projection", "lambert",
     ["platecarree", "mercator", "miller", "lambert", "albers", "robinson",
      "mollweide", "equalearth", "orthographic", "azimuthal", "northpolarstereo"],
     {"platecarree": "等经纬度", "mercator": "墨卡托", "miller": "米勒",
      "lambert": "兰伯特等角圆锥", "albers": "阿尔伯斯等积圆锥",
      "robinson": "罗宾逊", "mollweide": "摩尔威特", "equalearth": "等地球",
      "orthographic": "正射", "azimuthal": "方位等距", "northpolarstereo": "北极立体"},
     "basic", ["投影", "投影方式", "projection", "坐标系"],
     "中国区域图推荐兰伯特或阿尔伯斯；世界图用罗宾逊/等地球")
enum(PROJ, "map.extentPreset", "范围预设", "Extent preset", "china_neighbors",
     ["china", "china_neighbors", "china_full", "xinjiang", "central_asia",
      "asia", "world", "custom"],
     {"china": "中国", "china_neighbors": "中国及周边", "china_full": "中国全境(含南海)",
      "xinjiang": "新疆", "central_asia": "中亚", "asia": "亚洲", "world": "全球",
      "custom": "自定义经纬度"},
     "basic", ["范围", "图幅范围", "研究区范围", "extent", "显示范围"],
     "非 custom 时以预设为准，四个 extent 数值被忽略；custom 才用下面四项")
for _path, _zh, _en, _default, _lo, _hi in (
    ("map.extentLonMin", "最小经度", "Lon min", 72.0, -180, 360),
    ("map.extentLonMax", "最大经度", "Lon max", 137.0, -180, 360),
    ("map.extentLatMin", "最小纬度", "Lat min", 16.0, -90, 90),
    ("map.extentLatMax", "最大纬度", "Lat max", 55.0, -90, 90),
):
    num(PROJ, _path, _zh, _en, _default, _lo, _hi, 0.5, "°", "advanced",
        [_zh, _zh.replace("经度", "经").replace("纬度", "纬"), _path.split(".")[-1]],
        "仅 map.extentPreset=custom 时生效",
        visible={"path": "map.extentPreset", "in": ["custom"]})
num(PROJ, "map.centralLongitude", "中央经线", "Central longitude", 105.0, -180, 360, 1,
    "°", "advanced", ["中央经线", "中心经度", "central longitude"],
    "圆锥/方位投影会自动贴合研究区中心（偏差 >10° 时）；显式设置接近值则尊重用户输入")
num(PROJ, "map.centralLatitude", "中央纬度", "Central latitude", 35.0, -90, 90, 1,
    "°", "advanced", ["中央纬度", "中心纬度", "central latitude"],
    "Lambert/Albers/正射/方位投影的锥顶/球心纬度；偏离研究区 >5–10° 时自动贴合并 warning")
txt(PROJ, "map.standardParallels", "标准纬线", "Standard parallels", "25,47",
    "advanced", ["标准纬线", "双标准纬线", "standard parallels"],
    "Lambert/Albers 用，逗号分隔两条标准纬线（如 25,47）；留空或 auto 时按范围自动取值")

LAYERS = group("mapLayers", "地图要素", "Map layers", 44, MAP_ONLY)
for _path, _zh, _en, _default, _level in (
    ("map.layers.land", "陆地", "Land", True, "basic"),
    ("map.layers.ocean", "海洋", "Ocean", True, "basic"),
    ("map.layers.lakes", "湖泊", "Lakes", True, "advanced"),
    ("map.layers.rivers", "河流", "Rivers", False, "advanced"),
    ("map.layers.coastline", "海岸线", "Coastline", True, "advanced"),
    ("map.layers.countryBorders", "国界线", "Country borders", True, "advanced"),
    ("map.layers.chinaBorder", "中国国界", "China border", True, "basic"),
    ("map.layers.provinceBorders", "省界", "Province borders", False, "advanced"),
    ("map.layers.scsInset", "南海诸岛插图", "South China Sea inset", False, "basic"),
):
    flag(LAYERS, _path, _zh, _en, _default, _level, [_zh, _path.split(".")[-1]],
         "" if "scs" not in _path else "仅示意，正式出版请核对标准地图")

COLORS = group("mapColors", "地图配色", "Map colours", 45, MAP_ONLY)
for _path, _zh, _en, _default in (
    ("map.colors.land", "陆地填充", "Land fill", "#f2efe9"),
    ("map.colors.ocean", "海洋填充", "Ocean fill", "#e6f0f7"),
    ("map.colors.border", "国界颜色", "Border colour", "#8c8c8c"),
    ("map.colors.chinaBorder", "中国国界颜色", "China border colour", "#333333"),
):
    col(COLORS, _path, _zh, _en, _default, "advanced", [_zh, _path.split(".")[-1]])

GRID = group("mapGrid", "经纬网", "Graticule", 46, MAP_ONLY)
flag(GRID, "map.grid.show", "显示经纬网", "Show graticule", True, "basic",
     ["经纬网", "格网", "网格线", "graticule"])
num(GRID, "map.grid.intervalX", "经度间隔", "Longitude step", 0, 0, 60, 1, "°",
    "advanced", ["经度间隔", "经度步长"], "0 表示按图幅自动计算")
num(GRID, "map.grid.intervalY", "纬度间隔", "Latitude step", 0, 0, 60, 1, "°",
    "advanced", ["纬度间隔", "纬度步长"], "0 表示按图幅自动计算")
enum(GRID, "map.grid.labelFormat", "标注格式", "Label format", "degree",
     ["degree", "degree_minute", "degree_only", "none"],
     {"degree": "度（75°E）", "degree_minute": "度分（75°30′E）",
      "degree_only": "纯数字度数", "none": "不标注"},
     "basic", ["经纬度格式", "标注格式", "度数格式", "label format"])
flag(GRID, "map.grid.labelTop", "上方标注经度", "Top labels", False, "advanced",
     ["上方标注", "上边框标注", "top labels"])
flag(GRID, "map.grid.labelRight", "右侧标注纬度", "Right labels", False, "advanced",
     ["右侧标注", "右边框标注", "right labels"])

CBAR = group("colorbar", "色带", "Colourbar", 48, CBAR_ON)
flag(CBAR, "map.colorbar.show", "显示色带", "Show colorbar", True, "basic",
     ["色带", "图例色带", "colorbar", "色条"])
txt(CBAR, "map.colorbar.label", "色带标题", "Colorbar label", "", "basic",
    ["色带标题", "色带名称", "colorbar label", "单位说明"],
    "单位上下标自动排版：dS m-1 / dS m⁻¹ / m2 都会转成上标")
enum(CBAR, "map.colorbar.location", "色带位置", "Colorbar location", "right",
     ["right", "bottom", "inside"],
     {"right": "右侧", "bottom": "下方", "inside": "图内"},
     "basic", ["色带位置", "色条位置", "colorbar position"])
enum(CBAR, "map.colorbar.cmap", "配色方案", "Colour map", "YlOrRd",
     ["YlOrRd", "YlGnBu", "RdYlBu", "RdBu_r", "Spectral", "viridis", "plasma",
      "magma", "cividis", "Greys", "Blues", "Greens", "OrRd", "PuBu", "terrain"],
     {"YlOrRd": "黄橙红", "YlGnBu": "黄绿蓝", "RdYlBu": "红黄蓝",
      "RdBu_r": "红蓝（反向）", "Spectral": "光谱", "viridis": "viridis",
      "plasma": "plasma", "magma": "magma", "cividis": "cividis",
      "Greys": "灰阶", "Blues": "蓝色系", "Greens": "绿色系",
      "OrRd": "橙红", "PuBu": "紫蓝", "terrain": "地形"},
     "basic", ["配色", "色带颜色", "cmap", "色系", "colormap"])
enum(CBAR, "map.colorbar.palette", "色带配色（PPT）", "Colorbar palette", "",
     [""] + SEQ_IDS + DIV_IDS,
     dict({"": "跟随配色（cmap / 顺序色）"}, **dict(SEQ_LABELS), **dict(DIV_LABELS)),
     "basic", ["色带配色", "色带颜色", "色条配色", "colorbar palette"],
     "优先于 cmap；空=按 style.paletteSequential → map.colorbar.cmap 回退")
enum(CBAR, "map.colorbar.tickFormat", "刻度格式", "Tick format", "auto",
     ["auto", "integer", "one_decimal", "two_decimal", "scientific", "percent"],
     {"auto": "自动（按范围统一小数位）", "integer": "整数", "one_decimal": "1 位小数",
      "two_decimal": "2 位小数", "scientific": "科学计数", "percent": "百分比"},
     "advanced", ["色带刻度格式", "色带数字格式", "tick format", "色带小数位"],
     "auto 会按数值范围统一小数位，避免 0.27/0.472 混排")
enum(CBAR, "map.colorbar.extend", "色带延伸", "Extend", "neither",
     ["neither", "min", "max", "both"],
     {"neither": "不延伸", "min": "低端延伸", "max": "高端延伸", "both": "两端延伸"},
     "advanced", ["延伸", "超出值", "extend"])
num(CBAR, "map.colorbar.vmin", "色带最小值", "Colorbar min", None, -1e12, 1e12, None, "",
    "advanced", ["最小值", "下限", "vmin"], "留空自动取数据最小值", nullable=True)
num(CBAR, "map.colorbar.vmax", "色带最大值", "Colorbar max", None, -1e12, 1e12, None, "",
    "advanced", ["最大值", "上限", "vmax"], "留空自动取数据最大值", nullable=True)

SCALEBAR = group("scaleBar", "比例尺", "Scale bar", 50, MAP_ONLY)
flag(SCALEBAR, "map.scaleBar.show", "显示比例尺", "Show scale bar", False, "basic",
     ["比例尺", "scale bar"])
num(SCALEBAR, "map.scaleBar.lengthKm", "比例尺长度", "Scale bar length", 500, 10, 5000,
    10, "km", "basic", ["比例尺长度", "比例尺距离", "scale length"])
enum(SCALEBAR, "map.scaleBar.position", "比例尺位置", "Scale bar position", "lower left",
     ["lower left", "lower right", "upper left", "upper right"],
     {"lower left": "左下", "lower right": "右下", "upper left": "左上",
      "upper right": "右上"},
     "advanced", ["比例尺位置", "scale bar position"])

NORTH = group("northArrow", "指北针", "North arrow", 52, MAP_ONLY)
flag(NORTH, "map.northArrow.show", "显示指北针", "Show north arrow", False, "basic",
     ["指北针", "北箭头", "north arrow"])
enum(NORTH, "map.northArrow.position", "指北针位置", "North arrow position", "upper right",
     ["upper right", "upper left", "lower right", "lower left"],
     {"upper right": "右上", "upper left": "左上", "lower right": "右下",
      "lower left": "左下"},
     "advanced", ["指北针位置", "north arrow position"])
num(NORTH, "map.northArrow.size", "指北针大小", "North arrow size", 0.045, 0.02, 0.2,
    0.005, "", "advanced", ["指北针大小", "北箭头大小"])

POINT = group("mapPoint", "点与标注", "Points & labels", 54, MAP_ONLY)
enum(POINT, "map.point.mode", "点符号模式", "Point mode", "auto",
     ["auto", "fixed", "bubble", "choropleth"],
     {"auto": "自动", "fixed": "单色散点", "bubble": "气泡（按数值）",
      "choropleth": "按数值着色"},
     "basic", ["点符号", "点位符号", "散点模式", "point mode"])
num(POINT, "map.point.size", "符号大小", "Point size", 22.0, 2, 300, 1, "pt²", "basic",
    ["点大小", "符号大小", "point size"])
col(POINT, "map.point.color", "符号颜色", "Point colour", "#d62728", "advanced",
    ["点颜色", "符号颜色", "point color"])
flag(POINT, "map.label.show", "显示点标注", "Show point labels", False, "basic",
     ["点标注", "显示名称", "label"])
num(POINT, "map.label.size", "点标注字号", "Label size", 6.0, 4, 14, 0.5, "pt",
    "advanced", ["标注字号", "点字号"])
num(POINT, "map.choropleth.classes", "分级数量", "Class count", 5, 2, 9, 1, "级",
    "advanced", ["分级数", "分级数量", "classes"])
enum(POINT, "map.choropleth.palette", "分级设色配色（PPT）", "Choropleth palette", "",
     [""] + SEQ_IDS + DIV_IDS,
     dict({"": "跟随顺序配色（style.paletteSequential）"},
          **dict(SEQ_LABELS), **dict(DIV_LABELS)),
     "advanced", ["分级配色", "分级设色配色", "choropleth palette"],
     "优先于 style.paletteSequential；空=跟随顺序配色")

# ---------------------------------------------------------------------------
# legend / axes / chart-specific / data / compose / code
# ---------------------------------------------------------------------------
LEGEND = group("legend", "图例", "Legend", 60)
flag(LEGEND, "legend.show", "显示图例", "Show legend", True, "basic",
     ["图例", "显示图例", "legend"])
enum(LEGEND, "legend.position", "图例位置", "Legend position", "auto",
     ["auto", "upper right", "upper left", "lower right", "lower left", "center",
      "outside right", "below"],
     {"auto": "自动避让", "upper right": "右上", "upper left": "左上",
      "lower right": "右下", "lower left": "左下", "center": "居中",
      "outside right": "图外右侧", "below": "图下方"},
     "basic", ["图例位置", "图例放哪", "图例放到", "legend position"],
     "auto 会按数据像素遮挡打分挑选遮挡最少的位置")
num(LEGEND, "legend.fontSize", "图例字号", "Legend font size", None, 4, 20, 0.5, "pt",
    "basic", ["图例字号", "图例字体大小"],
    "留空跟随 style.font.sizeLegend（期刊风格切换会同步）", nullable=True)
num(LEGEND, "legend.ncol", "图例列数", "Legend columns", 1, 1, 5, 1, "", "advanced",
    ["图例列数", "图例横排", "ncol"], integer=True)
flag(LEGEND, "legend.frame", "图例边框", "Legend frame", True, "advanced",
     ["图例边框", "图例框", "legend frame"])
txt(LEGEND, "legend.title", "图例标题", "Legend title", "", "advanced",
    ["图例标题", "图例名称", "legend title"])

AXES = group("axes", "轴设置", "Axes", 70)
txt(AXES, "axes.xlabel", "X 轴标题", "X label", "", "basic",
    ["x 轴", "横轴标题", "xlabel", "横轴"])
txt(AXES, "axes.ylabel", "Y 轴标题", "Y label", "", "basic",
    ["y 轴", "纵轴标题", "ylabel", "纵轴"])
enum(AXES, "axes.xScale", "X 轴尺度", "X scale", "linear",
     ["linear", "log"], {"linear": "线性", "log": "对数"},
     "advanced", ["x 轴对数", "横轴对数", "xscale"])
enum(AXES, "axes.yScale", "Y 轴尺度", "Y scale", "linear",
     ["linear", "log"], {"linear": "线性", "log": "对数"},
     "advanced", ["y 轴对数", "纵轴对数", "yscale"])
for _path, _zh, _en in (("axes.xMin", "X 轴最小值", "X min"),
                        ("axes.xMax", "X 轴最大值", "X max"),
                        ("axes.yMin", "Y 轴最小值", "Y min"),
                        ("axes.yMax", "Y 轴最大值", "Y max")):
    num(AXES, _path, _zh, _en, None, -1e12, 1e12, None, "", "advanced",
        [_zh, _path.split(".")[-1]], "留空自动", nullable=True)
enum(AXES, "axes.categoricalRotation", "类目标签旋转", "Category label rotation",
     "auto", ["auto", "0", "30", "45", "90"],
     {"auto": "自动（重叠时依次旋转）", "0": "水平", "30": "30°",
      "45": "45°", "90": "垂直"},
     "advanced", ["类目标签旋转", "标签旋转", "类目旋转", "category rotation"],
     "auto：相邻标签重叠时自动 30°→45°→缩字号→缩写，仍重叠则进 warnings")

LINE_G = group("lineChart", "折线图", "Line chart", 76, {"path": "kind", "in": ["line"]})
enum(LINE_G, "line.cmap", "多系列配色", "Series colours", "tab10",
     ["tab10", "tab20", "Set1", "Set2", "Set3", "Paired", "Dark2", "viridis",
      "plasma", "Spectral"],
     {"tab10": "tab10", "tab20": "tab20", "Set1": "Set1", "Set2": "Set2",
      "Set3": "Set3", "Paired": "Paired", "Dark2": "Dark2", "viridis": "viridis",
      "plasma": "plasma", "Spectral": "Spectral"},
     "basic", ["多系列配色", "折线配色", "line cmap"])
flag(LINE_G, "line.dualAxis", "启用双 Y 轴", "Dual axis", False, "advanced",
     ["双轴", "双 y 轴", "次坐标轴", "dual axis"])
txt(LINE_G, "line.y2", "右轴数据列", "Right axis column", "", "advanced",
    ["右轴数据", "次坐标轴列", "y2"])

BAR_G = group("barChart", "柱状图", "Bar chart", 78, {"path": "kind", "in": ["bar"]})
enum(BAR_G, "bar.mode", "柱状模式", "Bar mode", "group",
     ["group", "stack", "percent"],
     {"group": "分组", "stack": "堆叠", "percent": "百分比堆叠"},
     "basic", ["分组柱", "堆叠柱", "柱状模式", "bar mode"])
enum(BAR_G, "bar.orientation", "方向", "Orientation", "vertical",
     ["vertical", "horizontal"],
     {"vertical": "竖直", "horizontal": "水平"},
     "basic", ["横向柱", "水平柱", "条形图", "orientation"])
enum(BAR_G, "bar.cmap", "柱配色", "Bar colours", "tab10",
     ["tab10", "Set1", "Set2", "Set3", "Paired", "Dark2", "viridis", "Blues"],
     {"tab10": "tab10", "Set1": "Set1", "Set2": "Set2", "Set3": "Set3",
      "Paired": "Paired", "Dark2": "Dark2", "viridis": "viridis", "Blues": "Blues"},
     "advanced", ["柱配色", "柱子颜色", "bar cmap"])
flag(BAR_G, "bar.valueLabels", "显示数值标签", "Value labels", False, "advanced",
     ["数值标签", "显示数值", "value labels"])

SCAT_G = group("scatterChart", "散点图", "Scatter", 80, {"path": "kind", "in": ["scatter"]})
enum(SCAT_G, "scatter.fit", "拟合线", "Fit line", "none",
     ["none", "linear", "poly2"],
     {"none": "不拟合", "linear": "线性拟合", "poly2": "二次拟合"},
     "basic", ["拟合线", "趋势线", "回归线", "fit"])
flag(SCAT_G, "scatter.showEquation", "显示拟合方程", "Show equation", True, "advanced",
     ["拟合方程", "显示 R2", "方程"])
txt(SCAT_G, "scatter.colorBy", "着色分组列", "Colour by column", "", "advanced",
    ["按列着色", "分组列", "colorBy"])

HEAT_G = group("heatmapChart", "热力图", "Heatmap", 82, {"path": "kind", "in": ["heatmap"]})
enum(HEAT_G, "heatmap.cmap", "热力配色", "Heatmap cmap", "RdBu_r",
     ["RdBu_r", "RdYlBu", "viridis", "plasma", "magma", "cividis", "YlOrRd",
      "Spectral", "Greys"],
     {"RdBu_r": "红蓝（反向）", "RdYlBu": "红黄蓝", "viridis": "viridis",
      "plasma": "plasma", "magma": "magma", "cividis": "cividis",
      "YlOrRd": "黄橙红", "Spectral": "光谱", "Greys": "灰阶"},
     "basic", ["热力配色", "矩阵配色", "heatmap cmap"])
flag(HEAT_G, "heatmap.annotate", "显示单元格数值", "Annotate cells", False, "advanced",
     ["单元格数值", "数值标注", "annotate"])

BOX_G = group("boxChart", "箱线图", "Box plot", 84, {"path": "kind", "in": ["box"]})
flag(BOX_G, "box.showOutliers", "显示离群点", "Show outliers", True, "advanced",
     ["离群点", "异常值", "outliers"])
num(BOX_G, "box.boxWidth", "箱体宽度", "Box width", 0.6, 0.1, 1, 0.05, "", "advanced",
    ["箱体宽度", "箱子宽度"])

DATA = group("data", "数据列映射", "Data columns", 90)
for _path, _zh, _en, _aliases, _help in (
    ("data.x", "X 列", "X column", ["x 列", "横轴列", "x 轴数据", "x column"], ""),
    ("data.y", "Y 列", "Y column", ["y 列", "纵轴列", "y 轴数据", "y column"], ""),
    ("data.group", "分组列", "Group column", ["分组列", "类别列", "group column"], ""),
    ("data.value", "数值列", "Value column", ["数值列", "值列", "value column"], ""),
    ("data.lat", "纬度列", "Latitude column", ["纬度列", "lat 列", "latitude"],
     "地图点数据建议显式指定，或保持 auto"),
    ("data.lon", "经度列", "Longitude column", ["经度列", "lon 列", "longitude"],
     "地图点数据建议显式指定，或保持 auto"),
):
    txt(DATA, _path, _zh, _en, "auto", "advanced", _aliases,
        _help or "填列名；“auto”表示自动推断")

COMPOSE = group("compose", "多子图合成", "Composite", 95,
                {"path": "kind", "in": ["compose"]})
num(COMPOSE, "compose.rows", "行数", "Rows", 0, 0, 6, 1, "", "basic",
    ["行数", "几行", "rows"], "0 表示自动（接近方形）", integer=True)
num(COMPOSE, "compose.cols", "列数", "Columns", 0, 0, 6, 1, "", "basic",
    ["列数", "几列", "cols"], "0 表示自动", integer=True)
num(COMPOSE, "compose.gapXMm", "水平间距", "Horizontal gap", 4.0, 0, 30, 0.5, "mm",
    "basic", ["子图间距", "水平间距", "gap x"])
num(COMPOSE, "compose.gapYMm", "垂直间距", "Vertical gap", 4.0, 0, 30, 0.5, "mm",
    "basic", ["行间距", "垂直间距", "gap y"])
enum(COMPOSE, "compose.align", "对齐方式", "Alignment", "axes",
     ["none", "axes"], {"none": "不对齐", "axes": "轴框对齐"},
     "advanced", ["对齐", "轴框对齐", "align"])
flag(COMPOSE, "compose.optimize", "排版优化", "Optimise layout", True, "basic",
     ["排版优化", "自动排版", "optimize"],
     "开启后等宽等高、轴框对齐、编号统一、总标题居中、边距最小化")
flag(COMPOSE, "compose.shareColorbar", "共享色带", "Shared colorbar", False,
     "advanced", ["共享色带", "共用色带"])
flag(COMPOSE, "compose.legendPerPanel", "每面板独立图例", "Legend per panel", True,
     "advanced", ["面板图例", "每图图例"])
flag(COMPOSE, "compose.panelLabel.show", "显示子图编号", "Show panel labels", True,
     "basic", ["子图编号", "abcdef", "panel label"])
enum(COMPOSE, "compose.panelLabel.style", "编号样式", "Label style", "(a)",
     ["(a)", "a"], {"(a)": "(a) 带括号", "a": "a 不带括号"},
     "basic", ["编号样式", "括号形式", "label style"])
enum(COMPOSE, "compose.panelLabel.position", "编号位置", "Label position",
     "upper left",
     ["upper left", "upper right", "lower left", "lower right"],
     {"upper left": "左上", "upper right": "右上", "lower left": "左下",
      "lower right": "右下"},
     "basic", ["编号位置", "标签位置", "label position"])

CODE = group("code", "自定义代码", "Custom code", 97)
txt(CODE, "customPatch", "自定义 Python 代码", "Custom patch", "", "advanced",
    ["自定义", "定制代码", "改代码", "customPatch"],
    "面板绘制完成后执行；可用 fig/axes/ax/np/plt/mpl/spec；异常只记 warning 不影响出图",
    multiline=True)


#: group id -> 工具区 section ("map" | "chart" | "compose" | "all")
GROUP_APPLIES = {
    "figure": "all",
    "text": "all",
    "style": "all",
    "font": "all",
    "palette": "all",
    "line": "chart",
    "axisStyle": "chart",
    "mapProjection": "map",
    "mapLayers": "map",
    "mapColors": "map",
    "mapGrid": "map",
    "colorbar": "map",
    "scaleBar": "map",
    "northArrow": "map",
    "mapPoint": "map",
    "legend": "all",
    "axes": "chart",
    "lineChart": "chart",
    "barChart": "chart",
    "scatterChart": "chart",
    "heatmapChart": "chart",
    "boxChart": "chart",
    "data": "all",
    "compose": "compose",
    "code": "all",
}


# ---------------------------------------------------------------------------
# emit + validate
# ---------------------------------------------------------------------------
def build() -> Dict[str, Any]:
    for entry in GROUPS:
        entry["appliesTo"] = GROUP_APPLIES.get(entry["id"], "all")
    return {"controls": {"version": 1, "groups": GROUPS},
            "presets": {"version": 1, "presets": PRESETS}}


def validate(controls_doc: Dict[str, Any], presets_doc: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    flat_defaults = flatten(DEFAULT_SPEC)
    control_paths: List[str] = []
    seen = set()
    for blob in controls_doc["groups"]:
        for item in blob["items"]:
            path = item["path"]
            if path in seen:
                errors.append("重复的 control path: %s" % path)
            seen.add(path)
            control_paths.append(path)
            if path not in flat_defaults:
                errors.append("control path 不在 DEFAULT_SPEC: %s" % path)
                continue
            if item["default"] != flat_defaults[path]:
                errors.append("默认值不一致 %s: controls=%r spec=%r" % (
                    path, item["default"], flat_defaults[path]))
            if item["type"] == "enum":
                if item["default"] not in item["options"]:
                    errors.append("enum 默认值不在 options: %s" % path)
                missing = [o for o in item["options"] if o not in item["optionLabels"]]
                if missing:
                    errors.append("enum 缺 optionLabels: %s -> %s" % (path, missing))
            if item["type"] == "number" and item["default"] is not None:
                lo, hi = item.get("min"), item.get("max")
                if lo is not None and item["default"] < lo:
                    errors.append("默认值低于 min: %s" % path)
                if hi is not None and item["default"] > hi:
                    errors.append("默认值高于 max: %s" % path)
            if item["type"] == "number" and item["default"] is None and not item.get("nullable"):
                errors.append("默认 null 但未标 nullable: %s" % path)
            if not item.get("labelZh"):
                errors.append("缺 labelZh: %s" % path)
            if not item.get("aliases"):
                errors.append("缺 aliases: %s" % path)
    # colour palette selections are user data, not typographic style, so
    # presets intentionally do not carry them (switching journal keeps the palette)
    style_paths = [p for p in control_paths
                   if p.startswith("style.") and p != "style.preset"
                   and not p.startswith("style.palette")]
    for entry in presets_doc["presets"]:
        values = entry["values"]
        missing_style = [p for p in style_paths if p not in values]
        if missing_style:
            errors.append("preset %s 缺 style path: %s" % (entry["id"], missing_style))
        for path in values:
            if path not in control_paths:
                errors.append("preset %s 的 key 不是 controls path: %s" % (entry["id"], path))
    return errors


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="只校验不写文件")
    args = parser.parse_args(argv)
    docs = build()
    errors = validate(docs["controls"], docs["presets"])
    summary = {
        "groups": len(docs["controls"]["groups"]),
        "items": sum(len(blob["items"]) for blob in docs["controls"]["groups"]),
        "presets": PRESET_IDS,
        "errors": errors,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if errors:
        print("ASSET VALIDATION FAILED", file=sys.stderr)
        return 1
    if args.check:
        return 0
    for path, doc in ((CONTROLS_PATH, docs["controls"]), (PRESETS_PATH, docs["presets"])):
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(doc, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        print("wrote " + path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
