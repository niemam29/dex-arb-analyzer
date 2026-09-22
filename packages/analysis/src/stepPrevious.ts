/**
 * Funkcja schodkowa „ostatnia znana wartość ≤ x" (krok wstecz, forward-fill) — bisekcja
 * wyodrębniona z `loadRefEthUsd` (ta sama bisekcja co `interpolateLinear` w `@dex-arb/core`,
 * tylko zwracająca wartość poprzedniego punktu zamiast interpolacji liniowej), teraz jedna,
 * przetestowana implementacja — używana przez referencyjny kurs ETH/USD. Poza zakresem próbek:
 * wartość skrajna (tak jak `interpolateLinear`), bez ekstrapolacji.
 */
export function stepPrevious(xs: number[], ys: number[]): (x: number) => number {
  if (xs.length !== ys.length) throw new Error("stepPrevious: xs i ys muszą mieć tę samą długość");
  if (xs.length === 0) throw new Error("stepPrevious: brak próbek");
  const pts = xs.map((x, i) => [x, ys[i]!] as const).sort((a, b) => a[0] - b[0]);
  const sx = pts.map((p) => p[0]);
  const sy = pts.map((p) => p[1]);
  return (x: number): number => {
    if (x <= sx[0]!) return sy[0]!;
    let lo = 0;
    let hi = sx.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (sx[mid]! <= x) lo = mid;
      else hi = mid;
    }
    return sx[hi]! <= x ? sy[hi]! : sy[lo]!;
  };
}
