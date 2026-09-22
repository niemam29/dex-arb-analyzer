// Test parsowania argumentów CLI `npm run matrix -w @dex-arb/worker -- ...`.
// Funkcja czysta (argv -> opcje) — testowana niezależnie od `scripts/matrix.ts` (który robi I/O
// i nie jest objęty include workspace vitest).
import { describe, expect, it } from "vitest";
import { parseMatrixArgs } from "./args.js";

describe("parseMatrixArgs", () => {
  it("bez flag: dryRun/force=false, skipDone=true (domyślnie), pairs/windows=undefined", () => {
    expect(parseMatrixArgs([])).toEqual({
      pairs: undefined,
      windows: undefined,
      dryRun: false,
      force: false,
      skipDone: true,
    });
  });

  it("--dry-run i --force to flagi bezargumentowe", () => {
    expect(parseMatrixArgs(["--dry-run", "--force"])).toEqual({
      pairs: undefined,
      windows: undefined,
      dryRun: true,
      force: true,
      skipDone: true,
    });
  });

  it("--no-skip-done ustawia skipDone=false", () => {
    expect(parseMatrixArgs(["--no-skip-done"]).skipDone).toBe(false);
  });

  it("--pairs dzieli po przecinku i przycina spacje", () => {
    expect(parseMatrixArgs(["--pairs", "WETH/USDC, WETH/USDT ,WBTC/WETH"]).pairs).toEqual([
      "WETH/USDC",
      "WETH/USDT",
      "WBTC/WETH",
    ]);
  });

  it("--windows dopuszcza spacje w nazwie okna (dzieli tylko po przecinku)", () => {
    expect(parseMatrixArgs(["--windows", "2021-11 ATH,2022-05 Luna"]).windows).toEqual(["2021-11 ATH", "2022-05 Luna"]);
  });

  it("kombinacja wszystkich flag, w dowolnej kolejności", () => {
    expect(
      parseMatrixArgs(["--force", "--windows", "2021-05 krach", "--dry-run", "--no-skip-done", "--pairs", "WETH/USDC"]),
    ).toEqual({ pairs: ["WETH/USDC"], windows: ["2021-05 krach"], dryRun: true, force: true, skipDone: false });
  });
});
