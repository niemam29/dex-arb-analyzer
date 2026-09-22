// Handler zadania verify:pair-window: orkiestruje runVerifyPairWindow (@dex-arb/analysis) —
// wypełnia opportunity_verifications dla okazji pary w oknie. db/rpc wstrzykiwane przez
// fabrykę (konwencja `makeX(deps)` z @dex-arb/ingest — makeIngestPoolWindow/makeImportCsv,
// i @dex-arb/worker — makeAnalyzePairWindow), a nie przez JobContext, bo kontrakt JobContext
// ich nie niesie.
import { createDrizzleVerifyRepo, runVerifyPairWindow } from "@dex-arb/analysis";
import type { VerifyPairWindowParams, JobHandler } from "@dex-arb/shared";
import type { Db } from "@dex-arb/db";
import type { RpcClient } from "@dex-arb/ingest";

export function makeVerifyPairWindow({ db, rpc }: { db: Db; rpc: RpcClient }): JobHandler<VerifyPairWindowParams> {
  const repo = createDrizzleVerifyRepo(db);
  return async ({ pairId, windowId, force }, ctx) => {
    const result = await runVerifyPairWindow({ pairId, windowId, ...(force !== undefined && { force }) }, { repo, rpc, ctx });
    await ctx.log(`Zakończono: ${result.total} okazji, wynik ${JSON.stringify(result.byStatus)}`);
  };
}
