"""Data loading + column inference.

The host sends ``data.source`` (csv / tsv / xlsx / json / geojson / gpkg) plus
optional explicit column names (``data.x`` / ``data.y`` / ``data.lat`` …).
When a name is ``"auto"`` (default) the column is inferred heuristically.
Every inference rule is documented in ``docs/SPEC.md``.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from .log import Ctx
from .paths import get_path

ENCODINGS = ("utf-8-sig", "utf-8", "gbk", "gb18030", "latin-1")

LON_KEYS = ["lon", "lng", "long", "longitude", "经度", "经", "xcoord", "x_coord"]
LAT_KEYS = ["lat", "latitude", "纬度", "纬", "ycoord", "y_coord"]
VALUE_KEYS = [
    "value", "val", "数值", "值", "z", "data", "含量", "浓度", "面积", "统计值",
    "mean", "mean_value", "ndvi", "index", "指标", "score", "得分",
]
LABEL_KEYS = ["label", "name", "名称", "地名", "站点", "station", "site", "id", "编号", "区域"]
GROUP_KEYS = ["group", "category", "类别", "分组", "类型", "class", "type", "item", "项目", "系列"]
X_KEYS = ["x", "year", "年份", "date", "日期", "时间", "time", "month", "月份", "period", "时期"]
Y_KEYS = ["y", "value", "数值", "指标"]
#: first-column names that usually act as a row/index label (heatmap etc.)
ROW_HINTS = ["月份", "月", "年份", "年", "日期", "时间", "时段", "id", "编号", "名称",
             "name", "row", "rowname", "index", "站点", "站"]

RESERVED_FOR_MAP = set(LON_KEYS + LAT_KEYS)


def resolve_path(source: str, workdir: Optional[str]) -> str:
    """Resolve ``data.source`` against the render ``workdir``."""
    if not source:
        return ""
    source = os.path.expanduser(str(source).strip().strip('"').strip("'"))
    if os.path.isabs(source):
        return os.path.normpath(source)
    base = workdir or os.getcwd()
    return os.path.normpath(os.path.join(base, source))


def _norm(name: Any) -> str:
    text = str(name).strip().lower()
    for ch in (" ", "\t", "-", "_", "（", "）", "(", ")", ":", "：", ".", "/"):
        text = text.replace(ch, "")
    return text


def _match_column(columns: List[str], keys: List[str]) -> Optional[str]:
    """Return the column best matching *keys* (exact, then startswith, then contains)."""
    normed = {col: _norm(col) for col in columns}
    for key in keys:
        key_n = _norm(key)
        for col, col_n in normed.items():
            if col_n == key_n:
                return col
    for key in keys:
        key_n = _norm(key)
        for col, col_n in normed.items():
            if col_n.startswith(key_n) or key_n.startswith(col_n):
                return col
    for key in keys:
        key_n = _norm(key)
        for col, col_n in normed.items():
            if key_n in col_n:
                return col
    return None


def _read_csv(path: str) -> pd.DataFrame:
    last_error: Optional[Exception] = None
    for encoding in ENCODINGS:
        try:
            for sep in (None, ",", "\t", ";", "|"):
                try:
                    frame = pd.read_csv(path, encoding=encoding, sep=sep, engine="python")
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    continue
                if frame.shape[1] > 1:
                    return frame
            frame = pd.read_csv(path, encoding=encoding, engine="python")
            return frame
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    raise ValueError("无法解析表格文件 %s（%s）" % (path, last_error))


def read_table(path: str, sheet: str = "", ctx: Optional[Ctx] = None) -> pd.DataFrame:
    """Read csv / tsv / txt / xlsx / json into a DataFrame."""
    ctx = ctx or Ctx()
    if not os.path.exists(path):
        raise FileNotFoundError("数据文件不存在：%s" % path)
    ext = os.path.splitext(path)[1].lower()
    if ext in (".xlsx", ".xls", ".xlsm"):
        try:
            frame = pd.read_excel(path, sheet_name=sheet or 0)
        except Exception as exc:  # noqa: BLE001
            raise ValueError("无法读取 Excel 文件 %s：%s" % (path, exc)) from exc
    elif ext in (".json",):
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        if isinstance(payload, list):
            frame = pd.DataFrame(payload)
        elif isinstance(payload, dict) and "data" in payload and isinstance(payload["data"], list):
            frame = pd.DataFrame(payload["data"])
        else:
            raise ValueError("JSON 数据不是表格结构（需要数组或 {data:[...]}）：%s" % path)
    elif ext in (".geojson",):
        from .geo import read_geodataframe

        frame = read_geodataframe(path, ctx)
    else:
        frame = _read_csv(path)
    if frame.empty:
        raise ValueError("数据文件为空：%s" % path)
    frame = frame.dropna(axis=1, how="all")
    if frame.shape[1] == 0:
        raise ValueError("数据文件没有可用列：%s" % path)
    frame.columns = [str(c) for c in frame.columns]
    return frame


def _numeric_columns(frame: pd.DataFrame) -> List[str]:
    cols = []
    for col in frame.columns:
        series = frame[col]
        if pd.api.types.is_numeric_dtype(series):
            cols.append(col)
        else:
            converted = pd.to_numeric(series, errors="coerce")
            if converted.notna().mean() >= 0.9:
                frame[col] = converted
                cols.append(col)
    return cols


def _categorical_columns(frame: pd.DataFrame) -> List[str]:
    numeric = set(_numeric_columns(frame))
    return [c for c in frame.columns if c not in numeric]


def _explicit(value: Any) -> Optional[str]:
    """``"auto"`` / ``""`` / ``None`` -> None (means: infer)."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ("auto", "自动", "none", "null"):
        return None
    return text


def _pick(frame: pd.DataFrame, explicit: Any, kind: str, ctx: Ctx, keys: Dict[str, List[str]]) -> Optional[str]:
    name = _explicit(explicit)
    if name:
        if name in frame.columns:
            return name
        lower = {str(c).lower(): c for c in frame.columns}
        if name.lower() in lower:
            return lower[name.lower()]
        ctx.warn("指定的列 %r 不存在，已改为自动推断" % name)
    return _match_column(list(frame.columns), keys.get(kind, []))


# ---------------------------------------------------------------------------
# map
# ---------------------------------------------------------------------------
def map_data(spec: Dict, workdir: Optional[str], ctx: Ctx) -> Dict[str, Any]:
    data = spec["data"]
    source = resolve_path(data.get("source", ""), workdir)
    if not source:
        ctx.warn("未提供 data.source，仅绘制底图（无数据图层）")
        return {"points": None, "frame": None, "geometry": None, "value": None,
                "label": None, "lon": None, "lat": None}
    ext = os.path.splitext(source)[1].lower()
    if ext in (".geojson", ".shp", ".gpkg", ".json"):
        from .geo import read_geodataframe

        frame = read_geodataframe(source, ctx)
        geom_col = "geometry" if "geometry" in frame.columns else None
        if geom_col is None:
            raise ValueError("矢量文件没有 geometry 列：%s" % source)
        value = _pick(frame, data.get("value"), "value", ctx,
                      {"value": VALUE_KEYS})
        label = _pick(frame, data.get("label"), "label", ctx,
                      {"label": LABEL_KEYS})
        if value is None:
            numeric = _numeric_columns(frame)
            value = numeric[0] if numeric else None
        if value is None:
            ctx.warn("矢量数据里找不到数值列，分级设色将使用单色")
        return {"points": None, "frame": frame, "geometry": geom_col,
                "value": value, "label": label, "lon": None, "lat": None,
                "source": source}

    frame = read_table(source, str(data.get("sheet") or ""), ctx)
    lon = _pick(frame, data.get("lon"), "lon", ctx, {"lon": LON_KEYS})
    lat = _pick(frame, data.get("lat"), "lat", ctx, {"lat": LAT_KEYS})
    if lon is None or lat is None:
        raise ValueError(
            "地图数据需要经度/纬度列（未找到）：现有列 %s" % ", ".join(map(str, frame.columns))
        )
    value = _pick(frame, data.get("value"), "value", ctx, {"value": VALUE_KEYS})
    if value is None:
        numeric = [c for c in _numeric_columns(frame) if c not in (lon, lat)]
        value = numeric[0] if numeric else None
    label = _pick(frame, data.get("label"), "label", ctx, {"label": LABEL_KEYS})
    if label is None:
        for col in frame.columns:
            if col not in (lon, lat) and col != value:
                label = col
                break
    return {"points": frame, "frame": frame, "geometry": None, "value": value,
            "label": label, "lon": lon, "lat": lat, "source": source}


# ---------------------------------------------------------------------------
# line / scatter / heatmap / box / bar
# ---------------------------------------------------------------------------
def _numeric_frame(frame: pd.DataFrame) -> pd.DataFrame:
    _numeric_columns(frame)
    keep = {}
    for col in frame.columns:
        if pd.api.types.is_numeric_dtype(frame[col]):
            keep[col] = frame[col]
    return pd.DataFrame(keep)


def line_data(spec: Dict, workdir: Optional[str], ctx: Ctx) -> Dict[str, Any]:
    data = spec["data"]
    source = resolve_path(data.get("source", ""), workdir)
    if not source:
        raise ValueError("折线图需要 data.source 数据文件")
    frame = read_table(source, str(data.get("sheet") or ""), ctx)
    numeric = _numeric_frame(frame)

    x_name = _pick(frame, data.get("x"), "x", ctx, {"x": X_KEYS})
    if x_name is None:
        non_numeric = [c for c in frame.columns if c not in numeric.columns]
        x_name = non_numeric[0] if non_numeric else frame.columns[0]

    y_explicit = _explicit(data.get("y"))
    if y_explicit:
        wanted = [part.strip() for part in str(y_explicit).replace("；", ",").replace(";", ",").split(",")]
        y_names = [c for c in wanted if c in frame.columns]
        missing = [c for c in wanted if c not in frame.columns]
        if missing:
            ctx.warn("指定的 y 列不存在：%s" % ", ".join(missing))
    else:
        y_names = [c for c in numeric.columns if c != x_name]
    if not y_names:
        raise ValueError("折线图找不到数值列（y）")

    y2_explicit = _explicit(spec["line"].get("y2"))
    y2_names: List[str] = []
    if spec["line"].get("dualAxis"):
        if y2_explicit:
            y2_names = [c for c in str(y2_explicit).split(",") if c.strip() in frame.columns]
        if not y2_names:
            y2_names = list(y_names[-1:])
            y_names = y_names[:-1] if len(y_names) > 1 else y_names
            ctx.warn("启用双轴但未指定 line.y2，已把最后一列 %r 放到右轴" % (y2_names[0] if y2_names else ""))

    x_values = frame[x_name]
    if not pd.api.types.is_numeric_dtype(x_values):
        x_values = pd.to_numeric(x_values, errors="ignore")
    return {
        "frame": frame,
        "x": x_values,
        "xName": x_name,
        "series": [(name, frame[name].to_numpy(dtype=float)) for name in y_names],
        "series2": [(name, frame[name].to_numpy(dtype=float)) for name in y2_names],
        "source": source,
    }


def scatter_data(spec: Dict, workdir: Optional[str], ctx: Ctx) -> Dict[str, Any]:
    data = spec["data"]
    source = resolve_path(data.get("source", ""), workdir)
    if not source:
        raise ValueError("散点图需要 data.source 数据文件")
    frame = read_table(source, str(data.get("sheet") or ""), ctx)
    numeric = _numeric_frame(frame)
    x_name = _pick(frame, data.get("x"), "x", ctx, {"x": X_KEYS})
    y_name = _pick(frame, data.get("y"), "y", ctx, {"y": Y_KEYS})
    candidates = list(numeric.columns)
    if x_name is None:
        x_name = candidates[0] if candidates else None
    if y_name is None:
        y_name = next((c for c in candidates if c != x_name), None)
    if x_name is None or y_name is None:
        raise ValueError("散点图需要两个数值列（x, y）")
    color_name = _pick(frame, spec["scatter"].get("colorBy") or data.get("group"), "group", ctx,
                       {"group": GROUP_KEYS}) if (spec["scatter"].get("colorBy") or data.get("group")) else None
    return {
        "frame": frame,
        "x": frame[x_name].to_numpy(dtype=float),
        "y": frame[y_name].to_numpy(dtype=float),
        "xName": x_name,
        "yName": y_name,
        "group": frame[color_name] if color_name else None,
        "groupName": color_name,
        "source": source,
    }


def bar_data(spec: Dict, workdir: Optional[str], ctx: Ctx) -> Dict[str, Any]:
    data = spec["data"]
    source = resolve_path(data.get("source", ""), workdir)
    if not source:
        raise ValueError("柱状图需要 data.source 数据文件")
    frame = read_table(source, str(data.get("sheet") or ""), ctx)
    numeric = _numeric_frame(frame)
    categorical = _categorical_columns(frame)
    group_explicit = _explicit(data.get("group"))
    value_explicit = _explicit(data.get("value"))

    if group_explicit and value_explicit and len(categorical) >= 2:
        # long format: group | series | value
        series_col = next((c for c in categorical if c != group_explicit), None)
        if series_col:
            pivot = frame.pivot_table(index=group_explicit, columns=series_col,
                                      values=value_explicit, aggfunc="mean")
            categories = [str(v) for v in pivot.index]
            series = [(str(col), pivot[col].to_numpy(dtype=float)) for col in pivot.columns]
            return {"categories": categories, "series": series,
                    "xName": group_explicit, "yName": value_explicit, "source": source,
                    "frame": frame}

    cat = _pick(frame, data.get("group"), "group", ctx, {"group": GROUP_KEYS})
    if cat is None:
        cat = _pick(frame, data.get("x"), "x", ctx, {"x": X_KEYS})
    if cat is None:
        cat = categorical[0] if categorical else frame.columns[0]
    if value_explicit:
        cols = [c for c in [p.strip() for p in str(value_explicit).split(",")] if c in frame.columns]
    else:
        cols = [c for c in numeric.columns if c != cat]
    if not cols:
        raise ValueError("柱状图找不到数值列")
    categories = [str(v) for v in frame[cat].tolist()]
    series = [(col, frame[col].to_numpy(dtype=float)) for col in cols]
    return {"categories": categories, "series": series, "xName": cat,
            "yName": ", ".join(cols), "source": source, "frame": frame}


def heatmap_data(spec: Dict, workdir: Optional[str], ctx: Ctx) -> Dict[str, Any]:
    data = spec["data"]
    source = resolve_path(data.get("source", ""), workdir)
    if not source:
        raise ValueError("热力图需要 data.source 数据文件")
    frame = read_table(source, str(data.get("sheet") or ""), ctx)
    numeric = _numeric_frame(frame)
    x_explicit = _explicit(data.get("x"))
    y_explicit = _explicit(data.get("y"))
    value_explicit = _explicit(data.get("value"))

    # --- long format: explicit row / column / value columns -----------------
    if x_explicit and y_explicit and value_explicit \
            and x_explicit in frame.columns and y_explicit in frame.columns \
            and value_explicit in frame.columns:
        rows = [str(v) for v in dict.fromkeys(frame[y_explicit].tolist())]
        cols = [str(v) for v in dict.fromkeys(frame[x_explicit].tolist())]
        matrix = np.full((len(rows), len(cols)), np.nan)
        row_index = {v: i for i, v in enumerate(rows)}
        col_index = {v: i for i, v in enumerate(cols)}
        for _, row in frame.iterrows():
            try:
                matrix[row_index[str(row[y_explicit])], col_index[str(row[x_explicit])]] = float(row[value_explicit])
            except (KeyError, TypeError, ValueError):
                continue
        return {"matrix": matrix, "rows": rows, "cols": cols,
                "rowName": y_explicit, "colName": x_explicit, "source": source}

    # --- wide matrix: optional first label column + numeric columns ---------
    index_name: Optional[str] = None
    if y_explicit and y_explicit in frame.columns:
        index_name = y_explicit
    else:
        first = str(frame.columns[0])
        if _norm(first) in {_norm(hint) for hint in ROW_HINTS}:
            index_name = first
        elif not pd.api.types.is_numeric_dtype(frame[first].dropna()):
            # a text label column on the left is the row index
            index_name = first
    value_columns = [c for c in numeric.columns if c != index_name]
    if not value_columns:
        raise ValueError("热力图找不到数值列")
    matrix = frame[value_columns].to_numpy(dtype=float)
    rows = [str(v) for v in frame[index_name].tolist()] if index_name \
        else [str(index + 1) for index in range(len(frame))]
    cols = [str(c) for c in value_columns]
    return {"matrix": matrix, "rows": rows, "cols": cols,
            "rowName": index_name or "", "colName": "", "source": source}


def box_data(spec: Dict, workdir: Optional[str], ctx: Ctx) -> Dict[str, Any]:
    data = spec["data"]
    source = resolve_path(data.get("source", ""), workdir)
    if not source:
        raise ValueError("箱线图需要 data.source 数据文件")
    frame = read_table(source, str(data.get("sheet") or ""), ctx)
    numeric = _numeric_frame(frame)
    categorical = _categorical_columns(frame)
    group_name = _pick(frame, data.get("group"), "group", ctx, {"group": GROUP_KEYS})
    value_name = _pick(frame, data.get("value"), "value", ctx, {"value": VALUE_KEYS})
    if group_name and not value_name:
        numeric_cols = [c for c in numeric.columns if c != group_name]
        if numeric_cols:
            value_name = numeric_cols[0]
    if group_name and value_name:
        groups: Dict[str, List[float]] = {}
        for _, row in frame.iterrows():
            try:
                groups.setdefault(str(row[group_name]), []).append(float(row[value_name]))
            except (TypeError, ValueError):
                continue
        labels = list(groups.keys())
        values = [np.asarray(v, dtype=float) for v in groups.values()]
        return {"labels": labels, "values": values, "groupName": group_name,
                "valueName": value_name, "source": source}
    if not numeric.columns.empty:
        labels = [str(c) for c in numeric.columns]
        values = [frame[c].dropna().to_numpy(dtype=float) for c in numeric.columns]
        return {"labels": labels, "values": values, "groupName": "",
                "valueName": "", "source": source}
    raise ValueError("箱线图需要分组列+数值列，或至少一个数值列")
