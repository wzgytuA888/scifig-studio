"""Command line interface for the scifig renderer.

Contract (see docs/CONTRACT.md §3.1/§7.2):
    python -m scifig.cli render   --spec s.json --out f.png [--workdir d]
                                  [--thumb t.png] [--code-out c.py]
    python -m scifig.cli codegen  --spec s.json --out c.py [--workdir d]
    python -m scifig.cli controls --out controls.json
    python -m scifig.cli validate --spec s.json

stdout carries exactly one JSON line, all logs go to stderr, failures exit 2.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from typing import Any, Dict, List, Optional

from . import __version__, controls
from .log import Ctx, set_debug


def _emit(payload: Dict[str, Any]) -> None:
    try:  # stdout must be UTF-8 for the host's JSON.parse
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - older wrapped streams
        pass
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()


def _load_spec(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        raise FileNotFoundError("spec 文件不存在：%s" % path)
    with open(path, "r", encoding="utf-8-sig") as handle:
        try:
            return json.load(handle)
        except json.JSONDecodeError as exc:
            raise ValueError("spec JSON 解析失败：%s" % exc) from exc


def _fail(error: str, trace: Optional[str] = None) -> int:
    payload: Dict[str, Any] = {"ok": False, "error": error}
    if trace:
        payload["trace"] = trace
    _emit(payload)
    return 2


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------
def cmd_render(args) -> int:
    from .engine import render_spec

    try:
        spec = _load_spec(args.spec)
    except Exception as exc:  # noqa: BLE001
        return _fail(_exc_message(exc))
    workdir = args.workdir or os.path.dirname(os.path.abspath(args.spec)) or os.getcwd()
    result = render_spec(spec, args.out, thumb=args.thumb, code_out=args.code_out,
                         workdir=workdir, spec_path=args.spec)
    _emit(result)
    return 0 if result.get("ok") else 2


def cmd_codegen(args) -> int:
    from . import spec as spec_module
    from .codegen import write_component

    ctx = Ctx()
    try:
        raw = _load_spec(args.spec)
        normalized = spec_module.normalize(raw, ctx)
        workdir = args.workdir or os.path.dirname(os.path.abspath(args.spec)) or os.getcwd()
        target = write_component(normalized, args.out, workdir=workdir, ctx=ctx)
    except Exception as exc:  # noqa: BLE001
        return _fail(_exc_message(exc))
    _emit({"ok": True, "path": target, "warnings": list(ctx.warnings)})
    return 0


def cmd_controls(args) -> int:
    source = controls.CONTROLS_PATH
    items = controls.control_paths()
    target = ""
    if args.out:
        target = os.path.abspath(args.out)
        directory = os.path.dirname(target)
        if directory:
            os.makedirs(directory, exist_ok=True)
        shutil.copyfile(source, target)
    _emit({
        "ok": True,
        "path": target,
        "source": source,
        "groups": len(controls.groups()),
        "items": len(items),
        "presets": [preset.get("id") for preset in controls.presets()],
    })
    return 0


def cmd_validate(args) -> int:
    from . import spec as spec_module

    try:
        raw = _load_spec(args.spec)
    except Exception as exc:  # noqa: BLE001
        return _fail(_exc_message(exc))
    report = spec_module.validate_report(raw)
    _emit(report)
    return 0 if report.get("ok") else 2


def _exc_message(exc: Exception) -> str:
    message = str(exc).strip()
    return message or type(exc).__name__


# ---------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="scifig", description="SciFigure Studio 制图引擎")
    parser.add_argument("--version", action="version", version="scifig " + __version__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_render = sub.add_parser("render", help="把 spec 渲染为 PNG")
    p_render.add_argument("--spec", required=True, help="spec JSON 路径")
    p_render.add_argument("--out", default="", help="输出 PNG 路径（spec.output.png 优先）")
    p_render.add_argument("--workdir", default=None, help="数据相对路径的基准目录")
    p_render.add_argument("--thumb", default=None, help="同次输出缩略图（长边<=480）")
    p_render.add_argument("--code-out", default=None, help="同次输出可独立运行的 component.py")
    p_render.add_argument("--debug", action="store_true", help="stderr 输出调试日志")
    p_render.set_defaults(func=cmd_render)

    p_codegen = sub.add_parser("codegen", help="由 spec 生成可独立运行的 Python 绘图代码")
    p_codegen.add_argument("--spec", required=True, help="spec JSON 路径")
    p_codegen.add_argument("--out", required=True, help="输出 component.py 路径")
    p_codegen.add_argument("--workdir", default=None, help="数据相对路径的基准目录")
    p_codegen.set_defaults(func=cmd_codegen)

    p_controls = sub.add_parser("controls", help="导出 controls.json（自检用）")
    p_controls.add_argument("--out", default=None, help="复制到该路径")
    p_controls.set_defaults(func=cmd_controls)

    p_validate = sub.add_parser("validate", help="校验 spec 结构（自检用）")
    p_validate.add_argument("--spec", required=True, help="spec JSON 路径")
    p_validate.set_defaults(func=cmd_validate)

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if getattr(args, "debug", False):
        set_debug(True)
    try:
        return int(args.func(args))
    except BrokenPipeError:  # pragma: no cover
        return 2
    except Exception as exc:  # noqa: BLE001 - last-resort safety net
        import traceback

        return _fail("渲染失败：%s" % _exc_message(exc),
                     traceback.format_exc(limit=3))


if __name__ == "__main__":
    raise SystemExit(main())
