"""Heatmap (matrix imshow + optional cell annotation + colorbar)."""

from __future__ import annotations

from typing import Any, Dict

import numpy as np
from matplotlib.colors import Normalize

from .. import dataio
from ..common import fill_cmap, resolve_cmap
from ..log import Ctx


def create_axes(fig, spec: Dict, rect, ctx: Ctx):
    return fig.add_axes(rect)


def draw(fig, ax, spec: Dict, data: Dict, ctx: Ctx) -> Dict[str, Any]:
    if data is None:
        data = dataio.heatmap_data(spec, None, ctx)
    matrix = np.asarray(data["matrix"], dtype=float)
    if matrix.size == 0:
        raise ValueError("热力图矩阵为空")
    if matrix.ndim == 1:
        matrix = matrix.reshape(1, -1)

    cmap, _palette_id = fill_cmap(spec, ctx, role="sequential",
                                  fallback=spec["heatmap"].get("cmap", "viridis"))
    vmin = spec["map"]["colorbar"].get("vmin")
    vmax = spec["map"]["colorbar"].get("vmax")
    if vmin is None:
        vmin = float(np.nanmin(matrix))
    if vmax is None:
        vmax = float(np.nanmax(matrix))
    if vmin == vmax:
        vmax = vmin + 1e-9
    norm = Normalize(vmin=vmin, vmax=vmax)
    if spec["heatmap"].get("centerZero"):
        limit = max(abs(vmin), abs(vmax))
        norm = Normalize(vmin=-limit, vmax=limit)
        cmap, _palette_id = fill_cmap(spec, ctx, role="diverging",
                                      fallback=spec["heatmap"].get("cmap", "RdBu_r"))

    image = ax.imshow(matrix, cmap=cmap, norm=norm, aspect="auto",
                      interpolation="nearest", zorder=2)
    ax.set_xticks(np.arange(matrix.shape[1]))
    ax.set_xticklabels([str(c) for c in data["cols"]])
    ax.set_yticks(np.arange(matrix.shape[0]))
    ax.set_yticklabels([str(r) for r in data["rows"]])
    if spec["axes"].get("tickRotate", 0) == 0 and matrix.shape[1] > 6:
        for label in ax.get_xticklabels():
            label.set_rotation(45)
            label.set_ha("right")
            label.set_rotation_mode("anchor")

    if spec["heatmap"].get("annotate"):
        fmt = str(spec["heatmap"].get("annotateFormat", ".2f"))
        size = float(spec["style"]["heatmap"].get("annotateSize", 6.0) or 6.0)
        for row in range(matrix.shape[0]):
            for col in range(matrix.shape[1]):
                value = matrix[row, col]
                if not np.isfinite(value):
                    continue
                red, green, blue, _alpha = cmap(norm(value))
                luminance = 0.299 * red + 0.587 * green + 0.114 * blue
                color = "white" if luminance < 0.45 else "#111111"
                try:
                    display = format(value, fmt) if (fmt.startswith(".") or fmt.endswith("f")) \
                        else str(value)
                except Exception:  # noqa: BLE001
                    display = "%.2f" % value
                ax.text(col, row, display, ha="center", va="center", fontsize=size,
                        color=color, zorder=4)

    ax.set_xlabel(str(data.get("colName") or spec["axes"].get("xlabel") or ""))
    ax.set_ylabel(str(data.get("rowName") or spec["axes"].get("ylabel") or ""))
    ax.grid(False)
    return {"handles": [], "labels": [], "mappable": image,
            "colorbar": True, "inkMode": "diff", "forbidden": []}
