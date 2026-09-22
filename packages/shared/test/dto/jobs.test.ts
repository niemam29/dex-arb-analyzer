import { describe, it, expect } from "vitest";
import { JobCreate, JobDto, JobList } from "../../src/dto/jobs.js";

describe("JobCreate", () => {
  it("akceptuje ingest:pool-window z poolId i windowId", () => {
    const r = JobCreate.safeParse({ type: "ingest:pool-window", params: { poolId: 1, windowId: 2 } });
    expect(r.success).toBe(true);
  });
  it("odrzuca analyze:pair-window bez pairId", () => {
    const r = JobCreate.safeParse({ type: "analyze:pair-window", params: { windowId: 2 } });
    expect(r.success).toBe(false);
  });
  it("odrzuca nieznany typ", () => {
    expect(JobCreate.safeParse({ type: "foo", params: {} }).success).toBe(false);
  });
  it("akceptuje pozostałe typy z JOB_TYPES (import:csv, verify:pair-window i train mają ścisłe schematy)", () => {
    expect(
      JobCreate.safeParse({
        type: "import:csv",
        params: { path: "x.csv", poolAliases: { uniswap: 1, sushiswap: 2 } },
      }).success,
    ).toBe(true);
    expect(JobCreate.safeParse({ type: "verify:pair-window", params: { pairId: 1, windowId: 2 } }).success).toBe(true);
    expect(JobCreate.safeParse({ type: "verify:pair-window", params: {} }).success).toBe(false);
    expect(JobCreate.safeParse({ type: "train", params: { trainWindows: [1], epochs: 5 } }).success).toBe(true);
    expect(JobCreate.safeParse({ type: "train", params: { epochs: 5 } }).success).toBe(false); // trainWindows wymagane
    expect(JobCreate.safeParse({ type: "calibrate:baseline_v2", params: { trainWindows: [1] } }).success).toBe(true);
    expect(JobCreate.safeParse({ type: "calibrate:baseline_v2", params: {} }).success).toBe(false);
  });
});

describe("JobDto", () => {
  const base = {
    id: 1,
    type: "ingest:pool-window" as const,
    params: { poolId: 1, windowId: 1 },
    status: "running" as const,
    progress: 12,
    log: "",
    error: null,
    attempts: 1,
    created_at: "2026-08-26T10:00:00.000Z",
    started_at: "2026-08-26T10:00:01.000Z",
    finished_at: null,
  };

  it("parsuje rekord z bazy z datami jako ISO string", () => {
    const r = JobDto.parse(base);
    expect(r.progress).toBe(12);
  });
  it("odrzuca status 'pending' (job_status DB enum nie ma tej wartości)", () => {
    expect(JobDto.safeParse({ ...base, status: "pending" }).success).toBe(false);
  });
  it("odrzuca progress spoza 0–100 lub niecałkowity", () => {
    expect(JobDto.safeParse({ ...base, progress: 101 }).success).toBe(false);
    expect(JobDto.safeParse({ ...base, progress: 12.5 }).success).toBe(false);
  });
  it("odrzuca nieznany typ zadania", () => {
    expect(JobDto.safeParse({ ...base, type: "unknown:job" }).success).toBe(false);
  });
});

describe("JobList", () => {
  it("parsuje pustą tablicę", () => {
    expect(JobList.parse([])).toEqual([]);
  });
});
