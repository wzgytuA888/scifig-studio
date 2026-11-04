"""Public rendering engine.

``render_spec`` is the single code path used by the CLI, by generated
``component.py`` scripts and by the host plugin, which guarantees that the
engine and generated code always produce identical pixels.
"""

from __future__ import annotations

import copy
import os
import traceback
from typing import Any, Dict, List, Optional, Tuple

import matplotlib
import numpy as np

from . import dataio
from . import spec as spec_module
from .charts import module_for
from .common import (MM_PER_INCH, add_colorbar, apply_note, apply_title,
                     fit_axes, format_ticks, mm_to_px, new_figure,
                     provisional_rect, save_figure)
from .defaults import default_spec
from .log import Ctx
from .paths import deep_merge, flatten
from .style import apply_style, style_spines

MAX_THUMB_SIDE = 480


# ---------------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------------
def render_spec(spec: Any, out_png: str, *, thumb: Optional[str] = None,
                code_out: Optional[str] = None, workdir: Optional[str] = None,
                spec_path: Optional[str] = None) -> Dict[str, Any]:
    """Render *spec* to *out_png*; optionally a thumbnail and the component code.

    Returns the JSON-ready result dict (same shape as the CLI stdout line).
    """
    ctx = Ctx()
    if workdir is None:
        workdir = os.path.dirname(os.path.abspath(spec_path)) if spec_path else os.getcwd()
    fig = None
    try:
        import warnings as _warnings

        normalized = spec_module.normalize(spec, ctx)
        target = str(normalized.get("output", {}).get("png") or "").strip() or out_png
        if not target:
            raise ValueError("缺少输出 PNG 路径（--out 或 spec.output.png）")
        caught: List[Any] = []
        with _warnings.catch_warnings(record=True) as caught:
            _warnings.simplefilter("always")
            fig = build_figure(normalized, ctx, workdir)
            png_path = save_figure(fig, target, normalized, ctx)
        _collect_matplotlib_warnings(caught, ctx)
        width_px, height_px = fig.bbox.width, fig.bbox.height
        if thumb:
            save_thumbnail(png_path, thumb, ctx)
        if code_out:
            from .codegen import write_component

            write_component(normalized, code_out, workdir=workdir, ctx=ctx)
        elapsed = ctx.elapsed_ms()
        metrics = {
            "widthMm": round(float(normalized["figure"]["widthMm"]), 2),
            "heightMm": round(float(normalized["figure"]["heightMm"]), 2),
            "dpi": int(normalized["figure"]["dpi"]),
            "elapsedMs": elapsed,
            "widthPx": int(round(width_px)),
            "heightPx": int(round(height_px)),
        }
        if thumb:
            metrics["thumb"] = os.path.abspath(thumb)
        if code_out:
            metrics["code"] = os.path.abspath(code_out)
        return {"ok": True, "png": png_path,
                "warnings": list(ctx.warnings),
                "autoAdjust": list(ctx.auto_adjust),
                "metrics": metrics}
    except Exception as exc:  # noqa: BLE001 - reported to the host as ok:false
        return {
            "ok": False,
            "error": _human_error(exc),
            "trace": "".join(traceback.format_exception_only(type(exc), exc)).strip(),
            "warnings": list(ctx.warnings),
            "autoAdjust": list(ctx.auto_adjust),
        }
    finally:
        if fig is not None:
            try:
                import matplotlib.pyplot as plt

                plt.close(fig)
            except Exception:  # noqa: BLE001
                pass


def build_figure(spec: Dict, ctx: Ctx, workdir: str):
    """Create the matplotlib figure for a normalised spec (no saving)."""
    apply_style(spec, ctx)
    fig = new_figure(spec)
    if spec["kind"] == "compose":
        _render_compose(fig, spec, ctx, workdir)
    else:
        _render_single(fig, spec, ctx, workdir)
    return fig


def save_thumbnail(png_path: str, thumb_path: str, ctx: Ctx) -> str:
    """Downscale a rendered PNG so its longest side is <= 480 px."""
    target = os.path.abspath(thumb_path)
    directory = os.path.dirname(target)
    if directory:
        os.makedirs(directory, exist_ok=True)
    try:
        from PIL import Image

        with Image.open(png_path) as image:
            image = image.convert("RGB")
            width, height = image.size
            scale = min(1.0, float(MAX_THUMB_SIDE) / max(width, height))
            if scale < 1.0:
                size = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
                image = image.resize(size, Image.LANCZOS)
            image.save(target, format="PNG")
    except Exception as exc:  # noqa: BLE001
        ctx.warn("缩略图生成失败：%s" % exc)
    return target


def _collect_matplotlib_warnings(caught: List[Any], ctx: Ctx) -> None:
    """Promote font/glyph warnings into the structured warnings list."""
    for entry in caught or []:
        message = str(getattr(entry, "message", ""))
        lowered = message.lower()
        if "glyph" in lowered or "missing from font" in lowered:
            ctx.warn("字体缺少字形：%s（可用 style.font.family / style.font.cjkFallback 调整）"
                     % message[:180])
        else:
            ctx.log("matplotlib: " + message[:200])


def _human_error(exc: Exception) -> str:
    message = str(exc).strip()
    if isinstance(exc, FileNotFoundError):
        return message or "文件不存在"
    if isinstance(exc, spec_module.SpecError):
        return message
    if isinstance(exc, ValueError):
        return message
    return "%s: %s" % (type(exc).__name__, message)


# ---------------------------------------------------------------------------
# data loading
# ---------------------------------------------------------------------------
def _load_data(kind: str, spec: Dict, workdir: Optional[str], ctx: Ctx) -> Any:
    if kind == "map":
        return dataio.map_data(spec, workdir, ctx)
    if kind == "line":
        return dataio.line_data(spec, workdir, ctx)
    if kind == "bar":
        return dataio.bar_data(spec, workdir, ctx)
    if kind == "scatter":
        return dataio.scatter_data(spec, workdir, ctx)
    if kind == "heatmap":
        return dataio.heatmap_data(spec, workdir, ctx)
    if kind == "box":
        return dataio.box_data(spec, workdir, ctx)
    raise spec_module.SpecError("不支持的图型 %r" % kind)


def _finish_axes(ax, spec: Dict, ctx: Ctx) -> None:
    style_spines(ax, spec)
    format_ticks(ax, spec)
    apply_title(ax, spec, ctx)


def _execute_custom_patch(fig, axes: List[Any], spec: Dict, ctx: Ctx,
                          label: str = "customPatch") -> None:
    code = spec.get("customPatch")
    if not code or not str(code).strip():
        return
    globals_dict = {
        "fig": fig,
        "axes": list(axes),
        "ax": axes[0] if axes else None,
        "np": np,
        "plt": matplotlib.pyplot,
        "mpl": matplotlib,
        "spec": spec,
    }
    try:
        exec(compile(str(code), "<%s>" % label, "exec"), globals_dict)
    except Exception as exc:  # noqa: BLE001 - never break the figure
        ctx.warn("%s 执行失败：%s: %s" % (label, type(exc).__name__, exc))


def _legend_warning(info: Dict, ctx: Ctx) -> None:
    score = info.get("score")
    if score is not None and float(score) > 0.15:
        ctx.warn("图例自动位置仍可能与数据重叠（遮挡评分 %.2f），可改 legend.position" % float(score))


# ---------------------------------------------------------------------------
# single chart
# ---------------------------------------------------------------------------
def _render_single(fig, spec: Dict, ctx: Ctx, workdir: str) -> None:
    kind = spec["kind"]
    module = module_for(kind)
    if module is None:
        raise spec_module.SpecError("不支持的图型 %r" % kind)
    data = _load_data(kind, spec, workdir, ctx)
    ax = module.create_axes(fig, spec, provisional_rect(kind), ctx)
    result = module.draw(fig, ax, spec, data, ctx) or {}
    _finish_axes(ax, spec, ctx)
    label_fit = {}
    if kind != "map":
        from .common import fit_axes_labels

        label_fit = fit_axes_labels(fig, ax, spec, ctx)
        if label_fit.get("overlapped"):
            ctx.warn("刻度标签过密（面板宽 %.0f mm），已自动旋转/缩小仍可能重叠"
                     % label_fit.get("panelWidthMm", 0.0))
    _adapt_narrow_panel(fig, ax, spec, ctx, None)
    extra_boxes = list(result.get("extraBBox") or [])

    dpi = float(spec["figure"]["dpi"])
    fw, fh = float(fig.bbox.width), float(fig.bbox.height)
    cb_cfg = spec["map"]["colorbar"]
    mappable = result.get("mappable")
    show_cb = bool(mappable is not None and cb_cfg.get("show", True))
    location = str(cb_cfg.get("location", "right")).lower()
    horizontal = location in ("bottom", "below", "outside bottom")
    reserve_right = 0.0
    reserve_bottom = 0.0
    if show_cb and not horizontal and location != "inside":
        reserve_right = _colorbar_reserve_px(fig, spec)
    if show_cb and horizontal:
        reserve_bottom = mm_to_px(17.0, dpi)
    note = str(spec.get("text", {}).get("note") or "").strip()
    if note:
        note_size = float(spec["text"].get("noteSize", spec["style"]["font"].get("sizeNote", 6.5)) or 6.5)
        reserve_bottom = max(reserve_bottom, mm_to_px(note_size * 0.45 + 2.6, dpi))
    fit_axes(fig, ax, pad_mm=float(spec["figure"].get("marginMm", 1.2)),
             reserve_right_px=reserve_right, reserve_bottom_px=reserve_bottom,
             extra_bboxes=extra_boxes)

    legend_info = _apply_legend(fig, ax, spec, result, ctx,
                                allow_outside=not (show_cb and not horizontal))
    _legend_warning(legend_info, ctx)
    if legend_info.get("outside"):
        extra_right = legend_info.get("width_px", 0.0) + mm_to_px(1.5, dpi) \
            if str(legend_info.get("position", "")).startswith("outside") else 0.0
        extra_bottom = legend_info.get("height_px", 0.0) + mm_to_px(1.5, dpi) \
            if str(legend_info.get("position", "")) == "below" else 0.0
        if extra_right or extra_bottom:
            fit_axes(fig, ax, pad_mm=float(spec["figure"].get("marginMm", 1.2)),
                     reserve_right_px=reserve_right + extra_right,
                     reserve_bottom_px=reserve_bottom + extra_bottom,
                     extra_bboxes=extra_boxes)
            fig.canvas.draw()
        if show_cb and not horizontal:
            ctx.warn("图例在图外右侧且存在色带，两者可能相邻过近，建议 legend.position=auto")

    if show_cb:
        _draw_colorbar(fig, ax, spec, result, ctx, horizontal)
    apply_note(fig, spec, ctx)
    _execute_custom_patch(fig, [ax], spec, ctx)


def _apply_legend(fig, ax, spec: Dict, result: Dict, ctx: Ctx,
                  allow_outside: bool = True) -> Dict[str, Any]:
    from .legend import apply_legend

    handles = result.get("handles") or []
    labels = result.get("labels") or []
    if not handles:
        return {"shown": False, "position": "none"}
    return apply_legend(fig, ax, handles, labels, spec, ctx,
                        forbidden=result.get("forbidden") or [],
                        ink_mode=result.get("inkMode", "diff"),
                        allow_outside=allow_outside)


def _colorbar_reserve_px(fig, spec: Dict, width_scale: float = 1.0,
                         pad_extra_mm: float = 0.0) -> float:
    """Space (px) needed to the right of the axes for a vertical colourbar."""
    cfg = spec["map"]["colorbar"]
    width_frac = min(0.12, max(0.008, float(cfg.get("width", 0.024) or 0.024)))
    width_frac *= max(0.4, min(1.0, width_scale))
    label_px = mm_to_px(11.0 if str(cfg.get("label") or "").strip() else 7.0, fig.dpi)
    return width_frac * float(fig.bbox.width) + label_px + mm_to_px(pad_extra_mm, fig.dpi)


def _adapt_narrow_panel(fig, ax, spec: Dict, ctx: Ctx,
                        label_fit: Optional[Dict]) -> None:
    """Warn when a < 55 mm panel still has colliding category labels."""
    if label_fit is None:
        return
    width_mm = float(ax.bbox.width / fig.dpi * 25.4)
    if width_mm < 55.0 and label_fit.get("overlapped"):
        ctx.warn("面板宽仅 %.0f mm 且类目标签自适应后仍重叠，建议改用 2 行布局或减少类目"
                 % width_mm)


def _draw_colorbar(fig, ax, spec: Dict, result: Dict, ctx: Ctx, horizontal: bool) -> None:
    mappable = result.get("mappable")
    if mappable is None:
        return
    boundaries = result.get("boundaries")
    ticks_override = boundaries if boundaries else None
    add_colorbar(fig, ax, mappable, spec, ctx, horizontal=horizontal,
                 boundaries=boundaries, ticks_override=ticks_override)


# ---------------------------------------------------------------------------
# compose
# ---------------------------------------------------------------------------
def _grid_shape(compose: Dict, count: int) -> Tuple[int, int]:
    """Grid (rows, cols) for *count* panels.

    Auto mode prefers a near-square layout (never 1xN for >2 panels), e.g.
    n=2 -> 1x2, n=3 -> 2x2 (last cell empty), n=4 -> 2x2, n=5 -> 2x3,
    n=6 -> 2x3, n=7..9 -> 3x3.
    """
    rows = int(compose.get("rows", 0) or 0)
    cols = int(compose.get("cols", 0) or 0)
    if cols > 0 and rows > 0:
        if rows * cols < count:
            cols = max(cols, int(np.ceil(count / float(rows))))
        return max(1, rows), max(1, cols)
    if cols > 0:
        return max(1, int(np.ceil(count / float(cols)))), cols
    if rows > 0:
        return rows, max(1, int(np.ceil(count / float(rows))))
    preferred = {1: (1, 1), 2: (1, 2), 3: (2, 2), 4: (2, 2),
                 5: (2, 3), 6: (2, 3), 7: (3, 3), 8: (3, 3), 9: (3, 3)}
    if count in preferred:
        return preferred[count]
    cols = int(np.ceil(np.sqrt(count)))
    rows = int(np.ceil(count / float(cols)))
    if rows == 1 and count > 2:
        rows = 2
        cols = int(np.ceil(count / 2.0))
    return max(1, rows), max(1, cols)


def _panel_spec(base: Dict, panel: Dict, ctx: Ctx) -> Dict[str, Any]:
    """Merge one panel specification onto the global figure spec."""
    if not isinstance(panel, dict):
        raise spec_module.SpecError("panel 必须是对象")
    panel = copy.deepcopy(panel)
    if not panel.get("kind"):
        raise spec_module.SpecError("panel 缺少 kind 字段")
    for key in ("figure", "style", "output", "compose"):
        panel.pop(key, None)
    title = panel.get("title", "")
    subtitle = panel.get("subtitle", "")
    merged = deep_merge(copy.deepcopy(base), panel)
    merged["kind"] = panel.get("kind")
    merged["title"] = title
    merged["subtitle"] = subtitle
    # a panel extent preset must not be defeated by the inherited (materialised)
    # global extent bounds: clear them unless the panel gives its own
    panel_flat = flatten(panel)
    if any(key.startswith("map.extentPreset") for key in panel_flat) and \
            not any(key in panel_flat for key in (
                "map.extentLonMin", "map.extentLonMax",
                "map.extentLatMin", "map.extentLatMax")):
        for key in ("extentLonMin", "extentLonMax", "extentLatMin", "extentLatMax"):
            merged.setdefault("map", {})[key] = None
        # let the panel's own extent decide the central meridian too
        if "map.centralLongitude" not in panel_flat:
            merged.setdefault("map", {})["centralLongitude"] = None
    merged.setdefault("compose", {})["panels"] = []
    merged.pop("_extent", None)
    panel_spec = spec_module.normalize(merged, ctx)
    return panel_spec


def _placeholder_panel(fig, rect, entry: Dict, spec: Dict, ctx: Ctx) -> Any:
    ax = fig.add_axes(rect)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_facecolor("#fafafa")
    message = "子图渲染失败\n" + str(entry.get("error") or "")[:160]
    ax.text(0.5, 0.5, message, transform=ax.transAxes, ha="center", va="center",
            fontsize=7.0, color="#b00020", wrap=True)
    title = str((entry.get("panel") or {}).get("title") or "")
    if title:
        ax.set_title(title, fontsize=8.0)
    return ax


def _render_compose(fig, spec: Dict, ctx: Ctx, workdir: str) -> None:
    compose = spec["compose"]
    panels = compose.get("panels") or []
    if not panels:
        raise spec_module.SpecError("kind=compose 需要 compose.panels 数组")
    base = copy.deepcopy(spec)
    count = len(panels)
    rows, cols = _grid_shape(compose, count)
    dpi = float(spec["figure"]["dpi"])
    fw, fh = float(fig.bbox.width), float(fig.bbox.height)
    gapx = mm_to_px(float(compose.get("gapXMm", 4.0) or 0.0), dpi)
    gapy = mm_to_px(float(compose.get("gapYMm", 4.0) or 0.0), dpi)
    outer = mm_to_px(float(compose.get("outerMarginMm", 1.8) or 0.0), dpi)
    label_cfg = compose.get("panelLabel") or {}
    show_label = bool(label_cfg.get("show", True))
    label_reserve = mm_to_px(4.6, dpi) if show_label else 0.0
    title = str(spec.get("title") or "").strip()
    title_reserve = mm_to_px(7.0, dpi) if title else 0.0
    note = str(spec.get("text", {}).get("note") or "").strip()
    note_reserve = 0.0
    if note:
        note_size = float(spec["text"].get("noteSize",
                                           spec["style"]["font"].get("sizeNote", 6.5)) or 6.5)
        note_reserve = mm_to_px(note_size * 0.45 + 2.6, dpi)
    optimize = bool(compose.get("optimize", True))
    legend_per_panel = bool(compose.get("legendPerPanel", True))
    share_colorbar = bool(compose.get("shareColorbar", False))

    entries: List[Dict[str, Any]] = []
    for index, panel in enumerate(panels):
        entry: Dict[str, Any] = {"panel": panel, "spec": None, "data": None,
                                 "ax": None, "res": None, "error": None,
                                 "legend": None}
        try:
            panel_spec = _panel_spec(base, panel, ctx)
            data = _load_data(panel_spec["kind"], panel_spec, workdir, ctx)
            entry["spec"] = panel_spec
            entry["data"] = data
        except Exception as exc:  # noqa: BLE001 - placeholder panel
            entry["error"] = "%s: %s" % (type(exc).__name__, exc)
            ctx.warn("子图 %d 准备失败：%s（已用占位面板）" % (index + 1, entry["error"]))
        entries.append(entry)

    def _decorations(renderer) -> Dict[int, Dict[str, float]]:
        deco: Dict[int, Dict[str, float]] = {}
        for index, entry in enumerate(entries):
            ax = entry["ax"]
            if ax is None:
                continue
            try:
                bbox = ax.get_tightbbox(renderer)
            except Exception:  # noqa: BLE001
                continue
            if bbox is None:
                continue
            extras = (entry.get("res") or {}).get("extraBBox") or []
            if extras:
                from matplotlib.transforms import Bbox as _Bbox

                boxes = [_Bbox.from_extents(bbox.x0, bbox.y0, bbox.x1, bbox.y1)]
                boxes.extend(_Bbox.from_extents(*extra) for extra in extras)
                bbox = _Bbox.union(boxes)
            pos = ax.get_position()
            px0, py0 = pos.x0 * fw, pos.y0 * fh
            pw, ph = pos.width * fw, pos.height * fh
            deco[index] = {
                "left": max(0.0, px0 - bbox.x0),
                "right": max(0.0, bbox.x1 - (px0 + pw)),
                "bottom": max(0.0, py0 - bbox.y0),
                "top": max(0.0, bbox.y1 - (py0 + ph)),
            }
        return deco

    def layout(deco: Dict[int, Dict[str, float]], cb_outer: float,
               cb_inner: float) -> Tuple[List[List[float]], List[float]]:
        """Equal-size panel boxes with decoration-aware gaps (optimize core)."""

        def deco_for(row: int, col: int) -> Dict[str, float]:
            index = row * cols + col
            return deco.get(index, {"left": 0.0, "right": 0.0, "bottom": 0.0, "top": 0.0})

        def biggest(values) -> float:
            return max([value for value in values if value is not None] or [0.0])

        left = biggest(deco_for(r, 0)["left"] for r in range(rows)) + outer
        right = biggest(deco_for(r, cols - 1)["right"] for r in range(rows)) + outer + cb_outer
        top = biggest(deco_for(0, c)["top"] for c in range(cols)) + outer \
            + label_reserve + title_reserve
        bottom = biggest(deco_for(rows - 1, c)["bottom"] for c in range(cols)) + outer + note_reserve
        left = min(left, fw * 0.35)
        right = min(right, fw * 0.40)
        top = min(top, fh * 0.35)
        bottom = min(bottom, fh * 0.30)
        col_gaps: List[float] = []
        for col in range(cols - 1):
            need_right = biggest(deco_for(r, col)["right"] for r in range(rows))
            need_left = biggest(deco_for(r, col + 1)["left"] for r in range(rows))
            col_gaps.append(max(gapx, mm_to_px(2.0, dpi),
                                need_right + need_left + mm_to_px(1.2, dpi)) + cb_inner)
        row_gaps: List[float] = []
        for row in range(rows - 1):
            need_bottom = biggest(deco_for(row, c)["bottom"] for c in range(cols))
            need_top = biggest(deco_for(row + 1, c)["top"] for c in range(cols))
            row_gaps.append(max(gapy, mm_to_px(3.0, dpi),
                                need_bottom + need_top + mm_to_px(1.5, dpi)))
        avail_w = max(40.0, fw - left - right - sum(col_gaps))
        avail_h = max(40.0, fh - bottom - top - sum(row_gaps))
        width = avail_w / cols
        height = avail_h / rows
        rects: List[List[float]] = []
        for index in range(count):
            row = index // cols
            col = index % cols
            x = left + sum(col_gaps[:col]) + col * width
            y = fh - top - sum(row_gaps[:row]) - (row + 1) * height
            rects.append([x / fw, y / fh, width / fw, height / fh])
        return rects, [left, right, bottom, top]

    rects, margins = layout({}, 0.0, 0.0)
    for index, entry in enumerate(entries):
        if entry["spec"] is None:
            entry["ax"] = _placeholder_panel(fig, rects[index], entry, spec, ctx)
            continue
        panel_spec = entry["spec"]
        module = module_for(panel_spec["kind"])
        try:
            ax = module.create_axes(fig, panel_spec, rects[index], ctx)
            if optimize and panel_spec["kind"] == "map":
                # let the map fill its cell so all panel frames line up
                try:
                    ax.set_aspect("auto")
                except Exception:  # noqa: BLE001
                    pass
            result = module.draw(fig, ax, panel_spec, entry["data"], ctx) or {}
            _finish_axes(ax, panel_spec, ctx)
            if panel_spec["kind"] != "map":
                from .common import fit_axes_labels

                entry["labelFit"] = fit_axes_labels(fig, ax, panel_spec, ctx)
            entry["ax"] = ax
            entry["res"] = result
        except Exception as exc:  # noqa: BLE001 - placeholder panel
            entry["error"] = "%s: %s" % (type(exc).__name__, exc)
            ctx.warn("子图 %d 渲染失败：%s（已用占位面板）" % (index + 1, entry["error"]))
            try:
                ax.remove()
            except Exception:  # noqa: BLE001
                pass
            entry["ax"] = _placeholder_panel(fig, rects[index], entry, spec, ctx)
            entry["res"] = None

    # ---- iterative layout optimisation ---------------------------------
    iterations = 3 if optimize else 1
    for iteration in range(iterations):
        try:
            fig.canvas.draw()
            renderer = fig.canvas.get_renderer()
        except Exception:  # noqa: BLE001
            break
        if optimize and iteration == iterations - 1:
            # adapt tick labels at (nearly) final panel width, then re-measure
            from .common import fit_axes_labels

            for entry in entries:
                if entry["ax"] is None:
                    continue
                panel_spec = entry.get("spec") or {}
                if panel_spec.get("kind") in (None, "map"):
                    continue
                entry["labelFit"] = fit_axes_labels(fig, entry["ax"], panel_spec, ctx)
            try:
                fig.canvas.draw()
                renderer = fig.canvas.get_renderer()
            except Exception:  # noqa: BLE001
                pass
        cb_outer = 0.0
        cb_inner = 0.0
        cb_width_scale = 0.8 if optimize else 1.0
        cb_pad_extra = 1.0 if optimize else 0.0
        if share_colorbar and _any_colorbar(entries):
            cb_outer = _colorbar_reserve_px(fig, spec, cb_width_scale,
                                            cb_pad_extra) + mm_to_px(2.0, dpi)
        elif not share_colorbar:
            needs = [_colorbar_reserve_px(fig, entry["spec"], cb_width_scale,
                                          cb_pad_extra)
                     for entry in entries if _panel_has_colorbar(entry)]
            if needs:
                cb_inner = max(needs) + mm_to_px(2.0, dpi)
                cb_outer = cb_inner
        deco = _decorations(renderer) if optimize else {}
        rects, margins = layout(deco, cb_outer, cb_inner)
        for index, entry in enumerate(entries):
            if entry["ax"] is not None:
                entry["ax"].set_position(rects[index])
    try:
        fig.canvas.draw()
    except Exception:  # noqa: BLE001
        pass

    # ---- colourbars -----------------------------------------------------
    if share_colorbar:
        _add_shared_colorbar(fig, spec, entries, margins, ctx, dpi,
                             width_scale=0.8 if optimize else 1.0,
                             pad_extra_mm=1.0 if optimize else 0.0)
    else:
        for entry in entries:
            if entry["ax"] is None or not _panel_has_colorbar(entry):
                continue
            _add_panel_colorbar(fig, entry, ctx, margins, dpi,
                                width_scale=0.8 if optimize else 1.0,
                                pad_extra_mm=1.0 if optimize else 0.0)
    # narrow panels: warn if category labels still collide after adaptation
    if optimize:
        for entry in entries:
            if entry["ax"] is not None and entry.get("labelFit") is not None:
                _adapt_narrow_panel(fig, entry["ax"], entry.get("spec") or spec,
                                    ctx, entry["labelFit"])

    # ---- legends --------------------------------------------------------
    any_legend = False
    for entry in entries:
        if entry["ax"] is None or entry["res"] is None:
            continue
        if not legend_per_panel:
            if entry["res"].get("handles"):
                any_legend = True
            continue
        allow_outside = not _panel_has_colorbar(entry)
        info = _apply_legend(fig, entry["ax"], entry["spec"], entry["res"], ctx,
                             allow_outside=allow_outside)
        entry["legend"] = info
        _legend_warning(info, ctx)
    if any_legend:
        ctx.auto("legendPerPanel", "已按设置省略各面板图例")
    try:
        fig.canvas.draw()
    except Exception:  # noqa: BLE001
        pass

    # ---- panel titles: keep them inside their own column -----------------
    if optimize:
        _fit_panel_titles(fig, entries, spec, ctx)

    # ---- panel labels / total title ------------------------------------
    if show_label:
        _draw_panel_labels(fig, entries, spec, ctx)
    if title:
        _draw_compose_title(fig, spec, ctx, title_reserve)

    apply_note(fig, spec, ctx)
    _execute_custom_patch(fig, [entry["ax"] for entry in entries if entry["ax"]],
                          spec, ctx)
    if optimize:
        _compose_quality_check(fig, entries, ctx)


def _panel_has_colorbar(entry: Dict) -> bool:
    result = entry.get("res") or {}
    spec = entry.get("spec") or {}
    if result.get("mappable") is None:
        return False
    return bool(spec.get("map", {}).get("colorbar", {}).get("show", True))


def _any_colorbar(entries: List[Dict]) -> bool:
    return any(_panel_has_colorbar(entry) for entry in entries)


def _add_shared_colorbar(fig, spec: Dict, entries: List[Dict], margins: List[float],
                         ctx: Ctx, dpi: float, width_scale: float = 1.0,
                         pad_extra_mm: float = 0.0) -> None:
    source = next((entry for entry in entries if _panel_has_colorbar(entry)), None)
    if source is None:
        return
    fw = float(fig.bbox.width)
    cfg = spec["map"]["colorbar"]
    width_frac = min(0.12, max(0.008, float(cfg.get("width", 0.024) or 0.024)))
    width_frac *= max(0.4, min(1.0, width_scale))
    x0 = (fw - margins[1] + mm_to_px(2.5 + pad_extra_mm, dpi)) / fw
    planned = [x0, 0.22, width_frac, 0.56]
    result = source["res"]
    try:
        add_colorbar(fig, source["ax"], result["mappable"],
                     source["spec"], ctx, horizontal=False,
                     boundaries=result.get("boundaries"),
                     ticks_override=result.get("boundaries") or None,
                     cax_rect=planned, shrink_label=True,
                     width_scale=width_scale, pad_extra_mm=pad_extra_mm)
    except Exception as exc:  # noqa: BLE001
        ctx.warn("共享色带绘制失败：%s" % exc)


def _add_panel_colorbar(fig, entry: Dict, ctx: Ctx, margins: List[float], dpi: float,
                        width_scale: float = 1.0,
                        pad_extra_mm: float = 0.0) -> None:
    ax = entry["ax"]
    spec = entry["spec"]
    result = entry["res"]
    try:
        add_colorbar(fig, ax, result["mappable"], spec, ctx, horizontal=False,
                     boundaries=result.get("boundaries"),
                     ticks_override=result.get("boundaries") or None,
                     shrink_label=True, width_scale=width_scale,
                     pad_extra_mm=pad_extra_mm)
    except Exception as exc:  # noqa: BLE001
        ctx.warn("子图色带绘制失败：%s" % exc)


def _fit_panel_titles(fig, entries: List[Dict], spec: Dict, ctx: Ctx) -> None:
    """Shrink panel titles until each stays inside its column and no two collide."""
    titles = [(entry, str((entry.get("spec") or {}).get("title") or ""))
              for entry in entries if entry.get("ax") is not None]
    titles = [(entry, text) for entry, text in titles if text]
    if not titles:
        return
    base_size = float(spec["style"]["font"].get("sizeTitle", 10.0))
    weight = "bold" if spec.get("text", {}).get("titleBold", True) else "normal"
    color = spec["style"]["font"].get("color", "#000000")
    fw = float(fig.bbox.width)
    sizes = [base_size, base_size - 1.0, base_size - 2.0, 8.0]
    for size in sizes:
        size = max(8.0, float(size))
        for entry, text in titles:
            try:
                entry["ax"].set_title(text, fontsize=size, fontweight=weight,
                                      color=color, pad=6.0)
            except Exception:  # noqa: BLE001
                continue
        try:
            fig.canvas.draw()
            renderer = fig.canvas.get_renderer()
        except Exception:  # noqa: BLE001
            return
        boxes = []
        clean = True
        for entry, _text in titles:
            ax = entry["ax"]
            try:
                bbox = ax.title.get_window_extent(renderer)
            except Exception:  # noqa: BLE001
                continue
            if bbox is None or bbox.width <= 0:
                continue
            pos = ax.get_position()
            if bbox.x0 < pos.x0 * fw - 2 or bbox.x1 > pos.x1 * fw + 2:
                clean = False
            boxes.append(bbox)
        for first in range(len(boxes)):
            for second in range(first + 1, len(boxes)):
                a, b = boxes[first], boxes[second]
                if not a.overlaps(b):
                    continue
                width = min(a.x1, b.x1) - max(a.x0, b.x0)
                height = min(a.y1, b.y1) - max(a.y0, b.y0)
                if width > 2 and height > 2:
                    clean = False
        if clean:
            if size < base_size:
                ctx.auto("panelTitle", "子图标题已缩小至 %.0f pt" % size)
            return
    ctx.warn("子图标题过宽，已缩到 8pt 仍可能跨出面板列宽，建议缩短标题或增大 compose.cols")


def _draw_panel_labels(fig, entries: List[Dict], spec: Dict, ctx: Ctx) -> None:
    compose = spec["compose"]
    cfg = compose.get("panelLabel") or {}
    style = str(cfg.get("style", "(a)"))
    size = cfg.get("fontSizePt") or (float(spec["style"]["font"].get("sizeAxis", 8.0)) + 1.0)
    bold = bool(cfg.get("bold", True))
    position = str(cfg.get("position", "upper left")).lower()
    color = spec["style"]["font"].get("color", "#000000")
    fig_width = float(fig.bbox.width)
    fig_height = float(fig.bbox.height)
    dx = mm_to_px(1.0, fig.dpi) / fig_width
    dy = mm_to_px(0.9, fig.dpi) / fig_height
    for index, entry in enumerate(entries):
        ax = entry["ax"]
        if ax is None:
            continue
        letter = chr(ord("a") + (index % 26))
        text = "(%s)" % letter if style.startswith("(") else letter
        pos = ax.get_position()
        if "right" in position:
            x = pos.x1 + dx
            ha = "left"
        else:
            x = pos.x0 - dx
            ha = "right"
        if "lower" in position:
            y = pos.y0 - dy
            va = "top"
        else:
            y = pos.y1 + dy
            va = "bottom"
        try:
            fig.text(x, y, text, ha=ha, va=va, fontsize=float(size),
                     fontweight="bold" if bold else "normal", color=color)
        except Exception as exc:  # noqa: BLE001
            ctx.warn("子图编号绘制失败：%s" % exc)


def _draw_compose_title(fig, spec: Dict, ctx: Ctx, title_reserve: float) -> None:
    title = str(spec.get("title") or "").strip()
    if not title:
        return
    size = float(spec["style"]["font"].get("sizeTitle", 10.0))
    color = spec["style"]["font"].get("color", "#000000")
    try:
        fig.text(0.5, 1.0 - mm_to_px(1.6, fig.dpi) / float(fig.bbox.height), title,
                 ha="center", va="top", fontsize=size, fontweight="bold", color=color)
    except Exception as exc:  # noqa: BLE001
        ctx.warn("总标题绘制失败：%s" % exc)


def _compose_quality_check(fig, entries: List[Dict], ctx: Ctx) -> None:
    """Warn about clipped text, overlapping panels and occluded legends."""
    try:
        fig.canvas.draw()
        renderer = fig.canvas.get_renderer()
    except Exception:  # noqa: BLE001
        return
    fw, fh = float(fig.bbox.width), float(fig.bbox.height)
    boxes: List[Tuple[str, Any]] = []
    for index, entry in enumerate(entries):
        ax = entry["ax"]
        if ax is None:
            continue
        try:
            tight = ax.get_tightbbox(renderer)
        except Exception:  # noqa: BLE001
            continue
        if tight is None:
            continue
        label = "子图 %d" % (index + 1)
        if tight.x0 < -2 or tight.y0 < -2 or tight.x1 > fw + 2 or tight.y1 > fh + 2:
            ctx.warn("%s 的文字超出画布（tight bbox 越界），已自动缩紧但可能被裁切" % label)
        boxes.append((label, tight))
    tolerance = 4.0  # px; touching edges are not a real overlap
    for first_index in range(len(boxes)):
        for second_index in range(first_index + 1, len(boxes)):
            first_label, first_box = boxes[first_index]
            second_label, second_box = boxes[second_index]
            if not first_box.overlaps(second_box):
                continue
            width = min(first_box.x1, second_box.x1) - max(first_box.x0, second_box.x0)
            height = min(first_box.y1, second_box.y1) - max(first_box.y0, second_box.y0)
            if width > tolerance and height > tolerance:
                ctx.warn("%s 与 %s 的文字区域重叠，建议增大 compose.gapXMm/gapYMm" %
                         (first_label, second_label))
