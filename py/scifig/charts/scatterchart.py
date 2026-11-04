"""Scatter plot with optional regression line (linear / quadratic)."""

from __future__ import annotations

from typing import Any, Dict

import numpy as np
from matplotlib.lines import Line2D

from .. import dataio
from ..log import Ctx
from . import series_colors


def create_axes(fig, spec: Dict, rect, ctx: Ctx):
    return fig.add_axes(rect)


def draw(fig, ax, spec: Dict, data: Dict, ctx: Ctx) -> Dict[str, Any]:
    if data is None:
        data = dataio.scatter_data(spec, None, ctx)
    x_values = np.asarray(data["x"], dtype=float)
    y_values = np.asarray(data["y"], dtype=float)
    valid = np.isfinite(x_values) & np.isfinite(y_values)
    x_values, y_values = x_values[valid], y_values[valid]
    if x_values.size == 0:
        raise ValueError("散点图没有有效数值")

    handles = []
    point_color = spec["style"]["font"].get("color", "#000000")
    size_cfg = float(spec["style"]["scatter"].get("size", 14.0) or 14.0)
    edge_width = float(spec["style"]["scatter"].get("edgeWidth", 0.3) or 0.0)
    group = data.get("group")
    mappable = None
    if group is not None:
        group_values = np.asarray(group)[valid]
        unique = list(dict.fromkeys([str(v) for v in group_values]))
        colors = series_colors(spec, len(unique), ctx, spec["line"].get("cmap", "tab10"))
        for index, name in enumerate(unique):
            mask = np.array([str(v) == name for v in group_values])
            handle = ax.scatter(x_values[mask], y_values[mask], s=size_cfg,
                                c=[colors[index % len(colors)]],
                                edgecolors="white", linewidths=edge_width,
                                label=name, zorder=3)
            handles.append(handle)
    else:
        handle = ax.scatter(x_values, y_values, s=size_cfg, c=point_color,
                            edgecolors="white", linewidths=edge_width, zorder=3)
        handles.append(handle)

    fit = str(spec["scatter"].get("fit", "none"))
    fit_handles: Dict[str, Any] = {}
    if fit not in ("none", "无", ""):
        fit_handles = _draw_fit(ax, x_values, y_values, fit, spec, ctx)
        fit_label = "线性拟合" if fit == "linear" else "二次拟合"
        handles.append(Line2D([], [], color=spec["scatter"].get("fitColor", "#333333"),
                              linewidth=1.0, linestyle="--", label=fit_label))
    return {"handles": handles,
            "labels": [h.get_label() for h in handles],
            "mappable": mappable, "inkMode": "diff",
            "forbidden": fit_handles.get("forbidden", [])}


def _draw_fit(ax, x_values, y_values, fit: str, spec: Dict, ctx: Ctx) -> Dict[str, Any]:
    color = spec["scatter"].get("fitColor", "#333333")
    degree = 2 if fit in ("poly2", "quadratic", "二次") else 1
    mask = np.isfinite(x_values) & np.isfinite(y_values)
    xv, yv = x_values[mask], y_values[mask]
    if xv.size < degree + 1:
        ctx.warn("数据点太少，无法拟合")
        return {}
    try:
        coeffs = np.polyfit(xv, yv, degree)
    except Exception as exc:  # noqa: BLE001
        ctx.warn("拟合失败：%s" % exc)
        return {}
    grid = np.linspace(float(np.min(xv)), float(np.max(xv)), 200)
    ax.plot(grid, np.polyval(coeffs, grid), color=color, linewidth=1.0, linestyle="--", zorder=4)

    predicted = np.polyval(coeffs, xv)
    ss_res = float(np.sum((yv - predicted) ** 2))
    ss_tot = float(np.sum((yv - np.mean(yv)) ** 2)) or 1e-12
    r2 = 1.0 - ss_res / ss_tot
    if degree == 1:
        equation = "y = %.4gx %+.4g" % (coeffs[0], coeffs[1])
    else:
        equation = "y = %.4gx² %+.4gx %+.4g" % (coeffs[0], coeffs[1], coeffs[2])
    text = "%s\n$R^2$ = %.3f" % (equation, r2)
    size = float(spec["style"]["font"].get("sizeTick", 7.0))
    annotated = None
    forbidden = []
    if spec["scatter"].get("showEquation", True):
        annotated = ax.annotate(
            text,
            xy=(0.98, 0.98), xycoords="axes fraction", ha="right", va="top",
            fontsize=size, color=spec["style"]["font"].get("color", "#000000"),
            bbox=dict(boxstyle="round,pad=0.25", facecolor="white", edgecolor="#b0b0b0",
                      linewidth=0.6, alpha=0.9),
            zorder=6,
        )
        bbox = annotated.get_bbox_patch()
        try:
            extent = bbox.get_window_extent(ax.figure.canvas.get_renderer())
            forbidden.append((extent.x0, extent.y0, extent.x1, extent.y1))
        except Exception:  # noqa: BLE001
            pass
    return {"text": text.replace("\n", " "), "forbidden": forbidden}
