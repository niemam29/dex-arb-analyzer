// GET /live (spec §6): ostatnia próbka panelu na żywo z magazynu wstrzykniętego w server.ts
// (`LiveStoreLike`). Zawsze 200 — także `stale` (błąd RPC) i `enabled=false` (brak store), żeby
// widok nie mylił awarii RPC z awarią API. `LiveSnapshotDto.parse` = kontrola kontraktu wyjścia
// (jak w routes/catalog.ts): niezgodność -> 500.
import type { FastifyPluginAsync } from "fastify";
import { LiveQuery, LiveSnapshotDto, emptyLiveSnapshot } from "@dex-arb/shared";
import { parseOr400 } from "../plugins/zod.js";

export const liveRoutes: FastifyPluginAsync = async (app) => {
  app.get("/live", async (req) => {
    parseOr400(LiveQuery, req.query);
    return LiveSnapshotDto.parse(app.live ? app.live.snapshot() : emptyLiveSnapshot(false));
  });
};
