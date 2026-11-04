"""Spec normalisation: defaults -> journal preset -> user overrides.

The renderer is stateless: every render starts from :data:`DEFAULT_SPEC`,
applies the selected journal preset, then the incoming spec (typed and
clamped against ``controls.json``).  Unknown paths are reported as warnings
instead of crashing, so a stale host never breaks a figure.
"""

from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional, Tuple

from . import controls
from .defaults import default_spec
from .log import Ctx
from .paths import deep_merge, flatten, get_path, set_path

KINDS = ("map", "line", "bar", "scatter", "heatmap", "box", "compose")

#: named geographic extents (lon_min, lon_max, lat_min, lat_max)
EXTENT_PRESETS: Dict[str, Tuple[float, float, float, float]] = {
    "china": (73.0, 136.0, 17.0, 54.0),
    "china_neighbors": (72.0, 137.0, 16.0, 55.0),
    "china_full": (73.0, 136.0, 3.0, 54.0),
    "xinjiang": (73.0, 97.0, 34.0, 49.5),
    "central_asia": (45.0, 92.0, 34.0, 56.0),
    "asia": (25.0, 150.0, -12.0, 60.0),
    "world": (-180.0, 180.0, -60.0, 84.0),
}

BOUND_PATHS = (
    "map.extentLonMin",
    "map.extentLonMax",
    "map.extentLatMin",
    "map.extentLatMax",
)

NULLABLE_NUMBERS = {
    "axes.xMin",
    "axes.xMax",
    "axes.yMin",
    "axes.yMax",
    "map.colorbar.vmin",
    "map.colorbar.vmax",
    "map.stdParallel1",
    "map.stdParallel2",
}

_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


class SpecError(ValueError):
    """Raised when the spec itself is structurally unusable."""


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _to_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        low = value.strip().lower()
        if low in ("true", "yes", "1", "on", "是", "开", "显示"):
            return True
        if low in ("false", "no", "0", "off", "否", "关", "不显示"):
            return False
    return None


def _to_number(value: Any) -> Optional[float]:
    if _is_number(value):
        return float(value)
    if isinstance(value, str):
        text = value.strip().replace("°", "").replace("mm", "").replace("pt", "")
        text = text.replace("，", ".").replace(",", ".")
        try:
            return float(text)
        except ValueError:
            return None
    return None


def _coerce_color(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if _HEX_RE.match(text):
        return text.lower()
    try:  # allow css colour names like "red" / "navy"
        from matplotlib.colors import is_color_like, to_hex

        if is_color_like(text):
            return to_hex(text, keep_alpha=True).lower()
    except Exception:  # pragma: no cover - matplotlib always present
        pass
    return None


def _coerce_value(path: str, value: Any, default: Any, item: Dict[str, Any], ctx: Ctx) -> Any:
    """Type-check and clamp one value; falls back to *default* on garbage."""
    kind = item.get("type", "text")
    if value is None:
        return None if default is None else default

    if kind == "number":
        number = _to_number(value)
        if number is None:
            ctx.warn("参数 %s 需要数字，已回退默认值 %r" % (path, default))
            return default
        if item.get("integer"):
            number = int(round(number))
        lo, hi = item.get("min"), item.get("max")
        if lo is not None and number < lo:
            ctx.warn("参数 %s=%s 小于下限 %s，已夹到下限" % (path, number, lo))
            number = lo
        if hi is not None and number > hi:
            ctx.warn("参数 %s=%s 大于上限 %s，已夹到上限" % (path, number, hi))
            number = hi
        return int(number) if item.get("integer") else float(number)

    if kind == "bool":
        flag = _to_bool(value)
        if flag is None:
            ctx.warn("参数 %s 需要布尔值（true/false），已回退默认值" % path)
            return default
        return flag

    if kind == "enum":
        options = item.get("options") or []
        if value in options:
            return value
        text = str(value).strip()
        for option in options:
            if str(option).lower() == text.lower():
                return option
        # tolerate a translated option label ("右下" -> "lower right")
        labels = item.get("optionLabels") or {}
        for option, label in labels.items():
            if str(label).strip() == text:
                return option
        ctx.warn("参数 %s=%r 不是可选项（%s），已忽略" % (path, value, "/".join(map(str, options))))
        return default

    if kind == "color":
        color = _coerce_color(value)
        if color is None:
            ctx.warn("参数 %s=%r 不是合法颜色，已忽略" % (path, value))
            return default
        return color

    # text / unknown
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v) for v in value)
    return str(value)


def merge_known(base: Dict[str, Any], raw: Dict[str, Any], ctx: Ctx) -> Dict[str, Any]:
    """Overlay *raw* onto *base*, keeping only paths that exist in *base*."""
    merged = copy.deepcopy(base)
    known = set(flatten(base).keys())
    flat_raw = flatten(raw)
    unknown: List[str] = []
    for path, value in flat_raw.items():
        if path in ("compose.panels", "panels"):
            merged["compose"]["panels"] = value if isinstance(value, list) else []
            continue
        if path in ("map.colorbar.fmt", "map.colorbar.format"):
            # alias for map.colorbar.tickFormat ("%.2f"/"%.1f"/"%d" tolerated)
            mapped = _map_colorbar_fmt(value)
            set_path(merged, "map.colorbar.tickFormat", mapped)
            continue
        if path not in known:
            unknown.append(path)
            continue
        default = get_path(base, path)
        if value is None:
            if default is None:
                set_path(merged, path, None)
            else:
                set_path(merged, path, default)
            continue
        set_path(merged, path, value)
    if unknown:
        preview = ", ".join(unknown[:8]) + (" …" if len(unknown) > 8 else "")
        ctx.warn("spec 中有 %d 个未知参数已忽略：%s" % (len(unknown), preview))
    return merged


def _apply_preset(spec: Dict[str, Any], preset_id: str, ctx: Ctx) -> Dict[str, Any]:
    known = controls.preset_index()
    if not known:  # presets.json missing -> keep defaults
        spec["style"]["preset"] = preset_id
        return spec
    if preset_id not in known:
        fallback = controls.default_preset_id()
        ctx.warn("未知期刊风格 %r，已回退为 %r" % (preset_id, fallback))
        preset_id = fallback
    # preset values are dotted paths (controls.json vocabulary), not nested dicts
    values = controls.preset_values(preset_id)
    merged = copy.deepcopy(spec)
    for path, value in values.items():
        try:
            set_path(merged, path, value)
        except Exception as exc:  # noqa: BLE001 - defensive
            ctx.warn("风格 %s 的参数 %s 无效，已忽略（%s）" % (preset_id, path, exc))
    merged["style"]["preset"] = preset_id
    return merged


def normalize(raw: Optional[Dict[str, Any]], ctx: Optional[Ctx] = None) -> Dict[str, Any]:
    """Return the fully resolved spec for one render."""
    ctx = ctx or Ctx()
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise SpecError("spec 必须是 JSON 对象（dict），实际是 %s" % type(raw).__name__)

    kind = raw.get("kind", "map")
    if kind not in KINDS:
        raise SpecError("不支持的图型 kind=%r，可选：%s" % (kind, ", ".join(KINDS)))
    if kind == "compose":
        panels = _raw_panels(raw)
        if not panels:
            raise SpecError("kind=compose 需要 compose.panels 数组（每个元素含 kind/data/title）")

    preset_raw = get_path(raw, "style.preset", controls.default_preset_id()) or controls.default_preset_id()
    spec = default_spec()
    spec["kind"] = kind
    spec = _apply_preset(spec, str(preset_raw), ctx)
    spec = merge_known(spec, raw, ctx)
    spec["kind"] = kind

    # ---- type check against controls.json -------------------------------
    index = controls.control_index()
    flat_defaults = flatten(default_spec())
    for path, item in index.items():
        if path not in flat_defaults:
            continue
        current = get_path(spec, path)
        default = get_path(default_spec(), path)
        coerced = _coerce_value(path, current, default, item, ctx)
        set_path(spec, path, coerced)

    # ---- nullable numeric paths may be explicitly empty ----------------
    for path in NULLABLE_NUMBERS:
        item = index.get(path)
        if item and item.get("type") == "number":
            current = get_path(spec, path)
            if current is None:
                continue
            number = _to_number(current)
            set_path(spec, path, number)

    # ---- figure geometry -------------------------------------------------
    figure = spec["figure"]
    figure["widthMm"] = _clamp_number(figure.get("widthMm", 180.0), 40.0, 400.0, 180.0)
    figure["heightMm"] = _clamp_number(figure.get("heightMm", 120.0), 30.0, 400.0, 120.0)
    figure["dpi"] = int(_clamp_number(figure.get("dpi", 300), 72.0, 1200.0, 300.0))
    figure["marginMm"] = _clamp_number(figure.get("marginMm", 1.2), 0.0, 12.0, 1.2)

    # ---- extent heuristic -------------------------------------------------
    # contract: a named extent preset always wins; the four bounds numbers are
    # only used when map.extentPreset == "custom"
    if spec["map"].get("extentPreset") not in EXTENT_PRESETS:
        spec["map"]["extentPreset"] = "custom"
    lon_min, lon_max, lat_min, lat_max = resolve_extent(spec)
    spec["_extent"] = [float(lon_min), float(lon_max), float(lat_min), float(lat_max)]
    # materialise the resolved bounds so re-normalising (codegen -> render)
    # is idempotent and does not flip a named preset into "custom"
    if spec["map"].get("extentPreset") in EXTENT_PRESETS:
        spec["map"]["extentLonMin"] = round(float(lon_min), 4)
        spec["map"]["extentLonMax"] = round(float(lon_max), 4)
        spec["map"]["extentLatMin"] = round(float(lat_min), 4)
        spec["map"]["extentLatMax"] = round(float(lat_max), 4)

    # ---- derived projection parameters -----------------------------------
    map_spec = spec["map"]
    flat_raw = flatten(raw)
    extent_center_lon = (lon_min + lon_max) / 2.0
    extent_center_lat = (lat_min + lat_max) / 2.0
    raw_central = get_path(raw, "map.centralLongitude", None)
    auto_center = raw_central is None or map_spec.get("extentPreset") in EXTENT_PRESETS \
        and "map.centralLongitude" not in flat_raw
    if auto_center:
        map_spec["centralLongitude"] = round(extent_center_lon, 2)
    projection = str(map_spec.get("projection", "lambert"))
    # conic projections: standard parallels come from map.standardParallels ("25,47")
    parallels = _parse_standard_parallels(map_spec.get("standardParallels"))
    if parallels:
        map_spec["stdParallel1"], map_spec["stdParallel2"] = parallels
    elif map_spec.get("stdParallel1") is None or map_spec.get("stdParallel2") is None:
        map_spec["stdParallel1"] = round(lat_min + 0.25 * (lat_max - lat_min), 2)
        map_spec["stdParallel2"] = round(lat_min + 0.75 * (lat_max - lat_min), 2)
        if projection in ("lambert", "albers"):
            ctx.auto("standardParallels",
                     "标准纬线已按范围自动取 %.0f°N、%.0f°N"
                     % (map_spec["stdParallel1"], map_spec["stdParallel2"]))
    if map_spec.get("centralLongitude") is None:
        map_spec["centralLongitude"] = round(extent_center_lon, 2)
    # central latitude: snap to the study area when obviously off (azimuthal /
    # orthographic globes are very sensitive, conic cones less so)
    central_lat = map_spec.get("centralLatitude")
    raw_central_lat = get_path(raw, "map.centralLatitude", None)
    if central_lat is None:
        map_spec["centralLatitude"] = round(extent_center_lat, 2)
    elif raw_central_lat is not None:
        threshold = 5.0 if projection in ("orthographic", "azimuthal") else 10.0
        try:
            if abs(float(central_lat) - extent_center_lat) > threshold:
                map_spec["centralLatitude"] = round(extent_center_lat, 2)
                ctx.auto("centralLatitude",
                         "中央纬度已对齐研究区中心（%.1f°N）" % extent_center_lat)
        except (TypeError, ValueError):
            pass
    # Conic / azimuthal projections look tilted when the central meridian is far
    # from the study area; snap it to the extent centre (>10° difference only,
    # so a user-chosen near-centre value is respected).
    central = map_spec.get("centralLongitude")
    if projection in ("lambert", "albers", "azimuthal", "orthographic",
                      "northpolarstereo") and central is not None and raw_central is not None:
        try:
            if abs(float(central) - extent_center_lon) > 10.0:
                map_spec["centralLongitude"] = round(extent_center_lon, 2)
                ctx.auto("centralLongitude",
                         "中央经线已对齐研究区中心（%.1f°E）" % extent_center_lon)
        except (TypeError, ValueError):
            pass

    # ---- palette ids ------------------------------------------------------
    _validate_palettes(spec, ctx)

    # ---- data defaults ----------------------------------------------------
    data = spec["data"]
    data["source"] = str(data.get("source") or "")
    if not spec.get("title"):
        spec["title"] = ""

    # colorbar range sanity
    vmin, vmax = spec["map"]["colorbar"].get("vmin"), spec["map"]["colorbar"].get("vmax")
    if vmin is not None and vmax is not None and vmin >= vmax:
        ctx.auto("colorbarRange", "色带范围已自动纠正（最小/最大值互换）")
        spec["map"]["colorbar"]["vmin"], spec["map"]["colorbar"]["vmax"] = vmax, vmin

    return spec


def _has(flat: Dict[str, Any], path: str) -> bool:
    return path in flat


def _parse_standard_parallels(value: Any) -> Optional[Tuple[float, float]]:
    """Parse ``map.standardParallels`` text such as ``"25,47"`` / ``"25，47"``."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ("auto", "自动", "none", "null"):
        return None
    numbers = [float(item) for item in re.findall(r"-?\d+(?:\.\d+)?", text)]
    numbers = [number for number in numbers if -90.0 <= number <= 90.0]
    if not numbers:
        return None
    if len(numbers) == 1:
        return (numbers[0], numbers[0])
    first, second = numbers[0], numbers[1]
    if first > second:
        first, second = second, first
    if abs(first - second) < 0.5:
        second = min(89.5, first + 0.5)
    return (first, second)


#: palette control path -> accepted palette kinds
PALETTE_RULES = {
    "style.palette": ("categorical",),
    "style.paletteSequential": ("sequential",),
    "style.paletteDiverging": ("diverging",),
    "map.colorbar.palette": ("sequential", "diverging"),
    "map.choropleth.palette": ("sequential", "diverging", "categorical"),
}
PALETTE_OPTIONAL = {"map.colorbar.palette", "map.choropleth.palette"}


def _validate_palettes(spec: Dict[str, Any], ctx: Ctx) -> None:
    from . import palettes as palette_store

    if not palette_store.all_palettes():  # data file missing -> legacy cmap only
        ctx.log("palettes.json 不可用，配色回退为 cmap")
        return
    for path, allowed in PALETTE_RULES.items():
        current = get_path(spec, path)
        text = "" if current is None else str(current).strip()
        fallback = get_path(default_spec(), path)
        if not text:
            if path in PALETTE_OPTIONAL:
                set_path(spec, path, "")
            else:
                set_path(spec, path, fallback)
            continue
        entry = palette_store.by_id(text)
        if entry is None:
            ctx.warn("配色 %s=%r 不在 palettes.json 中，已回退为 %r"
                     % (path, text, fallback))
            set_path(spec, path, fallback)
            continue
        if allowed and entry.get("kind") not in allowed:
            ctx.warn("配色 %s=%r 属于 %s 类型，不适用于该位置，已回退为 %r"
                     % (path, text, entry.get("kind"), fallback))
            set_path(spec, path, fallback)


def _map_colorbar_fmt(value: Any) -> str:
    """Tolerate ``fmt``-style overrides such as ``"%.2f"``."""
    text = str(value).strip()
    mapping = {
        "%.2f": "two_decimal", "%.1f": "one_decimal", "%.0f": "integer",
        "%d": "integer", "%.3f": "two_decimal", "%.2e": "scientific",
        "%.1e": "scientific", "g": "auto", "%g": "auto",
    }
    if text in mapping:
        return mapping[text]
    return text if text in ("auto", "integer", "one_decimal", "two_decimal",
                            "scientific", "percent") else "auto"


def _raw_panels(raw: Dict[str, Any]) -> List[Any]:
    """Read ``panels`` from the top level or from ``compose.panels``."""
    candidates = []
    top = raw.get("panels")
    if isinstance(top, list):
        candidates = top
    elif isinstance(raw.get("compose"), dict):
        inner = raw["compose"].get("panels")
        if isinstance(inner, list):
            candidates = inner
    return candidates


def _clamp_number(value: Any, lo: float, hi: float, fallback: float) -> float:
    number = _to_number(value)
    if number is None:
        return fallback
    return float(max(lo, min(hi, number)))


def _resolve_extent_heuristic(spec: Dict[str, Any], raw: Dict[str, Any], ctx: Ctx) -> None:
    """Deprecated: named presets now always win over explicit bounds.

    Kept as a no-op for older callers; see ``normalize`` for the contract rule.
    """
    if spec["map"].get("extentPreset") not in EXTENT_PRESETS:
        spec["map"]["extentPreset"] = "custom"


def resolve_extent(spec: Dict[str, Any]) -> Tuple[float, float, float, float]:
    """Return ``(lon_min, lon_max, lat_min, lat_max)`` for the current spec."""
    map_spec = spec.get("map", {})
    preset = map_spec.get("extentPreset", "custom")
    if preset in EXTENT_PRESETS:
        lon_min, lon_max, lat_min, lat_max = EXTENT_PRESETS[preset]
    else:
        lon_min = _to_number(map_spec.get("extentLonMin")) or -180.0
        lon_max = _to_number(map_spec.get("extentLonMax")) or 180.0
        lat_min = _to_number(map_spec.get("extentLatMin")) or -60.0
        lat_max = _to_number(map_spec.get("extentLatMax")) or 84.0
    lon_min = max(-360.0, min(360.0, lon_min))
    lon_max = max(-360.0, min(360.0, lon_max))
    lat_min = max(-90.0, min(90.0, lat_min))
    lat_max = max(-90.0, min(90.0, lat_max))
    if lon_min >= lon_max:
        lon_min, lon_max = lon_max, lon_min
    if lat_min >= lat_max:
        lat_min, lat_max = lat_max, lat_min
    if lon_max - lon_min < 0.05:
        lon_max = lon_min + 0.05
    if lat_max - lat_min < 0.05:
        lat_max = lat_min + 0.05
    return float(lon_min), float(lon_max), float(lat_min), float(lat_max)


def validate_report(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Structural validation used by ``scifig.cli validate``."""
    ctx = Ctx()
    report: Dict[str, Any] = {"ok": True, "warnings": [], "unknownPaths": [], "kind": None}
    try:
        flat_raw = flatten(raw)
        known = set(flatten(default_spec()).keys())
        report["unknownPaths"] = sorted(
            p for p in flat_raw if p not in known and p not in ("panels", "compose.panels")
        )
        spec = normalize(raw, ctx)
        report["kind"] = spec["kind"]
        report["resolvedPaths"] = len(flatten(spec))
        report["warnings"] = list(ctx.warnings)
    except Exception as exc:  # noqa: BLE001 - report, never raise
        report["ok"] = False
        report["error"] = "%s: %s" % (type(exc).__name__, exc)
        report["warnings"] = list(ctx.warnings)
    return report
