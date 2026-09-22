// Handler zadania analyze:pair-window: orkiestruje analyzePairWindow (@dex-arb/analysis) —
// wypełnia block_states/opportunities/model_scores dla pary w oknie. db wstrzykiwana przez
// fabrykę (konwencja `makeX(deps)` z @dex-arb/ingest — makeIngestPoolWindow/makeImportCsv), a nie
// przez JobContext, bo kontrakt JobContext jej nie niesie.
import { analyzePairWindow } from "@dex-arb/analysis";
import type { AnalyzePairWindowParams, JobHandler } from "@dex-arb/shared";
import type { Db } from "@dex-arb/db";

export function makeAnalyzePairWindow({ db }: { db: Db }): JobHandler<AnalyzePairWindowParams> {
  return async ({ pairId, windowId }, ctx) => {
    const result = await analyzePairWindow(db, { pairId, windowId }, { log: ctx.log, progress: ctx.progress, signal: ctx.signal });
    await ctx.log(`Zakończono: ${result.blocks} bloków, ${result.opportunities} okazji`);
  };
}
