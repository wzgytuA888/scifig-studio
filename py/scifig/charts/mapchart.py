"""Map chart: 11 projections, Natural-Earth layers with graceful degrade,
graticule with degree / degree-minute labels, colourbar, scale bar, north
arrow and the optional South China Sea inset.

All data coordinates are interpreted as WGS84 lon/lat (EPSG:4326).
"""

from __future__ import annotations

import os
import socket
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

import cartopy
import cartopy.crs as ccrs
import cartopy.io.shapereader as shpreader
from cartopy.mpl.gridliner import LatitudeFormatter, LongitudeFormatter
from matplotlib.cm import ScalarMappable
from matplotlib.colors import BoundaryNorm, Normalize
from matplotlib.patches import Polygon as MplPolygon
from matplotlib.patches import Rectangle

from .. import dataio
from ..common import class_colors, fill_cmap, point_color, resolve_cmap
from ..log import Ctx

PC = ccrs.PlateCarree()

#: projection catalogue (id -> builder description) -- ids are the contract
PROJECTIONS: Dict[str, Dict[str, str]] = {
    "platecarree": {"labelZh": "等经纬度（PlateCarree）", "labelEn": "Plate Carree"},
    "mercator": {"labelZh": "墨卡托", "labelEn": "Mercator"},
    "miller": {"labelZh": "米勒", "labelEn": "Miller"},
    "lambert": {"labelZh": "兰伯特等角圆锥", "labelEn": "Lambert Conformal Conic"},
    "albers": {"labelZh": "阿尔伯斯等积圆锥", "labelEn": "Albers Equal Area"},
    "robinson": {"labelZh": "罗宾逊", "labelEn": "Robinson"},
    "mollweide": {"labelZh": "摩尔威特", "labelEn": "Mollweide"},
    "equalearth": {"labelZh": "等地球", "labelEn": "Equal Earth"},
    "orthographic": {"labelZh": "正射（球面）", "labelEn": "Orthographic"},
    "azimuthal": {"labelZh": "方位等距", "labelEn": "Azimuthal Equidistant"},
    "northpolarstereo": {"labelZh": "北极立体投影", "labelEn": "North Polar Stereo"},
}

_MARKERS = {
    "circle": "o",
    "square": "s",
    "triangle": "^",
    "diamond": "D",
    "star": "*",
    "plus": "P",
}

#: simplified nine-dash polyline (schematic only, marked "示意" on the inset)
SCS_NINE_DASH: List[Tuple[float, float]] = [
    (108.1, 20.6), (109.4, 18.6), (109.9, 16.0), (111.3, 12.4),
    (112.6, 9.0), (114.6, 6.2), (116.9, 4.0), (118.6, 6.6),
    (119.1, 10.6), (119.8, 14.6), (120.9, 18.3), (122.2, 21.6),
]

_GEO_CACHE: Dict[Tuple[str, str, str], Any] = {}
_RAW_CACHE: Dict[Tuple[str, str, str], Any] = {}
_CLIP_CACHE: Dict[Tuple[str, str, str, str], Any] = {}


def _layer_box(extent: Sequence[float]):
    """Clip box (lon/lat) around the view extent, padded generously.

    The padding keeps the projected axes rectangle fully covered even for
    conic projections whose view rectangle is rotated against the lon/lat box.
    """
    import shapely.geometry as sgeom

    lon_min, lon_max, lat_min, lat_max = extent
    pad_x = max(1.5, 0.18 * (lon_max - lon_min))
    pad_y = max(1.5, 0.18 * (lat_max - lat_min))
    return sgeom.box(max(-180.0, lon_min - pad_x), max(-90.0, lat_min - pad_y),
                     min(180.0, lon_max + pad_x), min(90.0, lat_max + pad_y))


def _collect_geoms(geom: Any, out: List[Any]) -> None:
    if geom is None or getattr(geom, "is_empty", True):
        return
    geom_type = getattr(geom, "geom_type", "")
    if geom_type in ("Polygon", "LineString", "Point"):
        out.append(geom)
    elif geom_type in ("MultiPolygon", "MultiLineString", "GeometryCollection"):
        for part in geom.geoms:
            _collect_geoms(part, out)


def _clip_geoms(geoms: Sequence[Any], box: Any) -> List[Any]:
    """Clip Natural-Earth geometries to the view box.

    Unclipped global 10m layers cost ~80 s per canvas draw through cartopy's
    reprojection; clipping up front brings that down to ~0.3 s.
    """
    out: List[Any] = []
    for geom in geoms:
        try:
            clipped = geom.intersection(box)
        except Exception:  # noqa: BLE001 - invalid geometry
            continue
        _collect_geoms(clipped, out)
    return out


def _ne_path(resolution: str, category: str, name: str) -> Optional[str]:
    data_dir = cartopy.config.get("data_dir") or ""
    path = os.path.join(data_dir, "shapefiles", "natural_earth", category,
                        "ne_%s_%s.shp" % (resolution, name))
    return path if os.path.exists(path) else None


def _allow_download() -> bool:
    return os.environ.get("SCIFIG_OFFLINE", "0") not in ("1", "true", "yes")


def _load_geoms(resolution: str, category: str, name: str, ctx: Ctx,
                label: str) -> Optional[List[Any]]:
    """Raw (unclipped) Natural Earth geometries; cached per process."""
    key = (resolution, category, name)
    if key in _RAW_CACHE:
        return _RAW_CACHE[key]
    path = _ne_path(resolution, category, name)
    if path is None:
        if not _allow_download():
            ctx.warn("地图图层「%s」本地无缓存（离线模式），已跳过该图层" % label)
            _RAW_CACHE[key] = None
            return None
        previous = socket.getdefaulttimeout()
        socket.setdefaulttimeout(8.0)
        try:
            path = shpreader.natural_earth(resolution=resolution, category=category, name=name)
        except Exception as exc:  # noqa: BLE001 - network / disk failure
            ctx.warn("地图图层「%s」数据缺失且下载失败（%s），已跳过该图层" % (label, exc))
            _RAW_CACHE[key] = None
            return None
        finally:
            socket.setdefaulttimeout(previous)
    try:
        geoms = list(shpreader.Reader(path).geometries())
    except Exception as exc:  # noqa: BLE001
        ctx.warn("地图图层「%s」读取失败（%s），已跳过" % (label, exc))
        geoms = None
    _RAW_CACHE[key] = geoms
    return geoms


def _geoms(resolution: str, category: str, name: str, ctx: Ctx, label: str,
           box: Any) -> Optional[List[Any]]:
    """Geometries clipped to *box* (cached by layer + box)."""
    raw = _load_geoms(resolution, category, name, ctx, label)
    if not raw:
        return None
    key = (resolution, category, name, "%.3f,%.3f,%.3f,%.3f" % box.bounds)
    if key not in _CLIP_CACHE:
        _CLIP_CACHE[key] = _clip_geoms(raw, box)
    return _CLIP_CACHE[key]


def _china_geoms(resolution: str, ctx: Ctx, box: Any) -> Optional[List[Any]]:
    key = (resolution, "cultural", "china_boundary", "%.3f,%.3f,%.3f,%.3f" % box.bounds)
    if key in _GEO_CACHE:
        return _GEO_CACHE[key]
    path = _ne_path(resolution, "cultural", "admin_0_countries")
    if path is None:
        if not _allow_download():
            ctx.warn("中国国界数据本地无缓存（离线模式），已跳过")
            _GEO_CACHE[key] = None
            return None
        previous = socket.getdefaulttimeout()
        socket.setdefaulttimeout(8.0)
        try:
            path = shpreader.natural_earth(resolution=resolution, category="cultural",
                                           name="admin_0_countries")
        except Exception as exc:  # noqa: BLE001
            ctx.warn("中国国界数据缺失且下载失败（%s），已跳过" % exc)
            _GEO_CACHE[key] = None
            return None
        finally:
            socket.setdefaulttimeout(previous)
    geoms: List[Any] = []
    try:
        for record in shpreader.Reader(path).records():
            attrs = record.attributes
            code = str(attrs.get("ADM0_A3") or attrs.get("ADM0_A3_US") or "")
            sovereign = str(attrs.get("SOVEREIGNT") or "")
            name = str(attrs.get("NAME") or attrs.get("NAME_EN") or "")
            if code in ("CHN", "TWN", "HKG", "MAC") or sovereign == "China" or name == "China":
                geoms.append(record.geometry)
    except Exception as exc:  # noqa: BLE001
        ctx.warn("中国国界筛选失败（%s），已跳过" % exc)
        geoms = []
    if not geoms:
        ctx.warn("未能从 Natural Earth 数据中筛出中国国界，已跳过")
    clipped = _clip_geoms(geoms, box) if geoms else []
    _GEO_CACHE[key] = clipped or None
    return clipped or None


def _projection(spec: Dict, ctx: Ctx):
    map_spec = spec["map"]
    name = str(map_spec.get("projection", "lambert"))
    extent = spec.get("_extent") or (72.0, 137.0, 16.0, 55.0)
    lon_min, lon_max, lat_min, lat_max = extent
    central_lon = float(map_spec.get("centralLongitude") or (lon_min + lon_max) / 2.0)
    central_lat = map_spec.get("centralLatitude")
    central_lat = float(central_lat) if central_lat is not None else (lat_min + lat_max) / 2.0
    std1 = map_spec.get("stdParallel1")
    std2 = map_spec.get("stdParallel2")
    std1 = float(std1) if std1 is not None else (lat_min + 0.25 * (lat_max - lat_min))
    std2 = float(std2) if std2 is not None else (lat_min + 0.75 * (lat_max - lat_min))
    if std1 >= std2:  # degenerate cone -> widen slightly, keep the render valid
        std1, std2 = min(std1, std2) - 1.0, max(std1, std2) + 1.0
    if name == "platecarree":
        return ccrs.PlateCarree(central_longitude=0.0)
    if name == "mercator":
        return ccrs.Mercator(central_longitude=0.0)
    if name == "miller":
        return ccrs.Miller(central_longitude=central_lon)
    if name == "lambert":
        return ccrs.LambertConformal(central_longitude=central_lon,
                                     central_latitude=central_lat,
                                     standard_parallels=(std1, std2))
    if name == "albers":
        return ccrs.AlbersEqualArea(central_longitude=central_lon,
                                    central_latitude=central_lat,
                                    standard_parallels=(std1, std2))
    if name == "robinson":
        return ccrs.Robinson(central_longitude=central_lon)
    if name == "mollweide":
        return ccrs.Mollweide(central_longitude=central_lon)
    if name == "equalearth":
        return ccrs.EqualEarth(central_longitude=central_lon)
    if name == "orthographic":
        return ccrs.Orthographic(central_longitude=central_lon, central_latitude=central_lat)
    if name == "azimuthal":
        return ccrs.AzimuthalEquidistant(central_longitude=central_lon,
                                         central_latitude=central_lat)
    if name == "northpolarstereo":
        return ccrs.NorthPolarStereo(central_longitude=central_lon)
    ctx.warn("未知投影 %r，已回退兰伯特投影" % name)
    return ccrs.LambertConformal(central_longitude=central_lon,
                                 central_latitude=central_lat,
                                 standard_parallels=(std1, std2))


def create_axes(fig, spec: Dict, rect, ctx: Ctx):
    projection = _projection(spec, ctx)
    return fig.add_axes(rect, projection=projection)


def _set_extent(ax, spec: Dict, ctx: Ctx) -> None:
    extent = spec.get("_extent") or (72.0, 137.0, 16.0, 55.0)
    try:
        ax.set_extent(list(extent), crs=PC)
    except Exception as exc:  # noqa: BLE001
        ctx.auto("extent", "当前投影不支持该范围，已改用自动范围")
        ctx.debug("set_extent failed: %s" % exc)


def _auto_interval(span: float, target: int = 5) -> float:
    if not np.isfinite(span) or span <= 0:
        return 1.0
    for candidate in (0.5, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120):
        if span / candidate <= target and candidate <= span:
            return float(candidate)
    return float(max(span / 4.0, 0.05))


def _add_geom(ax, geoms, facecolor="none", edgecolor="none", linewidth=0.0,
              zorder: float = 1.0) -> None:
    if not geoms:
        return
    ax.add_geometries(geoms, PC, facecolor=facecolor, edgecolor=edgecolor,
                      linewidth=linewidth, zorder=zorder)


def _graticule(ax, spec: Dict, ctx: Ctx) -> List[Any]:
    """Draw gridlines + labels; returns the label Text artists (for layout)."""
    grid = spec["map"]["grid"]
    if not grid.get("show", True):
        return []
    extent = spec.get("_extent") or (72.0, 137.0, 16.0, 55.0)
    lon_min, lon_max, lat_min, lat_max = extent
    lon_interval = float(grid.get("intervalX") or 0)
    lat_interval = float(grid.get("intervalY") or 0)
    if not lon_interval:
        lon_interval = _auto_interval(lon_max - lon_min)
        ctx.auto("graticuleIntervalX", "经线间隔已自动取 %g°" % lon_interval)
    if not lat_interval:
        lat_interval = _auto_interval(lat_max - lat_min)
        ctx.auto("graticuleIntervalY", "纬线间隔已自动取 %g°" % lat_interval)
    xlocs = np.arange(np.ceil(lon_min / lon_interval) * lon_interval,
                      lon_max + 1e-9, lon_interval)
    ylocs = np.arange(np.ceil(lat_min / lat_interval) * lat_interval,
                      lat_max + 1e-9, lat_interval)
    label_format = str(grid.get("labelFormat", "degree"))
    want_labels = label_format not in ("none", "无") and any(
        bool(grid.get(key, False)) for key in ("labelTop", "labelBottom", "labelLeft", "labelRight")
    )
    style = dict(color=grid.get("lineColor", "#9a9a9a"),
                 linewidth=float(grid.get("lineWidth", 0.35) or 0.35),
                 linestyle=grid.get("lineStyle", "dashed") or "dashed",
                 zorder=2)
    try:
        gl = ax.gridlines(crs=PC, draw_labels=False, xlocs=xlocs, ylocs=ylocs, **style)
        gl.n_steps = 80
        if not want_labels:
            return []
        gl.top_labels = bool(grid.get("labelTop", False))
        gl.bottom_labels = bool(grid.get("labelBottom", True))
        gl.left_labels = bool(grid.get("labelLeft", True))
        gl.right_labels = bool(grid.get("labelRight", False))
        gl.x_inline = False
        gl.y_inline = False
        # rotation of graticule labels is a rendered-artefact trap: keep them
        # horizontal unless the user explicitly opts in
        rotation = bool(grid.get("rotation", False))
        gl.rotate_labels = rotation
        size = float(spec["style"]["font"].get("sizeTick", 7.0))
        color = spec["style"]["font"].get("color", "#000000")
        gl.xlabel_style = {"size": size, "color": color}
        gl.ylabel_style = {"size": size, "color": color}
        if label_format == "degree_minute":
            gl.xformatter = LongitudeFormatter(dms=True, minute_symbol="′")
            gl.yformatter = LatitudeFormatter(dms=True, minute_symbol="′")
        elif label_format == "degree_only":
            gl.xformatter = LongitudeFormatter(direction_label=False, degree_symbol="°")
            gl.yformatter = LatitudeFormatter(direction_label=False, degree_symbol="°")
        else:
            gl.xformatter = LongitudeFormatter(degree_symbol="°")
            gl.yformatter = LatitudeFormatter(degree_symbol="°")
        return list(getattr(gl, "label_artists", []) or [])
    except Exception as exc:  # noqa: BLE001 - e.g. non-rectangular projection
        ctx.warn("当前投影下经纬网标注不可用（%s），已关闭经纬网" % exc)
        try:
            ax.gridlines(crs=PC, draw_labels=False, xlocs=xlocs, ylocs=ylocs, **style)
        except Exception:  # noqa: BLE001
            pass
        return []


# ---------------------------------------------------------------------------
# data layers
# ---------------------------------------------------------------------------
def _value_range(values: np.ndarray, spec: Dict) -> Tuple[float, float]:
    cfg = spec["map"]["colorbar"]
    vmin = cfg.get("vmin")
    vmax = cfg.get("vmax")
    valid = values[np.isfinite(values)]
    if valid.size == 0:
        return 0.0, 1.0
    data_min = float(np.min(valid))
    data_max = float(np.max(valid))
    if data_min == data_max:
        data_max = data_min + 1e-6
    if vmin is None:
        vmin = data_min
    if vmax is None:
        vmax = data_max
    if float(vmin) >= float(vmax):
        vmin, vmax = data_min, data_max
    return float(vmin), float(vmax)


def _draw_points(ax, spec: Dict, data: Dict, ctx: Ctx) -> Dict[str, Any]:
    frame = data["points"]
    lon_values = pd.to_numeric(frame[data["lon"]], errors="coerce").to_numpy(dtype=float)
    lat_values = pd.to_numeric(frame[data["lat"]], errors="coerce").to_numpy(dtype=float)
    mask = np.isfinite(lon_values) & np.isfinite(lat_values)
    if not np.any(mask):
        ctx.warn("地图点数据没有有效经纬度，已跳过数据图层")
        return {"mappable": None, "handles": [], "labels": []}
    value = None
    if data.get("value") and data["value"] in frame.columns:
        value = pd.to_numeric(frame[data["value"]], errors="coerce").to_numpy(dtype=float)
    point_cfg = spec["map"]["point"]
    mode = str(point_cfg.get("mode", "auto"))
    if mode == "auto":
        mode = "choropleth" if value is not None else "fixed"
    marker = _MARKERS.get(str(point_cfg.get("style", "circle")), "o")
    size = float(point_cfg.get("size", 22.0) or 22.0)
    color = point_color(spec, ctx)
    edge_color = point_cfg.get("edgeColor", "#ffffff")
    alpha = float(point_cfg.get("alpha", 0.9) or 0.9)
    if value is not None:
        value = np.where(mask, value, np.nan)
    mappable = None
    handles: List[Any] = []
    labels: List[str] = []

    if mode == "choropleth" and value is not None:
        cmap, _palette_id = fill_cmap(spec, ctx, role="colorbar",
                                      fallback=spec["map"]["colorbar"].get("cmap", "YlOrRd"))
        vmin, vmax = _value_range(value, spec)
        norm = Normalize(vmin=vmin, vmax=vmax)
        collection = ax.scatter(lon_values[mask], lat_values[mask], c=value[mask],
                                cmap=cmap, norm=norm, s=size, marker=marker,
                                edgecolors=edge_color, linewidths=0.3,
                                transform=PC, zorder=6)
        mappable = collection
    elif mode == "bubble" and value is not None:
        vmin, vmax = _value_range(value, spec)
        span = (vmax - vmin) or 1.0
        normalized = np.clip((value - vmin) / span, 0.0, 1.0)
        sizes = size * (0.35 + 1.65 * np.nan_to_num(normalized, nan=0.0))
        collection = ax.scatter(lon_values[mask], lat_values[mask], s=sizes[mask],
                                c=color, marker=marker, edgecolors=edge_color,
                                linewidths=0.4, alpha=alpha, transform=PC, zorder=6)
        for fraction, text_value in ((0.0, vmin), (0.5, vmin + span / 2.0), (1.0, vmax)):
            proxy_size = size * (0.35 + 1.65 * fraction)
            handles.append(ax.scatter([], [], s=proxy_size, c=color, marker=marker,
                                      edgecolors=edge_color, linewidths=0.4, label=""))
            labels.append("%.4g" % text_value)
    else:
        ax.scatter(lon_values[mask], lat_values[mask], s=size, c=color, marker=marker,
                   edgecolors=edge_color, linewidths=0.4, alpha=alpha,
                   transform=PC, zorder=6)
    if spec["map"]["label"].get("show") and data.get("label") and data["label"] in frame.columns:
        _draw_point_labels(ax, spec, frame, mask, lon_values, lat_values, ctx)
    return {"mappable": mappable, "handles": handles, "labels": labels}


def _draw_point_labels(ax, spec: Dict, frame, mask, lon_values, lat_values, ctx: Ctx) -> None:
    label_cfg = spec["map"]["label"]
    size = float(label_cfg.get("size", 6.0) or 6.0)
    color = spec["style"]["font"].get("color", "#000000")
    mode = str(label_cfg.get("mode", "all"))
    labels = [str(v) for v in frame[data_label_column(spec, frame)].tolist()]
    offsets = [(0, 4), (0, -11), (7, 2), (-7, 2), (9, 9), (-9, 9), (0, 14)]
    figure = ax.figure
    renderer = None
    try:
        figure.canvas.draw()
        renderer = figure.canvas.get_renderer()
    except Exception:  # noqa: BLE001
        renderer = None
    placed: List[Any] = []
    skipped = 0
    total = 0
    for index in np.nonzero(mask)[0]:
        if mode == "auto" and index % 2 == 1:
            continue
        text = labels[index] if index < len(labels) else ""
        if not text or text.lower() in ("nan", "none"):
            continue
        total += 1
        for offset in offsets:
            try:
                artist = ax.annotate(
                    text,
                    xy=(lon_values[index], lat_values[index]),
                    xycoords=PC._as_mpl_transform(ax),
                    xytext=offset, textcoords="offset points",
                    fontsize=size, color=color, ha="center", va="bottom",
                    zorder=7,
                )
            except Exception:  # noqa: BLE001
                skipped += 1
                break
            if renderer is None:
                placed.append(artist)
                break
            try:
                bbox = artist.get_window_extent(renderer)
            except Exception:  # noqa: BLE001
                placed.append(artist)
                break
            collision = any(
                bbox.overlaps(other.get_window_extent(renderer)) for other in placed
            )
            if not collision:
                placed.append(artist)
                break
            artist.remove()
        else:
            skipped += 1
    if skipped and skipped > max(2, 0.3 * total):
        ctx.warn("点标注过密，已省略 %d 个（共 %d 个）" % (skipped, total))


def data_label_column(spec: Dict, frame) -> str:
    label = spec["data"].get("label", "auto")
    path = dataio._pick(frame, label, "label", Ctx(), {"label": dataio.LABEL_KEYS})
    if path:
        return path
    for column in frame.columns:
        if column not in (spec["data"].get("lon"), spec["data"].get("lat")):
            return column
    return str(frame.columns[0])


def _draw_polygons(ax, spec: Dict, data: Dict, ctx: Ctx) -> Dict[str, Any]:
    frame = data["frame"]
    value_column = data.get("value")
    border_color = spec["map"]["colors"].get("border", "#8c8c8c")
    point_fill = point_color(spec, ctx)
    if not value_column or value_column not in frame.columns:
        _add_geom(ax, list(frame.geometry), facecolor=point_fill, edgecolor=border_color,
                  linewidth=0.3, zorder=5)
        return {"mappable": None, "handles": [], "labels": [], "boundaries": None}
    values = pd.to_numeric(frame[value_column], errors="coerce").to_numpy(dtype=float)
    cmap, _palette_id = fill_cmap(spec, ctx, role="choropleth",
                                  fallback=spec["map"]["colorbar"].get("cmap", "YlOrRd"))
    scheme = str(spec["map"].get("choropleth", {}).get("scheme", "quantile"))
    class_count = int(spec["map"].get("choropleth", {}).get("classes", 5) or 5)
    class_count = max(2, min(9, class_count))
    valid = values[np.isfinite(values)]
    if valid.size == 0:
        _add_geom(ax, list(frame.geometry), facecolor="#dedede", edgecolor=border_color,
                  linewidth=0.3, zorder=5)
        ctx.warn("分级设色列没有有效数值，已用灰色填充")
        return {"mappable": None, "handles": [], "labels": [], "boundaries": None}
    vmin, vmax = _value_range(values, spec)
    if scheme == "equal":
        edges = np.linspace(vmin, vmax, class_count + 1)
    else:
        edges = np.nanquantile(valid, np.linspace(0.0, 1.0, class_count + 1))
    edges = np.unique(np.round(edges, 10))
    if edges.size < 2:
        edges = np.array([vmin, vmax])
    norm = BoundaryNorm(edges, ncolors=cmap.N)
    palette_colors, _class_palette = class_colors(
        spec, ctx, max(1, len(edges) - 1),
        fallback_cmap=str(spec["map"]["colorbar"].get("cmap", "YlOrRd")),
        role="choropleth")
    colors = [palette_colors[index] for index in range(len(edges) - 1)]
    for class_index in range(len(edges) - 1):
        lower, upper = edges[class_index], edges[class_index + 1]
        if class_index == len(edges) - 2:
            selected = (values >= lower) & (values <= upper)
        else:
            selected = (values >= lower) & (values < upper)
        geoms = [geom for geom, keep in zip(frame.geometry, selected) if bool(keep)]
        if geoms:
            _add_geom(ax, geoms, facecolor=colors[class_index], edgecolor=border_color,
                      linewidth=0.35, zorder=5)
    missing = len(frame) - int(np.isfinite(values).sum())
    if missing > 0:
        geoms = [geom for geom, keep in zip(frame.geometry, np.isfinite(values)) if not bool(keep)]
        if geoms:
            _add_geom(ax, geoms, facecolor="#efefef", edgecolor=border_color,
                      linewidth=0.3, zorder=5)
        ctx.warn("有 %d 个要素缺少数值，已用浅灰占位" % missing)
    mappable = ScalarMappable(norm=norm, cmap=cmap)
    mappable.set_array(np.asarray(edges))
    mappable.set_clim(float(edges[0]), float(edges[-1]))
    return {"mappable": mappable, "handles": [], "labels": [],
            "boundaries": [float(edge) for edge in edges],
            "tickLabels": ["%.4g" % float(e) for e in edges]}


# ---------------------------------------------------------------------------
# decorations: scale bar / north arrow / SCS inset
# ---------------------------------------------------------------------------
def _bbox_of(artist, figure) -> Optional[Tuple[float, float, float, float]]:
    try:
        figure.canvas.draw()
        renderer = figure.canvas.get_renderer()
        bbox = artist.get_window_extent(renderer)
        return (float(bbox.x0), float(bbox.y0), float(bbox.x1), float(bbox.y1))
    except Exception:  # noqa: BLE001
        return None


def _nice_smaller(value: float) -> float:
    import math

    if value <= 1.0:
        return 1.0
    exponent = math.floor(math.log10(value))
    base = 10.0 ** exponent
    for multiplier in (5.0, 2.0, 1.0):
        candidate = multiplier * base
        if candidate < value - 1e-9:
            return candidate
    return value / 2.0


def _scale_length_px(ax, length_km: float, units: str, extent) -> Optional[float]:
    lon_min, lon_max, lat_min, lat_max = extent
    lon0 = lon_min + 0.04 * (lon_max - lon_min)
    lat0 = lat_min + 0.10 * (lat_max - lat_min)
    length_m = length_km * 1000.0 if units.lower() != "m" else length_km
    try:
        from pyproj import Geod

        geod = Geod(ellps="WGS84")
        lon2, lat2, _az = geod.fwd(lon0, lat0, 90.0, length_m)
        pts = ax.projection.transform_points(PC, np.array([lon0, lon2]),
                                             np.array([lat0, lat2]))
        if not np.all(np.isfinite(pts[:, :2])):
            return None
        p0 = ax.transData.transform(pts[0, :2])
        p1 = ax.transData.transform(pts[1, :2])
        return float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))
    except Exception:  # noqa: BLE001
        return None


def _draw_scale_bar(ax, spec: Dict, ctx: Ctx) -> Optional[Tuple[float, float, float, float]]:
    cfg = spec["map"]["scaleBar"]
    if not cfg.get("show"):
        return None
    units = str(cfg.get("units", "km"))
    length_km = float(cfg.get("lengthKm", 500) or 500.0)
    extent = spec.get("_extent") or (72.0, 137.0, 16.0, 55.0)
    fig = ax.figure
    axes_width = float(ax.bbox.width)
    if axes_width <= 0:
        return None
    # 1) never occupy more than 60% (55% in narrow panels) of the axes width
    axes_w_mm = ax.bbox.width / fig.dpi * 25.4
    axes_h_mm = ax.bbox.height / fig.dpi * 25.4
    narrow = axes_w_mm < 70.0
    width_cap = 0.55 if narrow else 0.60
    length_px = _scale_length_px(ax, length_km, units, extent)
    for _ in range(8):
        if length_px is None or length_px <= width_cap * axes_width:
            break
        smaller = _nice_smaller(length_km)
        if smaller >= length_km:
            break
        probe = _scale_length_px(ax, smaller, units, extent)
        if probe is None or probe <= 1:
            break
        length_km, length_px = smaller, probe
    if length_px is None or not np.isfinite(length_px) or length_px <= 2 \
            or length_px > 0.80 * axes_width:
        ctx.auto("scaleBar", "比例尺已省略（长度超出合理范围）")
        return None
    if abs(length_km - float(cfg.get("lengthKm", 500) or 500.0)) > 1e-9:
        ctx.auto("scaleBarLength", "比例尺长度已缩为 %g km" % length_km)
    frac = length_px / axes_width
    position = str(cfg.get("position", "lower left")).lower()
    margin_mm = 1.8
    configured_font = float(spec["style"]["font"].get("sizeTick", 7.0))
    font_size = configured_font
    if narrow:
        font_size = min(font_size, 6.5)
        if font_size < configured_font:
            ctx.auto("scaleBarFontSize", "比例尺字号已缩小以适配窄面板")
    label_gap_pt = 4.5 if narrow else 2.5
    # 1.4 mm bar, clamped so it stays visible in small panels
    bar_h = max(0.0035, min(0.05, 1.4 / max(axes_h_mm, 1.0)))
    label_space = (font_size + 4.0) / 72.0 * 25.4 / max(axes_h_mm, 1.0)
    x0 = margin_mm / axes_w_mm if "left" in position else 1.0 - margin_mm / axes_w_mm - frac
    x1 = x0 + frac
    if "upper" in position:
        y0 = 1.0 - margin_mm / axes_h_mm - label_space - bar_h
    else:
        y0 = margin_mm / axes_h_mm
    style = str(cfg.get("style", "bar"))
    color = spec["style"]["font"].get("color", "#000000")
    artists = _draw_scale_bar_body(ax, spec, style, color, x0, x1, y0, bar_h)
    # 2) label layout: two end labels -> only end label -> smaller font -> compact
    label_text = "%g %s" % (length_km, units)
    renderer = None
    try:
        fig.canvas.draw()
        renderer = fig.canvas.get_renderer()
    except Exception:  # noqa: BLE001
        renderer = None
    bar_px = frac * axes_width
    layout = "two"
    text_width = [0.0, 0.0]

    def measure(text_value: str, size: float) -> float:
        if renderer is None:
            return size * 0.6 * len(text_value) * fig.dpi / 72.0
        try:
            from matplotlib.font_manager import FontProperties

            prop = FontProperties(size=size, family="sans-serif")
            width, _height, _descent = renderer.get_text_width_height_descent(
                text_value, prop, False)
            return float(width)
        except Exception:  # noqa: BLE001
            return size * 0.6 * len(text_value) * fig.dpi / 72.0

    for _attempt in range(3):
        text_width = [measure("0", font_size), measure(label_text, font_size)]
        spacing = 10.0 if narrow else 6.0
        if bar_px >= text_width[0] + text_width[1] + spacing:
            layout = "two"
            break
        if bar_px >= text_width[1] + 4.0:
            layout = "end"
            break
        font_size = max(6.0, font_size - 1.0)
    else:
        layout = "compact"
        label_text = "%g%s" % (length_km, units)
        text_width = [0.0, measure(label_text, font_size)]
    labels_artists: List[Any] = []
    if layout == "two":
        labels_artists.append(_scale_label(ax, "0", x0, y0 + bar_h, label_gap_pt,
                                           "left", font_size, color))
        labels_artists.append(_scale_label(ax, label_text, x1, y0 + bar_h, label_gap_pt,
                                           "right", font_size, color))
    elif layout == "end":
        labels_artists.append(_scale_label(ax, label_text, x1, y0 + bar_h, label_gap_pt,
                                           "right", font_size, color))
    else:
        labels_artists.append(_scale_label(ax, label_text, x1, y0 + bar_h, label_gap_pt,
                                           "right", font_size, color))
        ctx.auto("scaleBarLabel", "比例尺标签已精简为终点数值")
    if layout != "two":
        ctx.auto("scaleBarLabel", "比例尺标签已精简为终点数值")
    artists.extend(labels_artists)
    # 3) measure the union for legend avoidance
    try:
        fig.canvas.draw()
        renderer = fig.canvas.get_renderer()
        boxes = [artist.get_window_extent(renderer) for artist in artists]
    except Exception:  # noqa: BLE001
        boxes = []
    boxes = [box for box in boxes if box is not None]
    if not boxes:
        return None
    # 4) keep the bar inside the axes horizontally
    if boxes[0].x0 < ax.bbox.x0 - 1 or max(box.x1 for box in boxes) > ax.bbox.x1 + 1:
        ctx.auto("scaleBarEdge", "比例尺已贴近轴框边缘")
    return (min(box.x0 for box in boxes), min(box.y0 for box in boxes),
            max(box.x1 for box in boxes), max(box.y1 for box in boxes))


def _scale_label(ax, text_value: str, x: float, y: float, gap_pt: float,
                 ha: str, font_size: float, color: str) -> Any:
    return ax.annotate(
        text_value, xy=(x, y), xycoords="axes fraction",
        xytext=(0, gap_pt), textcoords="offset points",
        ha=ha, va="bottom", fontsize=font_size, color=color,
        annotation_clip=False, zorder=21,
    )


def _draw_scale_bar_body(ax, spec: Dict, style: str, color: str,
                         x0: float, x1: float, y0: float, bar_h: float) -> List[Any]:
    artists: List[Any] = []
    frac = x1 - x0
    if style == "simple":
        patch = Rectangle((x0, y0), frac, bar_h, transform=ax.transAxes,
                          facecolor=color, edgecolor=color, linewidth=0.4, zorder=20)
        ax.add_patch(patch)
        artists.append(patch)
    elif style == "line":
        artists.append(ax.plot([x0, x1], [y0 + bar_h / 2.0, y0 + bar_h / 2.0],
                               transform=ax.transAxes, color=color,
                               linewidth=1.0, zorder=20)[0])
        for tick_x in (x0, x1):
            artists.append(ax.plot([tick_x, tick_x], [y0, y0 + bar_h],
                                   transform=ax.transAxes, color=color,
                                   linewidth=1.0, zorder=20)[0])
    else:
        half = frac / 2.0
        for index, face in enumerate((color, "#ffffff")):
            patch = Rectangle((x0 + index * half, y0), half, bar_h,
                              transform=ax.transAxes, facecolor=face,
                              edgecolor=color, linewidth=0.5, zorder=20)
            ax.add_patch(patch)
            artists.append(patch)
    return artists


def _draw_north_arrow(ax, spec: Dict, ctx: Ctx) -> Optional[Tuple[float, float, float, float]]:
    cfg = spec["map"]["northArrow"]
    if not cfg.get("show"):
        return None
    position = str(cfg.get("position", "upper right")).lower()
    size = float(cfg.get("size", 0.07) or 0.07)
    color = cfg.get("color", "#000000")
    style = str(cfg.get("style", "arrow"))
    x = 0.90 if "right" in position else 0.10
    y = 0.83 if "upper" in position else 0.15
    if "center" in position:
        x = 0.5
    width = size * 0.55
    height = size
    artists: List[Any] = []
    font_size = float(spec["style"]["font"].get("sizeTick", 7.0))
    if style == "letter":
        artists.append(ax.text(x, y + height / 2.0, "N", transform=ax.transAxes,
                               ha="center", va="center", fontsize=font_size + 3,
                               fontweight="bold", color=color, zorder=22))
    else:
        triangle = MplPolygon(
            [(x, y + height), (x - width / 2.0, y), (x + width / 2.0, y)],
            closed=True, transform=ax.transAxes, facecolor=color,
            edgecolor=color, linewidth=0.4, zorder=22,
        )
        ax.add_patch(triangle)
        artists.append(triangle)
        artists.append(ax.text(x, y + height + 0.003, "N", transform=ax.transAxes,
                               ha="center", va="bottom", fontsize=font_size,
                               fontweight="bold", color=color, zorder=23))
        if style == "compass":
            side = width * 1.8
            artists.append(ax.plot([x - side / 2.0, x + side / 2.0],
                                   [y + height * 0.45, y + height * 0.45],
                                   transform=ax.transAxes, color=color,
                                   linewidth=0.8, zorder=21)[0])
    bboxes = [_bbox_of(artist, ax.figure) for artist in artists]
    bboxes = [bbox for bbox in bboxes if bbox]
    if not bboxes:
        return None
    return (min(b[0] for b in bboxes), min(b[1] for b in bboxes),
            max(b[2] for b in bboxes), max(b[3] for b in bboxes))


def _draw_scs_inset(ax, spec: Dict, ctx: Ctx, box) -> Optional[Tuple[float, float, float, float]]:
    layers = spec["map"]["layers"]
    if not layers.get("scsInset"):
        return None
    colors = spec["map"]["colors"]
    try:
        inset = ax.inset_axes([0.745, 0.012, 0.235, 0.42], projection=PC)
    except Exception as exc:  # noqa: BLE001
        ctx.warn("南海诸岛插图创建失败（%s），已跳过" % exc)
        return None
    try:
        inset.set_extent([105.0, 123.0, 2.0, 24.0], crs=PC)
        inset.set_facecolor(colors.get("ocean", "#e6f0f7"))
        inset.patch.set_zorder(0)
        inset.add_geometries(_geoms("10m", "physical", "land", ctx, "插图陆地", box) or [],
                             PC, facecolor=colors.get("land", "#f2efe9"),
                             edgecolor="none", zorder=1)
        inset.add_geometries(_geoms("10m", "physical", "coastline", ctx, "插图海岸线", box) or [],
                             PC, facecolor="none", edgecolor=colors.get("coastline", "#4d4d4d"),
                             linewidth=0.35, zorder=2)
        china = _china_geoms("10m", ctx, box) or []
        if china:
            inset.add_geometries(china, PC, facecolor="none",
                                 edgecolor=colors.get("chinaBorder", "#333333"),
                                 linewidth=0.8, zorder=3)
        if layers.get("scsNineDash", True):
            lons = [point[0] for point in SCS_NINE_DASH]
            lats = [point[1] for point in SCS_NINE_DASH]
            inset.plot(lons, lats, transform=PC, color="#333333", linewidth=0.8,
                       linestyle=(0, (3.0, 2.0)), zorder=3)
        inset.set_xticks([])
        inset.set_yticks([])
        size = float(spec["style"]["font"].get("sizeTick", 7.0)) - 0.5
        inset.text(0.5, 0.015, str(spec["map"].get("insetLabel", "南海诸岛")) + "（示意）",
                   transform=inset.transAxes, ha="center", va="bottom",
                   fontsize=size, color=spec["style"]["font"].get("color", "#000000"),
                   zorder=5)
        for spine in inset.spines.values():
            spine.set_linewidth(0.6)
            spine.set_color("#4d4d4d")
    except Exception as exc:  # noqa: BLE001
        ctx.warn("南海诸岛插图绘制失败（%s），已跳过" % exc)
        return None
    return _bbox_of(inset, ax.figure)


# ---------------------------------------------------------------------------
# main draw
# ---------------------------------------------------------------------------
def draw(fig, ax, spec: Dict, data: Dict, ctx: Ctx) -> Dict[str, Any]:
    _set_extent(ax, spec, ctx)
    layers = spec["map"]["layers"]
    colors = spec["map"]["colors"]
    extent = spec.get("_extent") or [72.0, 137.0, 16.0, 55.0]
    clip_extent = list(extent)
    if layers.get("scsInset"):
        clip_extent = [min(clip_extent[0], 105.0), max(clip_extent[1], 123.0),
                       min(clip_extent[2], 2.0), max(clip_extent[3], 24.0)]
    box = _layer_box(clip_extent)

    ocean_geoms = _geoms("10m", "physical", "ocean", ctx, "海洋", box) \
        if layers.get("ocean", True) else None
    # Background colour: with conic projections the projected extent rectangle
    # leaves corner wedges; painting them ocean/land instead of white blends
    # them into the basemap.
    if ocean_geoms:
        background = colors.get("ocean", "#e6f0f7")
    elif layers.get("land", True):
        background = colors.get("land", "#f2efe9")
    else:
        background = colors.get("ocean", "#e6f0f7")
    try:
        ax.set_facecolor(background)
        ax.patch.set_zorder(-10)
    except Exception:  # noqa: BLE001
        pass
    if str(spec["map"].get("projection", "lambert")) in (
            "lambert", "albers", "azimuthal", "orthographic", "northpolarstereo"):
        ctx.auto("cornerFill", "地图四角已用底色填充")

    if ocean_geoms:
        _add_geom(ax, ocean_geoms,
                  facecolor=colors.get("ocean", "#e6f0f7"), zorder=0)
    if layers.get("land", True):
        _add_geom(ax, _geoms("10m", "physical", "land", ctx, "陆地", box),
                  facecolor=colors.get("land", "#f2efe9"), zorder=1)
    if layers.get("lakes", True):
        _add_geom(ax, _geoms("10m", "physical", "lakes", ctx, "湖泊", box),
                  facecolor=colors.get("lakes", "#c9e0ee"), zorder=2)
    if layers.get("rivers", False):
        _add_geom(ax, _geoms("10m", "physical", "rivers_lake_centerlines", ctx, "河流", box),
                  edgecolor=colors.get("rivers", "#8fb8d6"), linewidth=0.45, zorder=2)
    if layers.get("coastline", True):
        _add_geom(ax, _geoms("10m", "physical", "coastline", ctx, "海岸线", box),
                  edgecolor=colors.get("coastline", "#4d4d4d"), linewidth=0.45, zorder=3)
    if layers.get("countryBorders", True):
        _add_geom(ax, _geoms("10m", "cultural", "admin_0_boundary_lines_land", ctx, "国界", box),
                  edgecolor=colors.get("border", "#8c8c8c"), linewidth=0.45, zorder=3)
    if layers.get("chinaBorder", True):
        china = _china_geoms("10m", ctx, box)
        if china:
            ax.add_geometries(china, PC, facecolor="none",
                              edgecolor=colors.get("chinaBorder", "#333333"),
                              linewidth=1.0, zorder=4)
    if layers.get("provinceBorders", False):
        _add_geom(ax, _geoms("10m", "cultural", "admin_1_states_provinces_lines", ctx, "省界", box),
                  edgecolor="#b0b0b0", linewidth=0.3, zorder=3)

    mappable = None
    handles: List[Any] = []
    labels: List[str] = []
    boundaries = None
    if data and data.get("frame") is not None:
        if data.get("geometry"):
            result = _draw_polygons(ax, spec, data, ctx)
        else:
            result = _draw_points(ax, spec, data, ctx)
        mappable = result.get("mappable")
        handles = result.get("handles") or []
        labels = result.get("labels") or []
        boundaries = result.get("boundaries")
    elif not spec["data"].get("source"):
        ctx.warn("地图没有数据图层（data.source 为空），仅输出底图")

    grid_labels = _graticule(ax, spec, ctx)
    forbidden: List[Tuple[float, float, float, float]] = []
    decorations = {
        "scaleBar": _draw_scale_bar(ax, spec, ctx),
        "northArrow": _draw_north_arrow(ax, spec, ctx),
        "scsInset": _draw_scs_inset(ax, spec, ctx, box),
    }
    for name, decoration in decorations.items():
        if decoration:
            forbidden.append(decoration)
    # decoration-to-decoration collision check (scale bar vs north arrow)
    first = decorations.get("scaleBar")
    second = decorations.get("northArrow")
    if first and second:
        overlap_width = min(first[2], second[2]) - max(first[0], second[0])
        overlap_height = min(first[3], second[3]) - max(first[1], second[1])
        if overlap_width > 2 and overlap_height > 2:
            ctx.warn("比例尺与指北针位置重叠，建议改 map.scaleBar.position 或 "
                     "map.northArrow.position")
    if first:
        inset = decorations.get("scsInset")
        if inset:
            overlap_width = min(first[2], inset[2]) - max(first[0], inset[0])
            overlap_height = min(first[3], inset[3]) - max(first[1], inset[1])
            if overlap_width > 2 and overlap_height > 2:
                ctx.warn("比例尺与南海诸岛插图重叠，建议把比例尺移到右下或左侧中部")
    extra_bbox: List[Tuple[float, float, float, float]] = []
    for artist in grid_labels:
        bbox = _bbox_of(artist, fig)
        if bbox:
            extra_bbox.append(bbox)
    for spine in ax.spines.values():
        spine.set_linewidth(0.6)
    return {"handles": handles, "labels": labels, "mappable": mappable,
            "boundaries": boundaries, "inkMode": "dark", "forbidden": forbidden,
            "extraBBox": extra_bbox, "colorbar": mappable is not None}
