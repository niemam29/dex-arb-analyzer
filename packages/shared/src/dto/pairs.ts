// DTO API dla par i puli — odpowiada `pairs`/`pools`/`dexes` w `@dex-arb/db`
// (packages/db/src/schema/config.ts); `dex_name` pochodzi z joina po stronie API.
import { z } from "zod";

export const PoolDto = z.object({
  id: z.number().int(),
  dex_id: z.number().int(),
  dex_name: z.string(),
  address: z.string(),
});
export type PoolDto = z.infer<typeof PoolDto>;

export const PairDto = z.object({
  id: z.number().int(),
  symbol: z.string(),
  token_base: z.string(),
  token_quote: z.string(),
  pools: z.array(PoolDto),
});
export type PairDto = z.infer<typeof PairDto>;

export const PairList = z.array(PairDto);
