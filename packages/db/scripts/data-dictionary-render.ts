// Słownik danych z modelu Drizzle (tabele, kolumny, typy, klucze, FK, UNIQUE, CHECK) + ręczna mapa
// jednostek/opisów COLUMN_DOCS — to ona jest źródłem migracji 0008 (COMMENT ON COLUMN) i kolumny
// „Jednostka/opis" w docs/data-dictionary.md. Czysta funkcja: bez połączenia z bazą.
import { PgDialect, PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { getTableName, is } from "drizzle-orm";
import * as schema from "../src/schema/index.js";

export const COLUMN_DOCS: Record<string, { unit: string; description: string }> = {
  "blocks.timestamp": { unit: "UTC", description: "Znacznik czasu bloku (timestamptz)." },
  "blocks.base_fee": { unit: "WEI", description: "baseFeePerGas; NULL przed EIP-1559 (blok 12 965 000)." },
  "blocks.gas_price_median": { unit: "WEI", description: "Mediana gasPrice wszystkich tx bloku. UWAGA: block_states.gas_price_median jest w GWEI." },
  "blocks.tx_count": { unit: "—", description: "Liczba transakcji w bloku." },
  "sync_events.reserve0": { unit: "jedn. natywne token0", description: "Rezerwa token0 po zdarzeniu Sync (uint112)." },
  "sync_events.reserve1": { unit: "jedn. natywne token1", description: "Rezerwa token1 po zdarzeniu Sync (uint112)." },
  "swap_events.amount0_in": { unit: "jedn. natywne token0", description: "Wpłata token0 w swapie." },
  "swap_events.amount0_out": { unit: "jedn. natywne token0", description: "Wypłata token0 w swapie." },
  "swap_events.amount1_in": { unit: "jedn. natywne token1", description: "Wpłata token1 w swapie." },
  "swap_events.amount1_out": { unit: "jedn. natywne token1", description: "Wypłata token1 w swapie." },
  "swap_events.gas_price": { unit: "WEI", description: "Efektywna cena gazu tx swapu; NULL tylko po imporcie CSV." },
  "ingest_ranges.from_block": { unit: "blok", description: "Początek chunku ingestu (włącznie)." },
  "ingest_ranges.to_block": { unit: "blok", description: "Koniec chunku ingestu (włącznie)." },
  "windows.from_ts": { unit: "UTC", description: "Początek okna [from, to)." },
  "windows.to_ts": { unit: "UTC", description: "Koniec okna (wyłącznie)." },
  "windows.from_block": { unit: "blok", description: "Pierwszy blok o ts ≥ from_ts (seed-data lub binary search RPC)." },
  "windows.to_block": { unit: "blok", description: "Ostatni blok o ts < to_ts." },
  "block_states.price_a": { unit: "quote/base", description: "Cena w puli A (Uniswap V2): quote za 1 base." },
  "block_states.price_b": { unit: "quote/base", description: "Cena w puli B (Sushiswap)." },
  "block_states.spread_pct": { unit: "%", description: "|p_A − p_B| / min(p_A, p_B) · 100 (bez obcięcia)." },
  "block_states.tvl_min_usd": { unit: "USD", description: "TVL płytszej puli (2 · rezerwa quote · quoteUsd)." },
  "block_states.gas_price_median": { unit: "GWEI", description: "Cena gazu bloku, interpolowana dla bloków bez zdarzeń." },
  "block_states.swaps_in_block": { unit: "—", description: "Liczba Swapów obu pul w bloku." },
  "block_states.s": { unit: "%", description: "Cecha S = spread obcięty do 3." },
  "block_states.g": { unit: "% z 50 000 USD", description: "Cecha G = koszt gazu 220k · gwei · ETHUSD / 50 000 · 100, obcięty do 2." },
  "block_states.l": { unit: "mln USD", description: "Cecha L = tvl_min_usd / 1e6, obcięta do 100." },
  "block_states.m": { unit: "pkt 0–100", description: "Cecha M = 50 % percentyl swapów + 50 % percentyl gazu (w oknie)." },
  "block_states.opt_trade_usd": { unit: "USD", description: "Optymalny wolumen arbitrażu dwupulowego." },
  "block_states.baseline_net_profit_usd": { unit: "USD", description: "gross − 220k · gwei · ETHUSD (baseline v1)." },
  "block_states.gross_profit_usd": { unit: "USD", description: "Zysk brutto arbitrażu (0 bez kierunku)." },
  "block_states.direction": { unit: "—", description: "a_to_b: base tańszy na Uniswap (kup tam, sprzedaj na Sushi); b_to_a odwrotnie; none." },
  "opportunities.spread_pct": { unit: "%", description: "Spread bloku-okazji (> 0,65 %)." },
  "opportunities.est_profit_usd": { unit: "USD", description: "Szacunek a priori zysku netto (baseline v1)." },
  "opportunity_verifications.realized_profit_usd": { unit: "USD", description: "Netto beneficjenta w tokenach pary (ETH≡WETH); NULL dla route = multi." },
  "opportunity_verifications.gas_used": { unit: "gaz", description: "gasUsed tx konsumującej." },
  "opportunity_verifications.gas_cost_usd": { unit: "USD", description: "gasUsed · effectiveGasPrice · ETHUSD bloku konsumpcji." },
  "opportunity_verifications.blocks_to_consumption": { unit: "bloki", description: "Blok tx − blok okazji, 0..3 (K_MAX)." },
  "opportunity_verifications.profitable_consumed": { unit: "—", description: "consumed_atomic ∧ two_pool ∧ realized − gas > 0 (etykieta uczenia)." },
  "opportunity_verifications.route": { unit: "—", description: "two_pool = zysk policzalny; multi = agregator/więcej pul, etykieta nieokreślona; NULL poza consumed_atomic." },
  "scoring_models.params": { unit: "JSON", description: "Parametry modelu (MamdaniParams / AnfisParams / BaselineV2Params)." },
  "scoring_models.metrics": { unit: "JSON", description: "AnfisMetrics / BaselineV2Metrics (population_block_states, population_verified, provenance) — schemat w @dex-arb/shared." },
  "model_scores.score": { unit: "score 0–100", description: "Wynik modelu; ≥ 50 = klasa pozytywna." },
  "jobs.progress": { unit: "%", description: "Postęp zadania 0–100." },
  "jobs.params": { unit: "JSON", description: "Parametry zadania (schematy w @dex-arb/shared jobs.ts)." },
};

export function schemaTables(): PgTable[] {
  // `is()` zwraca `value is InstanceType<typeof PgTable>`, niekompatybilne jako predykat zawężający
  // dla unii konkretnych `PgTableWithColumns<...>` z `schema` przy exactOptionalPropertyTypes —
  // filtrujemy przez `is()` i rzutujemy wynik.
  return Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[];
}

const dialect = new PgDialect();

export function renderDataDictionary(): string {
  const out: string[] = ["# Słownik danych", "", "Generowany: `npm run data-dictionary` (`packages/db/scripts/data-dictionary.ts`) z modelu Drizzle `packages/db/src/schema/*.ts` + mapy jednostek `COLUMN_DOCS`. Nie edytować ręcznie.", ""];
  for (const table of schemaTables()) {
    const cfg = getTableConfig(table);
    out.push(`## ${cfg.name}`, "");
    out.push("| Kolumna | Typ | NOT NULL | Domyślna | Jednostka | Opis |", "|---|---|---|---|---|---|");
    for (const c of cfg.columns) {
      const doc = COLUMN_DOCS[`${cfg.name}.${c.name}`];
      const def = c.default === undefined ? "" : typeof c.default === "object" && c.default !== null && "queryChunks" in (c.default as object) ? dialect.sqlToQuery(c.default as never).sql : JSON.stringify(c.default);
      out.push(`| ${c.name} | ${c.getSQLType()} | ${c.notNull ? "tak" : ""} | ${def} | ${doc?.unit ?? ""} | ${doc?.description ?? ""} |`);
    }
    out.push("");
    const keys: string[] = [];
    for (const pk of cfg.primaryKeys) keys.push(`PK: (${pk.columns.map((c) => c.name).join(", ")})`);
    for (const c of cfg.columns) if (c.primary) keys.push(`PK: (${c.name})`);
    for (const fk of cfg.foreignKeys) {
      const r = fk.reference();
      keys.push(`FK: ${r.columns.map((c) => c.name).join(", ")} → ${getTableName(r.foreignTable)}.${r.foreignColumns.map((c) => c.name).join(", ")}${fk.onDelete ? ` ON DELETE ${fk.onDelete.toUpperCase()}` : ""}`);
    }
    for (const u of cfg.uniqueConstraints) keys.push(`UNIQUE ${u.name ?? ""} (${u.columns.map((c) => c.name).join(", ")})`);
    for (const c of cfg.columns) if (c.isUnique) keys.push(`UNIQUE (${c.name})`);
    for (const ch of cfg.checks) keys.push(`CHECK ${ch.name}: ${dialect.sqlToQuery(ch.value).sql}`);
    for (const ix of cfg.indexes) keys.push(`INDEX ${ix.config.name}${ix.config.unique ? " UNIQUE" : ""} (${ix.config.columns.map((c) => ("name" in c ? String(c.name) : "wyrażenie")).join(", ")})${ix.config.where ? ` WHERE ${dialect.sqlToQuery(ix.config.where).sql}` : ""}`);
    if (keys.length) out.push(...keys.map((k) => `- ${k}`), "");
  }
  return out.join("\n");
}
