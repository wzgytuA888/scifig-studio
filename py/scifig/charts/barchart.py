"""Bar chart: grouped / stacked / percent, vertical or horizontal."""

from __future__ import annotations

from typing import Any, Dict

import numpy as np
from matplotlib.patches import Patch

from .. import dataio
from ..log import Ctx
from . import series_colors


def create_axes(fig, spec: Dict, rect, ctx: Ctx):
    return fig.add_axes(rect)


def draw(fig, ax, spec: Dict, data: Dict, ctx: Ctx) -> Dict[str, Any]:
    if data is None:
        data = dataio.bar_data(spec, None, ctx)
    categories = data["categories"]
    series = data["series"]
    if not categories or not series:
        raise ValueError("柱状图数据为空")
    mode = str(spec["bar"].get("mode", "group"))
    orientation = str(spec["bar"].get("orientation", "vertical"))
    colors = series_colors(spec, len(series), ctx, spec["bar"].get("cmap", "tab10"))
    bar_width = float(spec["style"]["bar"].get("width", 0.7) or 0.7)
    edge_color = spec["style"]["bar"].get("edgeColor", "#000000")
    edge_width = float(spec["style"]["bar"].get("edgeWidth", 0.5) or 0.0)
    alpha = float(spec["style"]["bar"].get("alpha", 1.0) or 1.0)

    matrix = np.array([[np.nan if v is None else float(v) for v in values] for _name, values in series],
                      dtype=float)
    # matrix[row=series, col=category]
    if matrix.shape[1] != len(categories):
        raise ValueError("柱状图数据行列不匹配")

    if mode == "percent":
        totals = np.nansum(matrix, axis=0)
        totals[totals == 0] = np.nan
        matrix = matrix / totals * 100.0

    positions = np.arange(len(categories))
    count = len(series)
    handles = []
    if orientation == "horizontal":
        if mode == "group":
            step = bar_width / max(1, count)
            for s_index, (name, _values) in enumerate(series):
                offset = (s_index - (count - 1) / 2.0) * step
                ax.barh(positions + offset, matrix[s_index], height=step,
                        color=colors[s_index % len(colors)], edgecolor=edge_color,
                        linewidth=edge_width, alpha=alpha, label=str(name), zorder=3)
        else:
            left = np.zeros(len(categories))
            for s_index, (name, _values) in enumerate(series):
                ax.barh(positions, matrix[s_index], left=left, height=bar_width,
                        color=colors[s_index % len(colors)], edgecolor=edge_color,
                        linewidth=edge_width, alpha=alpha, label=str(name), zorder=3)
                left = left + np.nan_to_num(matrix[s_index])
        ax.set_yticks(positions)
        ax.set_yticklabels([str(c) for c in categories])
        if mode == "percent":
            ax.set_xlim(0, 100)
    else:
        if mode == "group":
            step = bar_width / max(1, count)
            for s_index, (name, _values) in enumerate(series):
                offset = (s_index - (count - 1) / 2.0) * step
                ax.bar(positions + offset, matrix[s_index], width=step,
                       color=colors[s_index % len(colors)], edgecolor=edge_color,
                       linewidth=edge_width, alpha=alpha, label=str(name), zorder=3)
        else:
            bottom = np.zeros(len(categories))
            for s_index, (name, _values) in enumerate(series):
                ax.bar(positions, matrix[s_index], bottom=bottom, width=bar_width,
                       color=colors[s_index % len(colors)], edgecolor=edge_color,
                       linewidth=edge_width, alpha=alpha, label=str(name), zorder=3)
                bottom = bottom + np.nan_to_num(matrix[s_index])
        ax.set_xticks(positions)
        ax.set_xticklabels([str(c) for c in categories])
        if mode == "percent":
            ax.set_ylim(0, 100)
        if spec["axes"].get("tickRotate", 0) == 0 and len(categories) > 6:
            for label in ax.get_xticklabels():
                label.set_rotation(30)
                label.set_ha("right")
                label.set_rotation_mode("anchor")

    handles = [Patch(facecolor=colors[i % len(colors)], edgecolor=edge_color,
                     linewidth=edge_width, label=str(name))
               for i, (name, _values) in enumerate(series)]

    if spec["bar"].get("valueLabels"):
        fmt = str(spec["bar"].get("valueLabelFormat", "auto"))
        total = np.nansum(matrix, axis=0)
        for c_index in range(len(categories)):
            if mode == "group" and orientation == "vertical":
                step = bar_width / max(1, count)
                for s_index in range(count):
                    value = matrix[s_index, c_index]
                    if not np.isfinite(value):
                        continue
                    offset = (s_index - (count - 1) / 2.0) * step
                    ax.annotate(_fmt(value, fmt), (positions[c_index] + offset, value),
                                textcoords="offset points", xytext=(0, 2), ha="center",
                                va="bottom", fontsize=float(spec["style"]["font"].get("sizeTick", 7.0)) - 0.5)
            elif mode != "group" and orientation == "vertical":
                value = total[c_index]
                if np.isfinite(value):
                    ax.annotate(_fmt(value, fmt), (positions[c_index], value),
                                textcoords="offset points", xytext=(0, 2), ha="center",
                                va="bottom", fontsize=float(spec["style"]["font"].get("sizeTick", 7.0)) - 0.5)

    return {"handles": handles, "labels": [h.get_label() for h in handles],
            "mappable": None, "inkMode": "diff", "forbidden": []}


def _fmt(value: float, fmt: str) -> str:
    if fmt in ("integer", "int"):
        return "%d" % round(value)
    if fmt in ("one_decimal", "1f"):
        return "%.1f" % value
    if fmt in ("percent", "pct"):
        return "%g%%" % value
    if abs(value - round(value)) < 1e-9:
        return "%d" % round(value)
    return "%.2f" % value
