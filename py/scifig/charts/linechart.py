"""Line chart (multi-series + optional dual y axis)."""

from __future__ import annotations

from typing import Any, Dict

import numpy as np
from matplotlib.lines import Line2D

from .. import dataio
from ..log import Ctx
from . import series_colors, series_styles


def create_axes(fig, spec: Dict, rect, ctx: Ctx):
    return fig.add_axes(rect)


def draw(fig, ax, spec: Dict, data: Dict, ctx: Ctx) -> Dict[str, Any]:
    if data is None:
        data = dataio.line_data(spec, None, ctx)
    series = data["series"]
    x_values = data["x"]
    colors = series_colors(spec, len(series), ctx, spec["line"].get("cmap", "tab10"))
    styles = series_styles(len(series), spec)
    handles = []
    for index, (name, values) in enumerate(series):
        drawstyle = "steps-post" if spec["line"].get("step") else "default"
        (line,) = ax.plot(
            x_values,
            values,
            color=colors[index % len(colors)],
            linewidth=styles["widths"][index],
            linestyle=styles["dashes"][index],
            marker=styles["markers"][index] if spec["style"]["line"].get("marker", "none") != "none" else "none",
            markersize=float(spec["style"]["line"].get("markerSize", 3.5)),
            markeredgewidth=0.5,
            markevery=max(1, int(spec["style"]["line"].get("markerEvery", 1) or 1)),
            drawstyle=drawstyle,
            label=str(name),
            zorder=3,
        )
        handles.append(line)

    handles2 = []
    if data.get("series2"):
        ax2 = ax.twinx()
        colors2 = series_colors(spec, len(data["series2"]) + 2, ctx,
                                spec["line"].get("cmap", "tab10"))[2:]
        for index, (name, values) in enumerate(data["series2"]):
            (line,) = ax2.plot(
                x_values,
                values,
                color=colors2[index % len(colors2)],
                linewidth=styles["widths"][0],
                linestyle="--",
                label=str(name),
                zorder=3,
            )
            handles2.append(line)
        axes_cfg = spec["axes"]
        if str(axes_cfg.get("y2label") or "").strip():
            ax2.set_ylabel(str(axes_cfg["y2label"]))
        ax2.tick_params(labelsize=float(spec["style"]["font"].get("sizeTick", 7.0)))
        for spine in ("top",):
            ax2.spines[spine].set_visible(False)
        ax2.spines["right"].set_visible(True)
        if spec["style"]["axis"].get("showRight", False):
            ax2.spines["right"].set_visible(True)
        ax2.yaxis.set_major_formatter(ax.yaxis.get_major_formatter())
        spec.setdefault("_render", {})["ax2"] = ax2

    # automatic tick rotation for crowded category-like x axes
    if spec["axes"].get("tickRotate", 0) == 0:
        labels = [str(v) for v in np.asarray(x_values)[: 200]]
        if len(labels) > 6 and max((len(item) for item in labels), default=0) > 4:
            for label in ax.get_xticklabels():
                label.set_rotation(30)
                label.set_ha("right")
                label.set_rotation_mode("anchor")
    # integer-looking x (years, counts) should not print "2000.0"
    try:
        numeric_x = np.asarray(x_values, dtype=float)
        if np.all(np.isfinite(numeric_x)) and numeric_x.size and \
                np.allclose(numeric_x, np.round(numeric_x)) and \
                (float(np.max(numeric_x)) - float(np.min(numeric_x))) >= 5:
            from matplotlib.ticker import MaxNLocator

            ax.xaxis.set_major_locator(MaxNLocator(integer=True))
    except (TypeError, ValueError):
        pass
    return {"handles": handles + handles2,
            "labels": [h.get_label() for h in handles + handles2],
            "mappable": None, "inkMode": "diff", "forbidden": []}
