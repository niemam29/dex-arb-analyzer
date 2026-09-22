// Blok `provenance` zapisywany w `scoring_models.metrics` przez zadania `train` i
// `calibrate:baseline_v2`: co (git SHA, wersje), na czym (host RPC bez poświadczeń, zakresy bloków i
// liczności tabel per okno w chwili treningu) i jak długo. Bez tego tabela wyników w pracy jest
// nieodtwarzalna — liczności okien zmieniają się po każdym re-ingeście/reweryfikacji.
import { sql } from "drizzle-orm";
import { gitSha, packageVersion, rpcHostFrom, type Db } from "@dex-arb/db";
import { ProvenanceSchema, type Provenance } from "@dex-arb/shared";

interface WindowCountRow {
  id: number;
  from_block: number | null;
  to_block: number | null;
  block_states: number;
  opportunities: number;
  verified: number;
}

export async function collectProvenance(db: Db, windowIds: number[], startedAt: number): Promise<Provenance> {
  const uniq = [...new Set(windowIds)].sort((a, b) => a - b);
  let windows: WindowCountRow[] = [];
  if (uniq.length > 0) {
    const idList = sql.join(uniq.map((id) => sql`${id}`), sql`, `);
    windows = (await db.execute(sql`
      SELECT w.id, w.from_block::int AS from_block, w.to_block::int AS to_block,
        (SELECT count(*)::int FROM block_states bs WHERE bs.window_id = w.id) AS block_states,
        (SELECT count(*)::int FROM opportunities o WHERE o.window_id = w.id) AS opportunities,
        (SELECT count(*)::int FROM opportunities o JOIN opportunity_verifications ov ON ov.opportunity_id = o.id WHERE o.window_id = w.id) AS verified
      FROM windows w WHERE w.id IN (${idList}) ORDER BY w.id
    `)) as unknown as WindowCountRow[];
  }
  return ProvenanceSchema.parse({
    gitSha: gitSha(),
    nodeVersion: process.version,
    deps: { "@thi.ng/fuzzy": packageVersion("@thi.ng/fuzzy"), "drizzle-orm": packageVersion("drizzle-orm") },
    rpcHost: rpcHostFrom(process.env.RPC_URL),
    windows: windows.map((w) => ({ id: w.id, fromBlock: w.from_block, toBlock: w.to_block, blockStates: w.block_states, opportunities: w.opportunities, verified: w.verified })),
    durationMs: Math.max(0, Date.now() - startedAt),
    createdAt: new Date().toISOString(),
  });
}
