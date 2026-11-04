"""Chart registry.

Each renderer module implements ``create_axes(fig, spec, rect, ctx)`` and
``draw(fig, ax, spec, data, ctx)``.  Modules are imported lazily so that the
shared helpers below can be imported by the modules themselves without a
circular import.
"""

from __future__ import annotations

import importlib
from typing import Any, Dict

from ..log import Ctx

_MODULE_NAMES = ("mapchart", "linechart", "barchart", "scatterchart",
                 "heatmapchart", "boxchart")
_modules: Dict[str, Any] = {}


def module_for(kind: str):
    """Return the chart module for *kind* (lazy import)."""
    name = {
        "map": "mapchart",
        "line": "linechart",
        "bar": "barchart",
        "scatter": "scatterchart",
        "heatmap": "heatmapchart",
        "box": "boxchart",
    }.get(kind)
    if name is None:
        return None
    if name not in _modules:
        _modules[name] = importlib.import_module("." + name, __name__)
    return _modules[name]


def series_colors(spec: Dict, count: int, ctx: Ctx, fallback_cmap: str = "tab10") -> Any:
    """Category colours: PPT palette first, legacy cmap as fallback."""
    from .. import palettes as palette_store

    palette_id = str((spec.get("style") or {}).get("palette") or "").strip()
    colors = palette_store.categorical_colors(palette_id, count) if palette_id else None
    if colors:
        return colors
    return palette(fallback_cmap, count, ctx)


def palette(cmap_name: str, count: int, ctx: Ctx) -> Any:
    """Return *count* distinguishable colours for a named colour map."""
    from ..common import resolve_cmap

    cmap = resolve_cmap(cmap_name, ctx)
    qualitative = {
        "tab10", "tab20", "tab20b", "tab20c", "Set1", "Set2", "Set3",
        "Paired", "Dark2", "Accent", "Pastel1", "Pastel2",
    }
    if cmap_name in qualitative and hasattr(cmap, "colors"):
        colors = list(cmap.colors)
        return [colors[i % len(colors)] for i in range(max(1, count))]
    if count <= 1:
        return [cmap(0.6)]
    return [cmap(i / float(count - 1)) for i in range(count)]


def series_styles(count: int, spec: Dict) -> Dict[str, Any]:
    """Line/marker style cycles shared by line & scatter charts."""
    line_cfg = spec["style"]["line"]
    markers = ["o", "s", "^", "D", "v", "P", "X", "*"]
    dash = ["solid", "dashed", "dashdot", "dotted"]
    marker = line_cfg.get("marker", "none")
    out = {"markers": [], "dashes": [], "widths": []}
    for index in range(max(1, count)):
        out["markers"].append(marker if marker != "none" else markers[index % len(markers)])
        out["dashes"].append(line_cfg.get("dash", "solid") or dash[index % len(dash)])
        out["widths"].append(float(line_cfg.get("width", 1.2)))
    return out
