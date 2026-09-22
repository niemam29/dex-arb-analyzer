// Parsowanie argumentów CLI `npm run matrix -w @dex-arb/worker -- [--pairs a,b] [--windows a,b]
// [--dry-run] [--force] [--no-skip-done]`. Funkcja czysta, wołana przez
// `scripts/matrix.ts`.
export interface MatrixArgs {
  /** symbole par (--pairs WETH/USDC,WETH/USDT), undefined = wszystkie. */
  pairs: string[] | undefined;
  /** nazwy okien (--windows "2021-11 ATH,2022-05 Luna"), undefined = wszystkie; dzielone TYLKO
   * po przecinku (nazwy okien zawierają spacje). */
  windows: string[] | undefined;
  dryRun: boolean;
  force: boolean;
  /** domyślnie true; --no-skip-done wyłącza pomijanie ukończonych zadań. */
  skipDone: boolean;
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function splitList(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseMatrixArgs(argv: string[]): MatrixArgs {
  return {
    pairs: splitList(flag(argv, "pairs")),
    windows: splitList(flag(argv, "windows")),
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    skipDone: !argv.includes("--no-skip-done"),
  };
}
