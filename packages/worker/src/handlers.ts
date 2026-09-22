// Rejestr handlerów zadań. Wszystkie typy z JOB_TYPES mają handler. Konfiguracja RPC (`env`)
// jest wstrzykiwana przez wywołującego (`index.ts` czyta ją z process.env przez `loadIngestEnv`),
// żeby moduł dał się zbudować w testach bez `.env`.
import type { Db } from "@dex-arb/db";
import { RpcClient, makeIngestPoolWindow, makeImportCsv, type IngestEnv } from "@dex-arb/ingest";
import { makeAnalyzePairWindow } from "./jobs/analyzePairWindow.js";
import { makeVerifyPairWindow } from "./jobs/verifyPairWindow.js";
import { makeTrain } from "./jobs/train.js";
import { makeCalibrateBaselineV2 } from "./jobs/calibrateBaselineV2.js";
import type { HandlerRegistry } from "./types.js";

export function buildHandlers(db: Db, env: IngestEnv): HandlerRegistry {
  const rpc = new RpcClient({ urls: env.rpcUrls });
  return {
    "ingest:pool-window": makeIngestPoolWindow({ db, rpc, env }),
    "import:csv": makeImportCsv({ db }),
    "analyze:pair-window": makeAnalyzePairWindow({ db }),
    "verify:pair-window": makeVerifyPairWindow({ db, rpc }),
    train: makeTrain({ db }),
    "calibrate:baseline_v2": makeCalibrateBaselineV2({ db }),
  };
}
