#!/usr/bin/env python3
"""Wykresy do rozdziału 4 z plików results/*.csv (wyjście: Images/*.pdf)."""
import csv, pathlib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = pathlib.Path(__file__).resolve().parents[3]
RES = ROOT / "results"
OUT = pathlib.Path(__file__).resolve().parent / "Images"
OUT.mkdir(exist_ok=True)

plt.rcParams.update({"pdf.fonttype": 42, "font.family": "serif", "font.size": 9, "axes.grid": True,
                     "grid.alpha": 0.3, "figure.dpi": 150})

MODELS = [  # (id, etykieta, styl)
    (1, "baseline v1", dict(color="#6b7280", ls="--")),
    (2, "Mamdani", dict(color="#d97706", ls="-.")),
    (47, "baseline v2", dict(color="#0d9488")),
    (49, "ANFIS (W2)", dict(color="#4f46e5", ls=":")),
    (48, "ANFIS (W2+W4)", dict(color="#4f46e5")),
]
WINDOWS = {2: "2021-05 krach", 3: "2021-11 ATH", 4: "2022-05 Luna", 5: "2022-11 FTX"}


def roc(model_id, win):
    rows = list(csv.DictReader(open(RES / f"roc-{model_id}-{win}.csv")))
    return [float(r["fpr"]) for r in rows], [float(r["tpr"]) for r in rows]


def auc_of(model_id, win_id):
    for r in csv.DictReader(open(RES / "evaluation.csv")):
        if int(r["model_id"]) == model_id and (r["window_id"] or "") == (str(win_id) if win_id else ""):
            return float(r["auc"])
    return float("nan")


# --- rys.: ROC, wszystkie okna testowe ---
fig, ax = plt.subplots(figsize=(4.2, 4.0))
for mid, label, st in MODELS:
    x, y = roc(mid, "all")
    ax.plot(x, y, label=f"{label} (AUC {auc_of(mid, None):.3f})", lw=1.3, **st)
ax.plot([0, 1], [0, 1], color="k", lw=0.6, alpha=0.4)
ax.set_xlabel("odsetek fałszywych alarmów (FPR)")
ax.set_ylabel("czułość (TPR)")
ax.set_xlim(0, 1); ax.set_ylim(0, 1)
ax.legend(loc="lower right", fontsize=7.5, frameon=False)
fig.tight_layout(); fig.savefig(OUT / "roc-all.pdf"); plt.close(fig)

# --- rys.: ROC per okno dla baseline v2 i ANFIS W2+W4 ---
fig, axes = plt.subplots(2, 2, figsize=(6.2, 5.6), sharex=True, sharey=True)
for ax, (wid, wname) in zip(axes.flat, WINDOWS.items()):
    for mid, label, st in MODELS:
        if mid in (1, 47, 48):
            x, y = roc(mid, wid)
            ax.plot(x, y, label=f"{label} ({auc_of(mid, wid):.2f})", lw=1.2, **st)
    ax.plot([0, 1], [0, 1], color="k", lw=0.6, alpha=0.4)
    ax.set_title(wname, fontsize=9)
    ax.legend(loc="lower right", fontsize=7, frameon=False)
for ax in axes[1]: ax.set_xlabel("FPR")
for ax in axes[:, 0]: ax.set_ylabel("TPR")
fig.tight_layout(); fig.savefig(OUT / "roc-windows.pdf"); plt.close(fig)

# --- rys.: stabilność ANFIS po ziarnach ---
seeds = [r for r in csv.DictReader(open(RES / "evaluation-seeds.csv")) if r["name"] in ("anfis-w2", "anfis-w2w4")]
fig, ax = plt.subplots(figsize=(5.2, 3.0))
labels = list(WINDOWS.values()) + ["wszystkie"]
for i, (name, lab, col) in enumerate([("anfis-w2", "ANFIS (W2)", "#a5b4fc"), ("anfis-w2w4", "ANFIS (W2+W4)", "#4f46e5")]):
    vals = {r["window_name"]: r for r in seeds if r["name"] == name}
    keys = list(WINDOWS.values()) + ["wszystkie (2–5)"]
    m = [float(vals[k]["auc_mean"]) for k in keys]
    s = [float(vals[k]["auc_sd"]) for k in keys]
    xs = [j + (i - 0.5) * 0.36 for j in range(len(keys))]
    ax.bar(xs, m, width=0.34, yerr=s, capsize=2.5, color=col, label=lab)
ax.set_xticks(range(len(labels))); ax.set_xticklabels(labels, fontsize=8)
ax.set_ylabel("AUC (średnia ± sd, 5 ziaren)"); ax.set_ylim(0.5, 0.95)
ax.legend(fontsize=8, frameon=False, loc="upper left")
fig.tight_layout(); fig.savefig(OUT / "seeds.pdf"); plt.close(fig)

# --- rys.: opóźnienie konsumpcji (dane z zapytania SQL, docs/praca/tex/make-figures.py) ---
K = {0: 124, 1: 247, 2: 109, 3: 90}   # two_pool, stan bazy 27.08.2026
fig, ax = plt.subplots(figsize=(3.6, 2.6))
ax.bar(list(K), list(K.values()), color="#0d9488", width=0.6)
ax.set_xlabel("bloki od okazji do konsumpcji, $k$"); ax.set_ylabel("liczba okazji")
ax.set_xticks(list(K))
fig.tight_layout(); fig.savefig(OUT / "k-hist.pdf"); plt.close(fig)

print("OK:", sorted(p.name for p in OUT.glob("*.pdf")))
