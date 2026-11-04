"""Figure style: font fallback chain + matplotlib rcParams.

Font policy
-----------
A Latin family is always combined with a CJK fallback family, e.g.
``["Arial", "SimSun", "DejaVu Sans"]``.  matplotlib >= 3.6 resolves glyphs
per character through the family list on the Agg backend, so mixed
Chinese/English labels render without tofu.
"""

from __future__ import annotations

from typing import Dict, List

import matplotlib

matplotlib.use("Agg", force=True)

from matplotlib import rcParams  # noqa: E402
from matplotlib.font_manager import findfont, FontProperties  # noqa: E402
from matplotlib.font_manager import fontManager  # noqa: E402

from .log import Ctx  # noqa: E402

#: preferred Latin families (must stay in sync with controls.json)
LATIN_FONTS = ["Arial", "Times New Roman", "Helvetica", "DejaVu Sans"]

#: CJK families tried after the primary family
CJK_FONTS = [
    "SimSun",
    "SimHei",
    "Microsoft YaHei",
    "KaiTi",
    "FangSong",
    "STSong",
    "Noto Sans CJK SC",
    "Source Han Sans SC",
    "WenQuanYi Zen Hei",
    "Arial Unicode MS",
]

_AVAILABLE_FONTS: Dict[str, bool] = {}
_CJK_PRESENT: Dict[str, bool] = {}


def available_fonts() -> List[str]:
    names = {f.name for f in fontManager.ttflist}
    return sorted(names)


def _font_exists(name: str) -> bool:
    if not name:
        return False
    if not _AVAILABLE_FONTS:
        for entry in fontManager.ttflist:
            _AVAILABLE_FONTS[entry.name] = True
    return bool(_AVAILABLE_FONTS.get(name))


def has_cjk_glyphs(font_name: str) -> bool:
    """True when *font_name* carries CJK glyphs (probe 中/国/度)."""
    if font_name in _CJK_PRESENT:
        return _CJK_PRESENT[font_name]
    ok = False
    try:
        from matplotlib.ft2font import FT2Font

        path = findfont(FontProperties(family=[font_name]), fallback_to_default=False)
        font = FT2Font(path)
        cmap = font.get_charmap()
        ok = all(ord(ch) in cmap for ch in ("中", "国", "度"))
    except Exception:  # noqa: BLE001
        ok = False
    _CJK_PRESENT[font_name] = ok
    return ok


def resolve_fonts(family: str, cjk_fallback: str, ctx: Ctx) -> List[str]:
    """Build the ordered font family list used for every text artist."""
    chain: List[str] = []
    primary = str(family or "Arial").strip()
    if _font_exists(primary):
        chain.append(primary)
    else:
        ctx.warn("字体 %r 在本机不可用，已回退默认字体链" % primary)

    # universal symbol coverage (superscript minus, arrows, Greek …)
    for name in ("DejaVu Sans",):
        if name not in chain and _font_exists(name):
            chain.append(name)

    fallback = str(cjk_fallback or "auto").strip()
    if fallback and fallback.lower() not in ("none", "无", "off"):
        if fallback.lower() == "auto":
            for name in CJK_FONTS:
                if _font_exists(name) and has_cjk_glyphs(name):
                    chain.append(name)
                    break
        elif _font_exists(fallback):
            chain.append(fallback)
        else:
            ctx.warn("中文字体 %r 不可用，已改用自动回退链" % fallback)
            for name in CJK_FONTS:
                if _font_exists(name) and has_cjk_glyphs(name):
                    chain.append(name)
                    break

    for name in CJK_FONTS:
        if name not in chain and _font_exists(name):
            chain.append(name)
    for name in ("Arial", "DejaVu Sans"):
        if name not in chain and _font_exists(name):
            chain.append(name)
    if not chain:
        chain = ["DejaVu Sans"]
    # de-duplicate preserving order
    seen = set()
    unique: List[str] = []
    for name in chain:
        if name not in seen:
            seen.add(name)
            unique.append(name)
    return unique


def apply_style(spec: Dict, ctx: Ctx) -> Dict:
    """Apply global rcParams for one render; returns resolved style info."""
    style = spec["style"]
    font_cfg = style["font"]
    axis_cfg = style["axis"]
    line_cfg = style["line"]
    bar_cfg = style["bar"]
    figure = spec["figure"]

    fonts = resolve_fonts(font_cfg.get("family", "Arial"), font_cfg.get("cjkFallback", "auto"), ctx)

    def pt(value, fallback):
        try:
            return float(value)
        except (TypeError, ValueError):
            return fallback

    size_base = pt(font_cfg.get("sizeBase"), 8.0)
    size_title = pt(font_cfg.get("sizeTitle"), size_base + 1.0)
    size_axis = pt(font_cfg.get("sizeAxis"), size_base)
    size_tick = pt(font_cfg.get("sizeTick"), size_base - 1.0)
    size_legend = pt(font_cfg.get("sizeLegend"), size_base - 1.0)
    size_note = pt(font_cfg.get("sizeNote"), size_base - 1.5)
    tick_direction = axis_cfg.get("tickDirection", "in")
    grid_on = bool(axis_cfg.get("grid", False))

    rcParams.update(
        {
            "font.family": fonts,
            "font.sans-serif": fonts,
            "font.serif": fonts,
            "font.monospace": fonts,
            "font.size": size_base,
            "axes.titlesize": size_title,
            "axes.labelsize": size_axis,
            "xtick.labelsize": size_tick,
            "ytick.labelsize": size_tick,
            "legend.fontsize": size_legend,
            "legend.title_fontsize": size_legend,
            "axes.linewidth": pt(axis_cfg.get("lineWidth"), 0.8),
            "axes.edgecolor": axis_cfg.get("spineColor", "#000000"),
            "axes.labelcolor": font_cfg.get("color", "#000000"),
            "axes.titleweight": "bold" if spec.get("text", {}).get("titleBold", True) else "normal",
            "axes.unicode_minus": False,
            "xtick.direction": tick_direction,
            "ytick.direction": tick_direction,
            "xtick.major.size": pt(axis_cfg.get("tickLength"), 3.0),
            "ytick.major.size": pt(axis_cfg.get("tickLength"), 3.0),
            "xtick.major.width": pt(axis_cfg.get("tickWidth"), 0.8),
            "ytick.major.width": pt(axis_cfg.get("tickWidth"), 0.8),
            "xtick.minor.size": pt(axis_cfg.get("tickLength"), 3.0) * 0.6,
            "ytick.minor.size": pt(axis_cfg.get("tickLength"), 3.0) * 0.6,
            "xtick.minor.width": pt(axis_cfg.get("tickWidth"), 0.8) * 0.75,
            "ytick.minor.width": pt(axis_cfg.get("tickWidth"), 0.8) * 0.75,
            "xtick.labelcolor": font_cfg.get("color", "#000000"),
            "ytick.labelcolor": font_cfg.get("color", "#000000"),
            "axes.grid": grid_on,
            "grid.color": axis_cfg.get("gridColor", "#d9d9d9"),
            "grid.linewidth": pt(axis_cfg.get("gridLineWidth"), 0.4),
            "grid.linestyle": ":",
            "grid.alpha": 0.9,
            "text.color": font_cfg.get("color", "#000000"),
            "figure.facecolor": figure.get("facecolor", "#ffffff"),
            "figure.edgecolor": figure.get("facecolor", "#ffffff"),
            "savefig.facecolor": figure.get("facecolor", "#ffffff"),
            "savefig.edgecolor": figure.get("facecolor", "#ffffff"),
            "savefig.dpi": figure.get("dpi", 300),
            "savefig.transparent": False,
            "figure.autolayout": False,
            "figure.constrained_layout.use": False,
            "lines.linewidth": pt(line_cfg.get("width"), 1.2),
            "lines.markersize": pt(line_cfg.get("markerSize"), 3.5),
            "lines.solid_capstyle": "round",
            "patch.linewidth": pt(bar_cfg.get("edgeWidth"), 0.5),
            "patch.edgecolor": bar_cfg.get("edgeColor", "#000000"),
            "patch.facecolor": "none",
            "axes.formatter.use_mathtext": False,
            "mathtext.fontset": "dejavusans",
            "legend.handlelength": 1.6,
            "legend.handleheight": 0.9,
            "legend.borderpad": 0.35,
            "legend.labelspacing": 0.35,
            "legend.columnspacing": 1.0,
            "legend.framealpha": 0.9,
            "legend.fancybox": False,
            "legend.borderaxespad": 0.4,
            "axes.axisbelow": True,
        }
    )
    return {
        "fonts": fonts,
        "sizeBase": size_base,
        "sizeTitle": size_title,
        "sizeAxis": size_axis,
        "sizeTick": size_tick,
        "sizeLegend": size_legend,
        "sizeNote": size_note,
        "fontColor": font_cfg.get("color", "#000000"),
    }


def style_spines(ax, spec: Dict) -> None:
    """Apply top/right spine visibility and tick styling to one axes."""
    axis_cfg = spec["style"]["axis"]
    show_top = bool(axis_cfg.get("showTop", False))
    show_right = bool(axis_cfg.get("showRight", False))
    for side, visible in (("top", show_top), ("right", show_right)):
        try:
            ax.spines[side].set_visible(visible)
        except KeyError:  # pragma: no cover - GeoAxes owns its own frame
            pass
    direction = axis_cfg.get("tickDirection", "in")
    for axis in (ax.xaxis, ax.yaxis):
        try:
            axis.set_tick_params(which="both", direction=direction)
        except Exception:  # noqa: BLE001 - some cartopy axes ignore this
            pass
    if axis_cfg.get("grid", False):
        ax.set_axisbelow(True)
        try:
            ax.grid(True, color=axis_cfg.get("gridColor", "#d9d9d9"),
                    linewidth=axis_cfg.get("gridLineWidth", 0.4), linestyle=":", alpha=0.9)
        except Exception:  # noqa: BLE001
            pass
