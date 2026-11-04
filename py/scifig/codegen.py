"""Code generation: turn a rendered spec into a standalone Python component.

The generated script embeds the *normalised* spec as a Python literal and calls
:func:`scifig.engine.render_spec`, so engine and generated code share one code
path and produce byte-identical PNGs.
"""

from __future__ import annotations

import os
import pprint
from typing import Any, Dict, Optional

from .log import Ctx

INTERNAL_PREFIX = "_"

HEADER = '''#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""SciFigure Studio · 子图生成代码（component）

用途：
    独立复现一张 SCI 制图。本文件由图引擎 codegen 生成，可直接运行：
        python {filename} --out figure.png [--thumb thumb.png]

数据来源：
    {data_source}

如何改参数：
    1. 下方 SPEC 就是完整绘图参数（与工作台 controls.json 的 path 一一对应，
       例如 SPEC["map"]["projection"]、SPEC["legend"]["position"]）；
    2. 只改参数够不着的定制需求，写到 SPEC["customPatch"] 字符串里，
       可用变量：fig / axes / ax / np / plt / mpl / spec；
    3. 渲染逻辑在 scifig.engine.render_spec，本文件与引擎输出逐像素一致。

注意：本文件由程序生成，重新生成会覆盖手工修改；要长期保留的定制请写 customPatch。
"""
'''

TEMPLATE = '''import argparse
import json
import os
import sys

_BUNDLE_PY = r"{bundle_py}"
try:  # 正常安装时直接可用
    import scifig  # noqa: F401
except ImportError:  # 退化：把插件包的 py 目录加入 sys.path
    if os.path.isdir(_BUNDLE_PY) and _BUNDLE_PY not in sys.path:
        sys.path.insert(0, _BUNDLE_PY)
from scifig.engine import render_spec  # noqa: E402

# 数据文件所在目录（SPEC 中 data.source 的相对路径按它解析）
WORKDIR = r"{workdir}"

# ---------------------------------------------------------------------------
# 绘图参数（与 controls.json 的 path 完全一致，可直接改数值/枚举/布尔）
# ---------------------------------------------------------------------------
SPEC = {spec_literal}


def main() -> int:
    parser = argparse.ArgumentParser(description="渲染 SciFigure 子图并输出 PNG")
    parser.add_argument("--out", default="figure.png", help="输出 PNG 路径")
    parser.add_argument("--thumb", default=None, help="缩略图路径（长边 <= 480px）")
    parser.add_argument("--code-out", default=None, help="同时再生成一份本代码")
    args = parser.parse_args()

    result = render_spec(SPEC, args.out, thumb=args.thumb,
                         code_out=args.code_out, workdir=WORKDIR)
    payload = {{
        "ok": bool(result.get("ok")),
        "png": result.get("png"),
        "warnings": result.get("warnings", []),
        "error": result.get("error"),
    }}
    print(json.dumps(payload, ensure_ascii=False))
    return 0 if payload["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
'''


def _strip_internal(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _strip_internal(item)
            for key, item in value.items()
            if not str(key).startswith(INTERNAL_PREFIX)
        }
    if isinstance(value, list):
        return [_strip_internal(item) for item in value]
    return value


def _bundle_py_dir() -> str:
    import scifig

    return os.path.dirname(os.path.dirname(os.path.abspath(scifig.__file__)))


def _spec_literal(spec: Dict[str, Any]) -> str:
    clean = _strip_internal(spec)
    output = clean.get("output")
    if not isinstance(output, dict):
        clean["output"] = {"png": ""}
    else:
        output["png"] = ""
    literal = pprint.pformat(clean, indent=2, width=110, sort_dicts=False)
    return literal


def write_component(spec: Dict[str, Any], path: str, *, workdir: Optional[str] = None,
                    ctx: Optional[Ctx] = None) -> str:
    """Write the standalone component script for *spec*."""
    ctx = ctx or Ctx()
    target = os.path.abspath(path)
    directory = os.path.dirname(target)
    if directory:
        os.makedirs(directory, exist_ok=True)
    clean = _strip_internal(spec)
    data = clean.get("data") or {}
    source = str(data.get("source") or "")
    if source and workdir and not os.path.isabs(source):
        effective = os.path.normpath(os.path.join(workdir, source))
    else:
        effective = source or "（无外部数据文件：仅底图/合成图）"
    filename = os.path.basename(target)
    header = HEADER.format(filename=filename, data_source=effective)
    body = TEMPLATE.format(
        bundle_py=_bundle_py_dir(),
        workdir=workdir or os.getcwd(),
        spec_literal=_spec_literal(spec),
    )
    with open(target, "w", encoding="utf-8") as handle:
        handle.write(header)
        handle.write("\n")
        handle.write(body)
    return target
