"""Self-test harness for the scifig renderer.

Modes (combine with --mode):
    samples      渲染 samples/*.json 全部样例
    controls     遍历 controls.json 每个 path：设值 -> 渲染 -> 校验尺寸/是否生效
    presets      遍历 presets.json 全部期刊风格
    compose      多子图布局变体（optimize/align/shareColorbar/legendPerPanel）
    determinism  同 spec 连续两次渲染，比较 SHA256
    all          以上全部

Usage:
    python tools/selftest.py --mode all --outdir ../out/_selftest
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import traceback
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
PY_DIR = os.path.dirname(HERE)
sys.path.insert(0, PY_DIR)
BUNDLE_DIR = os.path.dirname(PY_DIR)
SAMPLES_DIR = os.path.join(BUNDLE_DIR, "samples")

from scifig import controls  # noqa: E402
from scifig import spec as spec_module  # noqa: E402
from scifig.engine import render_spec  # noqa: E402
from scifig.log import Ctx  # noqa: E402
from scifig.paths import get_path, set_path  # noqa: E402

TEST_DPI = 100

SAMPLE_SPECS = {
    "map": "spec_map.json",
    "map_polygon": "spec_map_polygon.json",
    "line": "spec_line.json",
    "bar": "spec_bar.json",
    "scatter": "spec_scatter.json",
    "heatmap": "spec_heatmap.json",
    "box": "spec_box.json",
    "compose": "spec_compose.json",
    "compose_3panels": "spec_compose_3panels.json",
    "custompatch": "spec_custompatch.json",
}

#: which base sample each control path is exercised on
PATH_KIND = {
    "map.": "map",
    "colorbar.": "map",
    "scaleBar.": "map",
    "northArrow.": "map",
    "point.": "map",
    "label.": "map",
    "choropleth.": "map",
    "legend.": "line",
    "axes.": "line",
    "line.": "line",
    "bar.": "bar",
    "scatter.": "scatter",
    "heatmap.": "heatmap",
    "box.": "box",
    "compose.": "compose",
    "data.": "line",
}

TEXT_VALUES = {
    "title": "自检标题 Title",
    "text.note": "数据来源：自检",
    "axes.xlabel": "年份 Year",
    "axes.ylabel": "数值 Value",
    "axes.y2label": "右轴 Right",
    "line.y2": "年均降水",
    "scatter.colorBy": "区域",
    "legend.title": "图例标题",
    "data.x": "年均降水",
    "data.y": "NDVI",
    "data.group": "土地类型",
    "data.value": "NDVI",
    "data.lat": "纬度",
    "data.lon": "经度",
    "data.sheet": "Sheet1",
    "map.colorbar.label": "自检数值 Value",
    "map.insetLabel": "南海诸岛",
    "map.standardParallels": "30,50",
    "customPatch": ("ax.plot([0.08, 0.92], [0.5, 0.5], transform=ax.transAxes, "
                    "color='#999999', linewidth=0.6)"),
}

#: extra spec tweaks so a control has a chance to be visible
BASE_TWEAKS = {
    "style.line.marker": {"style": {"line": {"marker": "o"}}},
    "style.line.markerSize": {"style": {"line": {"marker": "o"}}},
    "line.cmap": {"data": {"y": "NDVI,年均降水,年均气温"}},
    "line.y2": {"line": {"dualAxis": True}},
    "scatter.colorBy": {"data": {"group": "auto"}},
    "scatter.fit": {"scatter": {"fit": "none"}},
    "style.bar.width": {"kind": "bar", "data": {"source": "bar_grouped.csv",
                                                "group": "土地利用类型"}},
    "legend.ncol": {"legend": {"title": "组别"}},
    "map.point.color": {"map": {"point": {"mode": "fixed"}}},
    "map.label.size": {"map": {"label": {"show": True}}},
    "map.choropleth.classes": {"data": {"source": "map_polygons.geojson",
                                        "value": "soil_salinity", "label": "name"}},
    "map.extentLonMin": {"map": {"extentPreset": "custom"}},
    "map.extentLonMax": {"map": {"extentPreset": "custom"}},
    "map.extentLatMin": {"map": {"extentPreset": "custom"}},
    "map.extentLatMax": {"map": {"extentPreset": "custom"}},
}

NUMBER_VALUES = {
    "figure.widthMm": 160.0,
    "figure.heightMm": 110.0,
    "figure.dpi": 150,
    "map.colorbar.vmin": 0.3,
    "map.colorbar.vmax": 2.8,
    "axes.xMin": 2002.0,
    "axes.xMax": 2018.0,
    "axes.yMin": 0.2,
    "axes.yMax": 0.33,
    "map.extentLonMin": 74.0,
    "map.extentLonMax": 96.0,
    "map.extentLatMin": 35.0,
    "map.extentLatMax": 49.0,
    "map.grid.intervalX": 10.0,
    "map.grid.intervalY": 10.0,
    "map.choropleth.classes": 4,
    "compose.rows": 1,
    "compose.cols": 4,
}


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_sample(name: str) -> Dict[str, Any]:
    path = os.path.join(SAMPLES_DIR, SAMPLE_SPECS[name])
    with open(path, "r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def expected_pixels(spec: Dict[str, Any]) -> Tuple[int, int]:
    width_mm = float(spec.get("figure", {}).get("widthMm", 180))
    height_mm = float(spec.get("figure", {}).get("heightMm", 120))
    dpi = float(spec.get("figure", {}).get("dpi", 300))
    # matplotlib truncates to whole pixels for the Agg canvas
    return (int(width_mm / 25.4 * dpi), int(height_mm / 25.4 * dpi))


def png_size(path: str) -> Tuple[int, int]:
    from PIL import Image

    with Image.open(path) as image:
        return image.size


def kind_for_path(path: str) -> str:
    specific = {
        "data.lat": "map",
        "data.lon": "map",
        "data.value": "map",
        "data.label": "map",
        "data.group": "scatter",
        "data.x": "line",
        "data.y": "line",
        "data.sheet": "line",
        "style.palette": "line",
        "style.paletteSequential": "map_polygon",
        "style.paletteDiverging": "heatmap",
        "map.colorbar.palette": "map",
        "map.choropleth.palette": "map_polygon",
        "map.centralLatitude": "map",
        "map.standardParallels": "map",
    }
    if path in specific:
        return specific[path]
    for prefix, kind in PATH_KIND.items():
        if path.startswith(prefix):
            return kind
    return "line"


def test_value(item: Dict[str, Any], current: Any = None) -> Any:
    path = item["path"]
    kind = item["type"]
    if path in TEXT_VALUES:
        return TEXT_VALUES[path]
    if path in NUMBER_VALUES:
        return NUMBER_VALUES[path]
    if kind == "bool":
        base = current if isinstance(current, bool) else bool(item["default"])
        return not base
    if kind == "color":
        current_color = str(current if current is not None else item["default"]).lower()
        return "#2b6cb0" if current_color != "#2b6cb0" else "#d62728"
    if kind == "enum":
        wildcards = {"auto", "none", "", "custom"}
        options = [option for option in item["options"]
                   if option != current and option != item["default"]
                   and option not in wildcards]
        if not options:
            options = [option for option in item["options"] if option != current]
        if not options:
            options = [option for option in item["options"] if option != item["default"]]
        if not options:
            return item["default"]
        return options[0]
    if kind == "number":
        base = current if current is not None else item["default"]
        if base is None:
            return 1.0
        step = float(item.get("step") or 1.0)
        value = float(base) + step
        low, high = item.get("min"), item.get("max")
        if low is not None:
            value = max(value, float(low))
        if high is not None:
            value = min(value, float(high))
        if abs(value - float(base)) < 1e-9:
            value = float(base) - step
            if low is not None:
                value = max(value, float(low))
        return int(round(value)) if item.get("integer") else value
    return "自检test"


def apply_tweaks(spec: Dict[str, Any], path: str) -> Dict[str, Any]:
    tweak = BASE_TWEAKS.get(path)
    if not tweak:
        return spec
    for group, values in tweak.items():
        if group == "kind":
            spec["kind"] = values
            continue
        if not isinstance(values, dict):
            continue
        for key, value in values.items():
            set_path(spec, "%s.%s" % (group, key), value)
    return spec


def prepare_spec(base_kind: str, dpi: int = TEST_DPI) -> Dict[str, Any]:
    spec = load_sample(base_kind)
    spec.setdefault("figure", {})["dpi"] = dpi
    if isinstance(spec.get("data"), dict) and spec["data"].get("source"):
        spec["data"]["source"] = os.path.join(SAMPLES_DIR, str(spec["data"]["source"]))
    for panel in spec.get("panels", []):
        if isinstance(panel.get("data"), dict) and panel["data"].get("source"):
            panel["data"]["source"] = os.path.join(SAMPLES_DIR, panel["data"]["source"])
    return spec


def render_one(spec: Dict[str, Any], outdir: str, name: str) -> Dict[str, Any]:
    target = os.path.join(outdir, name)
    result = render_spec(spec, target, workdir=SAMPLES_DIR)
    return result


# ---------------------------------------------------------------------------
# modes
# ---------------------------------------------------------------------------
def run_samples(outdir: str) -> Dict[str, Any]:
    results = []
    for name, filename in SAMPLE_SPECS.items():
        path = os.path.join(SAMPLES_DIR, filename)
        with open(path, "r", encoding="utf-8-sig") as handle:
            spec = json.load(handle)
        spec_path = path
        target = os.path.join(outdir, "selftest_%s.png" % name)
        started = time.perf_counter()
        result = render_spec(spec, target, workdir=SAMPLES_DIR, spec_path=spec_path)
        elapsed = int((time.perf_counter() - started) * 1000)
        entry = {"name": name, "ok": bool(result.get("ok")), "ms": elapsed,
                 "png": result.get("png"), "warnings": result.get("warnings", []),
                 "error": result.get("error")}
        if result.get("ok"):
            expected = expected_pixels(spec)
            actual = png_size(result["png"])
            entry["size"] = list(actual)
            entry["sizeOk"] = tuple(actual) == expected
            entry["sha256"] = sha256(result["png"])
        results.append(entry)
    return {"mode": "samples", "results": results,
            "ok": all(item["ok"] and item.get("sizeOk", False) for item in results)}


def run_presets(outdir: str) -> Dict[str, Any]:
    results = []
    base = prepare_spec("line")
    for preset in controls.presets():
        preset_id = preset["id"]
        spec = json.loads(json.dumps(base))
        set_path(spec, "style.preset", preset_id)
        target = os.path.join(outdir, "selftest_preset_%s.png" % preset_id)
        result = render_spec(spec, target, workdir=SAMPLES_DIR)
        entry = {"preset": preset_id, "ok": bool(result.get("ok")),
                 "warnings": result.get("warnings", []), "error": result.get("error")}
        if result.get("ok"):
            entry["size"] = list(png_size(result["png"]))
            entry["sizeOk"] = tuple(png_size(result["png"])) == expected_pixels(spec)
            entry["sha256"] = sha256(result["png"])
        results.append(entry)
    # a map with every preset as well (projection + graticule + colorbar)
    map_base = prepare_spec("map")
    map_results = []
    for preset in controls.presets():
        preset_id = preset["id"]
        spec = json.loads(json.dumps(map_base))
        set_path(spec, "style.preset", preset_id)
        target = os.path.join(outdir, "selftest_preset_map_%s.png" % preset_id)
        result = render_spec(spec, target, workdir=SAMPLES_DIR)
        map_results.append({"preset": preset_id, "ok": bool(result.get("ok")),
                            "error": result.get("error")})
    return {"mode": "presets", "results": results, "mapResults": map_results,
            "ok": all(item["ok"] for item in results) and all(item["ok"] for item in map_results)}


def run_controls(outdir: str) -> Dict[str, Any]:
    items = controls.control_items()
    baselines: Dict[str, str] = {}
    base_specs: Dict[str, Dict[str, Any]] = {}
    for kind in set(kind_for_path(item["path"]) for item in items) | {"line", "map"}:
        spec = prepare_spec(kind)
        base_specs[kind] = spec
        baseline_path = os.path.join(outdir, "selftest_controls_base_%s.png" % kind)
        result = render_spec(spec, baseline_path, workdir=SAMPLES_DIR)
        baselines[kind] = sha256(baseline_path) if result.get("ok") else ""
    failures: List[Dict[str, Any]] = []
    unchanged: List[str] = []
    tested = 0
    for item in items:
        path = item["path"]
        kind = kind_for_path(path)
        spec = json.loads(json.dumps(base_specs[kind]))
        try:
            spec = apply_tweaks(spec, path)
            current = get_path(spec, path)
            value = test_value(item, current)
            set_path(spec, path, value)
            if path == "figure.dpi":
                spec.setdefault("figure", {})["dpi"] = int(value)
            target = os.path.join(outdir, "selftest_controls_tmp.png")
            result = render_spec(spec, target, workdir=SAMPLES_DIR)
            tested += 1
            if not result.get("ok"):
                failures.append({"path": path, "value": value,
                                 "error": result.get("error")})
                continue
            actual = png_size(result["png"])
            if tuple(actual) != expected_pixels(spec):
                failures.append({"path": path, "value": value,
                                 "error": "PNG 尺寸 %s != 期望 %s" % (actual, expected_pixels(spec))})
                continue
            if baselines.get(kind) and sha256(result["png"]) == baselines[kind]:
                unchanged.append(path)
        except Exception as exc:  # noqa: BLE001
            failures.append({"path": path, "error": "%s: %s" % (type(exc).__name__, exc),
                             "trace": traceback.format_exc(limit=2)})
    return {"mode": "controls", "tested": tested,
            "total": len(items), "failures": failures,
            "unchanged": unchanged,
            "ok": not failures}


def run_compose(outdir: str) -> Dict[str, Any]:
    base = prepare_spec("compose")
    variants = []
    configs = [
        ("default", {}),
        ("no_optimize", {"compose": {"optimize": False}}),
        ("align_none", {"compose": {"align": "none"}}),
        ("share_cbar", {"compose": {"shareColorbar": True}}),
        ("no_legend", {"compose": {"legendPerPanel": False}}),
        ("labels_plain", {"compose": {"panelLabel": {"style": "a", "position": "upper right"}}}),
        ("rows_1x4", {"compose": {"rows": 1, "cols": 4}}),
        ("gap_large", {"compose": {"gapXMm": 10, "gapYMm": 10}}),
    ]
    for name, patch in configs:
        spec = json.loads(json.dumps(base))
        for group, values in patch.items():
            for key, value in values.items():
                set_path(spec, "%s.%s" % (group, key), value)
        target = os.path.join(outdir, "selftest_compose_%s.png" % name)
        started = time.perf_counter()
        result = render_spec(spec, target, workdir=SAMPLES_DIR)
        entry = {"name": name, "ok": bool(result.get("ok")),
                 "ms": int((time.perf_counter() - started) * 1000),
                 "warnings": result.get("warnings", []), "error": result.get("error")}
        if result.get("ok"):
            entry["size"] = list(png_size(result["png"]))
            entry["sizeOk"] = tuple(png_size(result["png"])) == expected_pixels(spec)
            entry["sha256"] = sha256(result["png"])
        variants.append(entry)
    return {"mode": "compose", "results": variants,
            "ok": all(item["ok"] and item.get("sizeOk", False) for item in variants)}


def run_determinism(outdir: str) -> Dict[str, Any]:
    checks = []
    for kind in ("line", "heatmap", "map"):
        spec = prepare_spec(kind, dpi=120)
        first = os.path.join(outdir, "selftest_det_%s_1.png" % kind)
        second = os.path.join(outdir, "selftest_det_%s_2.png" % kind)
        result_a = render_spec(spec, first, workdir=SAMPLES_DIR)
        result_b = render_spec(spec, second, workdir=SAMPLES_DIR)
        same = result_a.get("ok") and result_b.get("ok") and sha256(first) == sha256(second)
        checks.append({"kind": kind, "ok": bool(same),
                       "sha256": sha256(first) if result_a.get("ok") else None})
    return {"mode": "determinism", "results": checks,
            "ok": all(item["ok"] for item in checks)}


def run_codegen(outdir: str) -> Dict[str, Any]:
    """Engine render vs generated component.py must be byte-identical."""
    import subprocess

    checks = []
    python = sys.executable
    for kind in ("line", "compose", "map"):
        spec = prepare_spec(kind, dpi=120)
        spec_path = os.path.join(outdir, "selftest_codegen_%s_spec.json" % kind)
        with open(spec_path, "w", encoding="utf-8") as handle:
            json.dump(spec, handle, ensure_ascii=False, indent=2)
        engine_png = os.path.join(outdir, "selftest_codegen_%s_engine.png" % kind)
        code_png = os.path.join(outdir, "selftest_codegen_%s_code.png" % kind)
        component = os.path.join(outdir, "selftest_codegen_%s_component.py" % kind)
        result = render_spec(spec, engine_png, workdir=SAMPLES_DIR, code_out=component)
        if not result.get("ok"):
            checks.append({"kind": kind, "ok": False, "error": result.get("error")})
            continue
        environment = dict(os.environ)
        environment["PYTHONPATH"] = PY_DIR
        process = subprocess.run([python, component, "--out", code_png],
                                 capture_output=True, text=True, env=environment)
        ok = process.returncode == 0 and os.path.exists(code_png)
        identical = ok and sha256(engine_png) == sha256(code_png)
        checks.append({"kind": kind, "ok": bool(identical),
                       "engine": sha256(engine_png) if result.get("ok") else None,
                       "code": sha256(code_png) if ok else None,
                       "stderr": process.stderr[-400:] if process.returncode else ""})
    return {"mode": "codegen", "results": checks,
            "ok": all(item["ok"] for item in checks)}


def run_custompatch(outdir: str) -> Dict[str, Any]:
    spec = prepare_spec("line", dpi=120)
    spec["customPatch"] = TEXT_VALUES["customPatch"]
    good = render_spec(spec, os.path.join(outdir, "selftest_patch_good.png"),
                       workdir=SAMPLES_DIR)
    broken = json.loads(json.dumps(spec))
    broken["customPatch"] = "def broken(:"
    bad = render_spec(broken, os.path.join(outdir, "selftest_patch_broken.png"),
                      workdir=SAMPLES_DIR)
    ok = bool(good.get("ok")) and bool(bad.get("ok")) and any(
        "customPatch" in warning for warning in bad.get("warnings", []))
    return {"mode": "custompatch", "ok": ok,
            "good": good.get("ok"), "brokenStillRenders": bad.get("ok"),
            "brokenWarnings": bad.get("warnings", [])}


def run_palettes(outdir: str) -> Dict[str, Any]:
    """Render every PPT palette once (categorical -> line, bands -> choropleth)."""
    from scifig import palettes as palette_store

    results: List[Dict[str, Any]] = []
    hashes = set()
    line_base = prepare_spec("line", dpi=100)
    poly_base = prepare_spec("map_polygon", dpi=100)
    for palette in palette_store.all_palettes():
        palette_id = palette["id"]
        kind = palette["kind"]
        spec = json.loads(json.dumps(line_base if kind == "categorical" else poly_base))
        if kind == "categorical":
            set_path(spec, "style.palette", palette_id)
        elif kind == "sequential":
            set_path(spec, "style.paletteSequential", palette_id)
            set_path(spec, "map.choropleth.palette", palette_id)
        else:
            set_path(spec, "style.paletteDiverging", palette_id)
            set_path(spec, "map.choropleth.palette", palette_id)
        target = os.path.join(outdir, "selftest_palette_%s.png" % palette_id)
        result = render_spec(spec, target, workdir=SAMPLES_DIR)
        entry = {"id": palette_id, "kind": kind, "ok": bool(result.get("ok")),
                 "warnings": result.get("warnings", []), "error": result.get("error")}
        if result.get("ok"):
            digest = sha256(result["png"])
            entry["sha256"] = digest
            hashes.add(digest)
        results.append(entry)
    ok = all(item["ok"] for item in results)
    return {"mode": "palettes", "count": len(results),
            "uniqueImages": len(hashes), "results": results, "ok": ok}


def run_projections(outdir: str) -> Dict[str, Any]:
    """Render every map projection once and ensure each changes the image."""
    from scifig.charts.mapchart import PROJECTIONS

    base = prepare_spec("map_polygon", dpi=100)
    results: List[Dict[str, Any]] = []
    hashes = set()
    for projection in PROJECTIONS:
        spec = json.loads(json.dumps(base))
        set_path(spec, "map.projection", projection)
        target = os.path.join(outdir, "selftest_projection_%s.png" % projection)
        result = render_spec(spec, target, workdir=SAMPLES_DIR)
        entry = {"projection": projection, "ok": bool(result.get("ok")),
                 "warnings": result.get("warnings", []), "error": result.get("error")}
        if result.get("ok"):
            digest = sha256(result["png"])
            entry["sha256"] = digest
            hashes.add(digest)
        results.append(entry)
    ok = all(item["ok"] for item in results) and len(hashes) == len(results)
    return {"mode": "projections", "count": len(results),
            "uniqueImages": len(hashes), "results": results, "ok": ok}


def run_autoadjust(outdir: str) -> Dict[str, Any]:
    """Auto improvements must go to ``autoAdjust``; real risks stay in ``warnings``."""
    checks: List[Dict[str, Any]] = []

    def auto_keys(result: Dict[str, Any]) -> List[str]:
        return [str(item.get("key")) for item in result.get("autoAdjust", [])]

    def auto_messages(result: Dict[str, Any]) -> List[str]:
        return [str(item.get("message")) for item in result.get("autoAdjust", [])]

    # 1) central meridian aligned to the study area (the user's complaint)
    spec = prepare_spec("map_polygon", dpi=TEST_DPI)
    set_path(spec, "map.centralLongitude", 105.0)
    set_path(spec, "map.extentPreset", "xinjiang")
    result = render_spec(spec, os.path.join(outdir, "selftest_auto_center.png"),
                         workdir=SAMPLES_DIR)
    messages = auto_messages(result)
    checks.append({
        "case": "centralLongitude",
        "ok": "centralLongitude" in auto_keys(result)
        and any("中央经线" in message for message in messages)
        and not any("中央经线" in warning for warning in result.get("warnings", [])),
        "autoAdjust": result.get("autoAdjust"),
        "warnings": result.get("warnings"),
    })

    # 2) corner fill + graticule interval on a conic map
    spec = prepare_spec("map", dpi=TEST_DPI)
    result = render_spec(spec, os.path.join(outdir, "selftest_auto_map.png"),
                         workdir=SAMPLES_DIR)
    checks.append({
        "case": "cornerFill+graticule",
        "ok": {"cornerFill", "graticuleIntervalX"} <= set(auto_keys(result))
        and not any("四角" in warning or "间隔" in warning
                    for warning in result.get("warnings", [])),
        "autoKeys": auto_keys(result),
    })

    # 3) scale bar degradation -> autoAdjust, not warning
    spec = prepare_spec("map", dpi=TEST_DPI)
    set_path(spec, "figure.widthMm", 90.0)
    set_path(spec, "figure.heightMm", 70.0)
    set_path(spec, "map.scaleBar.show", True)
    set_path(spec, "map.scaleBar.lengthKm", 5000)
    result = render_spec(spec, os.path.join(outdir, "selftest_auto_scalebar.png"),
                         workdir=SAMPLES_DIR)
    checks.append({
        "case": "scaleBar",
        "ok": any(key.startswith("scaleBar") for key in auto_keys(result))
        and not any("比例尺" in warning for warning in result.get("warnings", [])),
        "autoKeys": auto_keys(result),
    })

    # 4) crowded category labels -> rotation / font autoAdjust
    spec = prepare_spec("bar", dpi=TEST_DPI)
    set_path(spec, "figure.widthMm", 70.0)
    result = render_spec(spec, os.path.join(outdir, "selftest_auto_categories.png"),
                         workdir=SAMPLES_DIR)
    checks.append({
        "case": "categoricalLabels",
        "ok": any(key.startswith("categorical") for key in auto_keys(result)),
        "autoKeys": auto_keys(result),
        "warnings": result.get("warnings"),
    })

    # 5) a genuinely bad value must still be a warning, not an autoAdjust
    spec = prepare_spec("line", dpi=TEST_DPI)
    set_path(spec, "style.palette", "ppt-99")
    result = render_spec(spec, os.path.join(outdir, "selftest_auto_badpalette.png"),
                         workdir=SAMPLES_DIR)
    checks.append({
        "case": "badPaletteStaysWarning",
        "ok": any("style.palette" in warning for warning in result.get("warnings", []))
        and not any("配色" in message for message in auto_messages(result)),
        "warnings": result.get("warnings"),
    })

    ok = all(item["ok"] for item in checks)
    return {"mode": "autoadjust", "checks": checks, "ok": ok}


MODES = {
    "samples": run_samples,
    "presets": run_presets,
    "controls": run_controls,
    "palettes": run_palettes,
    "projections": run_projections,
    "compose": run_compose,
    "determinism": run_determinism,
    "codegen": run_codegen,
    "custompatch": run_custompatch,
    "autoadjust": run_autoadjust,
}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="scifig renderer self-test")
    parser.add_argument("--mode", default="all",
                        help="samples|controls|presets|compose|determinism|codegen|custompatch|all")
    parser.add_argument("--outdir", default=os.path.join(BUNDLE_DIR, "out", "_selftest"))
    parser.add_argument("--json", default=None, help="把完整报告写入该 JSON 文件")
    args = parser.parse_args(argv)
    outdir = os.path.abspath(args.outdir)
    os.makedirs(outdir, exist_ok=True)
    selected = list(MODES) if args.mode == "all" else [args.mode]
    report: Dict[str, Any] = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
                              "modes": {}}
    overall_ok = True
    for mode in selected:
        if mode not in MODES:
            print("未知模式：%s" % mode, file=sys.stderr)
            return 2
        started = time.perf_counter()
        try:
            result = MODES[mode](outdir)
        except Exception as exc:  # noqa: BLE001 - report, never crash
            result = {"mode": mode, "ok": False,
                      "error": "%s: %s" % (type(exc).__name__, exc),
                      "trace": traceback.format_exc(limit=4)}
        result["ms"] = int((time.perf_counter() - started) * 1000)
        report["modes"][mode] = result
        overall_ok = overall_ok and bool(result.get("ok"))
        print("[%s] %s (%d ms)" % (mode, "OK" if result.get("ok") else "FAIL", result["ms"]),
              file=sys.stderr)
        if mode == "controls":
            print("  遍历 %d/%d 个参数，失败 %d，无视觉变化 %d" % (
                result.get("tested", 0), result.get("total", 0),
                len(result.get("failures", [])), len(result.get("unchanged", []))),
                file=sys.stderr)
            for failure in result.get("failures", [])[:20]:
                print("  FAIL %s = %r -> %s" % (failure.get("path"), failure.get("value"),
                                                failure.get("error")), file=sys.stderr)
        elif mode == "samples":
            for item in result.get("results", []):
                print("  %-14s ok=%s %s%s" % (
                    item["name"], item["ok"], item.get("size"),
                    "" if item.get("sizeOk") else " SIZE-MISMATCH"), file=sys.stderr)
        elif mode == "codegen":
            for item in result.get("results", []):
                print("  %-10s identical=%s" % (item["kind"], item.get("ok")), file=sys.stderr)
        elif mode == "palettes":
            print("  配色 %d 套，唯一出图 %d 张" % (
                result.get("count", 0), result.get("uniqueImages", 0)), file=sys.stderr)
            for item in result.get("results", []):
                if not item.get("ok"):
                    print("  FAIL %s (%s) -> %s" % (item["id"], item["kind"],
                                                    item.get("error")), file=sys.stderr)
        elif mode == "projections":
            print("  投影 %d 种，唯一出图 %d 张" % (
                result.get("count", 0), result.get("uniqueImages", 0)), file=sys.stderr)
            for item in result.get("results", []):
                if not item.get("ok"):
                    print("  FAIL %s -> %s" % (item["projection"], item.get("error")),
                          file=sys.stderr)
    report["ok"] = overall_ok
    if args.json:
        with open(os.path.abspath(args.json), "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps({mode: report["modes"][mode].get("ok") for mode in selected},
                     ensure_ascii=False))
    return 0 if overall_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
