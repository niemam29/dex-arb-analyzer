import { z } from "zod";

const schema = z.object({
  RPC_URL: z.string().url({ message: "RPC_URL musi być poprawnym URL" }),
  RPC_FALLBACK_URLS: z.string().optional().default(""),
  RPC_CONCURRENCY: z.coerce.number().int().positive().default(4),
  LOGS_CHUNK_BLOCKS: z.coerce.number().int().positive().default(10_000),
});

export interface IngestEnv {
  rpcUrls: string[];
  rpcConcurrency: number;
  logsChunkBlocks: number;
}

export function loadIngestEnv(env: NodeJS.ProcessEnv = process.env): IngestEnv {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Błędna konfiguracja: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")} (wymagane RPC_URL)`,
    );
  }
  const d = parsed.data;
  const fallbacks = d.RPC_FALLBACK_URLS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { rpcUrls: [d.RPC_URL, ...fallbacks], rpcConcurrency: d.RPC_CONCURRENCY, logsChunkBlocks: d.LOGS_CHUNK_BLOCKS };
}
