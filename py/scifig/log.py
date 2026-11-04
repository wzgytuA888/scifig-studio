"""stderr logging + structured warning / auto-adjust collection.

``stdout`` is reserved for the single JSON result line of ``scifig.cli``.
Everything here writes to ``stderr`` only.

Two channels are kept apart:

* ``warnings``     – real risks the user should see (missing data, missing glyphs,
                     unavoidable overlap, customPatch failure, …).
* ``autoAdjust``  – the engine silently made the figure *better* (central meridian
                     aligned to the study area, scale bar shortened, category labels
                     rotated, ticks thinned, …).  These are informational and the
                     workbench shows them as a grey ⓘ hint, not a warning.
"""

from __future__ import annotations

import sys
import time
from typing import Dict, List


class Ctx:
    """Per-render context: warnings, auto adjustments, timers, stderr logger."""

    def __init__(self) -> None:
        self.warnings: List[str] = []
        self.auto_adjust: List[Dict[str, str]] = []
        self._seen = set()
        self._auto_seen = set()
        self.t0 = time.perf_counter()

    # -- warnings ---------------------------------------------------------
    def warn(self, message: str) -> None:
        message = str(message)
        if message in self._seen:
            return
        self._seen.add(message)
        self.warnings.append(message)
        self.log("WARN " + message)

    # -- automatic optimisations -----------------------------------------
    def auto(self, key: str, message: str) -> None:
        """Record an engine-made improvement (never a warning)."""
        key = str(key)
        message = str(message)
        signature = (key, message)
        if signature in self._auto_seen:
            return
        self._auto_seen.add(signature)
        self.auto_adjust.append({"key": key, "message": message})
        self.log("AUTO %s: %s" % (key, message))

    # -- logging ----------------------------------------------------------
    def log(self, message: str) -> None:
        print("[scifig] " + str(message), file=sys.stderr, flush=True)

    def info(self, message: str) -> None:
        self.log(str(message))

    def debug(self, message: str) -> None:
        if _DEBUG:
            self.log("DEBUG " + str(message))

    # -- timing -----------------------------------------------------------
    def elapsed_ms(self) -> int:
        return int(round((time.perf_counter() - self.t0) * 1000.0))


_DEBUG = False


def set_debug(flag: bool) -> None:
    global _DEBUG
    _DEBUG = bool(flag)
