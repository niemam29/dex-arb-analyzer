import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { COLUMN_DOCS, renderDataDictionary, schemaTables } from "../scripts/data-dictionary-render.js";

describe("data-dictionary", () => {
  const md = renderDataDictionary();
  it("ma sekcję dla każdej tabeli schematu", () => {
    for (const t of schemaTables()) expect(md).toContain(`## ${getTableConfig(t).name}`);
    // dexes, tokens, pairs, pools, windows, blocks, sync_events, swap_events, ingest_ranges,
    // block_states, opportunities, opportunity_verifications, scoring_models, model_scores, jobs
    expect(schemaTables().length).toBe(15);
  });
  it("kolumny z jednostkami mają jednostkę i opis; każdy wpis COLUMN_DOCS wskazuje istniejącą kolumnę", () => {
    expect(md).toMatch(/\| gas_price_median \| numeric\(40, 0\) \|[^|]*\|[^|]*\| WEI \|/);
    expect(md).toMatch(/\| gas_price_median \| double precision \|[^|]*\|[^|]*\| GWEI \|/);
    const existing = new Set(schemaTables().flatMap((t) => getTableConfig(t).columns.map((c) => `${getTableConfig(t).name}.${c.name}`)));
    for (const key of Object.keys(COLUMN_DOCS)) expect(existing.has(key), key).toBe(true);
  });
  it("wypisuje klucze, FK, UNIQUE i CHECK-i (nazwa + warunek)", () => {
    expect(md).toContain("PK: (pair_id, block)");
    expect(md).toContain("FK: pair_id → pairs.id");
    expect(md).toContain("UNIQUE scoring_models_name_version_unique (name, version)");
    expect(md).toMatch(/CHECK block_states_feature_ranges_check: .*"s" >= 0/);
    expect(md).toContain("opportunity_verifications_route_status_check");
  });
});
