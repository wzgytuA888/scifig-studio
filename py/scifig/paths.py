"""Dotted-path helpers for the scifig spec.

The spec is a plain nested dict (no arrays on tunable paths), e.g.::

    {"map": {"colorbar": {"label": "含量"}}, "legend": {"position": "upper right"}}

All controls / patch / NL layers speak the same dotted paths, so these helpers
are the single place where path traversal lives.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List


def split_path(path: str) -> List[str]:
    """``"map.colorbar.label"`` -> ``["map", "colorbar", "label"]``."""
    if not isinstance(path, str):
        raise TypeError("spec path must be a string, got %r" % (path,))
    keys = [p for p in path.split(".") if p != ""]
    if not keys:
        raise ValueError("empty spec path")
    return keys


def get_path(obj: Any, path: str, default: Any = None) -> Any:
    """Return the value at *path* or *default* when any segment is missing."""
    cur = obj
    for key in split_path(path):
        if not isinstance(cur, dict):
            return default
        if key not in cur:
            return default
        cur = cur[key]
    return cur


def has_path(obj: Any, path: str) -> bool:
    sentinel = object()
    return get_path(obj, path, sentinel) is not sentinel


def set_path(obj: Dict[str, Any], path: str, value: Any) -> Dict[str, Any]:
    """Set *value* at *path*, creating intermediate dicts as needed."""
    keys = split_path(path)
    cur = obj
    for key in keys[:-1]:
        nxt = cur.get(key)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[key] = nxt
        cur = nxt
    cur[keys[-1]] = value
    return obj


def delete_path(obj: Dict[str, Any], path: str) -> None:
    keys = split_path(path)
    cur = obj
    for key in keys[:-1]:
        nxt = cur.get(key)
        if not isinstance(nxt, dict):
            return
        cur = nxt
    cur.pop(keys[-1], None)


def flatten(obj: Any, prefix: str = "") -> Dict[str, Any]:
    """Flatten nested dicts into ``{"a.b.c": value}`` (leaves include None)."""
    out: Dict[str, Any] = {}
    if isinstance(obj, dict):
        for key, value in obj.items():
            child = "%s.%s" % (prefix, key) if prefix else str(key)
            if isinstance(value, dict):
                if value:
                    out.update(flatten(value, child))
                else:
                    out[child] = {}
            else:
                out[child] = value
    else:
        out[prefix] = obj
    return out


def deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge *override* into a copy of *base*; dicts merge, leaves win."""
    merged = dict(base)
    for key, value in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def diff_paths(old: Dict[str, Any], new: Dict[str, Any], prefix: str = "") -> Iterable[str]:
    """Yield dotted paths whose leaf value differs between two specs."""
    keys = set(old) | set(new)
    for key in sorted(keys):
        child = "%s.%s" % (prefix, key) if prefix else key
        a = old.get(key)
        b = new.get(key)
        if isinstance(a, dict) and isinstance(b, dict):
            yield from diff_paths(a, b, child)
        elif a != b:
            yield child
