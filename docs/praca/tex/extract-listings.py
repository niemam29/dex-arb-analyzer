#!/usr/bin/env python3
"""Kopiuje fragmenty kodu źródłowego do Listings/ z transliteracją znaków spoza ASCII
(pdflatex + listings nie obsługują wielobajtowego UTF-8 poza tablicą `literate`).
Polskie litery są zachowane (obsługuje je `literate` w main.tex)."""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[3]  # korzeń repo
OUT = pathlib.Path(__file__).resolve().parent / "Listings"
OUT.mkdir(exist_ok=True)

# (plik źródłowy, pierwsza linia, ostatnia linia, nazwa wyjściowa)
SPEC = [
    ("packages/core/src/amm.ts", 50, 79, "opt-trade.ts"),
    ("packages/core/src/mamdani.params.ts", 115, 135, "rules.ts"),
    ("packages/analysis/src/verify/classify.ts", 81, 133, "classify.ts"),
]

POLISH = set("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ")
MAP = {
    "→": "->", "←": "<-", "⇒": "=>", "—": "--", "–": "-", "·": "*", "×": "x",
    "≤": "<=", "≥": ">=", "≠": "!=", "≡": "==", "≈": "~=", "√": "sqrt",
    "⁻": "^-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5",
    "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "∧": "and", "∨": "or", "∈": "in",
    "„": '"', "”": '"', "“": '"', "’": "'", "…": "...", " ": " ",
    "Δ": "delta", "γ": "gamma", "σ": "sigma", "μ": "mu", "ε": "eps", "Σ": "sum",
    "∞": "inf",
}


def translit(s: str) -> str:
    out = []
    for ch in s:
        if ord(ch) < 128 or ch in POLISH:
            out.append(ch)
        else:
            out.append(MAP.get(ch, "?"))
    return "".join(out)


for src, first, last, name in SPEC:
    lines = (ROOT / src).read_text(encoding="utf8").splitlines()
    frag = lines[first - 1 : last]
    text = "\n".join(translit(l) for l in frag) + "\n"
    (OUT / name).write_text(text, encoding="utf8")
    bad = sorted({c for c in text if ord(c) >= 128 and c not in POLISH})
    print(f"{name}: {src}:{first}-{last} ({len(frag)} linii){' NIEPRZEMAPOWANE: ' + repr(bad) if bad else ''}")
