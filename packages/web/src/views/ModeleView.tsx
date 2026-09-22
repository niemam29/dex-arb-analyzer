// Widok "Modele" — porównanie modeli oceny (baseline/baseline_v2/mamdani/anfis):
// macierze pomyłek, krzywe ROC nałożone na jednym wykresie, histogramy score i tabela metryk
// P/R/F1/AUC, dla wybranego okna (albo wszystkich zweryfikowanych okien, gdy okno nie jest
// wybrane) — GET /models/:id/evaluation. Formularze zlecają trening ANFIS (POST
// /models/anfis/train) / kalibrację baseline v2 i śledzą postęp przez polling GET /jobs/:id
// (useJob, JOB_POLL_MS); po zakończeniu joba (status 'done') odświeżamy listę modeli.
// KPI w nagłówku liczone z tych samych ewaluacji (spec §4).
import { useEffect, useState } from "react";
import { z } from "zod";
import { MODEL_KINDS, type CalibrateBaselineV2Request, type EvaluationDto, type ModelDto, type TrainRequest } from "@dex-arb/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { useModels, useWindows } from "../api/hooks";
import { useCalibrateBaselineV2, useEvaluation, useJob, useTrainAnfis } from "../api/models";
import { ConfusionMatrix } from "../components/models/ConfusionMatrix";
import { RocChart } from "../components/models/RocChart";
import { ScoreHistogram } from "../components/models/ScoreHistogram";
import { TrainForm } from "../components/models/TrainForm";
import { CalibrateBaselineV2Form } from "../components/models/CalibrateBaselineV2Form";
import { BaselineV2Params } from "../components/models/BaselineV2Params";
import { ApiError } from "../api/client";
import { Loading, ErrorMessage, errorMessage } from "../components/Status";
import { PageHeader } from "../components/ui/PageHeader";
import { Card } from "../components/ui/Card";
import { Badge, JOB_TONE } from "../components/ui/Badge";
import { Bar } from "../components/ui/Bar";
import { EmptyState } from "../components/ui/EmptyState";
import type { StatProps } from "../components/ui/Stat";
import { modelColor } from "../theme";
import { fmtAucCi, fmtInt } from "../format";

const KINDS = MODEL_KINDS.options;
type Kind = (typeof KINDS)[number];
const KIND_PL: Record<Kind, string> = { baseline: "Baseline", baseline_v2: "Baseline v2 (skalibrowany)", mamdani: "Mamdani", anfis: "ANFIS" };

// Ciało 409 z POST /models/anfis/train — ten sam kształt co POST /jobs (`{ error, job }`, patrz
// packages/api/src/routes/jobs.ts i DaneView.tsx) — zadanie zdublowane wskazuje istniejący job.
const ConflictBody = z.object({ job: z.object({ id: z.number() }) });
function conflictJobId(body: unknown): number | undefined {
  const parsed = ConflictBody.safeParse(body);
  return parsed.success ? parsed.data.job.id : undefined;
}

type EvalQuery = UseQueryResult<EvaluationDto, unknown>;

export type MetricRow = { kind: Kind; model: ModelDto; ev: EvaluationDto };

const fmt3 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(3));

export function bestByColumn(rows: MetricRow[]): Record<"precision" | "recall" | "f1" | "auc" | "pr_auc", number | null> {
  const max = (vals: (number | null)[]) => {
    const nums = vals.filter((v): v is number => v != null);
    return nums.length ? Math.max(...nums) : null;
  };
  return {
    precision: max(rows.map((r) => r.ev.precision)),
    recall: max(rows.map((r) => r.ev.recall)),
    f1: max(rows.map((r) => r.ev.f1)),
    auc: max(rows.map((r) => r.ev.auc)),
    pr_auc: max(rows.map((r) => r.ev.pr_auc)),
  };
}

export function modeleStats(models: ModelDto[], rows: MetricRow[]): StatProps[] {
  const withAuc = rows.filter((r) => r.ev.auc != null);
  const best = withAuc.length ? withAuc.reduce((a, b) => (b.ev.auc! > a.ev.auc! ? b : a)) : null;
  const bv2 = rows.find((r) => r.kind === "baseline_v2");
  const labeled = rows.length ? Math.max(...rows.map((r) => r.ev.n)) : 0;
  return [
    { label: "Najlepszy AUC (test)", value: fmt3(best?.ev.auc), hint: best ? `${best.model.name} (v${best.model.version})` : "brak ewaluacji", tone: "accent" },
    { label: "Baseline v2 AUC", value: fmt3(bv2?.ev.auc), hint: bv2 ? `${bv2.model.name} (v${bv2.model.version})` : "brak modelu" },
    { label: "Modele", value: fmtInt(models.length) },
    { label: "Okazje z etykietą", value: fmtInt(labeled), hint: "zweryfikowane, w ewaluacji" },
  ];
}

function ModelPanel({ model, ev }: { model: ModelDto; ev: EvalQuery }) {
  const meta = ev.data
    ? `n = ${ev.data.n.toLocaleString("pl-PL")} · pozytywów = ${ev.data.n_positive.toLocaleString("pl-PL")} · AUC = ${fmtAucCi(ev.data.auc, ev.data.auc_ci95)}`
    : undefined;
  return (
    <Card
      title={
        <>
          <span className="dot" style={{ background: modelColor(model.kind) }} /> {model.name} (v{model.version})
        </>
      }
      meta={meta}
      className="model-panel"
    >
      {ev.isPending ? (
        <Loading />
      ) : ev.error ? (
        <ErrorMessage error={ev.error} />
      ) : !ev.data ? null : (
        <div className="stack">
          {/* Metryki z zadania treningowego liczone na INNEJ populacji (wszystkie block_states,
              tło bez okazji jako klasa 0) — nieporównywalne z AUC ewaluacji wyżej; etykieta
              mówi to wprost. */}
          {model.training_metrics_summary && (
            <p className="training-metrics muted" title="Z zadania treningowego; populacja: wszystkie block_states okna (tło bez okazji jako klasa 0) — nie porównywać z AUC ewaluacji na zweryfikowanych okazjach">
              AUC (trening, wszystkie bloki) = {model.training_metrics_summary.auc.toFixed(3)}, F1 (trening, wszystkie bloki) ={" "}
              {model.training_metrics_summary.f1.toFixed(3)}
            </p>
          )}
          {model.kind === "baseline_v2" && model.params && <BaselineV2Params params={model.params} />}
          <ConfusionMatrix confusion={ev.data.confusion} precision={ev.data.precision} recall={ev.data.recall} f1={ev.data.f1} />
          <ScoreHistogram histogram={ev.data.histogram} title="Rozkład score: skonsumowane z zyskiem vs pozostałe" />
        </div>
      )}
    </Card>
  );
}

export function ModeleView() {
  const models = useModels();
  const windows = useWindows();
  const [windowId, setWindowId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Partial<Record<Kind, number | null>>>({});
  const train = useTrainAnfis();
  const calibrate = useCalibrateBaselineV2();
  const [jobId, setJobId] = useState<number | null>(null);
  const [trainMsg, setTrainMsg] = useState<string | null>(null);
  const job = useJob(jobId);

  const byKind = (kind: Kind): ModelDto[] => (models.data ?? []).filter((m) => m.kind === kind);
  const chosenId = (kind: Kind): number | null => {
    const v = selected[kind];
    if (v !== undefined) return v;
    return byKind(kind).at(-1)?.id ?? null;
  };
  const chosenModel = (kind: Kind): ModelDto | null => byKind(kind).find((m) => m.id === chosenId(kind)) ?? null;

  // Hooki wywoływane po STAŁEJ tablicy KINDS (zawsze te same 4 wywołania w tej samej
  // kolejności) — zgodne z regułami hooków mimo warunkowego renderowania paneli niżej.
  const evals = KINDS.map((kind) => {
    const model = chosenModel(kind);
    return { kind, model, ev: useEvaluation(model?.id ?? null, windowId) };
  });

  // `models.refetch` jest stabilne między renderami (react-query) — celowo poza tablicą
  // zależności, żeby efekt reagował tylko na zmianę statusu joba, nie na każdy render.
  const jobStatus = job.data?.status;
  const refetchModels = models.refetch;
  useEffect(() => {
    if (jobStatus === "done") {
      void refetchModels();
    }
  }, [jobStatus, refetchModels]);

  // Wspólna obsługa wyniku zlecenia (trening ANFIS / kalibracja baseline v2): oba zwracają JobDto
  // (201) i ten sam kształt 409 `{ error, job }`.
  const jobCallbacks = (verb: string) => ({
    onSuccess: (created: { id: number }) => {
      setJobId(created.id);
      setTrainMsg(`Zlecono ${verb} (zadanie #${created.id})`);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        const id = conflictJobId(err.body);
        setTrainMsg(id != null ? `Takie zadanie już czeka lub jest w toku (#${id})` : "Takie zadanie już czeka lub jest w toku");
        return;
      }
      setTrainMsg(errorMessage(err));
    },
  });

  function onTrain(req: TrainRequest) {
    setTrainMsg(null);
    train.mutate(req, jobCallbacks("trening"));
  }

  function onCalibrate(req: CalibrateBaselineV2Request) {
    setTrainMsg(null);
    calibrate.mutate(req, jobCallbacks("kalibrację baseline v2"));
  }

  if (models.isPending || windows.isPending) return <Loading />;
  if (models.error || windows.error) return <ErrorMessage error={models.error ?? windows.error} />;

  const rows: MetricRow[] = evals
    .filter((e): e is typeof e & { model: ModelDto; ev: EvalQuery & { data: EvaluationDto } } => e.model != null && e.ev.data != null)
    .map((e) => ({ kind: e.kind, model: e.model, ev: e.ev.data }));
  const best = bestByColumn(rows);
  const rocSeries = rows.map((r) => ({ name: `${KIND_PL[r.kind]}: ${r.model.name}`, auc: r.ev.auc, roc: r.ev.roc, kind: r.kind }));

  const jobDone = job.data != null && (job.data.status === "done" || job.data.status === "failed");
  const pending = jobId != null && !jobDone;
  const winName = windows.data.find((w) => w.id === windowId)?.name ?? "wszystkie zweryfikowane okna";

  return (
    <>
      <PageHeader crumbs={["Modele"]} title="Modele" context={`ewaluacja: ${winName}`} stats={modeleStats(models.data, rows)} />
      <div className="toolbar">
        <label className="field">
          <span className="label">Okno</span>
          <select aria-label="Okno" value={windowId ?? ""} onChange={(e) => setWindowId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">wszystkie zweryfikowane</option>
            {windows.data.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        {KINDS.map((kind) => (
          <label key={kind} className="field">
            <span className="label">{KIND_PL[kind]}</span>
            <select
              aria-label={KIND_PL[kind]}
              value={chosenId(kind) ?? ""}
              onChange={(e) => setSelected((s) => ({ ...s, [kind]: e.target.value ? Number(e.target.value) : null }))}
            >
              <option value="">—</option>
              {byKind(kind).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} (v{m.version})
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="stack">
        <Card title="Porównanie" meta={`${fmtInt(rows.length)} modeli z ewaluacją`} padded={false}>
          {rows.length === 0 ? (
            <EmptyState title="Brak ewaluacji." hint="Wybierz modele w polach powyżej albo zweryfikuj okazje w widoku Dane." />
          ) : (
            <div className="table-scroll">
              <table className="table compare" aria-label="Metryki modeli">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Rodzaj</th>
                    <th className="num">Precyzja</th>
                    <th className="num">Czułość</th>
                    <th className="num">F1</th>
                    <th className="num">PR-AUC</th>
                    <th className="num">AUC</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.kind}>
                      <td className="key">
                        <span className="dot" style={{ background: modelColor(r.kind) }} /> {r.model.name}
                      </td>
                      <td className="muted">{KIND_PL[r.kind]}</td>
                      <td className={r.ev.precision === best.precision ? "num best" : "num"}>{fmt3(r.ev.precision)}</td>
                      <td className={r.ev.recall === best.recall ? "num best" : "num"}>{fmt3(r.ev.recall)}</td>
                      <td className={r.ev.f1 === best.f1 ? "num best" : "num"}>{fmt3(r.ev.f1)}</td>
                      <td className={r.ev.pr_auc != null && r.ev.pr_auc === best.pr_auc ? "num best" : "num"}>{fmt3(r.ev.pr_auc)}</td>
                      <td className={r.ev.auc != null && r.ev.auc === best.auc ? "num best" : "num"} title="AUC [95 % CI, bootstrap 1000 prób]">
                        {fmtAucCi(r.ev.auc, r.ev.auc_ci95)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {rocSeries.length > 0 && <RocChart series={rocSeries} />}

        <div className="model-grid">{evals.map((e) => e.model && <ModelPanel key={e.kind} model={e.model} ev={e.ev} />)}</div>

        <div className="two-col">
          <Card title="Trening ANFIS" meta="POST /models/anfis/train">
            <TrainForm windows={windows.data} pending={train.isPending || pending} onSubmit={onTrain} />
          </Card>
          <Card title="Kalibracja baseline v2" meta="POST /models/baseline_v2/calibrate">
            <CalibrateBaselineV2Form windows={windows.data} pending={calibrate.isPending || pending} onSubmit={onCalibrate} />
          </Card>
        </div>

        {(trainMsg || job.data) && (
          <Card title="Zadanie">
            {trainMsg && (
              <p className="status status--info" role="status">
                {trainMsg}
              </p>
            )}
            {job.data && (
              <div className="job-status">
                <span className="mono">#{job.data.id}</span>
                <Badge tone={JOB_TONE[job.data.status]}>{job.data.status}</Badge>
                <Bar value={job.data.progress / 100} tone={job.data.status === "failed" ? "danger" : job.data.status === "done" ? "ok" : "accent"} label={`postęp #${job.data.id}`} />
                <span className="num">{job.data.progress}%</span>
                {job.data.error && <p className="job-error">{job.data.error}</p>}
              </div>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
