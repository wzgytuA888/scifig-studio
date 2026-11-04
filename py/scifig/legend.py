"""Legend construction and *real* automatic placement.

``legend.position == "auto"`` does not use ``loc="best"``.  The renderer
rasterises the axes once, builds an "ink mask" (pixels that carry data /
labels), and scores a grid of candidate placements:

    score = ink_occlusion + 0.05 * centrality + 2.0 * out_of_bounds
            + 1.0 * overlap_with_reserved_boxes

Lowest score wins; ties break deterministically.  Reserved boxes protect the
graticule labels, scale bar, north arrow and the South-China-Sea inset.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import matplotlib
from matplotlib.legend import Legend

from .log import Ctx

Rect = Tuple[float, float, float, float]  # x0, y0, x1, y1 (display px, bottom-left origin)

INSIDE_LOCS = [
    "upper right",
    "upper left",
    "lower right",
    "lower left",
    "upper center",
    "lower center",
    "center left",
    "center right",
    "center",
]

EXPLICIT_POSITIONS = {
    "upper right": "upper right",
    "upper left": "upper left",
    "lower right": "lower right",
    "lower left": "lower left",
    "upper center": "upper center",
    "lower center": "lower center",
    "center left": "center left",
    "center right": "center right",
    "center": "center",
    "outside right": "outside right",
    "outside right top": "outside right",
    "outside right bottom": "outside right bottom",
    "below": "below",
    "outside bottom": "below",
    "outside left": "outside left",
    "none": "none",
}


def _legend_kwargs(spec: Dict) -> Dict[str, Any]:
    legend_cfg = spec.get("legend", {})
    font_cfg = spec["style"]["font"]
    default_size = float(font_cfg.get("sizeLegend", 7.0) or 7.0)
    size = legend_cfg.get("fontSize")
    if size is None:
        size = default_size
    return {
        "fontsize": float(size),
        "ncol": max(1, int(legend_cfg.get("ncol", 1) or 1)),
        "frameon": bool(legend_cfg.get("frame", True)),
        "title": legend_cfg.get("title") or None,
        "title_fontsize": float(size),
        "framealpha": float(legend_cfg.get("alpha", 0.9)),
        "handlelength": float(legend_cfg.get("lineLength", 1.6) or 1.6),
        "markerscale": float(legend_cfg.get("markerScale", 0.9) or 0.9),
        "borderpad": float(legend_cfg.get("margin", 0.4) or 0.4),
        "labelspacing": 0.35,
        "columnspacing": 1.0,
        "handletextpad": 0.6,
        "borderaxespad": 0.0,
        "fancybox": False,
        "facecolor": "white",
        "edgecolor": "#7f7f7f" if legend_cfg.get("frame", True) else "none",
    }


def _measure(spec: Dict, fig, ax, handles, labels) -> Optional[Legend]:
    if not handles:
        return None
    kwargs = _legend_kwargs(spec)
    try:
        legend = ax.legend(handles=handles, labels=[str(lbl) for lbl in labels],
                           loc="upper right", **kwargs)
    except Exception:  # noqa: BLE001 - e.g. duplicate proxy artists
        return None
    fig.canvas.draw()
    return legend


def _ink_mask(fig, ax, mode: str) -> Tuple[Any, Tuple[int, int]]:
    """Return (mask, origin) where mask[r, c] ~ display (origin_x + c, top_y - 1 - r)."""
    import numpy as np

    fig.canvas.draw()
    buf = np.asarray(fig.canvas.buffer_rgba())
    height = buf.shape[0]
    bbox = ax.get_window_extent()
    x0 = max(0, int(np.floor(bbox.x0)))
    x1 = min(buf.shape[1], int(np.ceil(bbox.x1)))
    y0 = max(0, int(np.floor(bbox.y0)))
    y1 = min(height, int(np.ceil(bbox.y1)))
    if x1 <= x0 or y1 <= y0:
        return np.zeros((1, 1), dtype=bool), (0, 0)
    sub = buf[height - y1:height - y0, x0:x1, :3].astype(np.int16)
    if mode == "dark":
        lum = 0.299 * sub[:, :, 0] + 0.587 * sub[:, :, 1] + 0.114 * sub[:, :, 2]
        mask = lum < 205.0
    else:
        face = np.asarray(matplotlib.colors.to_rgb(fig.get_facecolor())) * 255.0
        diff = np.abs(sub - face.reshape(1, 1, 3)).max(axis=2)
        mask = diff > 14.0
    return mask, (x0, y1)


def _mask_fraction(mask, origin: Tuple[int, int], rect: Rect) -> Tuple[float, float]:
    """Return (ink fraction, area fraction) inside *rect* (clipped to mask)."""
    x0o, ytop = origin
    height = mask.shape[0]
    rx0, ry0, rx1, ry1 = rect
    # display y -> mask row: row = ytop - 1 - y
    c0 = int(round(rx0 - x0o))
    c1 = int(round(rx1 - x0o))
    r0 = int(round(ytop - ry1))
    r1 = int(round(ytop - ry0))
    c0c, c1c = max(0, c0), min(mask.shape[1], c1)
    r0c, r1c = max(0, r0), min(height, r1)
    if c1c <= c0c or r1c <= r0c:
        return 0.0, 0.0
    region = mask[r0c:r1c, c0c:c1c]
    area_total = max(1, (c1 - c0) * (r1 - r0))
    area_in = max(1, region.shape[0] * region.shape[1])
    ink = float(region.mean()) * (area_in / area_total)
    covered = area_in / area_total
    return ink, covered


def _intersection_area(a: Rect, b: Rect) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    w = max(0.0, min(ax1, bx1) - max(ax0, bx0))
    h = max(0.0, min(ay1, by1) - max(ay0, by0))
    return w * h


def _anchor_for(loc: str, rect: Rect) -> Tuple[float, float]:
    x0, y0, x1, y1 = rect
    if loc == "upper right":
        return x1, y1
    if loc == "upper left":
        return x0, y1
    if loc == "lower right":
        return x1, y0
    if loc == "lower left":
        return x0, y0
    if loc == "upper center":
        return (x0 + x1) / 2.0, y1
    if loc == "lower center":
        return (x0 + x1) / 2.0, y0
    if loc == "center left":
        return x0, (y0 + y1) / 2.0
    if loc == "center right":
        return x1, (y0 + y1) / 2.0
    return (x0 + x1) / 2.0, (y0 + y1) / 2.0


def _rect_for(loc: str, anchor: Tuple[float, float], size: Tuple[float, float]) -> Rect:
    width, height = size
    ax_, ay_ = anchor
    if loc == "upper right":
        return ax_ - width, ay_ - height, ax_, ay_
    if loc == "upper left":
        return ax_, ay_ - height, ax_ + width, ay_
    if loc == "lower right":
        return ax_ - width, ay_, ax_, ay_ + height
    if loc == "lower left":
        return ax_, ay_, ax_ + width, ay_ + height
    if loc == "upper center":
        return ax_ - width / 2.0, ay_ - height, ax_ + width / 2.0, ay_
    if loc == "lower center":
        return ax_ - width / 2.0, ay_, ax_ + width / 2.0, ay_ + height
    if loc == "center left":
        return ax_, ay_ - height / 2.0, ax_ + width, ay_ + height / 2.0
    if loc == "center right":
        return ax_ - width, ay_ - height / 2.0, ax_, ay_ + height / 2.0
    return ax_ - width / 2.0, ay_ - height / 2.0, ax_ + width / 2.0, ay_ + height / 2.0


def _inside_candidates(fig, ax, legend_size: Tuple[float, float],
                       forbidden: Sequence[Rect]) -> List[Tuple[str, Rect, Dict[str, Any]]]:
    bbox = ax.get_window_extent()
    width, height = legend_size
    margin = max(2.0, 0.012 * min(bbox.width, bbox.height))
    if width >= bbox.width - 2 * margin or height >= bbox.height - 2 * margin:
        return []
    cands: List[Tuple[str, Rect, Dict[str, Any]]] = []
    xs = [bbox.x0 + margin, bbox.x1 - margin]
    ys = [bbox.y0 + margin, bbox.y1 - margin]
    grid = {
        "upper right": (xs[1], ys[1]),
        "upper left": (xs[0], ys[1]),
        "lower right": (xs[1], ys[0]),
        "lower left": (xs[0], ys[0]),
        "upper center": ((bbox.x0 + bbox.x1) / 2.0, ys[1]),
        "lower center": ((bbox.x0 + bbox.x1) / 2.0, ys[0]),
        "center left": (xs[0], (bbox.y0 + bbox.y1) / 2.0),
        "center right": (xs[1], (bbox.y0 + bbox.y1) / 2.0),
        "center": ((bbox.x0 + bbox.x1) / 2.0, (bbox.y0 + bbox.y1) / 2.0),
    }
    for index, (loc, anchor) in enumerate(grid.items()):
        rect = _rect_for(loc, anchor, legend_size)
        if rect[2] - rect[0] > bbox.width or rect[3] - rect[1] > bbox.height:
            continue
        cands.append((loc, rect, {"_index": index}))
    return cands


def auto_place(fig, ax, legend: Legend, spec: Dict, ctx: Ctx,
               forbidden: Sequence[Rect] = (), mode: str = "diff",
               allow_outside: bool = True) -> Dict[str, Any]:
    """Score candidate placements and move *legend* to the least occluding one."""
    bbox = ax.get_window_extent()
    try:
        extent = legend.get_window_extent()
    except Exception:  # noqa: BLE001
        extent = None
    if extent is None or extent.width <= 0 or extent.height <= 0:
        return {"position": "auto", "score": None}
    legend_size = (float(extent.width), float(extent.height))
    # the legend itself must not count as "data ink" while scoring
    legend.set_visible(False)
    try:
        mask, origin = _ink_mask(fig, ax, mode)
    finally:
        legend.set_visible(True)
    ax_area = max(1.0, bbox.width * bbox.height)

    scored: List[Tuple[float, str, Rect]] = []
    candidates = _inside_candidates(fig, ax, legend_size, forbidden)
    for loc, rect, meta in candidates:
        ink, covered = _mask_fraction(mask, origin, rect)
        cx = (rect[0] + rect[2]) / 2.0
        cy = (rect[1] + rect[3]) / 2.0
        acx = (bbox.x0 + bbox.x1) / 2.0
        acy = (bbox.y0 + bbox.y1) / 2.0
        dist = ((cx - acx) ** 2 + (cy - acy) ** 2) ** 0.5
        half_diag = max(1.0, (bbox.width ** 2 + bbox.height ** 2) ** 0.5 / 2.0)
        centrality = max(0.0, 1.0 - dist / half_diag)
        reserved = 0.0
        for rect_f in forbidden:
            area = _intersection_area(rect, rect_f)
            if area > 0:
                reserved += area / max(1.0, (rect[2] - rect[0]) * (rect[3] - rect[1]))
        score = ink + 0.05 * centrality + 1.0 * reserved + 1e-4 * meta["_index"]
        scored.append((score, loc, rect))

    # outside candidates are considered too, with a fixed preference penalty
    outside_opts: List[Tuple[float, str, Rect, Dict[str, Any]]] = []
    pad_px = 0.012 * bbox.width
    for loc in ("outside right", "below"):
        if not allow_outside:
            break
        rect = _outside_rect(loc, bbox, legend_size, pad_px)
        if rect is None:
            continue
        overlap = 0.0
        for rect_f in forbidden:
            overlap += _intersection_area(rect, rect_f) / max(1.0, (rect[2] - rect[0]) * (rect[3] - rect[1]))
        # prefer keeping the legend inside unless data really is in the way
        score = 0.10 + 0.5 * overlap + 1e-4 * (len(INSIDE_LOCS) + (0 if loc == "outside right" else 1))
        outside_opts.append((score, loc, rect, {"_outside": loc}))

    inside_best = min(scored, key=lambda item: item[0]) if scored else None
    outside_best = min(outside_opts, key=lambda item: item[0]) if outside_opts else None
    if inside_best and (outside_best is None or inside_best[0] <= outside_best[0]):
        score, loc, rect = inside_best
        _apply_inside(legend, ax, loc, rect)
        return {"position": loc, "score": round(float(score), 4)}
    if outside_best:
        score, loc, rect, meta = outside_best
        _apply_outside(legend, ax, loc, rect, bbox, pad_px)
        return {"position": loc, "score": round(float(score), 4)}
    if inside_best:
        score, loc, rect = inside_best
        _apply_inside(legend, ax, loc, rect)
        return {"position": loc, "score": round(float(score), 4)}
    return {"position": "auto", "score": None}


def _outside_rect(loc: str, bbox, legend_size: Tuple[float, float], pad_px: float) -> Optional[Rect]:
    width, height = legend_size
    if loc == "outside right":
        rect = (bbox.x1 + pad_px, bbox.y1 - height, bbox.x1 + pad_px + width, bbox.y1)
    else:  # below
        rect = (bbox.x0, bbox.y0 - pad_px - height, bbox.x0 + width, bbox.y0 - pad_px)
    return rect


def _apply_inside(legend: Legend, ax, loc: str, rect: Rect) -> None:
    bbox = ax.get_window_extent()
    ax_x = rect[2] if loc in ("upper right", "lower right", "center right") else rect[0]
    ax_y = rect[3] if loc in ("upper right", "upper left", "upper center") else rect[1]
    if loc in ("upper center", "lower center", "center"):
        ax_x = (rect[0] + rect[2]) / 2.0
    if loc in ("center left", "center right", "center"):
        ax_y = (rect[1] + rect[3]) / 2.0
    anchor = ((ax_x - bbox.x0) / bbox.width, (ax_y - bbox.y0) / bbox.height)
    legend.set_loc(loc)
    legend.set_bbox_to_anchor(anchor, transform=ax.transAxes)


def _apply_outside(legend: Legend, ax, loc: str, rect: Rect, bbox, pad_px: float) -> None:
    if loc == "outside right":
        legend.set_loc("upper left")
        legend.set_bbox_to_anchor((1.0 + pad_px / bbox.width, 1.0), transform=ax.transAxes)
    else:
        legend.set_loc("upper center")
        legend.set_bbox_to_anchor((0.5, -pad_px / bbox.height), transform=ax.transAxes)


def place_explicit(legend: Legend, ax, position: str, ctx: Ctx) -> None:
    """Move *legend* to an explicit named position."""
    key = EXPLICIT_POSITIONS.get(str(position).strip().lower())
    if key is None:
        ctx.warn("未知图例位置 %r，已改为 auto" % position)
        return
    if key == "none":
        legend.set_visible(False)
        return
    if key == "outside right":
        legend.set_loc("upper left")
        legend.set_bbox_to_anchor((1.02, 1.0), transform=ax.transAxes)
    elif key == "outside right bottom":
        legend.set_loc("lower left")
        legend.set_bbox_to_anchor((1.02, 0.0), transform=ax.transAxes)
    elif key == "outside left":
        legend.set_loc("lower right")
        legend.set_bbox_to_anchor((-0.02, 0.0), transform=ax.transAxes)
    elif key == "below":
        legend.set_loc("upper center")
        legend.set_bbox_to_anchor((0.5, -0.02), transform=ax.transAxes)
    else:
        legend.set_loc(key)
        legend.set_bbox_to_anchor(None)


def apply_legend(fig, ax, handles, labels, spec: Dict, ctx: Ctx,
                 forbidden: Sequence[Rect] = (), ink_mode: str = "diff",
                 allow_outside: bool = True) -> Dict[str, Any]:
    """Create + position the legend; returns placement info (may be empty)."""
    info: Dict[str, Any] = {"shown": False, "position": spec["legend"].get("position", "auto")}
    if not spec["legend"].get("show", True):
        info["position"] = "hidden"
        return info
    if not handles:
        return info
    legend = _measure(spec, fig, ax, handles, labels)
    if legend is None:
        return info
    position = str(spec["legend"].get("position", "auto")).strip()
    if position and position.lower() not in ("auto", "自动"):
        place_explicit(legend, ax, position, ctx)
        fig.canvas.draw()
        extent = legend.get_window_extent()
        info.update({"shown": True, "position": position,
                     "width_px": float(extent.width), "height_px": float(extent.height),
                     "outside": position.lower() in ("outside right", "below", "outside bottom", "outside left", "outside right bottom")})
        return info
    placement = auto_place(fig, ax, legend, spec, ctx, forbidden, mode=ink_mode,
                           allow_outside=allow_outside)
    fig.canvas.draw()
    extent = legend.get_window_extent()
    bbox = ax.get_window_extent()
    outside = extent.x0 > bbox.x1 + 1 or extent.y1 < bbox.y0 - 1
    info.update({"shown": True, "position": placement.get("position", "auto"),
                 "score": placement.get("score"),
                 "width_px": float(extent.width), "height_px": float(extent.height),
                 "outside": bool(outside)})
    return info
