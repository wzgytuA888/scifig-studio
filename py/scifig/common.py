"""Shared figure plumbing: canvas geometry, axes fitting, colorbar, ticks, text."""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Tuple

import matplotlib
import numpy as np
from matplotlib import colors as mcolors
from matplotlib import pyplot as plt
from matplotlib.cm import ScalarMappable
from matplotlib.ticker import FuncFormatter, ScalarFormatter, StrMethodFormatter

from .log import Ctx
from .paths import get_path
from .textutil import normalize_text

MM_PER_INCH = 25.4


def mm_to_px(mm: float, dpi: float) -> float:
    return float(mm) / MM_PER_INCH * float(dpi)


def px_to_mm(px: float, dpi: float) -> float:
    return float(px) * MM_PER_INCH / float(dpi)


def figure_pixels(spec: Dict) -> Tuple[int, int]:
    figure = spec["figure"]
    dpi = float(figure["dpi"])
    width = int(round(mm_to_px(figure["widthMm"], dpi)))
    height = int(round(mm_to_px(figure["heightMm"], dpi)))
    return max(1, width), max(1, height)


def new_figure(spec: Dict) -> Any:
    figure = spec["figure"]
    dpi = float(figure["dpi"])
    fig = plt.figure(
        figsize=(float(figure["widthMm"]) / MM_PER_INCH, float(figure["heightMm"]) / MM_PER_INCH),
        dpi=dpi,
        facecolor=figure.get("facecolor", "#ffffff"),
        frameon=False,
    )
    fig.set_facecolor(figure.get("facecolor", "#ffffff"))
    return fig


def save_figure(fig, path: str, spec: Dict, ctx: Ctx) -> str:
    target = os.path.abspath(path)
    directory = os.path.dirname(target)
    if directory:
        os.makedirs(directory, exist_ok=True)
    fig.savefig(
        target,
        format="png",
        dpi=float(spec["figure"]["dpi"]),
        facecolor=fig.get_facecolor(),
        edgecolor=fig.get_facecolor(),
        transparent=False,
        metadata={"Software": "SciFigure Studio", "Creator": "SciFigure Studio"},
    )
    return target


def provisional_rect(kind: str) -> List[float]:
    """Starting axes rect; the fitting pass refines it afterwards."""
    if kind == "map":
        return [0.08, 0.09, 0.82, 0.80]
    return [0.11, 0.12, 0.80, 0.78]


def fit_axes(
    fig,
    ax,
    pad_mm: float = 1.2,
    reserve_right_px: float = 0.0,
    reserve_bottom_px: float = 0.0,
    reserve_top_px: float = 0.0,
    reserve_left_px: float = 0.0,
    extra_bboxes: Optional[List[Tuple[float, float, float, float]]] = None,
    max_iter: int = 4,
) -> None:
    """Grow the axes until its decorations sit flush inside the canvas."""
    from matplotlib.transforms import Bbox

    pad = mm_to_px(max(0.0, pad_mm), fig.dpi)
    fw, fh = float(fig.bbox.width), float(fig.bbox.height)
    avail_x0 = pad + reserve_left_px
    avail_x1 = fw - pad - reserve_right_px
    avail_y0 = pad + reserve_bottom_px
    avail_y1 = fh - pad - reserve_top_px
    if avail_x1 - avail_x0 < 30 or avail_y1 - avail_y0 < 30:
        return
    renderer = None
    for _ in range(max_iter):
        try:
            fig.canvas.draw()
            renderer = fig.canvas.get_renderer()
            bbox = ax.get_tightbbox(renderer)
        except Exception:  # noqa: BLE001 - fitting is best-effort
            return
        if bbox is None:
            return
        if extra_bboxes:
            boxes = [Bbox.from_extents(bbox.x0, bbox.y0, bbox.x1, bbox.y1)]
            for x0, y0, x1, y1 in extra_bboxes:
                boxes.append(Bbox.from_extents(x0, y0, x1, y1))
            bbox = Bbox.union(boxes)
        cur = ax.get_position().bounds
        px0, py0 = cur[0] * fw, cur[1] * fh
        pw, ph = cur[2] * fw, cur[3] * fh
        left_m = max(0.0, px0 - bbox.x0)
        right_m = max(0.0, bbox.x1 - (px0 + pw))
        bottom_m = max(0.0, py0 - bbox.y0)
        top_m = max(0.0, bbox.y1 - (py0 + ph))
        new_px0 = avail_x0 + left_m + 1.0
        new_py0 = avail_y0 + bottom_m + 1.0
        new_px1 = avail_x1 - right_m - 1.0
        new_py1 = avail_y1 - top_m - 1.0
        if new_px1 - new_px0 < 24 or new_py1 - new_py0 < 24:
            return
        new_rect = [
            new_px0 / fw,
            new_py0 / fh,
            (new_px1 - new_px0) / fw,
            (new_py1 - new_py0) / fh,
        ]
        old = ax.get_position().bounds
        ax.set_position(new_rect)
        if all(abs(a - b) < 0.0015 for a, b in zip(new_rect, old)):
            break
    try:
        fig.canvas.draw()
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------------------
# colour maps / colourbar
# ---------------------------------------------------------------------------
def fill_cmap(spec: Dict, ctx: Ctx, role: str = "sequential",
              fallback: str = "viridis") -> Tuple[Any, str]:
    """Resolve a continuous colour map from the PPT palettes.

    Roles / priority:
    * ``colorbar``   : ``map.colorbar.palette`` > ``style.paletteSequential`` > cmap
    * ``choropleth`` : ``map.choropleth.palette`` > ``style.paletteSequential`` > cmap
    * ``diverging``  : ``style.paletteDiverging`` > cmap
    * ``sequential`` : ``style.paletteSequential`` > cmap
    """
    from . import palettes as palette_store

    style = spec.get("style") or {}
    candidate = ""
    if role == "colorbar":
        candidate = str(get_path(spec, "map.colorbar.palette") or "") \
            or str(style.get("paletteSequential") or "")
    elif role == "choropleth":
        candidate = str(get_path(spec, "map.choropleth.palette") or "") \
            or str(style.get("paletteSequential") or "")
    elif role == "diverging":
        candidate = str(style.get("paletteDiverging") or "")
    else:
        candidate = str(style.get("paletteSequential") or "")
    if candidate:
        cmap = palette_store.sequential_cmap(candidate) or palette_store.diverging_cmap(candidate)
        if cmap is not None:
            return cmap, candidate
    return resolve_cmap(fallback, ctx), ""


def class_colors(spec: Dict, ctx: Ctx, count: int, fallback_cmap: str = "YlOrRd",
                 role: str = "choropleth") -> Tuple[List[Any], str]:
    """Return *count* ordered class colours (palette first, cmap sampled otherwise)."""
    from . import palettes as palette_store

    style = spec.get("style") or {}
    if role == "choropleth":
        candidate = str(get_path(spec, "map.choropleth.palette") or "") \
            or str(style.get("paletteSequential") or "")
    elif role == "categorical":
        candidate = str(style.get("palette") or "")
    else:
        candidate = str(style.get("paletteSequential") or "")
    if candidate:
        colors = palette_store.class_colors(candidate, count)
        if colors:
            return [mcolors.to_rgba(color) for color in colors], candidate
    cmap = resolve_cmap(fallback_cmap, ctx)
    if count <= 1:
        return [cmap(1.0)], ""
    return [cmap(index / float(count - 1)) for index in range(count)], ""


def point_color(spec: Dict, ctx: Ctx) -> str:
    """Map point marker colour: categorical palette's first colour by default."""
    from . import palettes as palette_store

    cfg = spec["map"]["point"]
    color = str(cfg.get("color") or "#d62728")
    default_color = "#d62728"
    palette_id = str((spec.get("style") or {}).get("palette") or "").strip()
    if color.lower() == default_color and palette_id:
        colors = palette_store.colors_of(palette_id)
        if colors:
            return colors[0]
    return color


def resolve_cmap(name: str, ctx: Ctx, fallback: str = "viridis") -> Any:
    try:
        return matplotlib.colormaps[name]
    except Exception:  # noqa: BLE001
        from . import controls

        allowed = controls.control_index().get("map.colorbar.cmap", {}).get("options") or []
        if name not in allowed:
            ctx.warn("未知配色方案 %r，已回退为 %r" % (name, fallback))
        try:
            return matplotlib.colormaps[fallback]
        except Exception:  # noqa: BLE001
            return matplotlib.colormaps["viridis"]


def make_mappable(cmap_name: str, vmin: float, vmax: float, label: str,
                  extend: str, spec: Dict, ctx: Ctx, norm_center: Optional[float] = None) -> ScalarMappable:
    cmap = resolve_cmap(cmap_name, ctx)
    if vmin == vmax:
        vmax = vmin + 1e-9
    if norm_center is not None:
        from matplotlib.colors import TwoSlopeNorm

        span = max(abs(vmin - norm_center), abs(vmax - norm_center))
        norm = TwoSlopeNorm(vmin=norm_center - span, vcenter=norm_center, vmax=norm_center + span)
    else:
        norm = mcolors.Normalize(vmin=vmin, vmax=vmax)
    mappable = ScalarMappable(norm=norm, cmap=cmap)
    mappable.set_array(np.array([vmin, vmax]))
    mappable.set_clim(vmin, vmax)
    if extend in ("min", "max", "both", "neither"):
        mappable.set_extend(extend)
    return mappable


def add_colorbar(fig, ax, mappable, spec: Dict, ctx: Ctx, horizontal: bool = False,
                 boundaries: Optional[List[float]] = None,
                 ticks_override: Optional[List[float]] = None,
                 cax_rect: Optional[List[float]] = None,
                 shrink_label: bool = False,
                 width_scale: float = 1.0,
                 pad_extra_mm: float = 0.0) -> Any:
    """Add a colorbar using the configured location / size / tick format."""
    cfg = spec["map"]["colorbar"]
    location = str(cfg.get("location", "right")).lower()
    if horizontal or location in ("bottom", "below", "bottom out", "outside bottom"):
        orientation = "horizontal"
    else:
        orientation = "vertical"
    width_frac = float(cfg.get("width", 0.024) or 0.024)
    width_frac = min(0.12, max(0.008, width_frac)) * max(0.4, min(1.0, width_scale))
    pad_mm = 1.6 + max(0.0, float(pad_extra_mm))
    pos = ax.get_position()
    fw, fh = float(fig.bbox.width), float(fig.bbox.height)
    if location == "inside":
        planned_rect = [pos.x1 - width_frac * 1.2 - 0.02, pos.y0 + 0.12 * pos.height,
                        width_frac, 0.55 * pos.height]
        inside = True
    elif orientation == "horizontal":
        bar_h = 0.028 * (fh / max(fw, 1.0)) * 1.6
        bar_h = max(0.018, min(0.05, bar_h))
        planned_rect = [pos.x0 + 0.18 * pos.width,
                        pos.y0 - mm_to_px(pad_mm + 6.0, fig.dpi) / fh,
                        0.64 * pos.width, bar_h]
        inside = False
    else:
        bar_w = width_frac * (0.75 if shrink_label else 1.0)
        gap = mm_to_px(pad_mm, fig.dpi) / fw
        planned_rect = [pos.x1 + gap, pos.y0 + 0.12 * pos.height, bar_w, 0.62 * pos.height]
        inside = False
    cax = fig.add_axes(cax_rect if cax_rect is not None else planned_rect,
                       zorder=5 if inside else 2)
    if inside:
        cax.patch.set_alpha(0.0)
    ticks = _colorbar_ticks(mappable, cfg, ctx)
    if ticks_override is not None:
        ticks = list(ticks_override)
    try:
        colorbar_kwargs: Dict[str, Any] = {
            "cax": cax,
            "orientation": orientation,
            "extend": cfg.get("extend", "neither"),
            "ticks": ticks if ticks is not None else None,
        }
        if boundaries:
            colorbar_kwargs["boundaries"] = list(boundaries)
            colorbar_kwargs["spacing"] = "proportional"
            colorbar_kwargs["extend"] = "neither"
        cbar = fig.colorbar(mappable, **colorbar_kwargs)
    except Exception as exc:  # noqa: BLE001
        ctx.warn("色带绘制失败（%s），已跳过" % exc)
        fig.delaxes(cax)
        return None
    label = normalize_text(str(cfg.get("label") or "").strip())
    if label:
        label_size = float(spec["style"]["font"].get("sizeAxis", 8.0))
        if shrink_label:
            label_size = max(5.0, label_size - 1.0)
        cbar.set_label(label, fontsize=label_size)
    font_size = float(spec["style"]["font"].get("sizeTick", 7.0))
    cbar.ax.tick_params(labelsize=font_size, width=float(spec["style"]["axis"].get("tickWidth", 0.8)),
                        length=float(spec["style"]["axis"].get("tickLength", 3.0)),
                        direction=spec["style"]["axis"].get("tickDirection", "in"))
    if not bool(cfg.get("outline", True)):
        cbar.outline.set_visible(False)
    fmt = str(cfg.get("tickFormat", "auto"))
    clim = mappable.get_clim()
    if boundaries:
        labels = _format_tick_values(list(boundaries), clim[0], clim[1], fmt)
        if orientation == "horizontal":
            cbar.ax.set_xticklabels(labels)
        else:
            cbar.ax.set_yticklabels(labels)
    elif ticks is not None:
        labels = _format_tick_values(list(ticks), clim[0], clim[1], fmt)
        if orientation == "horizontal":
            cbar.ax.set_xticklabels(labels)
        else:
            cbar.ax.set_yticklabels(labels)
    return cbar


def _auto_decimals(vmin: float, vmax: float) -> int:
    span = abs(float(vmax) - float(vmin))
    if span < 5.0:
        return 2
    if span < 50.0:
        return 1
    return 0


def _format_tick_values(values: List[float], vmin: float, vmax: float, fmt: str) -> List[str]:
    """Uniform decimal formatting for one colourbar (never mixed 0.27/0.472)."""
    fmt = str(fmt or "auto")
    if fmt in ("auto", "", "none"):
        decimals = _auto_decimals(vmin, vmax)
        return [("%.*f" % (decimals, value)) for value in values]
    return [_format_value(value, fmt) for value in values]


def _colorbar_ticks(mappable, cfg: Dict, ctx: Ctx) -> Optional[List[float]]:
    if cfg.get("scale") == "log":
        return None
    vmin, vmax = mappable.get_clim()
    count = int(cfg.get("tickCount", 5) or 5)
    count = max(3, min(12, count))
    try:
        from matplotlib.ticker import MaxNLocator

        locator = MaxNLocator(nbins=count, steps=[1, 2, 2.5, 5, 10])
        ticks = [float(t) for t in locator.tick_values(vmin, vmax)
                 if vmin - 1e-12 <= t <= vmax + 1e-12]
        if len(ticks) < 3:  # sparse ranges: fall back to even spacing
            ticks = [float(v) for v in np.linspace(vmin, vmax, count)]
        return ticks
    except Exception:  # noqa: BLE001
        return None


def _format_value(value: float, fmt: str) -> str:
    if fmt in ("integer", "int"):
        return "%d" % round(value)
    if fmt in ("one_decimal", "1f", "oneDecimal"):
        return "%.1f" % value
    if fmt in ("two_decimal", "2f"):
        return "%.2f" % value
    if fmt in ("scientific", "sci"):
        return "%.1e" % value
    if fmt in ("percent", "pct"):
        return "%g%%" % (value * 100.0)
    if fmt in ("percent_direct",):
        return "%g%%" % value
    if abs(value) >= 10000 or (value != 0 and abs(value) < 0.001):
        return "%.1e" % value
    if abs(value - round(value)) < 1e-9:
        return "%d" % round(value)
    return "%g" % value


def format_ticks(ax, spec: Dict) -> None:
    """Apply axis scale / limits / tick formats / rotation."""
    from .textutil import normalize_text

    axes_cfg = spec["axes"]
    for axis_name in ("x", "y"):
        scale = axes_cfg.get("%sScale" % axis_name, "linear")
        try:
            # set_xscale() resets locators/formatters -> would wipe category
            # tick labels, so only touch the scale when it actually changes
            if str(getattr(ax, "get_%sscale" % axis_name)()) != str(scale):
                getattr(ax, "set_%sscale" % axis_name)(scale)
        except Exception:  # noqa: BLE001
            pass
    x_min, x_max = axes_cfg.get("xMin"), axes_cfg.get("xMax")
    y_min, y_max = axes_cfg.get("yMin"), axes_cfg.get("yMax")
    if x_min is not None or x_max is not None:
        try:
            ax.set_xlim(left=x_min, right=x_max)
        except Exception:  # noqa: BLE001
            pass
    if y_min is not None or y_max is not None:
        try:
            ax.set_ylim(bottom=y_min, top=y_max)
        except Exception:  # noqa: BLE001
            pass
    if axes_cfg.get("invertY"):
        try:
            ax.invert_yaxis()
        except Exception:  # noqa: BLE001
            pass
    fmt = str(axes_cfg.get("tickFormat", "auto"))
    if fmt != "auto":
        formatter = FuncFormatter(lambda value, _pos: _format_value(value, fmt))
        ax.xaxis.set_major_formatter(formatter)
        ax.yaxis.set_major_formatter(formatter)
    rotate = float(axes_cfg.get("tickRotate", 0) or 0)
    if rotate:
        for label in ax.get_xticklabels():
            label.set_rotation(rotate)
            label.set_ha("right" if rotate > 0 else "left")
            label.set_rotation_mode("anchor")
    xlabel = normalize_text(str(axes_cfg.get("xlabel") or "").strip())
    ylabel = normalize_text(str(axes_cfg.get("ylabel") or "").strip())
    if xlabel:
        ax.set_xlabel(xlabel)
    if ylabel:
        ax.set_ylabel(ylabel)


def apply_title(ax, spec: Dict, ctx: Ctx) -> None:
    from .textutil import normalize_text

    title = normalize_text(str(spec.get("title") or "").strip())
    subtitle = normalize_text(str(spec.get("subtitle") or "").strip())
    if subtitle:
        title = title + ("\n" + subtitle if title else subtitle)
    if title:
        font_size = float(spec["style"]["font"].get("sizeTitle", 10.0))
        weight = "bold" if spec.get("text", {}).get("titleBold", True) else "normal"
        try:
            ax.set_title(title, fontsize=font_size, fontweight=weight,
                         color=spec["style"]["font"].get("color", "#000000"), pad=8.0)
        except Exception:  # noqa: BLE001
            ctx.warn("标题绘制失败")


def apply_note(fig, spec: Dict, ctx: Ctx) -> None:
    from .textutil import normalize_text

    note = normalize_text(str(spec.get("text", {}).get("note") or "").strip())
    if not note:
        return
    size = float(spec["text"].get("noteSize", spec["style"]["font"].get("sizeNote", 6.5)) or 6.5)
    align = str(spec["text"].get("noteAlign", "right"))
    x = {"left": 0.01, "center": 0.5, "right": 0.99}.get(align, 0.99)
    ha = {"left": "left", "center": "center", "right": "right"}.get(align, "right")
    try:
        fig.text(x, 0.004, note, ha=ha, va="bottom", fontsize=size,
                 color=spec["style"]["font"].get("color", "#000000"))
    except Exception:  # noqa: BLE001
        ctx.warn("脚注绘制失败")


def panel_label(fig, ax, letter: str, spec: Dict) -> None:
    pos = ax.get_position()
    size = float(spec["style"]["font"].get("sizeAxis", 8.0)) + 1.0
    weight = "bold"
    try:
        fig.text(pos.x0 - 0.012, pos.y1 + 0.004, "(%s)" % letter, ha="right", va="bottom",
                 fontsize=size, fontweight=weight,
                 color=spec["style"]["font"].get("color", "#000000"))
    except Exception:  # noqa: BLE001
        pass


def hex_to_rgb(color: str) -> Tuple[float, float, float]:
    return mcolors.to_rgb(color)


# ---------------------------------------------------------------------------
# categorical / numeric tick-label auto fit
# ---------------------------------------------------------------------------
def _axis_labels(ax, axis: str) -> List[Any]:
    labels = ax.get_xticklabels() if axis == "x" else ax.get_yticklabels()
    return [label for label in labels if str(label.get_text()).strip()]


def _label_boxes(fig, labels: List[Any]) -> List[Any]:
    try:
        fig.canvas.draw()
        renderer = fig.canvas.get_renderer()
    except Exception:  # noqa: BLE001
        return []
    boxes = []
    for label in labels:
        try:
            bbox = label.get_window_extent(renderer)
        except Exception:  # noqa: BLE001
            continue
        if bbox is None or bbox.width <= 0 or bbox.height <= 0:
            continue
        boxes.append(bbox)
    return boxes


def _boxes_overlap(boxes: List[Any], tolerance: float = 0.5,
                   min_gap: float = 0.0, axis: str = "x") -> bool:
    """Overlap *or* uncomfortably small gap between adjacent labels.

    Bounding boxes are sorted along the axis first (matplotlib may return
    y-tick labels top-to-bottom), so gaps are always non-negative.
    """
    ordered = sorted(boxes, key=lambda box: box.x0 if axis == "x" else box.y0)
    for index in range(len(ordered) - 1):
        first, second = ordered[index], ordered[index + 1]
        if axis == "x":
            gap = second.x0 - first.x1
            span = min(first.y1, second.y1) - max(first.y0, second.y0)
        else:
            gap = second.y0 - first.y1
            span = min(first.x1, second.x1) - max(first.x0, second.x0)
        if span > tolerance and gap < max(min_gap, -tolerance):
            return True
    return False


def _is_numeric_label(text: str) -> bool:
    cleaned = str(text).strip().replace("−", "-").replace("°", "").replace("%", "")
    if not cleaned:
        return False
    try:
        float(cleaned)
        return True
    except ValueError:
        return False


def _abbreviate(text: str, max_chars: int = 5) -> str:
    text = str(text)
    if len(text) <= max_chars:
        return text
    return text[: max(1, max_chars - 1)] + "…"


def _apply_tick_style(labels: List[Any], rotation: float, font_size: float) -> None:
    for label in labels:
        try:
            label.set_fontsize(font_size)
            label.set_rotation(rotation)
            if rotation:
                label.set_ha("right")
                label.set_rotation_mode("anchor")
            else:
                label.set_ha("center")
                label.set_rotation_mode("default")
        except Exception:  # noqa: BLE001
            continue


def fit_axis_labels(fig, ax, spec: Dict, ctx: Ctx, axis: str = "x") -> Dict[str, Any]:
    """Auto-fit categorical rotation / numeric tick density for one axis.

    Categorical axis: on label overlap, try 30° -> 45° -> 90° (``auto``), then
    shrink font by 1 pt (min 6 pt), then abbreviate; still overlapping -> warning.
    Numeric axis: on overlap, reduce the locator bin count (5 -> 4 -> 3).
    """
    labels = _axis_labels(ax, axis)
    if len(labels) < 2:
        return {"axis": axis, "labels": len(labels), "fitted": False}
    fig_width_px = float(fig.bbox.width)
    if fig_width_px <= 0:
        return {"axis": axis, "fitted": False}
    numeric = all(_is_numeric_label(label.get_text()) for label in labels)
    base_size = float(spec["style"]["font"].get("sizeTick", 7.0))
    mode = str(spec["axes"].get("categoricalRotation", "auto") or "auto")
    # a FixedLocator usually means explicit category ticks -> never re-locate them
    try:
        from matplotlib.ticker import FixedLocator

        target_axis = ax.xaxis if axis == "x" else ax.yaxis
        fixed_ticks = isinstance(target_axis.get_major_locator(), FixedLocator)
    except Exception:  # noqa: BLE001
        fixed_ticks = False
    if fixed_ticks:
        numeric = False
    # require a visible gap (1.5 mm) between adjacent labels, not just no-overlap
    min_gap_px = mm_to_px(1.5, fig.dpi)
    rotated_gap_px = mm_to_px(0.3, fig.dpi)

    def crowded(rotation: float = 0.0) -> bool:
        threshold = min_gap_px if not rotation else rotated_gap_px
        return _boxes_overlap(_label_boxes(fig, labels), min_gap=threshold, axis=axis)

    def crowded_for(new_labels: List[Any]) -> bool:
        return _boxes_overlap(_label_boxes(fig, new_labels), min_gap=min_gap_px, axis=axis)

    if numeric:
        if not crowded():
            return {"axis": axis, "numeric": True, "fitted": False}
        from matplotlib.ticker import MaxNLocator

        target = ax.xaxis if axis == "x" else ax.yaxis
        for bins in (4, 3, 2):
            try:
                target.set_major_locator(MaxNLocator(nbins=bins))
            except Exception:  # noqa: BLE001
                break
            new_labels = _axis_labels(ax, axis)
            if not crowded_for(new_labels):
                ctx.auto("numericTicks", "%s 轴刻度已精简为 %d 个"
                         % (axis.upper(), len(new_labels)))
                return {"axis": axis, "numeric": True, "fitted": True, "bins": bins}
        ctx.warn("%s 轴刻度标签仍偏密，可手动设置 axes.%sMin/Max 或字号"
                 % (axis.upper(), axis))
        return {"axis": axis, "numeric": True, "fitted": True, "bins": 2}
    rotations: List[float] = [0, 30, 45, 90] if mode == "auto" else [float(mode)]
    if axis == "y":
        rotations = [0]  # vertical stacking: rotation does not help
    sizes = [base_size, max(6.0, base_size - 1.0), max(6.0, base_size - 2.0)]
    # 1) prefer rotation (lead's requested order: rotate -> shrink -> abbreviate)
    for rotation in rotations:
        _apply_tick_style(labels, rotation, base_size)
        if not crowded(rotation):
            if rotation:
                ctx.auto("categoricalRotation",
                         "%s 轴类目标签已旋转 %g°" % (axis.upper(), rotation))
            return {"axis": axis, "numeric": False, "fitted": rotation != 0,
                    "rotation": rotation, "fontSize": base_size}
    # 2) keep the rotation that helped least badly, then shrink the font
    for rotation in rotations[1:] + [0]:
        for font_size in sizes[1:]:
            _apply_tick_style(labels, rotation, font_size)
            if not crowded(rotation):
                if rotation:
                    ctx.auto("categoricalRotation",
                             "%s 轴类目标签已旋转 %g°" % (axis.upper(), rotation))
                ctx.auto("categoricalFontSize",
                         "%s 轴类目标签已缩小至 %.1f pt" % (axis.upper(), font_size))
                return {"axis": axis, "numeric": False, "fitted": True,
                        "rotation": rotation, "fontSize": font_size}
    # last resort: shorten labels
    abbreviations = [_abbreviate(label.get_text()) for label in labels]
    if any(new != old.get_text() for new, old in zip(abbreviations, labels)):
        for label, text_value in zip(labels, abbreviations):
            try:
                label.set_text(text_value)
            except Exception:  # noqa: BLE001
                continue
        _apply_tick_style(labels, rotations[-1], max(6.0, base_size - 2.0))
        if not crowded(rotations[-1]):
            ctx.auto("categoricalAbbrev", "%s 轴类目标签已缩写" % axis.upper())
            return {"axis": axis, "numeric": False, "fitted": True,
                    "abbreviated": True, "rotation": rotations[-1]}
    ctx.warn("%s 轴类目标签在 %.0f mm 宽面板下仍重叠，建议减少类目、换 2 行布局或调小字号"
             % (axis.upper(), ax.bbox.width / fig.dpi * 25.4))
    return {"axis": axis, "numeric": False, "fitted": False, "overlapped": True,
            "rotation": rotations[-1], "fontSize": max(6.0, base_size - 2.0)}


def fit_axes_labels(fig, ax, spec: Dict, ctx: Ctx) -> Dict[str, Any]:
    """Run :func:`fit_axis_labels` on both axes and merge the reports."""
    report = {"x": fit_axis_labels(fig, ax, spec, ctx, "x"),
              "y": fit_axis_labels(fig, ax, spec, ctx, "y")}
    report["overlapped"] = bool(report["x"].get("overlapped") or report["y"].get("overlapped"))
    report["panelWidthMm"] = float(ax.bbox.width / fig.dpi * 25.4)
    return report
