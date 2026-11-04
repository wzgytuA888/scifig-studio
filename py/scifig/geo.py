"""Vector data (GeoJSON / Shapefile / GPKG) loading helpers."""

from __future__ import annotations

import os
from typing import Any, Optional

import pandas as pd

from .log import Ctx


def read_geodataframe(path: str, ctx: Ctx) -> Any:
    """Read a vector file into a WGS84 GeoDataFrame."""
    if not os.path.exists(path):
        raise FileNotFoundError("矢量数据文件不存在：%s" % path)
    try:
        import geopandas as gpd
    except Exception as exc:  # pragma: no cover - geopandas is installed
        raise ValueError("当前环境缺少 geopandas，无法读取矢量数据：%s" % exc) from exc
    try:
        frame = gpd.read_file(path)
    except Exception as exc:  # noqa: BLE001
        raise ValueError("无法读取矢量文件 %s：%s" % (path, exc)) from exc
    if frame.empty:
        raise ValueError("矢量文件没有要素：%s" % path)
    try:
        if frame.crs is None:
            ctx.warn("矢量数据没有 CRS，按 WGS84(EPSG:4326) 处理")
        elif frame.crs.to_epsg() != 4326:
            frame = frame.to_crs(epsg=4326)
            ctx.info("矢量数据 CRS 已转换为 EPSG:4326")
    except Exception as exc:  # noqa: BLE001
        ctx.warn("矢量数据 CRS 转换失败，按原始坐标处理：%s" % exc)
    return frame
