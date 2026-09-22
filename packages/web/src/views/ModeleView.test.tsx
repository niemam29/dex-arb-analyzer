// Dymny test widoku Modele: metryki dwóch modeli, wysłanie żądania treningu z poprawnym ciałem
// i obsługa 409 (zdublowane zadanie treningu) — z zamockowanym fetch, jak
// OkazjeView.test.tsx/DaneView.test.tsx.
import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { EvaluationDto, ModelDto } from "@dex-arb/shared";
import { ModeleView, modeleStats, bestByColumn, type MetricRow } from "./ModeleView";

const windowsBody = [
  { id: 1, name: "maj 2021", from_ts: "2021-05-14T00:00:00Z", to_ts: "2021-05-26T00:00:00Z", from_block: 1, to_block: 1000 },
  { id: 2, name: "listopad 2022", from_ts: "2022-11-01T00:00:00Z", to_ts: "2022-11-14T00:00:00Z", from_block: 2000, to_block: 3000 },
];

const modelsBody = [
  { id: 1, name: "mamdani-v1", kind: "mamdani", version: 1, created_at: "2026-01-01T00:00:00Z" },
  {
    id: 3,
    name: "baseline_v2",
    kind: "baseline_v2",
    version: 1,
    created_at: "2026-01-03T00:00:00Z",
    params: { gasUnits: 150000, gasPriceFactor: 0.5, threshold: 0.42, weightOptTrade: 0, scale: 12.5, optTradeQuantiles: [0, 1] },
  },
  {
    id: 2,
    name: "ANFIS v1",
    kind: "anfis",
    version: 1,
    created_at: "2026-01-02T00:00:00Z",
    training_metrics_summary: { population: "block_states", auc: 0.999, f1: 0.42 },
  },
];

function evaluationFor(modelId: number) {
  const model = modelsBody.find((m) => m.id === modelId)!;
  return {
    model: { id: model.id, name: model.name, kind: model.kind, version: model.version },
    window: null,
    n: 8,
    n_positive: 4,
    confusion: { tp: 3, fp: 1, tn: 3, fn: 1 },
    precision: 0.75,
    recall: 0.75,
    f1: 0.75,
    auc: modelId === 1 ? 0.8 : modelId === 3 ? 0.71 : 0.92,
    auc_ci95: [0.7, 0.9],
    pr_auc: 0.42,
    roc: { fpr: [0, 0.25, 1], tpr: [0, 0.75, 1] },
    histogram: { edges: [0, 50, 100], positive: [1, 3], negative: [3, 1] },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function baseFetchMock() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/models/1/evaluation")) return Promise.resolve(jsonResponse(evaluationFor(1)));
    if (url.includes("/api/models/2/evaluation")) return Promise.resolve(jsonResponse(evaluationFor(2)));
    if (url.includes("/api/models/3/evaluation")) return Promise.resolve(jsonResponse(evaluationFor(3)));
    if (url.includes("/api/models")) return Promise.resolve(jsonResponse(modelsBody));
    if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
    return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
  });
}

afterEach(() => vi.unstubAllGlobals());

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ModeleView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("renderuje metryki dla dwóch modeli (mamdani i anfis)", async () => {
  vi.stubGlobal("fetch", baseFetchMock());
  renderView();

  await waitFor(() => expect(screen.getByText("mamdani-v1")).toBeInTheDocument());
  expect(screen.getByText("ANFIS v1")).toBeInTheDocument();

  const table = screen.getByRole("table", { name: "Metryki modeli" });
  expect(table.textContent).toContain("0,800 [0,70–0,90]");
  expect(table.textContent).toContain("0,920 [0,70–0,90]");
  expect(screen.getAllByText(/\[0,70–0,90\]/).length).toBeGreaterThan(0);
});

it("metryki treningowe ANFIS (training_metrics_summary) są opisane jako 'trening, wszystkie bloki', osobno od AUC ewaluacji", async () => {
  vi.stubGlobal("fetch", baseFetchMock());
  renderView();

  await waitFor(() => expect(screen.getByText("ANFIS v1")).toBeInTheDocument());
  const training = await screen.findByText(/AUC \(trening, wszystkie bloki\) = 0\.999/);
  expect(training.textContent).toContain("F1 (trening, wszystkie bloki) = 0.420");
  // AUC ewaluacji (0.920) nadal w tabeli; 0.999 nie trafia do tabeli metryk ewaluacji
  const table = screen.getByRole("table", { name: "Metryki modeli" });
  expect(table.textContent).not.toContain("0.999");
  // mamdani bez metryk treningowych — tylko jeden taki wiersz w widoku
  expect(screen.getAllByText(/trening, wszystkie bloki/)).toHaveLength(1);
});

it("wysyła żądanie treningu z poprawnym ciałem (TrainRequest snake_case)", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/models/anfis/train")) {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve(
        jsonResponse(
          {
            id: 42,
            type: "train",
            params: {},
            status: "queued",
            progress: 0,
            log: "",
            error: null,
            attempts: 0,
            created_at: "2026-08-26T10:00:00.000Z",
            started_at: null,
            finished_at: null,
          },
          201,
        ),
      );
    }
    if (url.includes("/api/jobs/42")) {
      return Promise.resolve(
        jsonResponse({
          id: 42,
          type: "train",
          params: {},
          status: "queued",
          progress: 0,
          log: "",
          error: null,
          attempts: 0,
          created_at: "2026-08-26T10:00:00.000Z",
          started_at: null,
          finished_at: null,
        }),
      );
    }
    if (url.includes("/api/models/1/evaluation")) return Promise.resolve(jsonResponse(evaluationFor(1)));
    if (url.includes("/api/models/2/evaluation")) return Promise.resolve(jsonResponse(evaluationFor(2)));
    if (url.includes("/api/models/3/evaluation")) return Promise.resolve(jsonResponse(evaluationFor(3)));
    if (url.includes("/api/models")) return Promise.resolve(jsonResponse(modelsBody));
    if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
    return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  renderView();

  await waitFor(() => expect(screen.getByText("mamdani-v1")).toBeInTheDocument());

  await userEvent.click(screen.getByLabelText("trening: maj 2021"));
  await userEvent.click(screen.getByLabelText("test: listopad 2022"));
  await userEvent.click(screen.getByRole("button", { name: "Trenuj ANFIS" }));

  await waitFor(() => expect(calls.length).toBe(1));
  expect(calls[0]!.body).toMatchObject({ train_windows: [1], test_windows: [2] });
  await waitFor(() => expect(screen.getByText(/Zlecono trening \(zadanie #42\)/)).toBeInTheDocument());
});

it("obsługuje 409 (zdublowane zadanie treningu)", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/models/anfis/train")) {
      return Promise.resolve(jsonResponse({ error: "Takie zadanie już czeka lub jest w toku", job: { id: 7 } }, 409));
    }
    if (url.includes("/api/models/1/evaluation")) return Promise.resolve(jsonResponse(evaluationFor(1)));
    if (url.includes("/api/models/2/evaluation")) return Promise.resolve(jsonResponse(evaluationFor(2)));
    if (url.includes("/api/models/3/evaluation")) return Promise.resolve(jsonResponse(evaluationFor(3)));
    if (url.includes("/api/models")) return Promise.resolve(jsonResponse(modelsBody));
    if (url.includes("/api/windows")) return Promise.resolve(jsonResponse(windowsBody));
    return Promise.reject(new Error(`nieoczekiwany fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  renderView();

  await waitFor(() => expect(screen.getByText("mamdani-v1")).toBeInTheDocument());

  await userEvent.click(screen.getByLabelText("trening: maj 2021"));
  await userEvent.click(screen.getByRole("button", { name: "Trenuj ANFIS" }));

  await waitFor(() => expect(screen.getByText(/Takie zadanie już czeka lub jest w toku \(#7\)/)).toBeInTheDocument());
});

it("pokazuje baseline v2 z parametrami kalibracji i wysyła żądanie kalibracji (CalibrateBaselineV2Request)", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const base = baseFetchMock();
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/models/baseline_v2/calibrate")) {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve(
        jsonResponse(
          { id: 43, type: "calibrate:baseline_v2", params: {}, status: "queued", progress: 0, log: "", error: null, attempts: 0, created_at: "2026-08-26T10:00:00.000Z", started_at: null, finished_at: null },
          201,
        ),
      );
    }
    if (url.includes("/api/jobs/43")) {
      return Promise.resolve(
        jsonResponse({ id: 43, type: "calibrate:baseline_v2", params: {}, status: "queued", progress: 0, log: "", error: null, attempts: 0, created_at: "2026-08-26T10:00:00.000Z", started_at: null, finished_at: null }),
      );
    }
    return base(input);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderView();

  await waitFor(() => expect(screen.getByText("baseline_v2")).toBeInTheDocument());
  const params = screen.getByLabelText("Parametry baseline v2");
  expect(params.textContent).toContain("150");
  expect(params.textContent).toContain("0,5");
  const table = screen.getByRole("table", { name: "Metryki modeli" });
  expect(table.textContent).toContain("0,710 [0,70–0,90]");

  await userEvent.click(screen.getByLabelText("kalibracja: maj 2021"));
  await userEvent.click(screen.getByLabelText("holdout: listopad 2022"));
  await userEvent.click(screen.getByRole("button", { name: "Kalibruj baseline v2" }));

  await waitFor(() => expect(calls.length).toBe(1));
  expect(calls[0]!.body).toEqual({ train_windows: [1], test_windows: [2] });
  await waitFor(() => expect(screen.getByText(/Zlecono kalibrację baseline v2 \(zadanie #43\)/)).toBeInTheDocument());
});

it("modeleStats i bestByColumn: najlepszy AUC, AUC baseline v2, liczba modeli, okazje z etykietą; najlepsze wartości per kolumna", () => {
  // `modelsBody`/`evaluationFor` to literały pod fetch-mock (kind/status jako string) — rzutujemy
  // na typy DTO, bo tu wołamy czyste funkcje bezpośrednio.
  const rows: MetricRow[] = [1, 3, 2].map((id) => {
    const m = modelsBody.find((x) => x.id === id)! as unknown as ModelDto;
    return { kind: m.kind, model: m, ev: evaluationFor(id) as unknown as EvaluationDto };
  });
  const stats = modeleStats(modelsBody as unknown as ModelDto[], rows);
  expect(stats.map((s) => s.label)).toEqual(["Najlepszy AUC (test)", "Baseline v2 AUC", "Modele", "Okazje z etykietą"]);
  expect(stats[0]!.value).toBe("0.920");
  expect(stats[0]!.hint).toBe("ANFIS v1 (v1)");
  expect(stats[1]!.value).toBe("0.710");
  expect(stats[2]!.value).toBe("3");
  expect(stats[3]!.value).toBe("8");
  expect(bestByColumn(rows)).toEqual({ precision: 0.75, recall: 0.75, f1: 0.75, auc: 0.92, pr_auc: 0.42 });
});

it("karta Porównanie: kropka koloru modelu i wyróżniony najlepszy AUC klasą .best", async () => {
  vi.stubGlobal("fetch", baseFetchMock());
  renderView();
  await waitFor(() => expect(screen.getByText("ANFIS v1")).toBeInTheDocument());
  const table = screen.getByRole("table", { name: "Metryki modeli" });
  expect(table.querySelectorAll(".dot")).toHaveLength(3);
  const best = table.querySelectorAll("td.best");
  expect(Array.from(best).map((td) => td.textContent)).toContain("0,920 [0,70–0,90]");
  expect(screen.getByRole("heading", { level: 2, name: "Modele" })).toBeInTheDocument();
  expect(screen.getByText("Najlepszy AUC (test)").nextElementSibling).toHaveTextContent("0.920");
});
