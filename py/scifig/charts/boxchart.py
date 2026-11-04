"""Box (and whisker) plot."""

from __future__ import annotations

from typing import Any, Dict

import numpy as np

from .. import dataio
from ..log import Ctx
from . import series_colors


def create_axes(fig, spec: Dict, rect, ctx: Ctx):
    return fig.add_axes(rect)


def draw(fig, ax, spec: Dict, data: Dict, ctx: Ctx) -> Dict[str, Any]:
    if data is None:
        data = dataio.box_data(spec, None, ctx)
    labels = data["labels"]
    values = [np.asarray(v, dtype=float) for v in data["values"]]
    values = [v[np.isfinite(v)] for v in values]
    if not any(v.size for v in values):
        raise ValueError("箱线图没有有效数值")
    colors = series_colors(spec, len(labels), ctx, spec["box"].get("cmap", "tab10"))
    width = float(spec["box"].get("boxWidth", 0.6) or 0.6)
    orientation = str(spec["box"].get("orientation", "vertical"))

    box = ax.boxplot(
        values,
        orientation="vertical" if orientation != "horizontal" else "horizontal",
        widths=width,
        patch_artist=True,
        showfliers=bool(spec["box"].get("showOutliers", True)),
        medianprops=dict(color="#1a1a1a", linewidth=1.0),
        whiskerprops=dict(color="#333333", linewidth=0.8),
        capprops=dict(color="#333333", linewidth=0.8),
        flierprops=dict(marker="o", markersize=2.5, markerfacecolor="#7f7f7f",
                        markeredgecolor="#7f7f7f", alpha=0.8),
    )
    for index, patch in enumerate(box["boxes"]):
        patch.set_facecolor(colors[index % len(colors)])
        patch.set_alpha(0.85)
        patch.set_edgecolor("#333333")
        patch.set_linewidth(0.7)
    ax.set_xticks(np.arange(1, len(labels) + 1))
    ax.set_xticklabels([str(label) for label in labels])
    if spec["axes"].get("tickRotate", 0) == 0 and len(labels) > 6:
        for label in ax.get_xticklabels():
            label.set_rotation(30)
            label.set_ha("right")
            label.set_rotation_mode("anchor")
    if orientation == "horizontal":
        ax.set_yticks(np.arange(1, len(labels) + 1))
        ax.set_yticklabels([str(label) for label in labels])
        ax.set_xticks([])
    return {"handles": [], "labels": [], "mappable": None,
            "inkMode": "diff", "forbidden": []}
