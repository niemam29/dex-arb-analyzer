#!/usr/bin/env python3
"""Kontrola pracy: (A) wskazówki redakcyjne WIMiIP, (B) odwołania i bibliografia,
(C) spójność liczb rozdz. 4 z results/*.csv. Uruchamiane przez `make check`.
Wynik: lista uwag z lokalizacją; kod wyjścia 1, gdy są uwagi kategorii BŁĄD."""
import csv, pathlib, re, sys
from collections import Counter

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RES = ROOT / "results"
issues = []  # (poziom, plik:linia, opis)


def add(level, where, msg):
    issues.append((level, where, msg))


def strip_comments(line):
    out, esc = [], False
    for ch in line:
        if ch == "%" and not esc:
            break
        esc = (ch == "\\") and not esc
        out.append(ch)
    return "".join(out)


chapters = sorted((HERE / "Chapters").glob("*.tex"))
texts = {}
for f in chapters:
    lines = f.read_text(encoding="utf8").splitlines()
    texts[f.name] = [(i + 1, strip_comments(l)) for i, l in enumerate(lines)]

# ---------------------------------------------------------------- (A) styl
BAD_START = ("Aby ", "Ponieważ ", "Więc ", "Ale ", "I ", "A ", "Żeby ")
FIRST_PERSON = re.compile(r"\b(ja|my|mnie|nam|nasz\w*|mój|moj\w*|moim|zrobiłem|zaimplementowałem|napisałem|"
                          r"zbudowałem|przeprowadziłem|uważam|sądzę|postanowiłem|wybrałem|zrobiliśmy|"
                          r"zaimplementowaliśmy|zbudowaliśmy)\b", re.I)
RELATIVE_REF = re.compile(r"\b(powyższ\w*|poniższ\w*|następn\w* (rysun|tabel|listing)|poprzedni\w* (rysun|tabel|listing))\b", re.I)
FUTURE = re.compile(r"\b(zostanie|zostaną|będzie (omówion|przedstawion|opisan)|będą (omówion|przedstawion|opisan))\b", re.I)
ILOSC = re.compile(r"\bilość\w*\s+(bloków|okazji|transakcji|swapów|modeli|reguł|testów|wierszy|zdarzeń|pul|par)\b", re.I)
COLLOQUIAL = re.compile(r"\b(fajn\w*|super\b|mega\b|ściągn\w*|ogarn\w*|w miarę|na dzień dzisiejszy|generalnie)\b", re.I)
CHRONO = re.compile(r"\b(na początku projektu|najpierw zrobiono|w pierwszej kolejności zrobiono|potem zrobiono)\b", re.I)
FILLER = re.compile(r"\b(warto (zauważyć|podkreślić|dodać)|należy (zauważyć|podkreślić)|kluczow\w*|istotn\w* jest|"
                    r"co więcej|ponadto|w dzisiejszym|holistyczn\w*|kompleksow\w*)\b", re.I)

for name, lines in texts.items():
    in_lst = 0
    para_start = True
    for n, l in lines:
        s = l.strip()
        if re.match(r"\\begin\{lstlisting\}|\\lstinputlisting", s):
            in_lst += 1
        if in_lst:
            if s.startswith(r"\end{lstlisting}") or s.startswith(r"\lstinputlisting"):
                in_lst = 0
            continue
        where = f"{name}:{n}"
        if not s:
            para_start = True
            continue
        if para_start and s.startswith(BAD_START):
            add("UWAGA", where, f"zdanie zaczyna się od „{s.split()[0]}”")
        para_start = False
        for m in re.finditer(r"[.!?]\s+([A-ZŻŹĆĄŚĘŁÓŃ]\w*\s)", s):
            w = m.group(1)
            if w in BAD_START:
                add("UWAGA", where, f"zdanie zaczyna się od „{w.strip()}”")
        if FIRST_PERSON.search(s):
            add("UWAGA", where, f"pierwsza osoba: „{FIRST_PERSON.search(s).group(0)}”")
        if RELATIVE_REF.search(s):
            add("BŁĄD", where, f"odwołanie względne: „{RELATIVE_REF.search(s).group(0)}” (użyć numeru)")
        if FUTURE.search(s):
            add("UWAGA", where, f"czas przyszły: „{FUTURE.search(s).group(0)}”")
        if ILOSC.search(s):
            add("UWAGA", where, f"„ilość” dla rzeczownika policzalnego: „{ILOSC.search(s).group(0)}”")
        if COLLOQUIAL.search(s):
            add("UWAGA", where, f"potoczne: „{COLLOQUIAL.search(s).group(0)}”")
        if CHRONO.search(s):
            add("UWAGA", where, f"opis chronologiczny: „{CHRONO.search(s).group(0)}”")
        if FILLER.search(s):
            add("UWAGA", where, f"fraza-wypełniacz: „{FILLER.search(s).group(0)}”")
        if re.search(r"\\footnote\{", s):
            add("UWAGA", where, "przypis dolny (wskazówki: unikać)")
        for cap in re.finditer(r"\\caption\{(.*)\}", s):
            c = cap.group(1).rstrip()
            if c.endswith(".") and not c.endswith("..."):
                add("BŁĄD", where, "podpis kończy się kropką")
        if re.search(r"\bTODO\b", l):
            add("TODO", where, l.strip()[:90])

# ------------------------------------------------- (B) odwołania i bibliografia
alltext = "\n".join(l for lines in texts.values() for _, l in lines)
labels = set(re.findall(r"\\label\{([^}]+)\}", alltext)) | set(re.findall(r"label=\{([^}]+)\}", alltext))
refs = set(re.findall(r"\\(?:eq)?ref\{([^}]+)\}", alltext))
for lab in sorted(labels - refs):
    add("BŁĄD", "-", f"etykieta bez odwołania w tekście: {lab}")
for r in sorted(refs - labels):
    add("BŁĄD", "-", f"odwołanie do nieistniejącej etykiety: {r}")
for name, lines in texts.items():
    for n, l in lines:
        if re.search(r"\\begin\{(figure|table)\}", l) and not re.search(r"\\label", "\n".join(x for _, x in lines[n - 1:n + 12])):
            add("UWAGA", f"{name}:{n}", "środowisko figure/table bez \\label w pobliżu")

bib = (HERE / "references.bib").read_text(encoding="utf8")
entries = re.findall(r"@\w+\{(\w+),", bib)
cited = set()
for m in re.finditer(r"\\cite\{([^}]+)\}", alltext):
    cited.update(k.strip() for k in m.group(1).split(","))
for k in sorted(set(entries) - cited):
    add("BŁĄD", "references.bib", f"pozycja niecytowana w tekście: {k}")
for k in sorted(cited - set(entries)):
    add("BŁĄD", "references.bib", f"cytowany klucz bez wpisu: {k}")
if re.search(r"wikipedia", bib, re.I):
    add("BŁĄD", "references.bib", "Wikipedia w bibliografii")
for m in re.finditer(r"@\w+\{(\w+),(.*?)\n\}", bib, re.S):
    k, body = m.group(1), m.group(2)
    if r"\url{" in body and "Dostęp" not in body:
        add("BŁĄD", "references.bib", f"{k}: źródło WWW bez daty dostępu")
    if "Dostęp: TODO" in body:
        add("TODO", "references.bib", f"{k}: data dostępu do uzupełnienia")

# ------------------------------------------------- (C) spójność liczb z results/
def pl(x, nd):
    return f"{x:.{nd}f}".replace(".", "{,}")


def has(num_str):
    return num_str in alltext


def check_num(where, label, num_str):
    if not has(num_str):
        add("BŁĄD", where, f"brak w tekście liczby {label} = {num_str} (results/)")


ch4 = "04-weryfikacja.tex"
# liczności tabel z provenance.json
import json
prov = json.load(open(RES / "provenance.json"))
for tbl, key in [("blocks", "bloki"), ("sync_events", "Sync"), ("swap_events", "Swap"), ("block_states", "stany"), ("opportunities", "okazje")]:
    v = prov["tables"][tbl]
    s = f"{v:,}".replace(",", r"\,")
    check_num(ch4, f"{tbl}", s)

# pokrycie: stany i okazje per okno (suma po parach)
cov = list(csv.DictReader(open(RES / "coverage.csv")))
per_win = {}
for r in cov:
    if r["dex"] != "uniswap-v2":
        continue
    w = r["window"]
    per_win.setdefault(w, [0, 0])
    per_win[w][0] += int(r["block_states"]); per_win[w][1] += int(r["opportunities"])
for w, (st, op) in per_win.items():
    check_num(ch4, f"stany {w}", f"{st:,}".replace(",", r"\,"))
    check_num(ch4, f"okazje {w}", f"{op:,}".replace(",", r"\,"))

# weryfikacja: sumy per okno
vs = list(csv.DictReader(open(RES / "verification-stats.csv")))
agg = {}
for r in vs:
    a = agg.setdefault(r["window"], Counter())
    for k in ("consumed_atomic", "zero_gas_consumers", "consumed_partial", "decayed", "persisted", "two_pool", "multi"):
        a[k] += int(r[k])
tot = Counter()
for w, a in agg.items():
    tot.update(a)
    for k in ("consumed_atomic", "two_pool", "multi", "persisted"):
        check_num(ch4, f"{k} {w}", f"{a[k]:,}".replace(",", r"\,"))
for k in ("consumed_atomic", "two_pool", "multi", "consumed_partial", "persisted"):
    check_num(ch4, f"{k} razem", f"{tot[k]:,}".replace(",", r"\,"))

# metryki modeli (id 1, 2, 47, 48, 49)
ev = list(csv.DictReader(open(RES / "evaluation.csv")))
for r in ev:
    if int(r["model_id"]) not in (1, 2, 47, 48, 49):
        continue
    lab = f"model {r['model_id']} {r['window_name']}"
    check_num(ch4, lab + " AUC", pl(float(r["auc"]), 3))
    check_num(ch4, lab + " PR-AUC", pl(float(r["pr_auc"]), 3))
    check_num(ch4, lab + " F1", pl(float(r["f1"]), 3))
    ci = f"[{pl(float(r['auc_ci_low']),2)}--{pl(float(r['auc_ci_high']),2)}]"
    check_num(ch4, lab + " CI", ci)

# stabilność seedów
for r in csv.DictReader(open(RES / "evaluation-seeds.csv")):
    if r["name"] in ("anfis-w2", "anfis-w2w4") and r["window_name"].startswith("wszystkie"):
        check_num(ch4, f"{r['name']} AUC mean", pl(float(r["auc_mean"]), 3))
        check_num(ch4, f"{r['name']} AUC sd", pl(float(r["auc_sd"]), 3))

# analiza wrażliwości na definicję populacji (wiersze „wszystkie”, modele 1, 2, 47, 48, 49)
for r in csv.DictReader(open(RES / "evaluation-sensitivity.csv")):
    if int(r["model_id"]) in (1, 2, 47, 48, 49) and r["window_name"].startswith("wszystkie"):
        lab = f"wrażliwość {r['variant']} model {r['model_id']}"
        check_num(ch4, lab + " AUC", pl(float(r["auc"]), 3))
        check_num(ch4, lab + " PR-AUC", pl(float(r["pr_auc"]), 3))
        ci = f"[{pl(float(r['auc_ci_low']),2)}--{pl(float(r['auc_ci_high']),2)}]"
        check_num(ch4, lab + " CI", ci)

# ---------------------------------------------------------------- raport
order = {"BŁĄD": 0, "UWAGA": 1, "TODO": 2}
issues.sort(key=lambda x: (order[x[0]], x[1]))
for lvl, where, msg in issues:
    print(f"{lvl:6s} {where:32s} {msg}")
c = Counter(l for l, _, _ in issues)
print(f"\n{c.get('BŁĄD',0)} błędów, {c.get('UWAGA',0)} uwag, {c.get('TODO',0)} TODO")
sys.exit(1 if c.get("BŁĄD", 0) else 0)
