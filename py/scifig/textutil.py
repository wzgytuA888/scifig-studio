"""Text normalisation for publication-quality labels.

User text often carries Unicode superscripts (``m⁻¹``, ``km²``) that Latin
fonts frequently lack, producing tofu boxes in the PNG.  Every user-visible
string therefore passes through :func:`normalize_text`, which rewrites
superscript / subscript runs into mathtext (``m$^{-1}$``) so they are drawn by
the mathtext font instead of the text font.

It also folds a few common compatibility characters (``℃`` -> ``°C``).
"""

from __future__ import annotations

import re
from typing import Optional

SUPERSCRIPT = {
    "⁰": "0",
    "¹": "1",
    "²": "2",
    "³": "3",
    "⁴": "4",
    "⁵": "5",
    "⁶": "6",
    "⁷": "7",
    "⁸": "8",
    "⁹": "9",
    "⁺": "+",
    "⁻": "-",
    "⁼": "=",
    "⁽": "(",
    "⁾": ")",
    "ⁿ": "n",
    "ⁱ": "i",
}

SUBSCRIPT = {
    "₀": "0",
    "₁": "1",
    "₂": "2",
    "₃": "3",
    "₄": "4",
    "₅": "5",
    "₆": "6",
    "₇": "7",
    "₈": "8",
    "₉": "9",
    "₊": "+",
    "₋": "-",
    "₌": "=",
    "₍": "(",
    "₎": ")",
}

REPLACEMENTS = {
    "℃": "°C",
    "℉": "°F",
    "㎜": "mm",
    "㎝": "cm",
    "㎞": "km",
    "㎏": "kg",
    "㎎": "mg",
    "㎖": "mL",
    "㎡": "m²",
    "㎥": "m³",
    "‰": "‰",
    "\u00a0": " ",
}


def _convert_runs(text: str, mapping: dict, marker: str) -> str:
    out = []
    index = 0
    length = len(text)
    while index < length:
        char = text[index]
        if char in mapping:
            start = index
            while index < length and text[index] in mapping:
                index += 1
            content = "".join(mapping[ch] for ch in text[start:index])
            # mathtext cannot contain spaces here; keep it tight
            out.append("$%s{%s}$" % (marker, content))
        else:
            out.append(char)
            index += 1
    return "".join(out)


def _has_cjk(text: str) -> bool:
    for char in text:
        code = ord(char)
        if (0x4E00 <= code <= 0x9FFF) or (0x3400 <= code <= 0x4DBF) \
                or (0xF900 <= code <= 0xFAFF) or (0x3000 <= code <= 0x303F):
            return True
    return False


#: unit symbols that may carry an ASCII exponent at the end of a label
UNIT_BASES = [
    "km", "cm", "mm", "dm", "nm", "um", "µm", "μm", "mL", "ml", "µL", "dS",
    "mS", "kPa", "MPa", "hPa", "kW", "MW", "kJ", "mmol", "mol", "kg", "mg",
    "ha", "eV", "dB", "Pa", "W", "J", "K", "L", "l", "g", "t", "s", "h",
    "m", "d",
]
_UNIT_TAIL_RE = re.compile(
    r"(?<![A-Za-z])(?P<base>(?:%s))(?:\s?\^|\s?\*\*)?\s?(?P<exp>[+-]?\d{1,2})(?P<tail>\s*[)）\]】]?\s*)$"
    % "|".join(sorted(UNIT_BASES, key=len, reverse=True))
)

_SUP_CHARS = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "-": "⁻", "+": "⁺",
}


def _unit_tail(text: str, unicode_mode: bool) -> str:
    """Rewrite an ASCII unit exponent at the label tail.

    ``"dS m-1"`` -> ``"dS m$^{-1}$"`` (Latin labels) or ``"dS m⁻¹"`` (CJK labels,
    because mathtext would render the Chinese text as tofu).
    """
    match = _UNIT_TAIL_RE.search(text)
    if not match:
        return text
    exponent = match.group("exp")
    if unicode_mode:
        superscript = "".join(_SUP_CHARS.get(char, char) for char in exponent)
        replacement = match.group("base") + superscript + match.group("tail")
    else:
        replacement = match.group("base") + "$^{%s}$" % exponent + match.group("tail")
    return text[: match.start()] + replacement


def normalize_text(value: Optional[str]) -> str:
    """Return *value* with Unicode scripts / ASCII unit exponents normalised.

    Rules
    -----
    * Pure Latin/symbol text: unit exponents are rewritten as mathtext
      (``m-1`` / ``m^2`` -> ``m$^{-1}$``); other superscripts become mathtext too.
    * Text that mixes CJK with units: exponents become Unicode superscripts
      (``m⁻¹``) which the DejaVu fallback font carries, because matplotlib
      renders every segment of a mathtext string with the mathtext font and
      would turn the Chinese into tofu.
    * Text already containing ``$`` is left alone (user supplied mathtext).
    """
    if value is None:
        return ""
    text = str(value)
    if not text:
        return text
    for source, target in REPLACEMENTS.items():
        text = text.replace(source, target)
    if "$" in text:
        return text
    cjk = _has_cjk(text)
    text = _unit_tail(text, unicode_mode=cjk)
    if cjk:
        return text
    text = _convert_runs(text, SUPERSCRIPT, "^")
    text = _convert_runs(text, SUBSCRIPT, "_")
    return text


def normalize_labels(values):
    """Vectorised :func:`normalize_text` for tick/category labels."""
    return [normalize_text(value) for value in values]
