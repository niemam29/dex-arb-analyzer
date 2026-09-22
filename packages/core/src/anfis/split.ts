/**
 * Podział indeksów próbek na zbiór treningowy/walidacyjny ze stratyfikacją po etykiecie
 * (spec §1.5: walidacja = 20% zbioru treningowego, stratyfikowana, seedowana). Stratyfikacja
 * jest ważna przy silnie niezbalansowanych klasach (~2% pozytywów) — losowy podział bez niej
 * mógłby zostawić zbiór walidacyjny bez ani jednej próbki dodatniej.
 */
import type { Rng } from "./random.js";
import { shuffleInPlace } from "./random.js";

export interface StratifiedSplit {
  train: number[];
  val: number[];
}

/**
 * Dzieli indeksy `0..labels.length-1` na `train`/`val` tak, by z każdej klasy do `val`
 * trafiło `round(valFraction * n_klasy)` indeksów (kolejność w obu zbiorach jest
 * potasowana, ale deterministyczna dla danego `rng`).
 */
export function splitStratified(labels: number[], valFraction: number, rng: Rng): StratifiedSplit {
  const byClass = new Map<number, number[]>();
  labels.forEach((y, i) => {
    const idx = byClass.get(y);
    if (idx) idx.push(i);
    else byClass.set(y, [i]);
  });

  const train: number[] = [];
  const val: number[] = [];
  for (const idx of byClass.values()) {
    shuffleInPlace(idx, rng);
    const nVal = Math.round(idx.length * valFraction);
    val.push(...idx.slice(0, nVal));
    train.push(...idx.slice(nVal));
  }
  return { train, val };
}

interface GroupInfo {
  idx: number[];
  hasPositive: boolean;
}

/**
 * Wariant `splitStratified` ŚWIADOMY GRUP (analogicznie do `computeGroupKeys`/`splitTrainTestByTime`
 * w `@dex-arb/analysis`): sąsiednie okazje potrafią dzielić TĘ SAMĄ konsumującą transakcję (lub
 * należeć do tego samego klastra kolejnych bloków tej samej pary) i mieć niemal identyczne
 * cechy/etykietę. Losowy podział próbka-po-próbce (jak `splitStratified`) mógłby taką grupę
 * rozdzielić między zbiór treningowy i walidacyjny wewnętrznego early-stoppingu — model
 * „widziałby" podczas treningu niemal ten sam przykład, który potem ocenia jako walidację, co
 * sztucznie zaniża stratę walidacyjną i psuje kryterium wczesnego zatrzymania. Ta funkcja nigdy
 * nie dzieli grupy: każda grupa z `groups[i]` trafia w CAŁOŚCI do `train` albo do `val`.
 *
 * Stratyfikacja jest po tym, czy grupa zawiera choć jedną próbkę dodatnią (`hasPositive`), nie po
 * pojedynczej etykiecie próbki (grupa może mieszać etykiety). Grupy z każdej z dwóch klas
 * (`hasPositive`/`!hasPositive`) są tasowane deterministycznie (`rng`) i dodawane do `val` po
 * kolei, aż liczba PRÓBEK DODATNICH (dla grup `hasPositive`) lub łączna liczba próbek (dla grup
 * `!hasPositive`) w `val` osiągnie w przybliżeniu `valFraction` odpowiedniej puli — z natury
 * granularności grup jest to przybliżenie, nie dokładny ułamek.
 */
export function splitStratifiedGroups(
  labels: number[],
  groups: (string | number)[],
  valFraction: number,
  rng: Rng,
): StratifiedSplit {
  if (labels.length !== groups.length) {
    throw new Error("splitStratifiedGroups: labels i groups muszą mieć tę samą długość");
  }

  const byGroup = new Map<string | number, number[]>();
  groups.forEach((g, i) => {
    const idx = byGroup.get(g);
    if (idx) idx.push(i);
    else byGroup.set(g, [i]);
  });

  const posGroups: GroupInfo[] = [];
  const otherGroups: GroupInfo[] = [];
  for (const idx of byGroup.values()) {
    const info: GroupInfo = { idx, hasPositive: idx.some((i) => labels[i] === 1) };
    (info.hasPositive ? posGroups : otherGroups).push(info);
  }

  // Tasowanie obu pul z JEDNEGO strumienia `rng` (kolejność wywołań ma znaczenie dla
  // determinizmu) — najpierw grupy z pozytywami, potem pozostałe.
  shuffleInPlace(posGroups, rng);
  shuffleInPlace(otherGroups, rng);

  const train: number[] = [];
  const val: number[] = [];

  const totalPos = labels.reduce((s, y) => s + (y === 1 ? 1 : 0), 0);
  const targetValPos = Math.round(totalPos * valFraction);
  let accPos = 0;
  for (const g of posGroups) {
    if (accPos < targetValPos) {
      val.push(...g.idx);
      accPos += g.idx.filter((i) => labels[i] === 1).length;
    } else {
      train.push(...g.idx);
    }
  }

  const totalOther = otherGroups.reduce((s, g) => s + g.idx.length, 0);
  const targetValOther = Math.round(totalOther * valFraction);
  let accOther = 0;
  for (const g of otherGroups) {
    if (accOther < targetValOther) {
      val.push(...g.idx);
      accOther += g.idx.length;
    } else {
      train.push(...g.idx);
    }
  }

  return { train, val };
}
