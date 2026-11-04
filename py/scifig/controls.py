"""Loading of the self-describing control/preset catalogues.

``controls.json`` is the single source of truth for parameter types, ranges,
enum options and aliases.  The renderer only uses it for *validation and
coercion* -- every control path must exist in :data:`scifig.defaults.DEFAULT_SPEC`.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

_HERE = os.path.dirname(os.path.abspath(__file__))
CONTROLS_PATH = os.path.join(_HERE, "controls.json")
PRESETS_PATH = os.path.join(_HERE, "presets.json")

_cache: Dict[str, Any] = {}


def _read_json(path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as exc:  # pragma: no cover - build error
        raise RuntimeError("损坏的 JSON: %s (%s)" % (path, exc)) from exc


def controls_doc() -> Dict[str, Any]:
    """Raw ``controls.json`` document (``{}`` when missing)."""
    if "controls" not in _cache:
        _cache["controls"] = _read_json(CONTROLS_PATH) or {}
    return _cache["controls"]


def presets_doc() -> Dict[str, Any]:
    """Raw ``presets.json`` document (``{}`` when missing)."""
    if "presets" not in _cache:
        _cache["presets"] = _read_json(PRESETS_PATH) or {}
    return _cache["presets"]


def control_items() -> List[Dict[str, Any]]:
    """Flat list of control items in document order."""
    items: List[Dict[str, Any]] = []
    for group in controls_doc().get("groups", []):
        for item in group.get("items", []):
            path = item.get("path")
            if not path:
                continue
            entry = dict(item)
            entry.setdefault("_group", group.get("id"))
            items.append(entry)
    return items


def control_index() -> Dict[str, Dict[str, Any]]:
    """``{path: control}`` map."""
    if "index" not in _cache:
        _cache["index"] = {item["path"]: item for item in control_items()}
    return _cache["index"]


def groups() -> List[Dict[str, Any]]:
    return list(controls_doc().get("groups", []))


def presets() -> List[Dict[str, Any]]:
    return list(presets_doc().get("presets", []))


def preset_index() -> Dict[str, Dict[str, Any]]:
    if "preset_index" not in _cache:
        _cache["preset_index"] = {p["id"]: p for p in presets() if p.get("id")}
    return _cache["preset_index"]


def preset_values(preset_id: str) -> Dict[str, Any]:
    preset = preset_index().get(preset_id)
    return dict(preset.get("values", {})) if preset else {}


def default_preset_id() -> str:
    ids = [p["id"] for p in presets() if p.get("id")]
    return ids[0] if ids else "sci"


def control_paths() -> List[str]:
    return [item["path"] for item in control_items()]


def reset_cache() -> None:
    _cache.clear()
