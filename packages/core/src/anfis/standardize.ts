/**
 * Standaryzacja cech dla konsekwentów ANFIS (spec §1.1): przesłanki (Gaussy) pracują na
 * wartościach surowych, ale konsekwenty (funkcje liniowe) na `x' = (x-mean)/std` — inaczej
 * cecha L (0–100 mln USD) dominowałaby nad S (0–3%) i Adam źle by się skalował.
 * `mean`/`std` liczone są na zbiorze treningowym i zapisywane w parametrach modelu, żeby
 * ewaluacja/inferencja używały dokładnie tej samej transformacji co trening.
 */
export interface Standardizer {
  mean: number[];
  std: number[];
}

/** Dolny próg odchylenia standardowego — chroni przed dzieleniem przez ~0 dla stałej kolumny. */
const STD_FLOOR = 1e-9;

/** Liczy średnią i odchylenie standardowe (populacyjne) per kolumna macierzy `X`. */
export function fitStandardizer(X: number[][]): Standardizer {
  const d = X[0]?.length ?? 0;
  const n = X.length;
  const mean = Array<number>(d).fill(0);
  const std = Array<number>(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] = mean[j]! + x[j]! / n;
  for (const x of X) for (let j = 0; j < d; j++) std[j] = std[j]! + (x[j]! - mean[j]!) ** 2 / n;
  for (let j = 0; j < d; j++) {
    std[j] = Math.sqrt(std[j]!);
    // Kolumna (prawie) stała: std=1 zamiast dzielenia przez ~0 (standaryzacja daje wtedy 0).
    if (std[j]! < STD_FLOOR) std[j] = 1;
  }
  return { mean, std };
}

/** `x' = (x - mean) / std` per współrzędna. */
export function standardize(x: number[], s: Standardizer): number[] {
  return x.map((v, j) => (v - s.mean[j]!) / s.std[j]!);
}

/** Odwrotność `standardize`: `x = x'·std + mean`. */
export function destandardize(z: number[], s: Standardizer): number[] {
  return z.map((v, j) => v * s.std[j]! + s.mean[j]!);
}
