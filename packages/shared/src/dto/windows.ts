// DTO API dla okien czasowych — odpowiada `windows` w `@dex-arb/db`
// (packages/db/src/schema/config.ts); `from_block`/`to_block` są null dopóki ingest ich
// nie wyznaczy (binary search po timestampach).
import { z } from "zod";

export const WindowDto = z.object({
  id: z.number().int(),
  name: z.string(),
  from_ts: z.string(),
  to_ts: z.string(),
  from_block: z.number().int().nullable(),
  to_block: z.number().int().nullable(),
});
export type WindowDto = z.infer<typeof WindowDto>;

export const WindowList = z.array(WindowDto);
