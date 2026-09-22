/**
 * Deterministyczny generator liczb pseudolosowych (PRNG) na potrzeby treningu ANFIS
 * (spec §1.5: „cały pseudolosowy stan z mulberry32(seed)"). Ten sam seed ⇒ identyczny
 * ciąg liczb ⇒ powtarzalny podział zbioru i trening (bez `Math.random`).
 */

/** Funkcja zwracająca kolejną liczbę pseudolosową z przedziału [0,1). */
export type Rng = () => number;

/**
 * mulberry32 — mały (32-bit stanu), szybki, deterministyczny PRNG.
 * Referencja: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tasowanie Fishera–Yatesa w miejscu, sterowane podanym `rng` (deterministyczne dla danego seeda). */
export function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}
